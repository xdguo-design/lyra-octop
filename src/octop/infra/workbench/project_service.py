"""Host-managed local preview services for explicitly trusted workbench projects."""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
from collections import deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from pathlib import Path, PureWindowsPath
from typing import Any
from urllib.parse import quote, urlsplit

import httpx

from octop.infra.utils import posix_compat
from octop.infra.workbench.deploy_plan import (
    PORT_PLACEHOLDER,
    DeployCommand,
    detect_deploy_plan,
    static_start,
)

_REPO_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
_REPO_HOSTS = {"github.com", "cnb.cool"}
_ENV_NAME_RE = re.compile(r"^[A-Z_][A-Z0-9_]*$")
_COMMAND_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
_MAX_LOG_BYTES = 8192
_START_TIMEOUT = 30.0
_DOCKER_BUILD_TIMEOUT = 900.0
_DOCKER_START_TIMEOUT = 60.0
_DEPLOY_INSTALL_TIMEOUT = 900.0
_DEPLOY_HEALTH_TIMEOUT = 120.0
_GIT_PROGRESS_RE = re.compile(
    r"(Counting objects|Compressing objects|Receiving objects|Resolving deltas):\s+(\d+)%"
)
# Overall download percent attributed to each git phase.
_GIT_PHASE_RANGES = {
    "Counting objects": (0, 8),
    "Compressing objects": (8, 20),
    "Receiving objects": (20, 92),
    "Resolving deltas": (92, 100),
}
_PREVIEW_DOMAIN_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_CHILD_ENV_KEYS = {
    "APPDATA",
    "GOCACHE",
    "GOMODCACHE",
    "GOPATH",
    "GOROOT",
    "GOTOOLCHAIN",
    "LOCALAPPDATA",
    "NODE_PATH",
    "NPM_CONFIG_PREFIX",
    "PATH",
    "PATHEXT",
    "PROGRAMFILES",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
}


@dataclass(frozen=True)
class ProcessSpec:
    command: str
    args: tuple[str, ...]
    cwd: str
    port_env: str
    bind_host_env: str | None
    health_path: str


@dataclass(frozen=True)
class ProjectServiceProfile:
    repository_url: str
    relative_path: str
    backend: ProcessSpec
    frontend: ProcessSpec


@dataclass
class _RunningProcess:
    process: asyncio.subprocess.Process
    output: bytearray = field(default_factory=bytearray)
    reader_task: asyncio.Task[None] | None = None


@dataclass
class _ProjectRuntime:
    profile: ProjectServiceProfile
    status: str = "stopped"
    url: str | None = None
    upstream_url: str | None = None
    preview_token: str | None = None
    processes: list[_RunningProcess] = field(default_factory=list)
    logs: deque[str] = field(default_factory=lambda: deque(maxlen=2))
    thumbnail_origins: tuple[str, ...] = ()


@dataclass
class _DockerRuntime:
    repository_url: str
    project_id: str | None
    status: str = "stopped"
    url: str | None = None
    upstream_url: str | None = None
    preview_token: str | None = None
    logs: deque[str] = field(default_factory=lambda: deque(maxlen=2))


@dataclass
class _JobState:
    """Progress of a one-shot background job (code download)."""

    status: str = "idle"  # idle | running | done | failed | cancelled
    percent: int = 0
    message: str = ""
    logs: deque[str] = field(default_factory=lambda: deque(maxlen=12))
    task: asyncio.Task[None] | None = None
    process: asyncio.subprocess.Process | None = None
    temp_dir: str | None = None

    def snapshot(self) -> dict[str, str | int | None]:
        return {
            "status": self.status,
            "percent": max(0, min(100, self.percent)),
            "message": self.message or None,
            "logs": "\n".join(self.logs)[-_MAX_LOG_BYTES:] or None,
        }


@dataclass
class _DeployRuntime:
    """Auto-deployed checkout: install/build commands plus the serving process."""

    repository_url: str
    project_id: str | None
    job: _JobState = field(default_factory=_JobState)
    status: str = "stopped"  # stopped | starting | running | failed
    url: str | None = None
    upstream_url: str | None = None
    preview_token: str | None = None
    kind: str | None = None
    processes: list[_RunningProcess] = field(default_factory=list)
    thumbnail_origins: tuple[str, ...] = ()


def parse_git_progress(line: str) -> int | None:
    """Map a ``git --progress`` stderr line onto an overall 0-100 percent."""
    match = _GIT_PROGRESS_RE.search(line)
    if match is None:
        return None
    low, high = _GIT_PHASE_RANGES[match.group(1)]
    phase = min(100, int(match.group(2)))
    return low + round((high - low) * phase / 100)


def normalize_repository_url(value: str) -> str | None:
    try:
        parsed = urlsplit(value.strip())
        parts = parsed.path.strip("/").removesuffix(".git").split("/")
        host = parsed.hostname.lower() if parsed.hostname else ""
        if (
            parsed.scheme.lower() != "https"
            or host not in _REPO_HOSTS
            or parsed.port is not None
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or len(parts) < 2
            or (host == "github.com" and len(parts) != 2)
            or any(not _REPO_SEGMENT_RE.fullmatch(part) or part in {".", ".."} for part in parts)
        ):
            return None
        normalized_parts = [part.lower() for part in parts] if host == "github.com" else parts
        return f"https://{host}/{'/'.join(normalized_parts)}"
    except ValueError:
        return None


