"""唯一性测试（pageflow 生成，slug=inpatient-registration）。同一标识不得在同一命名空间内重复。"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
RUNS = REPO / "docs" / "pages"
ID_ATTR = re.compile(r'id="([^"]+)"')
SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def _engine():
    path = REPO / "scripts" / "pageflow.py"
    spec = importlib.util.spec_from_file_location(
        "pageflow_engine_uniq_inpatient_registration", path
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["pageflow_engine_uniq_inpatient_registration"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def engine():
    return _engine()


def _all_docs(engine):
    docs = []
    for path in sorted(RUNS.glob("*/PROGRESS.md")):
        docs.append(engine.load_doc(path))
    assert docs, "docs/pages 下没有工作流文档"
    return docs


def test_slug_namespace_unique(engine):
    slugs = [doc.slug for doc in _all_docs(engine)]
    assert len(slugs) == len(set(slugs))


def test_slug_matches_directory(engine):
    for doc in _all_docs(engine):
        assert doc.slug == doc.path.parent.name, f"{doc.path} 的 slug 与目录名不一致"


def test_module_ids_unique_and_ordered(engine):
    for doc in _all_docs(engine):
        ids = [module.mid for module in doc.modules]
        assert len(ids) == len(set(ids)), f"{doc.slug} 模块 ID 重复"
        assert ids == sorted(ids, key=lambda value: int(re.sub(r"\D", "", value) or 0))


def test_artifacts_owned_by_one_module(engine):
    for doc in _all_docs(engine):
        seen: dict[str, str] = {}
        for module in doc.modules:
            for artifact in module.artifacts:
                assert artifact not in seen, f"{artifact} 同时属于 {seen[artifact]} 与 {module.mid}"
                seen[artifact] = module.mid


def test_log_entries_unique(engine):
    for doc in _all_docs(engine):
        keys = [(entry.stamp, entry.mid) for entry in doc.log]
        assert len(keys) == len(set(keys)), f"{doc.slug} 变更日志有重复条目"


def test_page_anchor_ids_unique(engine):
    for doc in _all_docs(engine):
        target = doc.target
        if not target.is_file():
            continue
        ids = ID_ATTR.findall(target.read_text(encoding="utf-8"))
        duplicates = sorted({value for value in ids if ids.count(value) > 1})
        assert not duplicates, f"{doc.slug} 页面重复 id：{duplicates}"


def test_page_ids_are_safe_tokens(engine):
    for doc in _all_docs(engine):
        target = doc.target
        if not target.is_file():
            continue
        for value in ID_ATTR.findall(target.read_text(encoding="utf-8")):
            assert SAFE_ID.match(value), f"不安全的 id：{value}"


def test_generated_test_files_unique(engine):
    files = sorted(
        path.name for path in (REPO / "tests" / "unit" / "workflow").glob("test_pf_*.py")
    )
    assert len(files) == len(set(files))
