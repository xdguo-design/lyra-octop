"""Install / build / start plans for repositories bound to a creation card.

Octop hosts a bound GitHub or CNB repository by cloning it and running it on
the host. The repository itself decides how: a ``Dockerfile`` wins, then a
Node project, then a Python project, then a plain static site. This module
only decides *which commands to run*; :class:`ProjectServiceManager` owns the
processes, ports and health checks.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

PlanKind = Literal["docker", "node", "python", "static"]

# Placeholder replaced with the allocated loopback port right before spawn.
PORT_PLACEHOLDER = "{port}"

# Build outputs Octop serves as a static site once a Node build has finished.
STATIC_OUTPUT_DIRS = ("dist", "build", "out")


class DeployPlanError(RuntimeError):
    """Raised when a checkout cannot be deployed automatically."""


@dataclass(frozen=True)
class DeployCommand:
    command: str
    args: tuple[str, ...] = ()
    cwd: str = "."


@dataclass(frozen=True)
class DeployPlan:
    kind: PlanKind
    install: tuple[DeployCommand, ...]
    build: tuple[DeployCommand, ...]
    start: DeployCommand | None
    port_env: str = "PORT"
    bind_host_env: str | None = "HOST"
    health_path: str = "/"
    # Checked after a successful build; the first directory that contains
    # ``index.html`` is served statically instead of running ``start``.
    static_dirs: tuple[str, ...] = ()


def static_start(directory: str) -> DeployCommand:
    # The port is positional: ``--port`` is not accepted by every Python
    # version that ships ``http.server``.
    return DeployCommand(
        "python",
        (
            "-m",
            "http.server",
            PORT_PLACEHOLDER,
            "--bind",
            "127.0.0.1",
            "--directory",
            directory,
        ),
    )


def _static_plan(directory: str) -> DeployPlan:
    return DeployPlan(
        "static",
        (),
        (),
        static_start(directory),
        port_env="PORT",
        bind_host_env=None,
    )


def _node_package_manager(root: Path) -> str:
    for lockfile, manager in (
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("bun.lockb", "bun"),
        ("bun.lock", "bun"),
    ):
        if (root / lockfile).is_file():
            return manager
    return "npm"


def _node_plan(root: Path) -> DeployPlan:
    try:
        manifest = json.loads((root / "package.json").read_text("utf-8", errors="replace"))
    except (OSError, ValueError) as exc:
        raise DeployPlanError("package.json 无法解析") from exc
    scripts = manifest.get("scripts") if isinstance(manifest, dict) else None
    scripts = scripts if isinstance(scripts, dict) else {}
    manager = _node_package_manager(root)
    install = (DeployCommand(manager, ("install",)),)
    build = (DeployCommand(manager, ("run", "build")),) if "build" in scripts else ()
    start: DeployCommand | None = None
    if "start" in scripts:
        start = DeployCommand(manager, ("run", "start"))
    elif "preview" in scripts:
        start = DeployCommand(
            manager,
            ("run", "preview", "--", "--host", "127.0.0.1", "--port", PORT_PLACEHOLDER),
        )
    if build:
        return DeployPlan(
            "node",
            install,
            build,
            start,
            static_dirs=STATIC_OUTPUT_DIRS,
        )
    if start is not None:
        return DeployPlan("node", install, (), start)
    raise DeployPlanError("package.json 里没有 build / start / preview 脚本，无法自动启动")


def _venv_python() -> str:
    if os.name == "nt":
        return ".venv/Scripts/python.exe"
    return ".venv/bin/python"


def _python_entry(root: Path) -> tuple[str, str] | None:
    """Return ``(module, attribute)`` for an ASGI/WSGI app, if one is obvious."""
    for name in ("app.py", "main.py", "server.py"):
        path = root / name
        if not path.is_file():
            continue
        try:
            source = path.read_text("utf-8", errors="replace")
        except OSError:
            continue
        if "FastAPI(" in source or "Flask(" in source:
            return path.stem, "app"
    return None


def _python_plan(root: Path) -> DeployPlan:
    venv_python = _venv_python()
    install_cmds: list[DeployCommand] = [DeployCommand("python", ("-m", "venv", ".venv"))]
    if (root / "requirements.txt").is_file():
        install_cmds.append(
            DeployCommand(venv_python, ("-m", "pip", "install", "-r", "requirements.txt"))
        )
    else:
        install_cmds.append(DeployCommand(venv_python, ("-m", "pip", "install", "-e", ".")))
    entry = _python_entry(root)
    if entry is not None:
        module, attribute = entry
        start = DeployCommand(
            venv_python,
            (
                "-m",
                "uvicorn",
                f"{module}:{attribute}",
                "--host",
                "127.0.0.1",
                "--port",
                PORT_PLACEHOLDER,
            ),
        )
    else:
        script = next(
            (
                name
                for name in ("main.py", "app.py", "server.py", "run.py")
                if (root / name).is_file()
            ),
            None,
        )
        if script is None:
            raise DeployPlanError(
                "没有找到可直接启动的 Python 入口（app.py / main.py / server.py）"
            )
        start = DeployCommand(venv_python, (script,))
    return DeployPlan("python", tuple(install_cmds), (), start)


def detect_deploy_plan(root: Path) -> DeployPlan:
    """Pick the install / build / start commands for a checked-out project."""
    if not root.is_dir():
        raise DeployPlanError("项目代码还没有下载到本地")
    if (root / "Dockerfile").is_file():
        return DeployPlan("docker", (), (), None)
    if (root / "package.json").is_file():
        return _node_plan(root)
    if (root / "pyproject.toml").is_file() or (root / "requirements.txt").is_file():
        return _python_plan(root)
    if (root / "index.html").is_file():
        return _static_plan(".")
    for output in STATIC_OUTPUT_DIRS:
        if (root / output / "index.html").is_file():
            return _static_plan(output)
    raise DeployPlanError(
        "仓库里没有 Dockerfile、package.json、Python 依赖或 index.html，无法自动安装"
    )
