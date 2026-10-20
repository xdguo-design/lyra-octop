"""Host-managed local preview services for explicitly trusted workbench projects."""

from __future__ import annotations

import asyncio
import os
import re
import signal
import socket
import subprocess
from collections import deque
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path, PureWindowsPath
from typing import Any
from urllib.parse import urlsplit

import httpx

_REPO_PATH_RE = re.compile(r"^/([^/]+)/([^/]+?)(?:\.git)?/?$")
_ENV_NAME_RE = re.compile(r"^[A-Z_][A-Z0-9_]*$")
_COMMAND_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
_MAX_LOG_BYTES = 8192
_START_TIMEOUT = 30.0
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
    processes: list[_RunningProcess] = field(default_factory=list)
    logs: deque[str] = field(default_factory=lambda: deque(maxlen=2))
    thumbnail_origins: tuple[str, ...] = ()


def normalize_repository_url(value: str) -> str | None:
    try:
        parsed = urlsplit(value.strip())
        match = _REPO_PATH_RE.fullmatch(parsed.path)
        if (
            parsed.scheme.lower() != "https"
            or parsed.hostname is None
            or parsed.hostname.lower() != "github.com"
            or parsed.port is not None
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or match is None
        ):
            return None
        return f"https://github.com/{match.group(1).lower()}/{match.group(2).lower()}"
    except ValueError:
        return None


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
            getattr(os, "killpg")(process.pid, getattr(signal, "SIGTERM"))
    try:
        await asyncio.wait_for(process.wait(), timeout=3)
    except TimeoutError:
        if os.name != "nt":
            with suppress(ProcessLookupError):
                getattr(os, "killpg")(process.pid, getattr(signal, "SIGKILL"))
        await process.wait()
    if running.reader_task is not None:
        running.reader_task.cancel()
        await asyncio.gather(running.reader_task, return_exceptions=True)


class ProjectServiceManager:
    def __init__(
        self,
        code_root: str | Path | None,
        profiles: dict[str, ProjectServiceProfile],
    ) -> None:
        self._code_root = code_root
        self._profiles = profiles
        self._runtimes: dict[str, _ProjectRuntime] = {}
        self._lock = asyncio.Lock()

    def status(self, repository_url: str) -> dict[str, str | None]:
        key = normalize_repository_url(repository_url)
        runtime = self._runtimes.get(key or "")
        if runtime is None:
            return {"status": "stopped", "url": None, "logs": None}
        if runtime.status == "running" and any(
            p.process.returncode is not None for p in runtime.processes
        ):
            runtime.status = "failed"
            runtime.url = None
        return {
            "status": runtime.status,
            "url": runtime.url,
            "logs": "\n".join(runtime.logs)[-_MAX_LOG_BYTES:] or None,
        }

    def has_profile(self, repository_url: str) -> bool:
        key = normalize_repository_url(repository_url)
        return key is not None and key in self._profiles

    def thumbnail_origins(self, repository_url: str) -> tuple[str, ...]:
        key = normalize_repository_url(repository_url)
        runtime = self._runtimes.get(key or "")
        return runtime.thumbnail_origins if runtime and runtime.status == "running" else ()

    async def start(self, repository_url: str) -> dict[str, str | None]:
        key = normalize_repository_url(repository_url)
        profile = self._profiles.get(key or "")
        if key is None or profile is None:
            raise KeyError("project launch profile not found")
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
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
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
        runtime.thumbnail_origins = ()

    async def stop(self, repository_url: str) -> dict[str, str | None]:
        key = normalize_repository_url(repository_url)
        if key is None or key not in self._profiles:
            raise KeyError("project launch profile not found")
        async with self._lock:
            runtime = self._runtimes.get(key)
            if runtime is not None:
                await self._stop_runtime(runtime)
                runtime.status = "stopped"
                runtime.logs.clear()
            return self.status(key)

    async def close(self) -> None:
        async with self._lock:
            for runtime in self._runtimes.values():
                await self._stop_runtime(runtime)
                runtime.status = "stopped"
                runtime.logs.clear()
