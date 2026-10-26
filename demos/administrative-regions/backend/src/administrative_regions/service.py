"""Official division data synchronization, validation, caching, and lookup."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SOURCE_URL = "https://dmfw.mca.gov.cn/9095/xzqh/getList?code=&maxLevel=3"
SOURCE_NAME = "民政部国家地名信息库"
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
MIN_NODE_COUNT = 3000
MAX_RESOLVE_CANDIDATES = 10
logger = logging.getLogger(__name__)


def normalize_tree(payload: Any) -> list[dict[str, Any]]:
    root = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(payload, dict) or payload.get("status") != 200:
        raise ValueError("上游地区服务返回错误")
    if not isinstance(root, dict) or root.get("code") != "00":
        raise ValueError("上游地区树根节点无效")
    provinces = root.get("children")
    if not isinstance(provinces, list) or not provinces:
        raise ValueError("上游地区树为空")

    seen: set[str] = set()
    count = 0

    def visit(items: list[Any], depth: int) -> list[dict[str, Any]]:
        nonlocal count
        if depth > 3:
            raise ValueError("上游地区树超过三级")
        result = []
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("上游地区节点无效")
            raw_code = item.get("code")
            label = item.get("name")
            if raw_code == "资料暂缺":
                continue
            if not isinstance(raw_code, str) or not re.fullmatch(r"\d{12}", raw_code):
                raise ValueError("上游行政区划编码无效")
            code = raw_code[:6]
            if code in seen:
                raise ValueError("上游行政区划编码重复")
            if not isinstance(label, str) or not label.strip():
                raise ValueError("上游地区名称为空")
            seen.add(code)
            count += 1
            children = item.get("children")
            if isinstance(children, list):
                nested = visit(children, depth + 1) if children else []
            elif children is None or (isinstance(children, str) and not children.strip()):
                nested = []
            else:
                raise ValueError("上游地区子节点格式无效")
            result.append(
                {"code": code, "label": label.strip(), **({"children": nested} if nested else {})}
            )
        return result

    regions = visit(provinces, 1)
    if len(regions) < 30 or count < MIN_NODE_COUNT:
        raise ValueError("上游地区树不完整")
    return regions


class RegionService:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.cache_path = data_dir / "regions.json"
        self.regions: list[dict[str, Any]] = []
        self.synced_at: str | None = None
        self.last_error: str | None = None
        self._sync_lock = asyncio.Lock()
        self._load()

    def _load(self) -> None:
        try:
            if self.cache_path.stat().st_size > MAX_RESPONSE_BYTES:
                raise ValueError("cache exceeds size limit")
            cache = json.loads(self.cache_path.read_text(encoding="utf-8"))
            regions = cache["regions"]
            _validate_cached_tree(regions)
            self.regions = regions
            synced_at = cache.get("synced_at")
            self.synced_at = synced_at if isinstance(synced_at, str) else None
        except FileNotFoundError:
            return
        except (OSError, ValueError, TypeError, KeyError, RecursionError) as exc:
            self.last_error = f"忽略无效缓存：{exc}"[:300]
            logger.warning("Ignoring invalid region cache: %s", exc)

    def status(self) -> dict[str, Any]:
        return {
            "source": SOURCE_NAME,
            "sourceUrl": SOURCE_URL,
            "syncedAt": self.synced_at,
            "provinceCount": len(self.regions),
            "available": bool(self.regions),
            "lastError": self.last_error,
        }

    def list_regions(self, parent_code: str | None = None) -> list[dict[str, Any]]:
        current = self.regions
        if parent_code:
            node = self.find(parent_code)
            if node is None:
                raise KeyError(parent_code)
            current = node.get("children", [])
        return current

    def find(self, code: str) -> dict[str, Any] | None:
        def walk(nodes: list[dict[str, Any]]) -> dict[str, Any] | None:
            for node in nodes:
                if node.get("code") == code:
                    return node
                found = walk(node.get("children", []))
                if found:
                    return found
            return None

        return walk(self.regions)

    def resolve(self, text: str) -> dict[str, Any] | None:
        query_chars = [(char, index) for index, char in enumerate(text) if not char.isspace()]
        query = "".join(char for char, _ in query_chars)
        if not query or len(query) > 200:
            return None
        paths: dict[tuple[str, ...], tuple[list[str], int, int]] = {}

        def match(labels: list[str], start: int) -> tuple[int, int]:
            def walk(level: int, offset: int) -> tuple[int, int]:
                if level == len(labels):
                    return offset, 0
                label = labels[level]
                best = (offset, 0)
                for size in range(2, len(label) + 1):
                    if not query.startswith(label[:size], offset):
                        continue
                    end, matched_levels = walk(level + 1, offset + size)
                    candidate = (end, matched_levels + 1)
                    if candidate > best:
                        best = candidate
                return best

            return walk(0, start)

        def visit(nodes: list[dict[str, Any]], path: list[dict[str, Any]]) -> None:
            for node in nodes:
                full_path = [*path, node]
                if len(full_path) < 2:
                    visit(node.get("children", []), full_path)
                    continue
                labels = [entry["label"] for entry in full_path]
                for first in range(len(labels)):
                    for start in range(len(query)):
                        end, matched_levels = match(labels[first:], start)
                        depth = first + matched_levels
                        if matched_levels and depth >= 2:
                            candidate_path = full_path[:depth]
                            codes = tuple(entry["code"] for entry in candidate_path)
                            candidate_labels = [entry["label"] for entry in candidate_path]
                            previous = paths.get(codes)
                            if (
                                previous is None
                                or end - start > previous[2] - previous[1]
                                or (
                                    end - start == previous[2] - previous[1] and start < previous[1]
                                )
                            ):
                                paths[codes] = (candidate_labels, start, end)
                visit(node.get("children", []), full_path)

        visit(self.regions, [])
        if not paths:
            return None
        best_match_length = max(end - start for _labels, start, end in paths.values())
        paths = {
            codes: value
            for codes, value in paths.items()
            if value[2] - value[1] == best_match_length
        }

        def result(codes: tuple[str, ...], value: tuple[list[str], int, int]) -> dict[str, Any]:
            labels, start, end = value
            display_labels = [
                label
                for index, label in enumerate(labels)
                if index == 0 or label != labels[index - 1]
            ]
            return {
                "codes": list(codes),
                "labels": labels,
                "path": "".join(display_labels),
                "start": query_chars[start][1],
                "end": query_chars[end - 1][1] + 1,
            }

        ordered = sorted(paths.items(), key=lambda item: result(item[0], item[1])["path"])
        if len(ordered) == 1:
            return result(*ordered[0])
        return {
            "ambiguous": True,
            "candidate_count": len(ordered),
            "candidates": [
                result(codes, value) for codes, value in ordered[:MAX_RESOLVE_CANDIDATES]
            ],
            "truncated": len(ordered) > MAX_RESOLVE_CANDIDATES,
        }

    async def sync(self) -> dict[str, Any]:
        async with self._sync_lock:
            try:
                regions = await asyncio.to_thread(self._download)
                synced_at = datetime.now(UTC).isoformat()
                await asyncio.to_thread(self._write_atomic, regions, synced_at)
                self.regions = regions
                self.synced_at = synced_at
                self.last_error = None
            except Exception as exc:
                self.last_error = str(exc)[:300]
                logger.exception("Administrative region sync failed")
                raise
            return self.status()

    def _download(self) -> list[dict[str, Any]]:
        request = urllib.request.Request(
            SOURCE_URL,
            headers={
                "Accept": "application/json",
                "User-Agent": "Octop-Administrative-Regions/0.1",
            },
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status != 200:
                raise ValueError(f"上游 HTTP 状态异常：{response.status}")
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("上游响应超过大小限制")
        return normalize_tree(json.loads(raw))

    def _write_atomic(self, regions: list[dict[str, Any]], synced_at: str) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        data = json.dumps(
            {"synced_at": synced_at, "regions": regions},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                "w", encoding="utf-8", dir=self.data_dir, delete=False
            ) as stream:
                temporary = Path(stream.name)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(self.cache_path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


def _validate_cached_tree(regions: Any) -> None:
    if not isinstance(regions, list) or len(regions) < 30:
        raise ValueError("cache has no complete region tree")
    seen: set[str] = set()
    count = 0

    def visit(nodes: list[Any], depth: int) -> None:
        nonlocal count
        if nodes and depth > 3:
            raise ValueError("cache tree exceeds three levels")
        for node in nodes:
            if not isinstance(node, dict):
                raise ValueError("cache contains an invalid node")
            code = node.get("code")
            label = node.get("label")
            children = node.get("children", [])
            if not isinstance(code, str) or not re.fullmatch(r"\d{6}", code):
                raise ValueError("cache contains an invalid code")
            if code in seen:
                raise ValueError("cache contains duplicate codes")
            if not isinstance(label, str) or not label.strip():
                raise ValueError("cache contains an invalid label")
            if not isinstance(children, list):
                raise ValueError("cache contains invalid children")
            seen.add(code)
            count += 1
            visit(children, depth + 1)

    visit(regions, 1)
    if count < MIN_NODE_COUNT:
        raise ValueError("cache tree is incomplete")
