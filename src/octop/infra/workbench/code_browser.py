"""Bounded, read-only browsing of a server-configured source tree."""

from __future__ import annotations

from pathlib import Path, PurePosixPath
from typing import Any

MAX_CODE_FILE_BYTES = 1024 * 1024
_DENIED_NAMES = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".env",
        "data",
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        ".testdata",
        ".testdata2",
    }
)
_DENIED_SUFFIXES = frozenset({".pem", ".key", ".p12", ".pfx", ".sqlite", ".db"})
_TEXT_EXTENSIONS = frozenset(
    {
        ".py",
        ".pyi",
        ".js",
        ".jsx",
        ".ts",
        ".tsx",
        ".css",
        ".less",
        ".html",
        ".htm",
        ".md",
        ".mdx",
        ".json",
        ".jsonc",
        ".yaml",
        ".yml",
        ".toml",
        ".sql",
        ".sh",
        ".bat",
        ".ps1",
        ".txt",
        ".xml",
        ".svg",
        ".ini",
        ".cfg",
        ".gitignore",
        ".dockerignore",
        ".lock",
        ".conf",
        ".example",
    }
)


class CodeBrowseError(ValueError):
    """A source path is unavailable or outside the allowed text-file surface."""


def _is_denied_name(name: str) -> bool:
    lower = name.casefold()
    return (
        name.startswith(".")
        or lower in _DENIED_NAMES
        or lower.startswith(".env.")
        or "credential" in lower
        or "secret" in lower
        or lower.endswith(tuple(_DENIED_SUFFIXES))
        or lower in {"id_rsa", "id_ed25519", "credentials", "secrets.json"}
    )


def _resolve(root_value: str | Path | None, relative_path: str) -> tuple[Path, Path]:
    if not root_value:
        raise CodeBrowseError("code browsing is not configured")
    root = Path(root_value).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise CodeBrowseError("code root is not a directory")
    normalized = relative_path.replace("\\", "/")
    path = PurePosixPath(normalized)
    if (path.is_absolute() or ":" in normalized or ".." in path.parts) and normalized not in {
        "",
        ".",
    }:
        raise CodeBrowseError("invalid code path")
    if any(_is_denied_name(part) for part in path.parts if part not in {".", ""}):
        raise CodeBrowseError("path is excluded")
    candidate = root.joinpath(*(part for part in path.parts if part not in {".", ""}))
    current = root
    for part in path.parts:
        if part in {".", ""}:
            continue
        current = current / part
        if current.is_symlink():
            raise CodeBrowseError("symbolic links are not browsable")
    resolved = candidate.resolve(strict=True)
    if not resolved.is_relative_to(root):
        raise CodeBrowseError("path escapes code root")
    return root, resolved


def list_code_directory(
    root_value: str | Path | None, relative_path: str = "."
) -> list[dict[str, Any]]:
    root, directory = _resolve(root_value, relative_path)
    if not directory.is_dir():
        raise CodeBrowseError("not a directory")
    entries: list[dict[str, Any]] = []
    for child in directory.iterdir():
        if child.is_symlink() or _is_denied_name(child.name):
            continue
        is_dir = child.is_dir()
        if not is_dir and child.suffix.casefold() not in _TEXT_EXTENSIONS:
            continue
        entries.append(
            {
                "name": child.name,
                "path": child.relative_to(root).as_posix(),
                "is_directory": is_dir,
                "size": None if is_dir else child.stat().st_size,
            }
        )
    return sorted(entries, key=lambda item: (not item["is_directory"], item["name"].casefold()))


def read_code_file(root_value: str | Path | None, relative_path: str) -> dict[str, Any]:
    root, file_path = _resolve(root_value, relative_path)
    if not file_path.is_file() or file_path.suffix.casefold() not in _TEXT_EXTENSIONS:
        raise CodeBrowseError("not a supported text file")
    size = file_path.stat().st_size
    if size > MAX_CODE_FILE_BYTES:
        raise CodeBrowseError("file exceeds the 1 MiB preview limit")
    content = file_path.read_bytes()
    if len(content) > MAX_CODE_FILE_BYTES or b"\0" in content:
        raise CodeBrowseError("file is not a supported text file")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise CodeBrowseError("file is not UTF-8 text") from exc
    return {"path": file_path.relative_to(root).as_posix(), "content": text, "size": len(content)}
