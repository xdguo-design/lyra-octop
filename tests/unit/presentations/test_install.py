from __future__ import annotations

import hashlib
from pathlib import Path
from zipfile import ZipFile

import pytest
from scripts import install_ppt_master


def _archive(tmp_path: Path, entries: dict[str, str]) -> Path:
    path = tmp_path / "package.zip"
    with ZipFile(path, "w") as archive:
        for name, value in entries.items():
            archive.writestr(name, value)
    return path


def test_installer_rejects_modified_archive(tmp_path: Path) -> None:
    archive = _archive(tmp_path, {"unknown.txt": "changed"})
    with pytest.raises(ValueError, match="checksum"):
        install_ppt_master.install(tmp_path / "runtime", archive)
    assert not (tmp_path / "runtime").exists()


def test_installer_rejects_archive_escape(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    prefix = f"ppt-master-{install_ppt_master.PPT_MASTER_COMMIT}/skills/ppt-master/"
    archive = _archive(tmp_path, {prefix + "../escape.py": "unsafe"})
    monkeypatch.setattr(
        install_ppt_master,
        "PPT_MASTER_ARCHIVE_SHA256",
        hashlib.sha256(archive.read_bytes()).hexdigest(),
    )
    with pytest.raises(ValueError, match="unsafe"):
        install_ppt_master.install(tmp_path / "runtime", archive)
    assert not (tmp_path / "escape.py").exists()


def test_installer_preserves_unrecognized_destination(tmp_path: Path) -> None:
    destination = tmp_path / "runtime"
    destination.mkdir()
    marker = destination / "keep.txt"
    marker.write_text("existing data", encoding="utf-8")
    with pytest.raises(ValueError, match="destination exists"):
        install_ppt_master.install(destination)
    assert marker.read_text(encoding="utf-8") == "existing data"


def test_installer_is_atomic_and_idempotent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    prefix = f"ppt-master-{install_ppt_master.PPT_MASTER_COMMIT}/skills/ppt-master/"
    archive = _archive(
        tmp_path,
        {
            prefix + "SKILL.md": "official skill",
            prefix + "LICENSE": "license",
            prefix + "scripts/tool.py": "tool",
        },
    )
    monkeypatch.setattr(
        install_ppt_master,
        "PPT_MASTER_ARCHIVE_SHA256",
        hashlib.sha256(archive.read_bytes()).hexdigest(),
    )
    checks: list[Path] = []
    monkeypatch.setattr(install_ppt_master, "_verify", lambda path: checks.append(path))
    root = tmp_path / "runtime"
    result = install_ppt_master.install(root, archive)
    assert (result / "SKILL.md").read_text(encoding="utf-8") == "official skill"
    assert (result / "LICENSE").read_text(encoding="utf-8") == "license"
    assert install_ppt_master.install(root) == result
    assert len(checks) == 2
    assert (root / ".octop-ppt-master-commit").read_text(
        encoding="ascii"
    ) == install_ppt_master.PPT_MASTER_COMMIT
