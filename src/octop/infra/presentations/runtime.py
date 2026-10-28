"""Pinned PPT Master native exporter, isolated from the server process."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from octop.infra.presentations.models import Slide
from octop.infra.presentations.svg import validate_svg
from octop.infra.utils.paths import PathLayout

PPT_MASTER_COMMIT = "0396656f4f5c28ba8096e8339716c338a576996c"
PPT_MASTER_ARCHIVE_SHA256 = "d31aaed6b2ac5032165f1d61796c068b21d1dab8f3756608372747f1acbe2fea"
PPT_MASTER_VERSION = "6.7.3"
MAX_EXPORT_BYTES = 40 * 1024 * 1024


def skill_directory() -> Path:
    configured = os.environ.get("OCTOP_PPT_MASTER_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return (
        PathLayout.from_env().root
        / "runtimes"
        / "ppt-master"
        / PPT_MASTER_COMMIT
        / "skills"
        / "ppt-master"
    )


def runtime_status() -> dict[str, object]:
    root = skill_directory()
    installed = (root / "SKILL.md").is_file() and (
        root / "scripts" / "attribution_guard.py"
    ).is_file()
    return {"installed": installed, "version": PPT_MASTER_VERSION, "commit": PPT_MASTER_COMMIT}


def validate_pptx(data: bytes) -> None:
    if len(data) > MAX_EXPORT_BYTES:
        raise ValueError("export is too large")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = set(archive.namelist())
            if not {"[Content_Types].xml", "ppt/presentation.xml"}.issubset(names):
                raise ValueError("invalid PowerPoint package")
    except zipfile.BadZipFile as exc:
        raise ValueError("invalid PowerPoint package") from exc


def export_native(slides: list[Slide]) -> bytes:
    """Convert validated pages to editable shapes, with no shell or inherited secrets."""
    if not runtime_status()["installed"]:
        raise FileNotFoundError("PPT Master is not installed")
    root = skill_directory()
    with tempfile.TemporaryDirectory(prefix="octop-ppt-") as temporary:
        project = Path(temporary)
        source = project / "svg_output"
        source.mkdir()
        notes: dict[str, str] = {}
        for index, slide in enumerate(slides):
            if not slide.svg:
                raise ValueError("page is not generated")
            stem = f"slide{index + 1:02d}"
            (source / f"{stem}.svg").write_text(validate_svg(slide.svg), encoding="utf-8")
            notes[stem] = slide.notes
        (project / "notes.json").write_text(json.dumps(notes, ensure_ascii=False), encoding="utf-8")
        environment = {
            key: value
            for key, value in os.environ.items()
            if key.upper()
            in {
                "PATH",
                "SYSTEMROOT",
                "WINDIR",
                "TEMP",
                "TMP",
                "HOME",
                "USERPROFILE",
                "LOCALAPPDATA",
                "APPDATA",
            }
        }
        environment.update(PYTHONUTF8="1", PYTHONNOUSERSITE="1")
        # Logs go to a file so verbose upstream diagnostics cannot grow server RAM.
        with tempfile.TemporaryFile() as logs:
            result = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).with_name("native_export.py")),
                    str(root),
                    str(project),
                ],
                cwd=project,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=logs,
                stderr=subprocess.STDOUT,
                timeout=120,
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError("PPT Master export failed")
        output = project / "presentation.pptx"
        if output.stat().st_size > MAX_EXPORT_BYTES:
            raise ValueError("export is too large")
        data = output.read_bytes()
        validate_pptx(data)
        return data