def normalize_repository_branch(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    branch = value.strip()
    if (
        len(branch) > 255
        or branch.startswith(("-", "/"))
        or branch.endswith(("/", "."))
        or ".." in branch
        or "@{" in branch
        or branch == "@"
        or "//" in branch
        or "\\" in branch
        or any(ord(char) < 32 or ord(char) == 127 or char in " ~^:?*[" for char in branch)
        or any(part.startswith(".") or part.endswith(".lock") for part in branch.split("/"))
        or any(part in {"", ".", ".."} for part in branch.split("/"))
    ):
        return None
    return branch


def _normalize_preview_domain(value: str | None) -> str | None:
    if not value:
        return None
    domain = value.strip().lower().rstrip(".")
    labels = domain.split(".")
    if (
        len(domain) > 253
        or len(labels) < 2
        or not any(char.isalpha() for char in domain)
        or any(len(label) > 63 or not _PREVIEW_DOMAIN_LABEL_RE.fullmatch(label) for label in labels)
    ):
        raise ValueError("workbench_preview_domain must be a DNS name without scheme or wildcard")
    return domain


def _process_spec(raw: Any, field_name: str) -> ProcessSpec:
    if not isinstance(raw, dict):
        raise ValueError(f"{field_name} must be an object")
    command = raw.get("command")
    args = raw.get("args")
    cwd = raw.get("cwd")
    port_env = raw.get("port_env")
    bind_host_env = raw.get("bind_host_env")
    health_path = raw.get("health_path")
    if not isinstance(command, str) or not _COMMAND_RE.fullmatch(command):
        raise ValueError(f"{field_name}.command must be a program name without a path")
    if (
        not isinstance(args, list)
        or len(args) > 64
        or any(not isinstance(arg, str) or any(ord(char) < 32 for char in arg) for arg in args)
    ):
        raise ValueError(f"{field_name}.args must be a list of plain strings")
    if (
        not isinstance(cwd, str)
        or not cwd
        or Path(cwd).is_absolute()
        or PureWindowsPath(cwd).is_absolute()
        or any(part == ".." for part in cwd.replace("\\", "/").split("/"))
    ):
        raise ValueError(f"{field_name}.cwd must be a relative path without traversal")
    if port_env not in {"ADDR", "PORT"}:
        raise ValueError(f"{field_name}.port_env must be ADDR or PORT")
    if bind_host_env is not None and (
        not isinstance(bind_host_env, str) or not _ENV_NAME_RE.fullmatch(bind_host_env)
    ):
        raise ValueError(f"{field_name}.bind_host_env must be null or an environment variable")
    if not isinstance(health_path, str) or not health_path.startswith("/"):
        raise ValueError(f"{field_name}.health_path must be an absolute HTTP path")
    return ProcessSpec(command, tuple(args), cwd, port_env, bind_host_env, health_path)


def parse_profiles(raw_profiles: Any) -> dict[str, ProjectServiceProfile]:
    if not isinstance(raw_profiles, list):
        raise ValueError("workbench_launch_profiles must be a list")
    profiles: dict[str, ProjectServiceProfile] = {}
    for raw in raw_profiles:
        if not isinstance(raw, dict):
            raise ValueError("workbench launch profile must be an object")
        repository_url = raw.get("repository_url")
        normalized = (
            normalize_repository_url(repository_url) if isinstance(repository_url, str) else None
        )
        if normalized is None or normalized in profiles:
            raise ValueError("workbench launch profile repository_url is invalid or duplicated")
        relative_path = raw.get("relative_path")
        if (
            not isinstance(relative_path, str)
            or not relative_path
            or Path(relative_path).is_absolute()
            or PureWindowsPath(relative_path).is_absolute()
            or any(part == ".." for part in relative_path.replace("\\", "/").split("/"))
        ):
            raise ValueError("workbench launch profile relative_path is invalid")
        profiles[normalized] = ProjectServiceProfile(
            normalized,
            relative_path,
            _process_spec(raw.get("backend"), "backend"),
            _process_spec(raw.get("frontend"), "frontend"),
        )
    return profiles


def resolve_project_root(code_root: str | Path | None, relative_path: str) -> Path:
    if not code_root:
        raise ValueError("workbench_code_root is not configured")
    root = Path(code_root).resolve(strict=True)
    target = (root / relative_path).resolve(strict=True)
    if not target.is_dir() or not target.is_relative_to(root):
        raise ValueError("project path escapes workbench_code_root")
    return target


def _free_port(exclude: set[int] | None = None) -> int:
    excluded = exclude or set()
    with socket.socket() as sock:
        for _ in range(20):
            sock.bind(("127.0.0.1", 0))
            port = int(sock.getsockname()[1])
            if port not in excluded:
                return port
            sock.close()
            sock = socket.socket()
    raise OSError("unable to allocate a distinct local port")


def _redact_log(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace")
    text = re.sub(
        r"(?i)(bearer\s+|(?:access[_-]?token|refresh[_-]?token|token|password|secret|credential|api[_-]?key|database_url)[=: ]+)\S+",
        r"\1[redacted]",
        text,
    )
    return text[-_MAX_LOG_BYTES:]


def _child_environment() -> dict[str, str]:
    return {key: value for key, value in os.environ.items() if key.upper() in _CHILD_ENV_KEYS}


async def _read_output(running: _RunningProcess) -> None:
    stream = running.process.stdout
    if stream is None:
        return
    while chunk := await stream.read(1024):
        running.output.extend(chunk)
        if len(running.output) > _MAX_LOG_BYTES:
            del running.output[:-_MAX_LOG_BYTES]


async def _terminate(running: _RunningProcess) -> None:
    process = running.process
    if process.returncode is not None:
        return
    if os.name == "nt":
        killer = await asyncio.create_subprocess_exec(
            "taskkill",
            "/PID",
            str(process.pid),
            "/T",
            "/F",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await killer.wait()
    else:
        with suppress(ProcessLookupError):
            posix_compat.killpg(process.pid, signal.SIGTERM)
    try:
        await asyncio.wait_for(process.wait(), timeout=3)
    except TimeoutError:
        if os.name != "nt":
            with suppress(ProcessLookupError):
                posix_compat.killpg(process.pid, posix_compat.sigkill())
        await process.wait()
    if running.reader_task is not None:
        running.reader_task.cancel()
        await asyncio.gather(running.reader_task, return_exceptions=True)


async def _kill_process(process: asyncio.subprocess.Process) -> None:
    """Stop a helper process (git, installers) without raising."""
    if process.returncode is not None:
        return
    if os.name == "nt":
        with suppress(OSError):
            killer = await asyncio.create_subprocess_exec(
                "taskkill",
                "/PID",
                str(process.pid),
                "/T",
                "/F",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await killer.wait()
    else:
        with suppress(ProcessLookupError):
            posix_compat.killpg(process.pid, signal.SIGTERM)
    with suppress(TimeoutError):
        await asyncio.wait_for(process.wait(), timeout=5)


class ProjectServiceManager:
    def __init__(
        self,
        code_root: str | Path | None,
        profiles: dict[str, ProjectServiceProfile],
        project_root: str | Path | None = None,
        preview_domain: str | None = None,
    ) -> None:
        self._code_root = code_root
        self._profiles = profiles
        self._runtimes: dict[str, _ProjectRuntime] = {}
        self._project_root = Path(project_root) if project_root is not None else None
        self._preview_domain = _normalize_preview_domain(preview_domain)
        self._docker_runtimes: dict[tuple[str, str | None], _DockerRuntime] = {}
        self._downloads: dict[tuple[str, str | None], _JobState] = {}
        self._deploys: dict[tuple[str, str | None], _DeployRuntime] = {}
        self._lock = asyncio.Lock()

    def status(self, repository_url: str, project_id: str | None = None) -> dict[str, str | None]:
        key = normalize_repository_url(repository_url)
        if key is not None and key not in self._profiles:
            deploy_runtime = self._deploys.get((key, project_id))
            if deploy_runtime is not None and deploy_runtime.status in {
                "starting",
                "running",
                "failed",
            }:
                if deploy_runtime.status == "running" and any(
                    item.process.returncode is not None for item in deploy_runtime.processes
                ):
                    deploy_runtime.status = "failed"
                    deploy_runtime.url = None
                return {
                    "status": deploy_runtime.status,
                    "url": deploy_runtime.url,
                    "logs": "\n".join(deploy_runtime.job.logs)[-_MAX_LOG_BYTES:] or None,
                }
            docker_runtime = self._docker_runtimes.get((key, project_id))
            return {
                "status": docker_runtime.status if docker_runtime else "stopped",
                "url": docker_runtime.url if docker_runtime else None,
                "logs": "\n".join(docker_runtime.logs)[-_MAX_LOG_BYTES:] or None
                if docker_runtime
                else None,
            }
        process_runtime = self._runtimes.get(key or "")
        if process_runtime is None:
            return {"status": "stopped", "url": None, "logs": None}
        if process_runtime.status == "running" and any(
            p.process.returncode is not None for p in process_runtime.processes
        ):
            process_runtime.status = "failed"
            process_runtime.url = None
        return {
            "status": process_runtime.status,
            "url": process_runtime.url,
            "logs": "\n".join(process_runtime.logs)[-_MAX_LOG_BYTES:] or None,
        }

    def has_profile(self, repository_url: str) -> bool:
        key = normalize_repository_url(repository_url)
        return key is not None and (key in self._profiles or self._project_root is not None)

    def thumbnail_origins(
        self, repository_url: str, project_id: str | None = None
    ) -> tuple[str, ...]:
        key = normalize_repository_url(repository_url)
        if key is not None and key not in self._profiles:
            deploy_runtime = self._deploys.get((key, project_id))
            if (
                deploy_runtime is not None
                and deploy_runtime.status == "running"
                and deploy_runtime.upstream_url
            ):
                return (deploy_runtime.upstream_url,)
            docker_runtime = self._docker_runtimes.get((key, project_id))
            return (
                (docker_runtime.upstream_url,)
                if docker_runtime
                and docker_runtime.status == "running"
                and docker_runtime.upstream_url
                else ()
            )
        process_runtime = self._runtimes.get(key or "")
        return (
            process_runtime.thumbnail_origins
            if process_runtime and process_runtime.status == "running"
            else ()
        )

    def preview_upstream_for_host(self, host: str) -> str | None:
        token = self._preview_token_from_host(host)
        if token is None:
            return None
        for deploy_runtime in self._deploys.values():
            if (
                deploy_runtime.preview_token == token
                and deploy_runtime.status == "running"
                and deploy_runtime.upstream_url
            ):
                return deploy_runtime.upstream_url
        for runtime in self._docker_runtimes.values():
            if (
                runtime.preview_token == token
                and runtime.status == "running"
                and runtime.upstream_url
            ):
                return runtime.upstream_url
        for process_runtime in self._runtimes.values():
            if (
                process_runtime.preview_token == token
                and process_runtime.status == "running"
                and process_runtime.upstream_url
            ):
                return process_runtime.upstream_url
        return None

    def is_preview_host(self, host: str) -> bool:
        return self._preview_token_from_host(host) is not None

    def _preview_token_from_host(self, host: str) -> str | None:
        if self._preview_domain is None:
            return None
        normalized_host = host.partition(":")[0].rstrip(".").lower()
        suffix = f".{self._preview_domain}"
        if not normalized_host.endswith(suffix):
            return None
        token = normalized_host[: -len(suffix)]
        return token if re.fullmatch(r"[0-9a-f]{48}", token) else None

    async def start(
        self,
        repository_url: str,
        project_id: str | None = None,
        *,
        access_token: str | None = None,
    ) -> dict[str, str | None]:
        key = normalize_repository_url(repository_url)
        profile = self._profiles.get(key or "")
        if key is None:
            raise KeyError("project launch profile not found")
        if profile is None:
            return await self._start_docker_project(key, project_id, access_token)
        async with self._lock:
            current = self.status(key)
            if current["status"] == "running":
                return current
            runtime = self._runtimes.setdefault(key, _ProjectRuntime(profile))
            runtime.status = "starting"
            runtime.logs.clear()
            try:
                project_root = resolve_project_root(self._code_root, profile.relative_path)
                backend_port = _free_port()
                frontend_port = _free_port({backend_port})
                backend_url = f"http://127.0.0.1:{backend_port}"
                frontend_url = f"http://127.0.0.1:{frontend_port}"
                runtime.thumbnail_origins = (frontend_url, backend_url)
                await self._start_process(
                    runtime, project_root, profile.backend, backend_port, frontend_port, backend_url
                )
                await self._wait_health(backend_url + profile.backend.health_path, runtime)
                await self._start_process(
                    runtime,
                    project_root,
                    profile.frontend,
                    frontend_port,
                    frontend_port,
                    backend_url,
                )
                await self._wait_health(frontend_url + profile.frontend.health_path, runtime)
                runtime.upstream_url = frontend_url
                if self._preview_domain:
                    runtime.preview_token = runtime.preview_token or secrets.token_hex(24)
                    runtime.url = f"https://{runtime.preview_token}.{self._preview_domain}"
                else:
                    runtime.url = frontend_url
                runtime.status = "running"
                return self.status(key)
            except asyncio.CancelledError:
                await self._stop_runtime(runtime)
                runtime.status = "stopped"
                raise
            except Exception as exc:
                for process in runtime.processes:
                    if process.reader_task is not None:
                        await asyncio.sleep(0)
                    runtime.logs.append(_redact_log(bytes(process.output)))
                runtime.logs.append(str(exc))
                await self._stop_runtime(runtime)
                runtime.status = "failed"
                raise RuntimeError(_redact_log("\n".join(runtime.logs).encode())) from exc

    # ------------------------------------------------------------------
    # Code download (with progress) and auto deploy
    # ------------------------------------------------------------------

    def _project_key(self, repository_url: str, project_id: str | None) -> tuple[str, str | None]:
        key = normalize_repository_url(repository_url)
        if key is None or self._project_root is None:
            raise KeyError("project repository is not supported")
        return key, project_id

    def download_status(
        self, repository_url: str, project_id: str | None = None
    ) -> dict[str, str | int | None]:
        key, item = self._project_key(repository_url, project_id)
        job = self._downloads.get((key, item))
        return job.snapshot() if job is not None else _JobState().snapshot()

    async def start_download(
        self,
        repository_url: str,
        project_id: str | None = None,
        *,
        access_token: str | None = None,
        branch: str | None = None,
    ) -> dict[str, str | int | None]:
        key, item = self._project_key(repository_url, project_id)
        job = self._downloads.get((key, item))
        if job is not None and job.status == "running":
            return job.snapshot()
        checkout, _container, _image = self._docker_names(key, item)
        job = _JobState(status="running", percent=0, message="正在连接仓库")
        self._downloads[(key, item)] = job
        job.task = asyncio.create_task(
            self._run_download(
                key,
                item,
                checkout,
                job,
                access_token,
                normalize_repository_branch(branch),
            )
        )
        return job.snapshot()

    async def cancel_download(
        self, repository_url: str, project_id: str | None = None
    ) -> dict[str, str | int | None]:
        key, item = self._project_key(repository_url, project_id)
        job = self._downloads.get((key, item))
        if job is None:
            return _JobState().snapshot()
        if job.status == "running":
            if job.process is not None:
                await _kill_process(job.process)
            if job.task is not None:
                job.task.cancel()
                await asyncio.gather(job.task, return_exceptions=True)
            job.status = "cancelled"
            job.message = "已取消下载"
        return job.snapshot()

    async def _run_download(
        self,
        key: str,
        project_id: str | None,
        checkout: Path,
        job: _JobState,
        access_token: str | None,
        branch: str | None,
    ) -> None:
        host = urlsplit(key).hostname or "cnb.cool"
        temp_dir: str | None = None
        try:
            if checkout.is_dir() and not checkout.is_symlink():
                job.status = "done"
                job.percent = 100
                job.message = "代码已在本地"
                return
            checkout.parent.mkdir(parents=True, exist_ok=True)
            temp_dir = tempfile.mkdtemp(prefix="octop-clone-", dir=checkout.parent)
            job.temp_dir = temp_dir
            target = Path(temp_dir) / "source"
            args = ["clone", "--depth", "1", "--progress"]
            if branch:
                args.extend(("--branch", branch))
            args.extend((key, str(target)))
            async with self._credential_args(access_token, host) as extra:
                process = await asyncio.create_subprocess_exec(
                    "git",
                    *extra,
                    *args,
                    cwd=str(checkout.parent),
                    env=_child_environment(),
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                    start_new_session=os.name == "posix",
                    creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                )
                job.process = process
                job.message = "正在下载代码"
                assert process.stderr is not None
                buffer = ""
                while True:
                    chunk = await process.stderr.read(4096)
                    if not chunk:
                        break
                    buffer += chunk.decode("utf-8", errors="replace")
                    lines = re.split(r"[\r\n]", buffer)
                    buffer = lines.pop()
                    for line in lines:
                        text = line.strip()
                        if not text:
                            continue
                        percent = parse_git_progress(text)
                        if percent is not None:
                            job.percent = max(job.percent, percent)
                        elif text.startswith(("Cloning into", "remote:", "warning:")):
                            job.logs.append(text[:200])
                code = await process.wait()
            if code != 0:
                raise RuntimeError("git clone 失败，请检查仓库权限或网络")
            target.replace(checkout)
            job.percent = 100
            job.status = "done"
            job.message = "下载完成"
        except asyncio.CancelledError:
            job.status = "cancelled"
            job.message = "已取消下载"
        except Exception as exc:
            job.status = "failed"
            job.message = _redact_log(str(exc).encode())[:400]
        finally:
            job.process = None
            job.temp_dir = None
            if temp_dir is not None:
                with suppress(OSError):
                    shutil.rmtree(temp_dir, ignore_errors=True)

    def deploy_status(
        self, repository_url: str, project_id: str | None = None
    ) -> dict[str, str | int | None]:
        key, item = self._project_key(repository_url, project_id)
        runtime = self._deploys.get((key, item))
        if runtime is None:
            snapshot = _JobState().snapshot()
            snapshot.update({"url": None, "kind": None})
            return snapshot
        snapshot = runtime.job.snapshot()
        snapshot["url"] = runtime.url if runtime.status == "running" else None
        snapshot["kind"] = runtime.kind
        return snapshot

    async def start_deploy(
        self,
        repository_url: str,
        project_id: str | None = None,
        *,
        access_token: str | None = None,
        branch: str | None = None,
    ) -> dict[str, str | int | None]:
        key, item = self._project_key(repository_url, project_id)
        runtime = self._deploys.setdefault((key, item), _DeployRuntime(key, item))
        if runtime.job.status == "running":
            return self.deploy_status(key, item)
        await self._stop_deploy_runtime(runtime)
        runtime.status = "starting"
        runtime.url = None
        runtime.upstream_url = None
        runtime.job = _JobState(status="running", percent=2, message="准备代码")
        runtime.job.task = asyncio.create_task(
            self._run_deploy(
                key,
                item,
                runtime,
                access_token,
                normalize_repository_branch(branch),
            )
        )
        return self.deploy_status(key, item)

    async def stop_deploy(
        self, repository_url: str, project_id: str | None = None
    ) -> dict[str, str | int | None]:
        key, item = self._project_key(repository_url, project_id)
        runtime = self._deploys.get((key, item))
        if runtime is not None:
            if runtime.job.task is not None and runtime.job.status == "running":
                runtime.job.task.cancel()
                await asyncio.gather(runtime.job.task, return_exceptions=True)
            await self._stop_deploy_runtime(runtime)
            runtime.status = "stopped"
            if runtime.job.status != "cancelled":
                runtime.job.status = "idle"
                runtime.job.percent = 0
            runtime.job.message = "已停止"
        return self.deploy_status(key, item)

    async def _run_deploy(
        self,
        key: str,
        project_id: str | None,
        runtime: _DeployRuntime,
        access_token: str | None,
        branch: str | None,
    ) -> None:
        job = runtime.job
        try:
            checkout, _container, _image = self._docker_names(key, project_id)
            if not checkout.is_dir():
                job.message = "下载代码"
                await self._clone_project(key, checkout, access_token, branch)
            job.percent = 12
            job.message = "识别项目类型"
            plan = detect_deploy_plan(checkout)
            runtime.kind = plan.kind
            if plan.kind == "docker":
                job.message = "构建并启动 Docker 镜像"
                job.percent = 20
                status = await self._start_docker_project(key, project_id, access_token)
                runtime.status = str(status["status"])
                job.status = "done" if runtime.status == "running" else "failed"
                job.percent = 100 if job.status == "done" else job.percent
                job.message = "安装完成" if job.status == "done" else "Docker 启动失败"
                return
            if plan.install:
                job.message = "安装依赖"
                await self._run_plan_commands(runtime, checkout, plan.install, job, 12, 55)
            if plan.build:
                job.message = "构建项目"
                await self._run_plan_commands(runtime, checkout, plan.build, job, 55, 80)
            start = plan.start
            for directory in plan.static_dirs:
                if (checkout / directory / "index.html").is_file():
                    start = static_start(directory)
                    break
            if start is None:
                raise RuntimeError("构建完成但没有可启动的产物")
            job.message = "启动服务"
            job.percent = 88
            port = _free_port()
            await self._spawn_plan_process(runtime, checkout, start, port)
            upstream = f"http://127.0.0.1:{port}"
            runtime.upstream_url = upstream
            runtime.thumbnail_origins = (upstream,)
            job.message = "等待服务就绪"
            await self._wait_deploy_health(upstream + plan.health_path, runtime)
            if self._preview_domain:
                runtime.preview_token = runtime.preview_token or secrets.token_hex(24)
                runtime.url = f"https://{runtime.preview_token}.{self._preview_domain}"
            else:
                runtime.url = upstream
            runtime.status = "running"
            job.status = "done"
            job.percent = 100
            job.message = "安装完成"
        except asyncio.CancelledError:
            await self._stop_deploy_runtime(runtime)
            runtime.status = "stopped"
            job.status = "cancelled"
            job.message = "已取消安装"
        except Exception as exc:
            await self._stop_deploy_runtime(runtime)
            runtime.status = "failed"
            job.status = "failed"
            job.message = _redact_log(str(exc).encode())[:400]
            job.logs.append(job.message)

    async def _run_plan_commands(
        self,
        runtime: _DeployRuntime,
        checkout: Path,
        commands: tuple[DeployCommand, ...],
        job: _JobState,
        start_pct: int,
        end_pct: int,
    ) -> None:
        step = (end_pct - start_pct) / max(1, len(commands))
        for index, command in enumerate(commands):
            cwd = (checkout / command.cwd).resolve()
            if not cwd.is_dir() or not cwd.is_relative_to(checkout.resolve()):
                raise RuntimeError("安装命令的工作目录不在项目内")
            job.logs.append(f"$ {command.command} {' '.join(command.args)}".strip()[:200])
            process = await asyncio.create_subprocess_exec(
                self._resolve_program(command.command, checkout),
                *command.args,
                cwd=cwd,
                env=_child_environment(),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                start_new_session=os.name == "posix",
                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
            output = await self._collect_output(process, job, _DEPLOY_INSTALL_TIMEOUT)
            if process.returncode:
                raise RuntimeError(output[-400:] or f"{command.command} 执行失败")
            job.percent = int(start_pct + step * (index + 1))

    @staticmethod
    async def _collect_output(
        process: asyncio.subprocess.Process, job: _JobState, timeout: float
    ) -> str:
        assert process.stdout is not None
        output = bytearray()

        async def read_output() -> None:
            assert process.stdout is not None
            while chunk := await process.stdout.read(4096):
                output.extend(chunk)
                if len(output) > _MAX_LOG_BYTES:
                    del output[:-_MAX_LOG_BYTES]

        try:
            await asyncio.wait_for(asyncio.gather(read_output(), process.wait()), timeout)
        except TimeoutError:
            await _kill_process(process)
            raise RuntimeError("安装超时，请检查网络或依赖配置") from None
        text = _redact_log(bytes(output))
        for line in text.splitlines()[-4:]:
            if line.strip():
                job.logs.append(line.strip()[:200])
        return text

    @staticmethod
    def _resolve_program(command: str, checkout: Path) -> str:
        if "/" in command or "\\" in command:
            candidate = (checkout / command).resolve()
            if not candidate.is_relative_to(checkout.resolve()) or not candidate.is_file():
                raise RuntimeError(f"找不到命令 {command}")
            return str(candidate)
        if command == "python":
            return sys.executable
        found = shutil.which(command)
        if found is None:
            raise RuntimeError(f"本机没有安装 {command}")
        return found

    async def _spawn_plan_process(
        self,
        runtime: _DeployRuntime,
        checkout: Path,
        command: DeployCommand,
        port: int,
    ) -> None:
        cwd = (checkout / command.cwd).resolve()
        if not cwd.is_dir() or not cwd.is_relative_to(checkout.resolve()):
            raise RuntimeError("启动命令的工作目录不在项目内")
        env = _child_environment()
        env["PORT"] = str(port)
        env["HOST"] = "127.0.0.1"
        args = [arg.replace(PORT_PLACEHOLDER, str(port)) for arg in command.args]
        process = await asyncio.create_subprocess_exec(
            self._resolve_program(command.command, checkout),
            *args,
            cwd=cwd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=os.name == "posix",
            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
        )
        running = _RunningProcess(process)
        runtime.processes.append(running)
        running.reader_task = asyncio.create_task(_read_output(running))

    async def _wait_deploy_health(self, url: str, runtime: _DeployRuntime) -> None:
        async with httpx.AsyncClient(timeout=1.0) as client:
            async with asyncio.timeout(_DEPLOY_HEALTH_TIMEOUT):
                while True:
                    if any(item.process.returncode is not None for item in runtime.processes):
                        raise RuntimeError("服务启动后立即退出，请查看日志")
                    try:
                        response = await client.get(url)
                        if response.status_code < 500:
                            return
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(0.3)

    async def _stop_deploy_runtime(self, runtime: _DeployRuntime) -> None:
        for process in reversed(runtime.processes):
            await _terminate(process)
        runtime.processes.clear()
        runtime.url = None
        runtime.upstream_url = None
        runtime.thumbnail_origins = ()

    def _docker_names(self, repository_url: str, project_id: str | None) -> tuple[Path, str, str]:
        if self._project_root is None:
            raise RuntimeError("Docker project previews are not configured")
        canonical_url = normalize_repository_url(repository_url)
        if canonical_url is None:
            raise ValueError("invalid GitHub or CNB repository URL")
        parsed = urlsplit(canonical_url)
        parts = parsed.path.strip("/").split("/")
        if parsed.hostname not in _REPO_HOSTS or len(parts) < 2:
            raise ValueError("invalid GitHub or CNB repository URL")
        root = self._project_root.resolve()
        item_suffix = (
            hashlib.sha256(project_id.encode()).hexdigest()[:16] if project_id else "shared"
        )
        host_folder = "github" if parsed.hostname == "github.com" else "cnb"
        path_parts = [part.lower() for part in parts] if host_folder == "github" else parts
        checkout = (root / host_folder / Path(*path_parts) / item_suffix).resolve()
        if not checkout.is_relative_to(root):
            raise ValueError("repository path escapes the project root")
        name = hashlib.sha256(f"{canonical_url}\0{project_id or ''}".encode()).hexdigest()[:16]
        return checkout, f"octop-project-{name}", f"octop-project:{name}"

    async def _docker_command(
        self,
        *args: str,
        cwd: Path | None = None,
        timeout: float = 30.0,
        check: bool = True,
    ) -> str:
        try:
            process = await asyncio.create_subprocess_exec(
                *args,
                cwd=cwd,
                env=_child_environment(),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(f"{args[0]} is not installed on the Octop host") from exc

        async def read_output() -> bytes:
            output = bytearray()
            assert process.stdout is not None
            while chunk := await process.stdout.read(4096):
                output.extend(chunk)
                if len(output) > _MAX_LOG_BYTES:
                    del output[:-_MAX_LOG_BYTES]
            return bytes(output)

        try:
            output, _ = await asyncio.wait_for(
                asyncio.gather(read_output(), process.wait()), timeout=timeout
            )
        except TimeoutError as exc:
            process.kill()
            await process.wait()
            raise RuntimeError(f"{args[0]} timed out") from exc
        text = _redact_log(output)
        if check and process.returncode:
            raise RuntimeError(text or f"{args[0]} exited with status {process.returncode}")
        if process.returncode and not check:
            return ""
        return text.strip()

    @asynccontextmanager
    async def _credential_args(
        self, access_token: str | None, host: str
    ) -> AsyncIterator[list[str]]:
        """Yield ``git -c`` arguments that supply a stored token for ``host``."""
        if access_token is None:
            yield []
            return
        username = "x-access-token" if host == "github.com" else "cnb"
        with tempfile.TemporaryDirectory(prefix="octop-git-auth-") as temp:
            credentials = Path(temp) / "credentials"
            credentials.write_text(
                f"https://{username}:{quote(access_token, safe='')}@{host}\n", encoding="utf-8"
            )
            helper = f"store --file={shlex.quote(str(credentials))}"
            yield ["-c", f"credential.helper={helper}"]

    async def _git_command(
        self,
        access_token: str | None,
        *args: str,
        host: str = "cnb.cool",
        cwd: Path | None = None,
        timeout: float = 30.0,
    ) -> str:
        async with self._credential_args(access_token, host) as extra:
            return await self._docker_command("git", *extra, *args, cwd=cwd, timeout=timeout)

    async def _clone_project(
        self,
        repository_url: str,
        checkout: Path,
        access_token: str | None = None,
        branch: str | None = None,
    ) -> None:
        checkout.parent.mkdir(parents=True, exist_ok=True)
        if checkout.exists():
            if checkout.is_symlink() or not checkout.is_dir():
                raise RuntimeError("project checkout path is not a directory")
            return
        with tempfile.TemporaryDirectory(prefix="octop-clone-", dir=checkout.parent) as temp:
            target = Path(temp) / "source"
            args = ["clone", "--depth", "1"]
            if branch:
                args.extend(("--branch", branch))
            args.extend((repository_url, str(target)))
            await self._git_command(
                access_token,
                *args,
                host=urlsplit(repository_url).hostname or "cnb.cool",
                timeout=180,
            )
            target.replace(checkout)

    async def update(
        self,
        repository_url: str,
        project_id: str,
        *,
        access_token: str | None = None,
        source_only: bool = False,
        repository_branch: str | None = None,
    ) -> None:
        key = normalize_repository_url(repository_url)
        if key is None:
            raise KeyError("project repository is not updateable")
        host = urlsplit(key).hostname or "cnb.cool"
        branch = normalize_repository_branch(repository_branch)
        if repository_branch is not None and branch is None:
            raise RuntimeError("project repository branch is invalid")
        profile = None if source_only else self._profiles.get(key)
        if source_only:
            checkout, _container, _image = self._docker_names(key, project_id)
            container = image = None
        elif profile is not None:
            checkout = resolve_project_root(self._code_root, profile.relative_path)
            container = image = None
        elif self._project_root is not None:
            checkout, container, image = self._docker_names(key, project_id)
        else:
            raise KeyError("project repository is not updateable")
        async with self._lock:
            if profile is None and not checkout.exists():
                await self._clone_project(key, checkout, access_token, branch)
            if not checkout.is_dir() or (profile is None and checkout.is_symlink()):
                raise RuntimeError("project checkout is not a directory")
            remote = await self._docker_command("git", "remote", "get-url", "origin", cwd=checkout)
            if normalize_repository_url(remote) != key:
                raise RuntimeError("project origin does not match the registered repository")
            if await self._docker_command("git", "status", "--porcelain", cwd=checkout):
                raise RuntimeError("project checkout has local changes; update cancelled")
            if source_only:
                if branch is None:
                    refs = await self._git_command(
                        access_token,
                        "ls-remote",
                        "--symref",
                        "origin",
                        "HEAD",
                        host=host,
                        cwd=checkout,
                    )
                    match = re.search(r"^ref: refs/heads/(\S+)\s+HEAD$", refs, re.MULTILINE)
                    branch = normalize_repository_branch(match.group(1)) if match else None
                    if branch is None:
                        raise RuntimeError("project repository default branch is unavailable")
                current_branch = await self._docker_command(
                    "git", "branch", "--show-current", cwd=checkout
                )
                if current_branch.strip() != branch:
                    await self._git_command(
                        access_token,
                        "fetch",
                        "--depth",
                        "1",
                        "origin",
                        f"+refs/heads/{branch}:refs/remotes/origin/{branch}",
                        host=host,
                        cwd=checkout,
                    )
                    local_branch = await self._docker_command(
                        "git", "branch", "--list", branch, cwd=checkout
                    )
                    if local_branch.strip():
                        await self._docker_command("git", "switch", branch, cwd=checkout)
                    else:
                        await self._docker_command(
                            "git",
                            "switch",
                            "--track",
                            "-c",
                            branch,
                            f"origin/{branch}",
                            cwd=checkout,
                        )
                await self._git_command(
                    access_token,
                    "pull",
                    "--ff-only",
                    "origin",
                    branch,
                    host=host,
                    timeout=180,
                    cwd=checkout,
                )
            else:
                await self._git_command(
                    access_token, "pull", "--ff-only", host=host, timeout=180, cwd=checkout
                )
            if source_only:
                return
            if profile is not None:
                process_runtime = self._runtimes.get(key)
                if process_runtime is not None:
                    await self._stop_runtime(process_runtime)
                    process_runtime.status = "stopped"
                    process_runtime.logs.clear()
            else:
                assert container is not None and image is not None
                await self._docker_command("docker", "rm", "--force", container, check=False)
                await self._docker_command("docker", "image", "rm", image, check=False)
                docker_runtime = self._docker_runtimes.setdefault(
                    (key, project_id), _DockerRuntime(key, project_id)
                )
                docker_runtime.status = "stopped"
                docker_runtime.url = None
                docker_runtime.upstream_url = None
                docker_runtime.logs.clear()

    @staticmethod
    def _container_port(checkout: Path) -> int:
        dockerfile = checkout / "Dockerfile"
        if not dockerfile.is_file() or not dockerfile.resolve().is_relative_to(checkout.resolve()):
            raise RuntimeError("repository must contain a Dockerfile inside its root")
        with dockerfile.open("rb") as source:
            content = source.read(65536).decode("utf-8", errors="replace")
        for line in content.splitlines():
            match = re.match(r"^\s*EXPOSE\s+(\d+)(?:/tcp)?(?:\s|$)", line, re.IGNORECASE)
            if match and 1 <= int(match.group(1)) <= 65535:
                return int(match.group(1))
        raise RuntimeError("Dockerfile must expose a numeric TCP port")

    async def _start_docker_project(
        self, repository_url: str, project_id: str | None, access_token: str | None = None
    ) -> dict[str, str | None]:
        checkout, container, image = self._docker_names(repository_url, project_id)
        async with self._lock:
            runtime_key = (repository_url, project_id)
            runtime = self._docker_runtimes.setdefault(
                runtime_key, _DockerRuntime(repository_url, project_id)
            )
            if runtime.status == "running" and runtime.url:
                return self.status(repository_url, project_id)
            runtime.status = "starting"
            runtime.url = None
            runtime.upstream_url = None
            runtime.logs.clear()
            try:
                await self._docker_command("docker", "info", "--format={{.ServerVersion}}")
                await self._clone_project(repository_url, checkout, access_token)
                port = self._container_port(checkout)
                image_result = await self._docker_command(
                    "docker", "image", "inspect", image, check=False
                )
                if not image_result:
                    await self._docker_command(
                        "docker",
                        "build",
                        "--tag",
                        image,
                        str(checkout),
                        timeout=_DOCKER_BUILD_TIMEOUT,
                    )
                existing = await self._docker_command(
                    "docker", "inspect", "--format={{.State.Status}}", container, check=False
                )
                if existing and existing != "running":
                    await self._docker_command("docker", "start", container)
                elif not existing:
                    await self._docker_command(
                        "docker",
                        "run",
                        "--detach",
                        "--name",
                        container,
                        "--publish",
                        f"127.0.0.1::{port}",
                        "--cap-drop",
                        "ALL",
                        "--security-opt",
                        "no-new-privileges",
                        "--pids-limit",
                        "256",
                        "--memory",
                        "1g",
                        "--cpus",
                        "2",
                        image,
                    )
                published = await self._docker_command("docker", "port", container, f"{port}/tcp")
                match = re.search(r"127\.0\.0\.1:(\d+)", published)
                if match is None:
                    raise RuntimeError("Docker did not publish the project port on loopback")
                upstream_url = f"http://127.0.0.1:{match.group(1)}"
                runtime.upstream_url = upstream_url
                if self._preview_domain:
                    runtime.preview_token = runtime.preview_token or secrets.token_hex(24)
                    url = f"https://{runtime.preview_token}.{self._preview_domain}"
                else:
                    url = upstream_url
                await self._wait_docker_health(upstream_url)
                runtime.url = url
                runtime.status = "running"
                return self.status(repository_url, project_id)
            except asyncio.CancelledError:
                with suppress(Exception):
                    await self._docker_command(
                        "docker", "stop", "--time", "5", container, check=False
                    )
                runtime.status = "stopped"
                raise
            except Exception as exc:
                runtime.logs.append(str(exc))
                try:
                    await self._docker_command(
                        "docker", "stop", "--time", "5", container, check=False
                    )
                    logs = await self._docker_command("docker", "logs", container, check=False)
                    if logs:
                        runtime.logs.append(logs)
                except Exception:
                    pass
                runtime.status = "failed"
                runtime.url = None
                runtime.upstream_url = None
                raise RuntimeError(_redact_log("\n".join(runtime.logs).encode())) from exc

    async def _wait_docker_health(self, url: str) -> None:
        async with httpx.AsyncClient(timeout=1.0) as client:
            async with asyncio.timeout(_DOCKER_START_TIMEOUT):
                while True:
                    try:
                        await client.get(url)
                        return
                    except httpx.HTTPError:
                        await asyncio.sleep(0.25)

    async def _start_process(
        self,
        runtime: _ProjectRuntime,
        project_root: Path,
        spec: ProcessSpec,
        port: int,
        frontend_port: int,
        backend_url: str,
    ) -> None:
        cwd = (project_root / spec.cwd).resolve(strict=True)
        if not cwd.is_relative_to(project_root):
            raise ValueError("process cwd escapes project root")
        env = _child_environment()
        env[spec.port_env] = f"127.0.0.1:{port}" if spec.port_env == "ADDR" else str(port)
        if spec.bind_host_env:
            env[spec.bind_host_env] = "127.0.0.1"
        if spec == runtime.profile.backend:
            env["CORS_ORIGINS"] = f"http://127.0.0.1:{frontend_port}"
        else:
            env["BACKEND_URL"] = backend_url + "/api/v1"
        process = await asyncio.create_subprocess_exec(
            spec.command,
            *spec.args,
            cwd=cwd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=os.name == "posix",
            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
        )
        running = _RunningProcess(process)
        runtime.processes.append(running)
        running.reader_task = asyncio.create_task(_read_output(running))

    async def _wait_health(self, url: str, runtime: _ProjectRuntime) -> None:
        async with httpx.AsyncClient(timeout=1.0) as client:
            async with asyncio.timeout(_START_TIMEOUT):
                while True:
                    if any(item.process.returncode is not None for item in runtime.processes):
                        raise RuntimeError("project process exited before health check")
                    try:
                        response = await client.get(url)
                        if response.is_success:
                            return
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(0.25)

    async def _stop_runtime(self, runtime: _ProjectRuntime) -> None:
        for process in reversed(runtime.processes):
            await _terminate(process)
        runtime.processes.clear()
        runtime.url = None
        runtime.upstream_url = None
        runtime.thumbnail_origins = ()

    async def stop(
        self, repository_url: str, project_id: str | None = None
    ) -> dict[str, str | None]:
        key = normalize_repository_url(repository_url)
        if key is None:
            raise KeyError("project launch profile not found")
        if key not in self._profiles:
            if self._project_root is None:
                raise KeyError("project launch profile not found")
            deploy_runtime = self._deploys.get((key, project_id))
            if deploy_runtime is not None:
                if deploy_runtime.job.task is not None and deploy_runtime.job.status == "running":
                    deploy_runtime.job.task.cancel()
                    await asyncio.gather(deploy_runtime.job.task, return_exceptions=True)
                await self._stop_deploy_runtime(deploy_runtime)
                deploy_runtime.status = "stopped"
                if deploy_runtime.job.status != "cancelled":
                    deploy_runtime.job.status = "idle"
            _, container, _ = self._docker_names(key, project_id)
            async with self._lock:
                try:
                    state = await self._docker_command(
                        "docker", "inspect", "--format={{.State.Status}}", container, check=False
                    )
                    if state == "running":
                        await self._docker_command("docker", "stop", "--time", "5", container)
                except RuntimeError:
                    pass
                docker_runtime = self._docker_runtimes.setdefault(
                    (key, project_id), _DockerRuntime(key, project_id)
                )
                docker_runtime.status = "stopped"
                docker_runtime.url = None
                docker_runtime.upstream_url = None
                docker_runtime.logs.clear()
                return self.status(key, project_id)
        async with self._lock:
            process_runtime = self._runtimes.get(key)
            if process_runtime is not None:
                await self._stop_runtime(process_runtime)
                process_runtime.status = "stopped"
                process_runtime.logs.clear()
            return self.status(key)

    async def close(self) -> None:
        async with self._lock:
            for process_runtime in self._runtimes.values():
                await self._stop_runtime(process_runtime)
                process_runtime.status = "stopped"
                process_runtime.logs.clear()
            for deploy_runtime in self._deploys.values():
                if deploy_runtime.job.task is not None and deploy_runtime.job.status == "running":
                    deploy_runtime.job.task.cancel()
                    await asyncio.gather(deploy_runtime.job.task, return_exceptions=True)
                await self._stop_deploy_runtime(deploy_runtime)
                deploy_runtime.status = "stopped"
            for job in self._downloads.values():
                if job.process is not None:
                    await _kill_process(job.process)
        for docker_runtime in self._docker_runtimes.values():
            if docker_runtime.status == "running" or docker_runtime.status == "starting":
                try:
                    _, container, _ = self._docker_names(
                        docker_runtime.repository_url, docker_runtime.project_id
                    )
                    await self._docker_command("docker", "stop", "--time", "5", container)
                except Exception:
                    pass
                docker_runtime.status = "stopped"
                docker_runtime.url = None
                docker_runtime.upstream_url = None
