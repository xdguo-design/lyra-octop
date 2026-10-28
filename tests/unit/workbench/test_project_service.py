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
    _DockerRuntime,
    normalize_repository_branch,
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
        normalize_repository_url("https://cnb.cool/xdguo/octop.git")
        == "https://cnb.cool/xdguo/octop"
    )
    assert (
        normalize_repository_url("https://cnb.cool/group/subgroup/octop")
        == "https://cnb.cool/group/subgroup/octop"
    )
    assert normalize_repository_url("https://evil.example/xdguo/octop") is None
    assert (
        normalize_repository_url("https://github.com:8443/xdguo-design/data-upload-product") is None
    )
    assert normalize_repository_url("https://github.com/../escape") is None
    assert normalize_repository_branch(None) is None
    assert normalize_repository_branch(" dev ") == "dev"
    assert normalize_repository_branch("feature/admission-ui") == "feature/admission-ui"
    assert normalize_repository_branch("--upload-pack=evil") is None
    assert normalize_repository_branch("../outside") is None


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


@pytest.mark.asyncio
async def test_github_project_clones_builds_and_manages_a_loopback_container(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = "https://github.com/xdguo-design/lyra-gateway"
    manager = ProjectServiceManager(None, {}, tmp_path / "projects", "preview.example.com")
    calls: list[tuple[str, ...]] = []
    project_id = "project-1"

    async def fake_command(*args: str, cwd: Path | None = None, **_kwargs: object) -> str:
        calls.append(args)
        if args[:2] == ("git", "clone"):
            target = Path(args[-1])
            target.mkdir()
            (target / "Dockerfile").write_text("FROM scratch\nEXPOSE 8765\n", encoding="utf-8")
        if args[:2] == ("docker", "port"):
            return "127.0.0.1:49152"
        if args[:3] == ("docker", "image", "inspect"):
            return ""  # No cached image.
        if args[:2] == ("docker", "inspect"):
            return "running" if any(call[:2] == ("docker", "run") for call in calls) else ""
        return "ok"

    async def healthy(_url: str) -> None:
        return None

    monkeypatch.setattr(manager, "_docker_command", fake_command)
    monkeypatch.setattr(manager, "_wait_docker_health", healthy)

    assert manager.has_profile(url)
    first = await manager.start(url, project_id)
    second = await manager.start(url, project_id)
    assert first["status"] == "running"
    assert first["url"].startswith("https://")
    assert second == first
    preview_host = first["url"].removeprefix("https://")
    assert manager.is_preview_host(preview_host)
    assert manager.preview_upstream_for_host(preview_host) == "http://127.0.0.1:49152"
    assert manager.preview_upstream_for_host("unknown.preview.example.com") is None
    assert not manager.is_preview_host("random.preview.example.com.evil")
    assert manager.thumbnail_origins(url, project_id) == ("http://127.0.0.1:49152",)
    assert sum(call[:2] == ("git", "clone") for call in calls) == 1
    assert sum(call[:2] == ("docker", "run") for call in calls) == 1
    assert any("127.0.0.1::8765" in call for call in calls)

    stopped = await manager.stop(url, project_id)
    assert stopped["status"] == "stopped"
    assert manager.preview_upstream_for_host(preview_host) is None
    assert any(call[:2] == ("docker", "stop") for call in calls)
    assert manager._docker_names(url, project_id)[1] != manager._docker_names(url, "project-2")[1]


@pytest.mark.asyncio
async def test_github_project_without_dockerfile_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = "https://github.com/example/no-image"
    manager = ProjectServiceManager(None, {}, tmp_path / "projects")

    async def fake_clone(_url: str, checkout: Path, _access_token: str | None = None) -> None:
        checkout.mkdir(parents=True)

    async def fake_command(*_args: str, **_kwargs: object) -> str:
        return "ok"

    monkeypatch.setattr(manager, "_clone_project", fake_clone)
    monkeypatch.setattr(manager, "_docker_command", fake_command)
    with pytest.raises(RuntimeError, match="Dockerfile"):
        await manager.start(url, "project-1")
    assert manager.status(url, "project-1")["status"] == "failed"
    assert manager.thumbnail_origins(url, "project-1") == ()


@pytest.mark.asyncio
async def test_project_update_pulls_fast_forward_and_invalidates_old_preview(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = "https://cnb.cool/example/project"
    project_id = "project-1"
    manager = ProjectServiceManager(None, {}, tmp_path / "projects")
    checkout, container, image = manager._docker_names(url, project_id)
    assert manager._docker_names(f"{url}.git", project_id) == (checkout, container, image)
    checkout.mkdir(parents=True)
    calls: list[tuple[tuple[str, ...], Path | None]] = []

    async def fake_command(*args: str, cwd: Path | None = None, **_kwargs: object) -> str:
        calls.append((args, cwd))
        if args[:4] == ("git", "remote", "get-url", "origin"):
            return url
        return ""

    monkeypatch.setattr(manager, "_docker_command", fake_command)
    runtime = manager._docker_runtimes.setdefault(
        (url, project_id), _DockerRuntime(url, project_id)
    )
    runtime.status = "running"
    runtime.url = "https://preview.example.com"

    await manager.update(url, project_id)

    assert ("git", "pull", "--ff-only") in [args for args, _cwd in calls]
    assert any(args == ("docker", "rm", "--force", container) for args, _cwd in calls)
    assert any(args == ("docker", "image", "rm", image) for args, _cwd in calls)
    assert manager.status(url, project_id)["status"] == "stopped"


@pytest.mark.asyncio
async def test_project_update_keeps_preview_when_checkout_has_local_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = "https://github.com/example/project"
    manager = ProjectServiceManager(None, {}, tmp_path / "projects")
    checkout, _container, _image = manager._docker_names(url, "project-1")
    checkout.mkdir(parents=True)
    calls: list[tuple[str, ...]] = []

    async def fake_command(*args: str, **_kwargs: object) -> str:
        calls.append(args)
        if args[:4] == ("git", "remote", "get-url", "origin"):
            return url
        if args[:3] == ("git", "status", "--porcelain"):
            return " M source.py"
        return ""

    monkeypatch.setattr(manager, "_docker_command", fake_command)
    with pytest.raises(RuntimeError, match="local changes"):
        await manager.update(url, "project-1")

    assert not any(args[:2] == ("docker", "rm") for args in calls)
    assert not any(args[:2] == ("git", "pull") for args in calls)


@pytest.mark.asyncio
async def test_project_update_clones_repository_on_first_use(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = "https://cnb.cool/group/subgroup/project"
    manager = ProjectServiceManager(None, {}, tmp_path / "projects")
    checkout, _container, _image = manager._docker_names(url, "project-1")
    calls: list[tuple[str, ...]] = []

    async def fake_command(*args: str, **_kwargs: object) -> str:
        calls.append(args)
        if args[:2] == ("git", "clone"):
            Path(args[-1]).mkdir()
        if args[:4] == ("git", "remote", "get-url", "origin"):
            return url
        if args[:3] == ("git", "ls-remote", "--symref"):
            return "ref: refs/heads/main\tHEAD\nabc123\tHEAD\n"
        if args[:3] == ("git", "branch", "--show-current"):
            return "main"
        return ""

    monkeypatch.setattr(manager, "_docker_command", fake_command)
    await manager.update(url, "project-1", source_only=True)

    assert any(args[:2] == ("git", "clone") for args in calls)
    assert checkout.is_dir()
    assert ("git", "pull", "--ff-only", "origin", "main") in calls
    assert all(args[0] == "git" for args in calls)


@pytest.mark.asyncio
async def test_source_only_update_switches_to_selected_remote_branch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = "https://github.com/example/project"
    manager = ProjectServiceManager(None, {}, tmp_path / "projects")
    checkout, _container, _image = manager._docker_names(url, "app:1:admission-registration")
    checkout.mkdir(parents=True)
    calls: list[tuple[str, ...]] = []

    async def fake_command(*args: str, **_kwargs: object) -> str:
        calls.append(args)
        if args[:4] == ("git", "remote", "get-url", "origin"):
            return url
        if args[:3] == ("git", "branch", "--show-current"):
            return "main"
        return ""

    monkeypatch.setattr(manager, "_docker_command", fake_command)
    await manager.update(
        url,
        "app:1:admission-registration",
        source_only=True,
        repository_branch="dev",
    )

    assert (
        "git",
        "fetch",
        "--depth",
        "1",
        "origin",
        "+refs/heads/dev:refs/remotes/origin/dev",
    ) in calls
    assert ("git", "switch", "--track", "-c", "dev", "origin/dev") in calls
    assert ("git", "pull", "--ff-only", "origin", "dev") in calls


@pytest.mark.asyncio
async def test_cnb_git_auth_uses_and_removes_temporary_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manager = ProjectServiceManager(None, {}, tmp_path / "projects")
    token = "secret/token value"
    captured: dict[str, object] = {}

    async def fake_command(*args: str, **_kwargs: object) -> str:
        captured["args"] = args
        helper = next(arg for arg in args if arg.startswith("credential.helper="))
        credential_file = Path(helper.split("--file=", 1)[1].strip("'\""))
        captured["credential_file"] = credential_file
        captured["contents"] = credential_file.read_text(encoding="utf-8")
        return ""

    monkeypatch.setattr(manager, "_docker_command", fake_command)
    await manager._git_command(token, "pull", "--ff-only")

    args = captured["args"]
    assert isinstance(args, tuple)
    assert token not in " ".join(args)
    assert captured["contents"] == "https://cnb:secret%2Ftoken%20value@cnb.cool\n"
    credential_file = captured["credential_file"]
    assert isinstance(credential_file, Path)
    assert not credential_file.exists()
