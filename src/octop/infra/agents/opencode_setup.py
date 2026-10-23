"""Install the OpenCode CLI for the current Octop service account."""

from __future__ import annotations

import asyncio
import os
import shutil
import sys
from pathlib import Path

_INSTALLER = "curl -fsSL https://opencode.ai/v2/install | bash"
_INSTALL_TIMEOUT_SECONDS = 180


def opencode_binary() -> str | None:
    """Find the OpenCode binary visible to Octop, including its user install path."""
    found = shutil.which("opencode")
    if found:
        return found
    candidates = (
        Path.home() / ".opencode" / "bin" / "opencode",
        Path.home() / ".local" / "bin" / "opencode",
    )
    for path in candidates:
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
    return None


async def install_opencode() -> str:
    """Install OpenCode using its official Linux installer and return its binary path."""
    if sys.platform != "linux":
        raise RuntimeError("OpenCode automatic installation is supported on Linux only")
    existing = opencode_binary()
    if existing:
        return existing
    if not shutil.which("bash") or not shutil.which("curl"):
        raise RuntimeError("The Octop server needs bash and curl to install OpenCode")

    process = await asyncio.create_subprocess_exec(
        "bash",
        "-c",
        _INSTALLER,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        await asyncio.wait_for(process.wait(), timeout=_INSTALL_TIMEOUT_SECONDS)
    except TimeoutError as exc:
        process.kill()
        await process.wait()
        raise RuntimeError("OpenCode installation timed out") from exc

    binary = opencode_binary()
    if process.returncode != 0 or binary is None:
        raise RuntimeError("OpenCode installer failed or did not produce a runnable binary")
    return binary
