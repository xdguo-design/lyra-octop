"""由 pageflow 从 docs/pages/workflow-board/PROGRESS.md 生成 —— 不要手改，改文档后重跑 `pageflow gen-tests`。"""

from __future__ import annotations

import ast
import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
DOC = REPO / "docs/pages/workflow-board/PROGRESS.md"
PAGE = REPO / "docs/workflow/board/index.html"
GENERATED = [
    "tests/unit/workflow/test_pf_workflow_board_adversarial.py",
    "tests/unit/workflow/test_pf_workflow_board_contract.py",
    "tests/unit/workflow/test_pf_workflow_board_uniqueness.py",
]

MODULES = [
    ("M1", "文档模型与解析", "done"),
    ("M2", "进度追加协议", "done"),
    ("M3", "看板页面渲染", "done"),
    ("M4", "测试生成器", "done"),
    ("M5", "对抗性与唯一性套件", "done"),
]
LOG_COUNT = 6


def _engine():
    path = REPO / "scripts" / "pageflow.py"
    spec = importlib.util.spec_from_file_location("pageflow_engine_workflow_board", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["pageflow_engine_workflow_board"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def engine():
    return _engine()


def test_doc_is_valid(engine):
    doc = engine.load_doc(DOC)
    engine.validate_doc(doc)
    assert doc.meta["slug"] == "workflow-board"
    assert [(m.mid, m.name, m.status) for m in doc.modules] == MODULES


def test_all_modules_done(engine):
    doc = engine.load_doc(DOC)
    assert [m.mid for m in doc.modules if m.status != "done"] == []


def test_page_matches_doc(engine):
    doc = engine.load_doc(DOC)
    assert PAGE.is_file(), f"页面缺失：{PAGE}"
    html = PAGE.read_text(encoding="utf-8")
    assert engine.page_problems(doc, html) == []


def test_rendered_page_has_every_module(engine):
    doc = engine.load_doc(DOC)
    html = engine.render_page(doc)
    assert engine.page_problems(doc, html) == []
    for mid, name, _ in MODULES:
        assert f'id="module-{mid.lower()}"' in html
        assert name in html


def test_log_entries_recorded(engine):
    doc = engine.load_doc(DOC)
    assert len(doc.log) == LOG_COUNT
    for entry in doc.log:
        assert entry.summary, f"{entry.mid} 缺少摘要"
        assert entry.verify, f"{entry.mid} 缺少校验记录"


def test_generated_tests_are_python():
    for path in GENERATED:
        source = (REPO / path).read_text(encoding="utf-8")
        ast.parse(source)
