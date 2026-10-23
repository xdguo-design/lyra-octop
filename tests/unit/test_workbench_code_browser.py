"""Safety checks for the read-only workbench code browser."""

from pathlib import Path

import pytest

from octop.infra.workbench.code_browser import (
    CodeBrowseError,
    list_code_directory,
    read_code_file,
)


def test_code_browser_lists_source_and_hides_private_entries(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "app.py").write_text("print('ok')", encoding="utf-8")
    (tmp_path / ".env").write_text("TOKEN=secret", encoding="utf-8")
    (tmp_path / "data").mkdir()

    entries = list_code_directory(tmp_path)
    assert [item["name"] for item in entries] == ["src"]
    assert read_code_file(tmp_path, "src/app.py")["content"] == "print('ok')"


@pytest.mark.parametrize("path", ["../outside.py", "src/../../outside.py", "C:/secret.txt"])
def test_code_browser_rejects_paths_outside_root(tmp_path: Path, path: str) -> None:
    with pytest.raises(CodeBrowseError):
        read_code_file(tmp_path, path)


def test_code_browser_rejects_secrets_binary_and_large_files(tmp_path: Path) -> None:
    (tmp_path / "credentials.json").write_text("secret", encoding="utf-8")
    (tmp_path / "data.py").write_bytes(b"\0binary")
    (tmp_path / "large.py").write_bytes(b"x" * (1024 * 1024 + 1))

    for path in ("credentials.json", "data.py", "large.py"):
        with pytest.raises(CodeBrowseError):
            read_code_file(tmp_path, path)


def test_code_browser_rejects_symlink_escape(tmp_path: Path) -> None:
    root = tmp_path / "root"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (outside / "secret.py").write_text("secret", encoding="utf-8")
    link = root / "linked"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are unavailable on this host")
    with pytest.raises(CodeBrowseError):
        read_code_file(root, "linked/secret.py")
