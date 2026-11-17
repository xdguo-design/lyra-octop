"""由 pageflow 从 docs/pages/inpatient-registration/PROGRESS.md 生成 —— 不要手改，改文档后重跑 `pageflow gen-tests`。"""

from __future__ import annotations

import ast
import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
DOC = REPO / "docs/pages/inpatient-registration/PROGRESS.md"
PAGE = REPO / "docs/workflow/board/inpatient-registration.html"
GENERATED = [
    "tests/unit/workflow/test_pf_inpatient_registration_adversarial.py",
    "tests/unit/workflow/test_pf_inpatient_registration_contract.py",
    "tests/unit/workflow/test_pf_inpatient_registration_uniqueness.py",
]

MODULES = [
    ("M1", "需求与数据基线", "done"),
    ("M2", "页面主体与交互", "done"),
    ("M3", "看板页渲染", "done"),
    ("M4", "合同测试", "done"),
    ("M5", "对抗性测试", "done"),
    ("M6", "唯一性测试", "done"),
    ("M7", "页面行为测试", "done"),
    ("M8", "校验报告与验收准备", "done"),
]
LOG_COUNT = 8


def _engine():
    path = REPO / "scripts" / "pageflow.py"
    spec = importlib.util.spec_from_file_location("pageflow_engine_inpatient_registration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["pageflow_engine_inpatient_registration"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def engine():
    return _engine()


def test_doc_is_valid(engine):
    doc = engine.load_doc(DOC)
    engine.validate_doc(doc)
    assert doc.meta["slug"] == "inpatient-registration"
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
