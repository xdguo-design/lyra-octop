#!/usr/bin/env python3
"""pageflow — 页面开发工作流引擎。

一个页面 = 一份文档 (``docs/pages/<slug>/PROGRESS.md``) + 一个目标页面 + 一组由文档生成的测试。
本引擎把这条流水线固化成可执行命令：

    start     建分支 + 生成文档骨架
    log       追加一条进度（模块 / 摘要 / 产出文件 / 校验命令）
    render    用文档渲染看板页面
    gen-tests 用文档生成测试文件（合同 / 对抗性 / 唯一性）
    verify    跑生成的测试并写回校验报告
    finish    闸门全绿后合并分支并删除分支

只依赖标准库；git / uv / pytest 通过子进程调用。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import string
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"
RUNS_DIR = DOCS_DIR / "pages"
TESTS_DIR = ROOT / "tests" / "unit" / "workflow"

ALLOWED_STATUS = ("todo", "wip", "done", "blocked")
STATUS_LABEL = {"todo": "待开始", "wip": "进行中", "done": "已完成", "blocked": "阻塞"}

SLUG_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
ID_SAFE_RE = re.compile(r"[^a-z0-9-]+")
DASH_RE = re.compile(r"-{2,}")
SEP_RE = re.compile(r"^:?-{3,}:?$")
META_RE = re.compile(r"<!--\s*pageflow:meta(.*?)-->", re.DOTALL)
LOG_MARK_RE = re.compile(r"<!--\s*pageflow:log\s*-->")
LOG_HEAD_RE = re.compile(r"^###\s+(?P<stamp>\S+)\s*·\s*(?P<mid>[^·]+?)\s*·\s*(?P<title>.+?)\s*$")
BULLET_RE = re.compile(r"^-\s*(?P<key>[^：:]{1,16})[：:]\s*(?P<value>.*)$")
ID_ATTR_RE = re.compile(r'id="([^"]+)"')


class PageflowError(RuntimeError):
    """工作流前置条件不满足（脏工作区、模块未完成、校验未通过……）。"""


# ─── 基础工具 ────────────────────────────────────────────────────────────────


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _git(*args: str, check: bool = True) -> str:
    proc = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    out = (proc.stdout or "").strip()
    if check and proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise PageflowError(f"git {' '.join(args)} 失败：{detail}")
    return out


def _run(argv: list[str]) -> int:
    print("$ " + " ".join(argv))
    proc = subprocess.run(argv, cwd=ROOT, check=False)
    return proc.returncode


def sanitize_id(raw: str) -> str:
    """把任意标识符压成 HTML id 安全形式（小写 + [a-z0-9-]）。"""
    cleaned = ID_SAFE_RE.sub("-", raw.strip().lower())
    cleaned = DASH_RE.sub("-", cleaned).strip("-")
    return cleaned or "x"


def _snake(slug: str) -> str:
    return sanitize_id(slug).replace("-", "_")


def _file_stat(path: Path) -> str:
    if not path.is_file():
        return "（缺文件）"
    data = path.read_bytes()
    lines = data.decode("utf-8", errors="replace").count("\n") + 1
    return f"{lines} 行, sha256:{hashlib.sha256(data).hexdigest()[:8]}"


# ─── 文档模型 ────────────────────────────────────────────────────────────────


@dataclass
class Module:
    mid: str
    name: str
    status: str
    artifacts: list[str] = field(default_factory=list)
    verify: str = ""


@dataclass
class LogEntry:
    stamp: str
    mid: str
    title: str
    status: str = ""
    summary: str = ""
    files: str = ""
    verify: str = ""


@dataclass
class Doc:
    path: Path
    meta: dict[str, str]
    sections: dict[str, str]
    modules: list[Module]
    log: list[LogEntry]
    test_plan: list[dict[str, str]]

    @property
    def slug(self) -> str:
        return self.meta.get("slug") or self.path.parent.name

    @property
    def title(self) -> str:
        return self.meta.get("title") or self.slug

    @property
    def branch(self) -> str:
        return self.meta.get("branch") or f"feature/page-{self.slug}"

    @property
    def base(self) -> str:
        return self.meta.get("base") or "develop"

    @property
    def target(self) -> Path:
        raw = self.meta.get("target") or f"docs/workflow/board/{self.slug}.html"
        return (ROOT / raw).resolve()


def doc_path(slug: str) -> Path:
    return RUNS_DIR / slug / "PROGRESS.md"


def _require_slug(slug: str) -> str:
    if not SLUG_RE.match(slug or ""):
        raise PageflowError(f"slug 不合法：{slug!r}（要求 kebab-case，例如 workflow-board）")
    return slug


# ─── 解析 ────────────────────────────────────────────────────────────────────


def split_sections(text: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current = "_preamble"
    buf: list[str] = []
    for line in text.splitlines():
        if line.startswith("## "):
            sections[current] = "\n".join(buf).strip()
            current = line[3:].strip()
            buf = []
        else:
            buf.append(line)
    sections[current] = "\n".join(buf).strip()
    return sections


def section_like(sections: dict[str, str], needle: str) -> str:
    for key, body in sections.items():
        if needle in key:
            return body
    return ""


def parse_meta(text: str) -> dict[str, str]:
    match = META_RE.search(text)
    if not match:
        return {}
    meta: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip()
    return meta


def _cells(line: str) -> list[str]:
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|"):
        body = body[:-1]
    return [cell.strip() for cell in body.split("|")]


def parse_table(body: str) -> list[dict[str, str]]:
    rows = [line for line in body.splitlines() if line.strip().startswith("|")]
    if not rows:
        return []
    header = _cells(rows[0])
    table: list[dict[str, str]] = []
    for line in rows[1:]:
        cells = _cells(line)
        if cells and all(SEP_RE.match(cell) for cell in cells if cell):
            continue
        if not any(cells):
            continue
        cells = cells + [""] * (len(header) - len(cells))
        table.append({name: cells[idx] for idx, name in enumerate(header)})
    return table


def _split_list(cell: str) -> list[str]:
    if not cell:
        return []
    parts = re.split(r"<br\s*/?>|、", cell)
    return [part.strip().strip("`").strip() for part in parts if part.strip().strip("`")]


def _norm_status(raw: str) -> str:
    value = (raw or "").strip().lower()
    return value if value in ALLOWED_STATUS else "todo"


def parse_modules(body: str) -> list[Module]:
    modules: list[Module] = []
    for row in parse_table(body):
        mid = row.get("ID") or row.get("id") or ""
        if not mid:
            continue
        verify = (row.get("校验") or row.get("verify") or "").strip().strip("`")
        modules.append(
            Module(
                mid=mid.strip(),
                name=(row.get("模块") or row.get("module") or "").strip() or mid,
                status=_norm_status(row.get("状态") or row.get("status") or ""),
                artifacts=_split_list(row.get("产出") or row.get("artifacts") or ""),
                verify=verify,
            )
        )
    return modules


def parse_log(body: str) -> list[LogEntry]:
    entries: list[LogEntry] = []
    current: LogEntry | None = None
    for line in body.splitlines():
        head = LOG_HEAD_RE.match(line.strip())
        if head:
            if current is not None:
                entries.append(current)
            current = LogEntry(
                stamp=head.group("stamp").strip(),
                mid=head.group("mid").strip(),
                title=head.group("title").strip(),
            )
            continue
        if current is None:
            continue
        bullet = BULLET_RE.match(line.strip())
        if not bullet:
            continue
        key = bullet.group("key").strip()
        value = bullet.group("value").strip()
        if key.startswith("状态"):
            current.status = _norm_status(value)
        elif key.startswith("摘要"):
            current.summary = value
        elif key.startswith("文件"):
            current.files = value
        elif key.startswith("校验"):
            current.verify = value
    if current is not None:
        entries.append(current)
    return entries


def parse_doc_text(text: str, path: Path) -> Doc:
    text = text.lstrip("\ufeff").replace("\r\n", "\n")
    sections = split_sections(text)
    return Doc(
        path=path,
        meta=parse_meta(text),
        sections=sections,
        modules=parse_modules(section_like(sections, "模块清单")),
        log=parse_log(section_like(sections, "变更日志")),
        test_plan=parse_table(section_like(sections, "测试计划")),
    )


def load_doc(path: str | Path) -> Doc:
    target = Path(path)
    if not target.is_file():
        raise PageflowError(f"文档不存在：{target}")
    return parse_doc_text(target.read_text(encoding="utf-8"), target)


def find_doc(slug: str) -> Doc:
    return load_doc(doc_path(_require_slug(slug)))


def validate_doc(doc: Doc) -> None:
    """结构校验：重复模块 ID、非法状态、空模块表都算失败。"""
    if not doc.modules:
        raise PageflowError(f"{doc.path}：模块清单为空")
    seen: set[str] = set()
    for module in doc.modules:
        key = module.mid.upper()
        if key in seen:
            raise PageflowError(f"{doc.path}：模块 ID 重复 -> {module.mid}")
        seen.add(key)
    for module in doc.modules:
        if module.status not in ALLOWED_STATUS:
            raise PageflowError(f"{doc.path}：模块 {module.mid} 状态非法 -> {module.status}")


def pending_modules(doc: Doc) -> list[Module]:
    return [module for module in doc.modules if module.status != "done"]


# ─── 页面渲染 ────────────────────────────────────────────────────────────────

PAGE_TEMPLATE = string.Template(
    """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="pageflow-slug" content="$slug" />
