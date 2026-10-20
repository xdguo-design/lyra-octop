from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

from octop.infra.workbench.project_service import (
    ProcessSpec,
    ProjectServiceManager,
    ProjectServiceProfile,
    _child_environment,
    normalize_repository_url,
    parse_profiles,
    resolve_project_root,
)


def _profile(relative_path: str = "data-upload-product") -> dict[str, object]:
    return {
        "repository_url": "https://github.com/xdguo-design/data-upload-product",
        "relative_path": relative_path,
        "backend": {
            "command": "go",
            "args": ["run", "./cmd/server"],
            "cwd": "backend",
            "port_env": "ADDR",
            "bind_host_env": None,
            "health_path": "/api/v1/health",
        },
        "frontend": {
            "command": "node",
            "args": ["doc/prototype/server.js"],
            "cwd": ".",
            "port_env": "PORT",
            "bind_host_env": "HOST",
            "health_path": "/",
        },
    }


def test_parse_profiles_matches_only_normalized_repository_url() -> None:
    profiles = parse_profiles([_profile()])

    assert profiles["https://github.com/xdguo-design/data-upload-product"].relative_path == (
        "data-upload-product"
    )
    assert parse_profiles([_profile()]).get("https://github.com/another/repo") is None
    assert (
        normalize_repository_url("https://github.com/xdguo-design/data-upload-product.git")
        == "https://github.com/xdguo-design/data-upload-product"
    )
    assert (
        normalize_repository_url("https://github.com:8443/xdguo-design/data-upload-product") is None
    )


def test_parse_profiles_rejects_shell_commands_and_invalid_relative_paths() -> None:
    profile = _profile()
    backend = profile["backend"]
    assert isinstance(backend, dict)
    backend["command"] = "go && whoami"
    with pytest.raises(ValueError, match="command"):
        parse_profiles([profile])

    with pytest.raises(ValueError, match="relative_path"):
        parse_profiles([_profile("../outside")])


def test_child_environment_does_not_inherit_octop_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OCTOP_ACCESS_TOKEN", "private-token")
    monkeypatch.setenv("PATH", "safe-path")

    child_env = _child_environment()

    assert child_env["PATH"] == "safe-path"
    assert "OCTOP_ACCESS_TOKEN" not in child_env


def test_resolve_project_root_rejects_symlink_escape(tmp_path: Path) -> None:
    code_root = tmp_path / "projects"
    code_root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    link = code_root / "data-upload-product"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("directory symlinks are unavailable")

    with pytest.raises(ValueError, match="workbench_code_root"):
        resolve_project_root(code_root, "data-upload-product")


@pytest.mark.asyncio
async def test_start_is_idempotent_and_stop_cleans_both_processes(tmp_path: Path) -> None:
    project_root = tmp_path / "data-upload-product"
    (project_root / "backend").mkdir(parents=True)
    url = "https://github.com/xdguo-design/data-upload-product"
    backend = ProcessSpec(
        sys.executable,
        (
            "-c",
            "import os; from http.server import HTTPServer,BaseHTTPRequestHandler; "
            "H=type('H',(BaseHTTPRequestHandler,),{'do_GET':lambda s:(s.send_response(200),s.end_headers())}); "
            "HTTPServer(('127.0.0.1',int(os.environ['ADDR'].rsplit(':',1)[1])),H).serve_forever()",
        ),
        "backend",
        "ADDR",
        None,
        "/health",
    )
    frontend = ProcessSpec(
        sys.executable,
        (
            "-c",
            "import os; from http.server import HTTPServer,BaseHTTPRequestHandler; "
            "H=type('H',(BaseHTTPRequestHandler,),{'do_GET':lambda s:(s.send_response(200),s.end_headers())}); "
            "HTTPServer(('127.0.0.1',int(os.environ['PORT'])),H).serve_forever()",
        ),
        ".",
        "PORT",
        "HOST",
        "/",
    )
    profile = ProjectServiceProfile(url, project_root.name, backend, frontend)
    manager = ProjectServiceManager(tmp_path, {url: profile})
    try:
        first, second = await asyncio.gather(manager.start(url), manager.start(url))
        assert first["status"] == "running"
        assert first["url"] == second["url"]
        assert len(manager._runtimes[url].processes) == 2
    finally:
        await manager.stop(url)
    assert manager.status(url) == {"status": "stopped", "url": None, "logs": None}


@pytest.mark.asyncio
async def test_start_failure_cleans_started_processes(tmp_path: Path) -> None:
    project_root = tmp_path / "data-upload-product"
    (project_root / "backend").mkdir(parents=True)
    url = "https://github.com/xdguo-design/data-upload-product"
    exits = ProcessSpec(sys.executable, ("-c", "raise SystemExit(2)"), "backend", "ADDR", None, "/")
    unused = ProcessSpec(sys.executable, ("-c", "pass"), ".", "PORT", "HOST", "/")
    manager = ProjectServiceManager(
        tmp_path,
        {url: ProjectServiceProfile(url, project_root.name, exits, unused)},
    )

    with pytest.raises(RuntimeError, match="exited before health check"):
        await manager.start(url)
    assert manager.status(url)["status"] == "failed"
    assert manager._runtimes[url].processes == []
    await manager.close()
