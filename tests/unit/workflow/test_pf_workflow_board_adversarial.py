"""对抗性测试（pageflow 生成，slug=workflow-board）。攻击面：文档文本 → 解析 → 渲染。"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]

PAYLOADS = [
    "<script>alert('xss')</script>",
    '"><img src=x onerror=alert(1)>',
    "</textarea><svg/onload=alert(1)>",
    "javascript:alert(document.cookie)",
    "{{7*7}}${jndi:ldap://127.0.0.1:1389/a}",
    "\u202eRTL-override",
    "零宽度\u200b字符\u200d注入",
    "`rm -rf /`; $(id) | cat /etc/passwd",
    "| 伪装 | 表格 | 行 |",
]

PROBE = """# {title}

<!-- pageflow:meta
slug: probe-workflow_board
title: {title}
branch: feature/probe
base: develop
target: docs/probe.html
created: 2026-01-01T00:00:00+08:00
-->

## 2. 模块清单

| ID | 模块 | 状态 | 产出 | 校验 |
| --- | --- | --- | --- | --- |
| M1 | {title} | done | docs/probe.html | check |

## 3. 变更日志

<!-- pageflow:log -->

### 2026-01-01T00:00:01+08:00 · M1 · {title}
- 状态：done
- 摘要：{title}
- 文件：docs/probe.html
- 校验：check
"""


def _engine():
    path = REPO / "scripts" / "pageflow.py"
    spec = importlib.util.spec_from_file_location("pageflow_engine_adv_workflow_board", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["pageflow_engine_adv_workflow_board"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def engine():
    return _engine()


@pytest.mark.parametrize("payload", PAYLOADS)
def test_payload_is_escaped(engine, tmp_path, payload):
    doc = engine.parse_doc_text(PROBE.format(title=payload), tmp_path / "PROGRESS.md")
    html = engine.render_page(doc)
    lowered = html.lower()
    for marker in ("<script", "<img", "<svg", "<iframe", "<textarea", "<object"):
        assert marker not in lowered, f"未转义的注入片段：{marker}"
    from html import escape as html_escape

    assert html_escape(payload) in html
    assert len(html) > 200


@pytest.mark.parametrize("payload", PAYLOADS)
def test_payload_never_breaks_parser(engine, tmp_path, payload):
    doc = engine.parse_doc_text(PROBE.format(title=payload), tmp_path / "PROGRESS.md")
    engine.validate_doc(doc)
    assert len(doc.modules) == 1
    assert len(doc.log) == 1


def test_duplicate_module_ids_rejected(engine, tmp_path):
    text = PROBE.format(title="dup").replace(
        "| M1 |",
        "| M1 | dup | done | a | b |\n| M1 |",
        1,
    )
    doc = engine.parse_doc_text(text, tmp_path / "PROGRESS.md")
    with pytest.raises(engine.PageflowError):
        engine.validate_doc(doc)


def test_unknown_status_is_quarantined(engine, tmp_path):
    doc = engine.parse_doc_text(
        PROBE.format(title="status-probe").replace("| done |", "| pwned |", 1),
        tmp_path / "PROGRESS.md",
    )
    assert doc.modules[0].status == "todo"


def test_empty_module_table_rejected(engine, tmp_path):
    text = PROBE.format(title="empty")
    head, _, tail = text.partition("## 3. 变更日志")
    skeleton = head.split("## 2. 模块清单")[0]
    doc = engine.parse_doc_text(
        skeleton + "## 2. 模块清单\n\n## 3. 变更日志" + tail,
        tmp_path / "PROGRESS.md",
    )
    with pytest.raises(engine.PageflowError):
        engine.validate_doc(doc)


def test_crlf_and_bom_tolerated(engine, tmp_path):
    raw = PROBE.format(title="crlf").replace("\n", "\r\n")
    doc = engine.parse_doc_text("\ufeff" + raw, tmp_path / "PROGRESS.md")
    engine.validate_doc(doc)


def test_oversized_title_survives(engine, tmp_path):
    payload = "A" * 20000
    doc = engine.parse_doc_text(PROBE.format(title=payload), tmp_path / "PROGRESS.md")
    html = engine.render_page(doc)
    assert payload in html
    assert len(doc.modules) == 1


def test_id_attribute_is_sanitized(engine):
    assert engine.sanitize_id("M1") == "m1"
    assert engine.sanitize_id('x" onclick="alert(1)') == "x-onclick-alert-1"
    assert engine.sanitize_id("") == "x"
    assert engine.sanitize_id("模块 1") == "1"
