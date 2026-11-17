from __future__ import annotations

import json
from pathlib import Path

import pytest

from octop.infra.workbench.deploy_plan import (
    PORT_PLACEHOLDER,
    DeployPlanError,
    detect_deploy_plan,
)
from octop.infra.workbench.project_service import parse_git_progress


def _node_project(root: Path, scripts: dict[str, str], lockfile: str | None = None) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "package.json").write_text(
        json.dumps({"name": "demo", "scripts": scripts}), encoding="utf-8"
    )
    if lockfile:
        (root / lockfile).write_text("", encoding="utf-8")
    return root


def test_dockerfile_wins_over_every_other_flavour(tmp_path: Path) -> None:
    root = _node_project(tmp_path / "app", {"start": "node server.js"})
    (root / "Dockerfile").write_text("FROM node:22\nEXPOSE 3000\n", encoding="utf-8")

    plan = detect_deploy_plan(root)

    assert plan.kind == "docker"
    assert plan.install == ()
    assert plan.start is None


def test_node_build_project_serves_the_build_output(tmp_path: Path) -> None:
    root = _node_project(tmp_path / "app", {"build": "vite build", "start": "node server.js"})

    plan = detect_deploy_plan(root)

    assert plan.kind == "node"
    assert [command.args for command in plan.install] == [("install",)]
    assert plan.build[0].args == ("run", "build")
    assert plan.static_dirs == ("dist", "build", "out")
    assert plan.start is not None and plan.start.args == ("run", "start")
    assert PORT_PLACEHOLDER in plan.start.args or plan.start.command == "npm"


def test_node_project_uses_the_lockfile_package_manager(tmp_path: Path) -> None:
    root = _node_project(tmp_path / "app", {"start": "node server.js"}, "pnpm-lock.yaml")

    plan = detect_deploy_plan(root)

    assert plan.install[0].command == "pnpm"
    assert plan.start is not None and plan.start.command == "pnpm"


def test_node_project_without_scripts_is_rejected(tmp_path: Path) -> None:
    root = _node_project(tmp_path / "app", {})

    with pytest.raises(DeployPlanError, match="build / start / preview"):
        detect_deploy_plan(root)


def test_static_site_is_served_on_the_allocated_port(tmp_path: Path) -> None:
    root = tmp_path / "site"
    root.mkdir()
    (root / "index.html").write_text("<html></html>", encoding="utf-8")

    plan = detect_deploy_plan(root)

    assert plan.kind == "static"
    assert plan.start is not None
    assert plan.start.command == "python"
    assert plan.start.args[-1] == "."
    assert PORT_PLACEHOLDER in plan.start.args


def test_python_project_bootstraps_a_venv_and_runs_uvicorn(tmp_path: Path) -> None:
    root = tmp_path / "api"
    root.mkdir()
    (root / "requirements.txt").write_text("fastapi\n", encoding="utf-8")
    (root / "app.py").write_text("from fastapi import FastAPI\napp = FastAPI()\n", encoding="utf-8")

    plan = detect_deploy_plan(root)

    assert plan.kind == "python"
    assert plan.install[0].args == ("-m", "venv", ".venv")
    assert plan.install[1].args[:4] == ("-m", "pip", "install", "-r")
    assert plan.start is not None
    assert "uvicorn" in plan.start.args
    assert "app:app" in plan.start.args
    assert PORT_PLACEHOLDER in plan.start.args


def test_unknown_checkout_has_no_deploy_plan(tmp_path: Path) -> None:
    root = tmp_path / "empty"
    root.mkdir()

    with pytest.raises(DeployPlanError, match="无法自动安装"):
        detect_deploy_plan(root)


def test_parse_git_progress_maps_each_phase_onto_the_whole_download() -> None:
    counting = parse_git_progress("Counting objects: 100% (120/120), done.")
    receiving = parse_git_progress("Receiving objects:  67% (67/100), 1.2 MiB | 2.0 MiB/s")
    resolving = parse_git_progress("Resolving deltas: 100% (42/42), done.")

    assert counting == 8
    assert receiving is not None and 20 < receiving < 92
    assert resolving == 100
    assert parse_git_progress("Cloning into 'source'...") is None
    assert parse_git_progress("remote: Enumerating objects: 12, done.") is None
