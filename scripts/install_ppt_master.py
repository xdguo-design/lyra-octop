"""Install the immutable PPT Master runtime used by Octop's PPT workbench."""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

from octop.infra.presentations.runtime import (
    PPT_MASTER_ARCHIVE_SHA256,
    PPT_MASTER_COMMIT,
    skill_directory,
)


def _verify(skill: Path) -> None:
    subprocess.run(
        [sys.executable, str(skill / "scripts" / "attribution_guard.py")], check=True, timeout=60
    )


def install(destination: Path, archive_path: Path | None = None) -> Path:
    """Install the complete immutable skill, rejecting archive escapes and symlinks."""
    root = destination.resolve()
    skill = root / "skills" / "ppt-master"
    marker = root / ".octop-ppt-master-commit"
    if root.exists():
        if not marker.is_file() or marker.read_text(encoding="ascii").strip() != PPT_MASTER_COMMIT:
            raise ValueError("destination exists without the pinned Octop runtime marker")
        _verify(skill)
        return skill
    root.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".ppt-master-install-", dir=root.parent) as temporary:
        staging = Path(temporary).resolve()
        archive_file = archive_path or staging / "upstream.zip"
        if archive_path is None:
            url = f"https://codeload.github.com/hugohe3/ppt-master/zip/{PPT_MASTER_COMMIT}"
            with (
                urllib.request.urlopen(url, timeout=60) as response,
                archive_file.open("wb") as output,
            ):
                total = 0
                while block := response.read(1024 * 1024):
                    total += len(block)
                    if total > 100 * 1024 * 1024:
                        raise ValueError("runtime archive exceeds 100 MiB")
                    output.write(block)
        with archive_file.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != PPT_MASTER_ARCHIVE_SHA256:
            raise ValueError("runtime archive checksum does not match the pinned release")
        unpacked = staging / "runtime"
        unpacked.mkdir()
        prefix = PurePosixPath(f"ppt-master-{PPT_MASTER_COMMIT}/skills/ppt-master")
        with zipfile.ZipFile(archive_file) as archive:
            entries: list[tuple[zipfile.ZipInfo, Path]] = []
            total = 0
            for entry in archive.infolist():
                path = PurePosixPath(entry.filename)
                if not path.is_relative_to(prefix):
                    continue
                relative = path.relative_to(prefix)
                if any(
                    part in {".", ".."} or ":" in part or "\\" in part for part in relative.parts
                ):
                    raise ValueError("unsafe runtime archive path")
                if stat.S_ISLNK(entry.external_attr >> 16):
                    raise ValueError("runtime archive contains a symlink")
                total += entry.file_size
                if total > 100 * 1024 * 1024 or len(entries) >= 20000:
                    raise ValueError("runtime package exceeds extraction limits")
                target = unpacked / "skills" / "ppt-master" / Path(*relative.parts)
                if not target.resolve().is_relative_to(unpacked):
                    raise ValueError("unsafe runtime archive target")
                entries.append((entry, target))
            for entry, target in entries:
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(entry) as source, target.open("wb") as output:
                        shutil.copyfileobj(source, output)
        _verify(unpacked / "skills" / "ppt-master")
        (unpacked / ".octop-ppt-master-commit").write_text(PPT_MASTER_COMMIT, encoding="ascii")
        if not unpacked.resolve().is_relative_to(staging) or root.exists():
            raise ValueError("runtime install target changed")
        os.replace(unpacked, root)
    return skill


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--destination", type=Path, help="Runtime root (default: versioned Octop runtime directory)"
    )
    args = parser.parse_args()
    print(install(args.destination or skill_directory().parents[1]))


if __name__ == "__main__":
    main()