<meta name="pageflow-branch" content="$branch" />
<title>$title · 开发进度</title>
<style>
  :root {
    --paper: #f7f5f0;
    --ink: #16181d;
    --muted: #6b6f7a;
    --line: #dcd7cc;
    --done: #1f7a4d;
    --wip: #a4761b;
    --todo: #6b6f7a;
    --blocked: #a63d3d;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font: 15px/1.6 "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 48px 24px 80px; }
  .hero { border-bottom: 1px solid var(--line); padding-bottom: 24px; }
  .kicker {
    margin: 0 0 8px;
    font-size: 12px;
    letter-spacing: .18em;
    text-transform: uppercase;
    color: var(--muted);
  }
  h1 { margin: 0 0 12px; font-size: 34px; line-height: 1.2; letter-spacing: -.01em; }
  .meta { margin: 0; color: var(--muted); font-size: 13px; }
  .bar {
    margin-top: 20px;
    height: 6px;
    border-radius: 99px;
    background: #e6e1d6;
    overflow: hidden;
  }
  .bar > span { display: block; height: 100%; background: var(--done); }
  .count { margin: 10px 0 0; font-size: 13px; color: var(--muted); }
  h2 {
    margin: 44px 0 16px;
    font-size: 13px;
    letter-spacing: .16em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .card {
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 16px 18px;
  }
  .card header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .mid { font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
  .pill {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 99px;
    border: 1px solid currentColor;
  }
  .pill.done { color: var(--done); }
  .pill.wip { color: var(--wip); }
  .pill.todo { color: var(--todo); }
  .pill.blocked { color: var(--blocked); }
  .card h3 { margin: 10px 0 8px; font-size: 16px; font-weight: 600; }
  .files { margin: 0; padding-left: 18px; font-size: 12px; color: var(--muted); }
  .files code, .verify code { font-size: 12px; }
  .verify { margin: 10px 0 0; font-size: 12px; color: var(--muted); }
  .log { list-style: none; margin: 0; padding: 0; border-left: 2px solid var(--line); }
  .log > li { position: relative; padding: 0 0 22px 20px; }
  .log > li::before {
    content: "";
    position: absolute;
    left: -5px;
    top: 6px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--done);
  }
  .log .stamp {
    margin: 0;
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--muted);
  }
  .log h3 { margin: 4px 0 4px; font-size: 15px; }
  .log p { margin: 0; }
  .log .files { margin-top: 4px; padding-left: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  th { font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; }
  footer {
    margin-top: 56px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
    font-size: 12px;
    color: var(--muted);
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <p class="kicker">pageflow · $branch</p>
    <h1>$title</h1>
    <p class="meta">基线 $base · 目标 $target · 文档创建于 $stamp</p>
    <div class="bar"><span style="width:$pct%"></span></div>
    <p class="count">$done / $total 模块完成</p>
  </header>
  <main>
    <h2>模块</h2>
    <div class="grid">
$cards
    </div>
    <h2>变更日志</h2>
    <ol class="log">
$logs
    </ol>
    <h2>测试计划</h2>
    <table>
      <thead><tr><th>TID</th><th>类型</th><th>描述</th><th>断言</th></tr></thead>
      <tbody>
$plan
      </tbody>
    </table>
  </main>
  <footer>本文档由 docs/pages/$slug/PROGRESS.md 渲染；改动请改文档后重新 render。</footer>
</div>
</body>
</html>
"""
)


def _module_card(module: Module) -> str:
    anchor = "module-" + sanitize_id(module.mid)
    label = STATUS_LABEL.get(module.status, module.status)
    files = "".join(f"<li><code>{escape(item)}</code></li>" for item in module.artifacts)
    files = files or "<li><code>—</code></li>"
    return (
        f'      <article class="card" id="{anchor}" data-status="{escape(module.status)}">\n'
        '        <header><span class="mid">'
        f"{escape(module.mid)}</span>"
        f'<span class="pill {escape(module.status)}">{escape(label)}</span></header>\n'
        f"        <h3>{escape(module.name)}</h3>\n"
        f'        <ul class="files">{files}</ul>\n'
        f'        <p class="verify">校验：<code>{escape(module.verify or "—")}</code></p>\n'
        "      </article>"
    )


def _log_item(index: int, entry: LogEntry) -> str:
    return (
        f'      <li id="log-{index}">\n'
        f'        <p class="stamp">{escape(entry.stamp)} · {escape(entry.mid)}</p>\n'
        f"        <h3>{escape(entry.title)}</h3>\n"
        f"        <p>{escape(entry.summary or '—')}</p>\n"
        f'        <p class="files">{escape(entry.files or "—")}</p>\n'
        "      </li>"
    )


def _plan_rows(plan: list[dict[str, str]]) -> str:
    if not plan:
        return '        <tr><td colspan="4">（测试计划待补）</td></tr>'
    rows = []
    for row in plan:
        cells = [row.get(key, "") for key in ("TID", "类型", "描述", "断言")]
        rendered = "".join(f"<td>{escape(cell)}</td>" for cell in cells)
        rows.append(f"        <tr>{rendered}</tr>")
    return "\n".join(rows)


def render_page(doc: Doc) -> str:
    """把文档渲染成看板页面。所有文档文本一律 HTML 转义。"""
    total = len(doc.modules)
    done = sum(1 for module in doc.modules if module.status == "done")
    pct = 0 if total == 0 else round(100 * done / total)
    target_rel = doc.target.relative_to(ROOT).as_posix() if doc.target.is_relative_to(ROOT) else str(doc.target)
    return PAGE_TEMPLATE.substitute(
        slug=escape(doc.slug),
        branch=escape(doc.branch),
        title=escape(doc.title),
        base=escape(doc.base),
        target=escape(target_rel),
        stamp=escape(doc.meta.get("created", "—")),
        pct=str(pct),
        done=str(done),
        total=str(total),
        cards="\n".join(_module_card(module) for module in doc.modules),
        logs="\n".join(_log_item(index, entry) for index, entry in enumerate(doc.log, start=1)),
        plan=_plan_rows(doc.test_plan),
    )


def page_problems(doc: Doc, html: str) -> list[str]:
    """页面与文档的结构一致性检查（不做字节比对，页面允许人工微调样式）。"""
    problems: list[str] = []
    if f'content="{escape(doc.slug)}"' not in html:
        problems.append("缺少 pageflow-slug meta")
    for module in doc.modules:
        anchor = f'id="module-{sanitize_id(module.mid)}"'
        if anchor not in html:
            problems.append(f"缺少模块锚点 {anchor}")
        if escape(module.name) not in html:
            problems.append(f"缺少模块标题 {module.name}")
    anchors = [value for value in ID_ATTR_RE.findall(html) if value.startswith("module-")]
    if len(anchors) != len(doc.modules):
        problems.append(f"模块锚点数量 {len(anchors)} != 模块数 {len(doc.modules)}")
    log_ids = [value for value in ID_ATTR_RE.findall(html) if value.startswith("log-")]
    if len(log_ids) != len(doc.log):
        problems.append(f"日志条目 {len(log_ids)} != 变更日志条数 {len(doc.log)}")
    return problems


# ─── 测试文件生成 ────────────────────────────────────────────────────────────

CONTRACT_TEST = string.Template(
    '''"""由 pageflow 从 $doc_rel 生成 —— 不要手改，改文档后重跑 `pageflow gen-tests`。"""

from __future__ import annotations

import ast
import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
DOC = REPO / "$doc_rel"
PAGE = REPO / "$page_rel"
GENERATED = [
$generated_files
]

MODULES = [
$modules
]
LOG_COUNT = $log_count


def _engine():
    path = REPO / "scripts" / "pageflow.py"
    spec = importlib.util.spec_from_file_location("pageflow_engine_$snake", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["pageflow_engine_$snake"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def engine():
    return _engine()


def test_doc_is_valid(engine):
    doc = engine.load_doc(DOC)
    engine.validate_doc(doc)
    assert doc.meta["slug"] == "$slug"
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
        assert f'id="module-{engine.sanitize_id(mid)}"' in html
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
''',
    )

ADVERSARIAL_TEST = string.Template(
    '''"""对抗性测试（pageflow 生成，slug=$slug）。攻击面：文档文本 → 解析 → 渲染。"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]

PAYLOADS = [
$payloads
]

PROBE = """# {title}

<!-- pageflow:meta
slug: probe-$snake
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
    spec = importlib.util.spec_from_file_location("pageflow_engine_adv_$snake", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["pageflow_engine_adv_$snake"] = module
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
        "| M1 | dup | done | a | b |\\n| M1 |",
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
    doc = engine.parse_doc_text(skeleton + "## 2. 模块清单\\n\\n## 3. 变更日志" + tail, tmp_path / "PROGRESS.md")
    with pytest.raises(engine.PageflowError):
        engine.validate_doc(doc)


def test_crlf_and_bom_tolerated(engine, tmp_path):
    raw = PROBE.format(title="crlf").replace("\\n", "\\r\\n")
    doc = engine.parse_doc_text("\\ufeff" + raw, tmp_path / "PROGRESS.md")
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
''',
    )

UNIQUENESS_TEST = string.Template(
    '''"""唯一性测试（pageflow 生成，slug=$slug）。同一标识不得在同一命名空间内重复。"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
RUNS = REPO / "docs" / "pages"
ID_ATTR = re.compile(r'id="([^"]+)"')
SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$$")


def _engine():
    path = REPO / "scripts" / "pageflow.py"
    spec = importlib.util.spec_from_file_location("pageflow_engine_uniq_$snake", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["pageflow_engine_uniq_$snake"] = module
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
        assert ids == sorted(ids, key=lambda value: int(re.sub(r"\\D", "", value) or 0))


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
    files = sorted(path.name for path in (REPO / "tests" / "unit" / "workflow").glob("test_pf_*.py"))
    assert len(files) == len(set(files))
''',
    )


_INVISIBLE = ("\u202e", "\u200b", "\u200d", "\u200e", "\u200f", "\ufeff")


def _payload_literal(item: str) -> str:
    """序列化成源码字面量：保留中文可读性，转义不可见控制字符。"""
    dumped = json.dumps(item, ensure_ascii=False)
    for char in _INVISIBLE:
        dumped = dumped.replace(char, f"\\u{ord(char):04x}")
    return dumped


def render_tests(doc: Doc) -> dict[str, str]:
    """由文档生成三个测试文件的源码。调用方负责落盘。"""
    slug = doc.slug
    snake = _snake(slug)
    page_rel = doc.target.relative_to(ROOT).as_posix() if doc.target.is_relative_to(ROOT) else str(doc.target)
    doc_rel = doc.path.relative_to(ROOT).as_posix() if doc.path.is_relative_to(ROOT) else str(doc.path)
    generated = [
        f'    "tests/unit/workflow/test_pf_{snake}_adversarial.py",',
        f'    "tests/unit/workflow/test_pf_{snake}_contract.py",',
        f'    "tests/unit/workflow/test_pf_{snake}_uniqueness.py",',
    ]
    modules = "".join(
        f'    ("{module.mid}", "{module.name}", "{module.status}"),\n' for module in doc.modules
    )
    payloads = "".join(f"    {_payload_literal(item)},\n" for item in ADVERSARIAL_PAYLOADS)
    return {
        f"test_pf_{snake}_contract.py": CONTRACT_TEST.substitute(
            doc_rel=doc_rel,
            page_rel=page_rel,
            generated_files="\n".join(generated),
            modules=modules,
            log_count=str(len(doc.log)),
            snake=snake,
            slug=slug,
        ),
        f"test_pf_{snake}_adversarial.py": ADVERSARIAL_TEST.substitute(
            payloads=payloads, snake=snake, slug=slug
        ),
        f"test_pf_{snake}_uniqueness.py": UNIQUENESS_TEST.substitute(snake=snake, slug=slug),
    }


ADVERSARIAL_PAYLOADS = [
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


# ─── 命令实现 ────────────────────────────────────────────────────────────────

SCAFFOLD = """# __TITLE__ — 开发文档

<!-- pageflow:meta
slug: __SLUG__
title: __TITLE__
branch: __BRANCH__
base: __BASE__
target: __TARGET__
created: __CREATED__
-->

## 1. 目标

（待补充：这个页面给谁用、解决什么问题、验收口径是什么。）

## 2. 模块清单

| ID | 模块 | 状态 | 产出 | 校验 |
| --- | --- | --- | --- | --- |
| M1 | 首个模块 | todo | `__TARGET__` | `pageflow status --slug __SLUG__` |

## 3. 变更日志

<!-- pageflow:log -->

## 4. 决策记录

| 时间 | 决策 | 原因 |
| --- | --- | --- |
| __CREATED__ | 采用文档驱动 | 文档是唯一事实来源，页面与测试都由它派生 |

## 5. 测试计划

| TID | 类型 | 描述 | 断言 |
| --- | --- | --- | --- |
| T1 | contract | 文档与页面一致 | 每个模块在页面有唯一锚点 |
| T2 | adversarial | 恶意文本注入 | 渲染结果不含可执行标签 |
| T3 | uniqueness | 标识唯一 | 锚点 id 与模块 ID 无重复 |
"""


def cmd_start(args: argparse.Namespace) -> int:
    slug = _require_slug(args.slug)
    path = doc_path(slug)
    if path.exists() and not args.force:
        raise PageflowError(f"文档已存在：{path}（确认要覆盖请加 --force）")
    dirty = _git("status", "--porcelain", check=False)
    if dirty and not args.allow_dirty:
        raise PageflowError("工作区有未提交改动，先提交或加 --allow-dirty")

    branch = args.branch or f"feature/page-{slug}"
    target = args.target or f"docs/workflow/board/{slug}.html"
    base = args.base
    _git("rev-parse", "--verify", base)
    existing = _git("branch", "--list", branch, check=False)
    if existing:
        _git("checkout", branch)
        print(f"[start] 复用已存在分支 {branch}")
    else:
        _git("checkout", "-b", branch, base)
        print(f"[start] 从 {base} 创建分支 {branch}")

    path.parent.mkdir(parents=True, exist_ok=True)
    body = (
        SCAFFOLD.replace("__TITLE__", args.title)
        .replace("__SLUG__", slug)
        .replace("__BRANCH__", branch)
        .replace("__BASE__", base)
        .replace("__TARGET__", target)
        .replace("__CREATED__", _now())
    )
    path.write_text(body, encoding="utf-8", newline="\n")
    print(f"[start] 文档：{path.relative_to(ROOT).as_posix()}")

    if not args.no_commit:
        _git("add", "--", path.relative_to(ROOT).as_posix())
        _git("commit", "-m", f"docs(pageflow): start {slug}")
    print("[start] 下一步：pageflow log --slug %s --module M1 --title ... --summary ..." % slug)
    return 0


def cmd_log(args: argparse.Namespace) -> int:
    doc = find_doc(args.slug)
    text = doc.path.read_text(encoding="utf-8")
    status = args.status
    entry_lines = [
        f"### {_now()} · {args.module} · {args.title}",
        f"- 状态：{status}",
        f"- 摘要：{args.summary}",
        f"- 文件：{args.files or '—'}",
        f"- 校验：{args.verify or '—'}",
    ]
    entry = "\n".join(entry_lines)
    marker = LOG_MARK_RE.search(text)
    if marker is None:
        raise PageflowError("文档缺少 <!-- pageflow:log --> 标记")
    head = text[: marker.end()]
    lines = text[marker.end() :].split("\n")
    cut = len(lines)
    for index, line in enumerate(lines):
        if line.startswith("## "):
            cut = index
            break
    block = "\n".join(lines[:cut]).strip("\n")
    rest = "\n".join(lines[cut:]).lstrip("\n")
    updated = head.rstrip("\n") + "\n\n"
    if block:
        updated = updated + block + "\n\n"
    updated = updated + entry
    if rest:
        updated = updated + "\n\n" + rest

    if args.artifacts:
        updated = _rewrite_module_row(updated, args.module, status, args.artifacts, args.verify)

    doc.path.write_text(updated.rstrip("\n") + "\n", encoding="utf-8", newline="\n")
    print(f"[log] 追加 {args.module} · {args.title} -> {doc.path.relative_to(ROOT).as_posix()}")

    if args.commit:
        _git("add", "--", doc.path.relative_to(ROOT).as_posix())
        _git("commit", "-m", f"docs(pageflow): log {args.slug} {args.module}")
    return 0


def _rewrite_module_row(
    text: str, mid: str, status: str, artifacts: str, verify: str
) -> str:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if not line.strip().startswith("|"):
            continue
        cells = _cells(line)
        if not cells or cells[0].strip().upper() != mid.upper():
            continue
        cells = cells + [""] * (5 - len(cells))
        cells[2] = status
        cells[3] = artifacts
        if verify:
            cells[4] = verify
        lines[index] = "| " + " | ".join(cells[:5]) + " |"
        return "\n".join(lines)
    raise PageflowError(f"模块清单里找不到 {mid}")


def cmd_render(args: argparse.Namespace) -> int:
    doc = find_doc(args.slug)
    validate_doc(doc)
    html = render_page(doc)
    target = Path(args.out).resolve() if args.out else doc.target
    if args.check:
        if not target.is_file():
            raise PageflowError(f"页面不存在：{target}")
        problems = page_problems(doc, target.read_text(encoding="utf-8"))
        if problems:
            raise PageflowError("页面与文档不一致：" + "；".join(problems))
        print(f"[render] 页面与文档一致：{target.relative_to(ROOT).as_posix()}")
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(html, encoding="utf-8", newline="\n")
    print(f"[render] 已写入 {target.relative_to(ROOT).as_posix()}")
    return 0


def cmd_gen_tests(args: argparse.Namespace) -> int:
    doc = find_doc(args.slug)
    validate_doc(doc)
    pending = pending_modules(doc)
    if pending and not args.allow_pending:
        detail = "、".join(module.mid for module in pending)
        raise PageflowError(f"仍有模块未完成：{detail}（整体完成后才能生成测试）")
    TESTS_DIR.mkdir(parents=True, exist_ok=True)
    init = TESTS_DIR / "__init__.py"
    if not init.exists():
        init.write_text("", encoding="utf-8")
    written: list[Path] = []
    for name, source in render_tests(doc).items():
        path = TESTS_DIR / name
        path.write_text(source, encoding="utf-8", newline="\n")
        written.append(path)
    for path in written:
        print(f"[gen-tests] {path.relative_to(ROOT).as_posix()}")
    return 0


def _pytest_command(paths: list[str]) -> list[str]:
    uv = shutil_which("uv")
    if uv:
        return [uv, "run", "pytest", *paths, "-x", "-q"]
    return [sys.executable, "-m", "pytest", *paths, "-x", "-q"]


def shutil_which(name: str) -> str | None:
    import shutil

    return shutil.which(name)


def cmd_verify(args: argparse.Namespace) -> int:
    doc = find_doc(args.slug)
    snake = _snake(doc.slug)
    paths = [
        f"tests/unit/workflow/test_pf_{snake}_contract.py",
        f"tests/unit/workflow/test_pf_{snake}_adversarial.py",
        f"tests/unit/workflow/test_pf_{snake}_uniqueness.py",
    ]
    missing = [path for path in paths if not (ROOT / path).is_file()]
    if missing:
        raise PageflowError("测试文件缺失，先跑 gen-tests：" + "、".join(missing))

    results: list[tuple[str, str, int]] = []
    try:
        render_code = cmd_render(argparse.Namespace(slug=doc.slug, out=None, check=True))
    except PageflowError as exc:
        print(f"[verify] render --check 失败：{exc}")
        render_code = 1
    results.append(("render --check", "页面与文档结构一致", render_code))

    for path in paths:
        code = _run(_pytest_command([path]))
        results.append((path, "pytest", code))

    ok = all(code == 0 for _, _, code in results)
    stamp = _now()
    report = [
        f"# {doc.title} — 校验报告",
        "",
        f"- 状态：{'PASS' if ok else 'FAIL'}",
        f"- 时间：{stamp}",
        f"- slug：{doc.slug}",
        f"- 模块：{len(doc.modules)}（完成 {sum(1 for m in doc.modules if m.status == 'done')}）",
        f"- 变更日志条目：{len(doc.log)}",
        "",
        "| 检查项 | 说明 | 结果 |",
        "| --- | --- | --- |",
    ]
    for name, note, code in results:
        report.append(f"| `{name}` | {note} | {'通过' if code == 0 else f'失败({code})'} |")
    report.append("")
    report.append(
        "对抗性用例覆盖：XSS/标签注入、属性逃逸、javascript: 协议、模板与 `${}` 注入、"
        "RTL 与零宽字符、超长文本、命令注入串、表格行伪装；唯一性用例覆盖：slug、模块 ID、"
        "产出文件归属、日志条目、页面锚点、锚点字符集。"
    )
    out = doc.path.parent / "VERIFY.md"
    out.write_text("\n".join(report).rstrip("\n") + "\n", encoding="utf-8", newline="\n")
    print(f"[verify] {'PASS' if ok else 'FAIL'} -> {out.relative_to(ROOT).as_posix()}")
    return 0 if ok else 1


def cmd_finish(args: argparse.Namespace) -> int:
    doc = find_doc(args.slug)
    validate_doc(doc)
    pending = pending_modules(doc)
    if pending:
        raise PageflowError("仍有模块未完成：" + "、".join(module.mid for module in pending))

    report = doc.path.parent / "VERIFY.md"
    if not report.is_file():
        raise PageflowError("缺少校验报告，先跑 pageflow verify")
    first = report.read_text(encoding="utf-8")
    if "状态：PASS" not in first:
        raise PageflowError("校验报告不是 PASS，先修好再合并")

    branch = doc.branch
    base = args.base or doc.base
    current = _git("rev-parse", "--abbrev-ref", "HEAD")
    if current != branch:
        raise PageflowError(f"当前分支 {current} 与文档登记分支 {branch} 不一致")

    if args.gate:
        for command in args.gate:
            code = _run(command.split())
            if code != 0:
                raise PageflowError(f"闸门失败：{command}")

    merge_note = [
        "",
        "## 6. 合并记录",
        "",
        f"- 时间：{_now()}",
        f"- 分支：`{branch}` → `{base}`",
        f"- 方式：merge --no-ff，合并后删除源分支",
        f"- 校验：{report.relative_to(ROOT).as_posix()}（PASS）",
        "",
    ]
    text = doc.path.read_text(encoding="utf-8").rstrip("\n")
    if "## 6. 合并记录" not in text:
        text = text + "\n" + "\n".join(merge_note)
        doc.path.write_text(text.rstrip("\n") + "\n", encoding="utf-8", newline="\n")

    changes = _git("status", "--porcelain", check=False)
    if changes:
        _git("add", "-A")
        _git("commit", "-m", f"feat(pageflow): ship {doc.slug}")

    if args.dry_run:
        print(f"[finish][dry-run] 将合并 {branch} → {base} 并删除分支")
        return 0

    _git("checkout", base)
    _git("merge", "--no-ff", branch, "-m", f"merge: {doc.slug}")
    _git("branch", "-d", branch)
    print(f"[finish] 已合并 {branch} → {base}，分支已删除")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    doc = find_doc(args.slug)
    validate_doc(doc)
    print(f"{doc.title}  ({doc.slug})")
    print(f"  分支：{doc.branch}  基线：{doc.base}")
    print(f"  页面：{doc.target.relative_to(ROOT).as_posix() if doc.target.is_relative_to(ROOT) else doc.target}")
    print("  ID   状态     模块")
    for module in doc.modules:
        print(f"  {module.mid:<4} {STATUS_LABEL.get(module.status, module.status):<8} {module.name}")
    done = sum(1 for module in doc.modules if module.status == "done")
    print(f"  进度：{done}/{len(doc.modules)}   日志：{len(doc.log)} 条")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    rows = sorted(RUNS_DIR.glob("*/PROGRESS.md"))
    if not rows:
        print("（docs/pages 下还没有工作流文档）")
        return 0
    for path in rows:
        doc = load_doc(path)
        done = sum(1 for module in doc.modules if module.status == "done")
        print(f"{doc.slug:<28} {done}/{len(doc.modules)} 模块   {doc.branch}")
    return 0


# ─── 入口 ────────────────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pageflow", description="页面开发工作流引擎")
    sub = parser.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start", help="建分支 + 生成文档骨架")
    start.add_argument("--slug", required=True)
    start.add_argument("--title", required=True)
    start.add_argument("--base", default="develop")
    start.add_argument("--branch", default="")
    start.add_argument("--target", default="")
    start.add_argument("--force", action="store_true")
    start.add_argument("--allow-dirty", action="store_true")
    start.add_argument("--no-commit", action="store_true")
    start.set_defaults(func=cmd_start)

    log = sub.add_parser("log", help="追加一条进度")
    log.add_argument("--slug", required=True)
    log.add_argument("--module", required=True)
    log.add_argument("--title", required=True)
    log.add_argument("--summary", required=True)
    log.add_argument("--files", default="")
    log.add_argument("--verify", default="")
    log.add_argument("--status", default="wip", choices=list(ALLOWED_STATUS))
    log.add_argument("--artifacts", default="", help="同时更新模块清单的产出列")
    log.add_argument("--commit", action="store_true")
    log.set_defaults(func=cmd_log)

    render = sub.add_parser("render", help="用文档渲染页面")
    render.add_argument("--slug", required=True)
    render.add_argument("--out", default="")
    render.add_argument("--check", action="store_true")
    render.set_defaults(func=cmd_render)

    gen = sub.add_parser("gen-tests", help="用文档生成测试文件")
    gen.add_argument("--slug", required=True)
    gen.add_argument("--allow-pending", action="store_true")
    gen.set_defaults(func=cmd_gen_tests)

    verify = sub.add_parser("verify", help="跑生成的测试并写校验报告")
    verify.add_argument("--slug", required=True)
    verify.set_defaults(func=cmd_verify)

    finish = sub.add_parser("finish", help="合并并删除分支")
    finish.add_argument("--slug", required=True)
    finish.add_argument("--base", default="")
    finish.add_argument("--gate", action="append", default=[], help="额外闸门命令，可重复")
    finish.add_argument("--dry-run", action="store_true")
    finish.set_defaults(func=cmd_finish)

    status = sub.add_parser("status", help="查看进度")
    status.add_argument("--slug", required=True)
    status.set_defaults(func=cmd_status)

    listing = sub.add_parser("list", help="列出所有工作流文档")
    listing.set_defaults(func=cmd_list)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except PageflowError as exc:
        print(f"[pageflow] {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
