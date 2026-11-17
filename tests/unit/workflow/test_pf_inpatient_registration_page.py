"""住院登记页面的行为与视觉契约测试（静态断言）。

页面是单文件、无构建、无外链，因此这里不启浏览器：直接对 `docs/pages/inpatient-registration/index.html`
做源码级断言 —— 结构（三步骤 / 两个主 tab / 表格列数）、数据基线（4 张申请单 + 5 条登记记录）、
状态机与三类锁定态、提交链路（勾选 → 二次确认 → 生成住院号）、以及原型 spec 的硬性视觉约束
（无外链 / 无 emoji / 无紫色渐变 / 正文 >= 14px / 禁用「圆角卡 + 左侧彩色竖条」）。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
PAGE = REPO / "docs/pages/inpatient-registration/index.html"

APPLICATIONS = {
    "陈静怡": "P2024051827",
    "王振华": "P2024040913",
    "林小雨": "P2024022644",
    "赵卫国": "P2023110378",
}
REGISTRATIONS = [
    "ZY20261112001",
    "ZY20261112002",
    "ZY20261111008",
    "ZY20261110015",
    "ZY20261109003",
]
REG_STATUSES = ["待入科", "在院", "转科待接收", "待出院审核", "出院待结算"]

EMOJI_RANGES = (
    (0x1F000, 0x1FAFF),
    (0x2600, 0x27BF),
    (0x2B00, 0x2BFF),
    (0xFE0F, 0xFE0F),
)


@pytest.fixture(scope="module")
def html() -> str:
    assert PAGE.is_file(), f"页面缺失：{PAGE}"
    return PAGE.read_text(encoding="utf-8")


def _block(html: str, selector: str) -> str:
    match = re.search(r"(?m)^[ \t]*" + re.escape(selector) + r"\s*\{([^}]*)\}", html)
    assert match, f"缺少样式块 {selector}"
    return match.group(1)


# ─── 自包含与视觉硬约束 ──────────────────────────────────────────────────────


def test_page_is_single_file_without_network(html):
    for marker in ("<link", "<script src", "@import", "url(", "http://", "https://"):
        assert marker not in html, f"页面出现外部依赖：{marker}"


def test_body_text_is_at_least_14px(html):
    body = _block(html, "body")
    assert "font: 14px/1.5" in body
    assert not re.search(r"font:\s*1[0-3]px", body)


def test_no_emoji_in_page(html):
    offenders = [ch for ch in html if any(lo <= ord(ch) <= hi for lo, hi in EMOJI_RANGES)]
    assert offenders == [], f"页面出现 emoji：{offenders[:5]}"


def test_no_purple_gradient_or_decorative_card_bar(html):
    lowered = html.lower()
    assert "gradient" not in lowered
    for hex_value in ("#8b5cf6", "#a855f7", "#7c3aed", "#6d28d9"):
        assert hex_value not in lowered
    card = _block(html, ".card")
    assert "border-left" not in card, "申请卡不得使用左侧彩色竖条"


def test_page_uses_dense_workbench_palette(html):
    assert "#0f62fe" in html  # 主操作蓝
    assert "#161616" in html  # 主文本
    assert "--radius: 2px" in html  # Carbon 直角


def test_no_watermark_or_signature(html):
    for marker in ("水印", "pageflow", "本文档由"):
        assert marker not in html


# ─── 结构与字典 ─────────────────────────────────────────────────────────────


def test_has_two_main_tabs_and_three_steps(html):
    assert len(re.findall(r'<button class="maintab', html)) == 2
    assert len(re.findall(r'class="step" data-step=', html)) == 3
    assert len(re.findall(r'<button class="subtab', html)) == 3


def test_registration_table_has_seven_columns(html):
    heads = re.findall(r'<th scope="col">([^<]+)</th>', html)
    assert len(heads) == 7
    assert heads[0] == "住院号"
    assert heads[-1] == "登记时间"


def test_dictionaries_cover_spec_values(html):
    for value in ("急诊入院", "择期入院", "转科入院", "暂不分床"):
        assert value in html
    for dept in ("心血管内科", "普外科", "骨科", "神经内科", "呼吸内科"):
        assert dept in html


# ─── 数据基线 ───────────────────────────────────────────────────────────────


def test_application_queue_matches_spec(html):
    assert len(re.findall(r'id: "A\d"', html)) == 4
    for name, patient_id in APPLICATIONS.items():
        assert name in html
        assert patient_id in html


def test_registration_queue_matches_spec(html):
    assert len(re.findall(r'no: "ZY\d{11}"', html)) == 5
    for number in REGISTRATIONS:
        assert number in html
    for status in REG_STATUSES:
        assert status in html


def test_awaiting_patient_is_the_odd_sample(html):
    assert 'status: "awaiting"' in html
    assert re.search(r'name: "赵卫国"[\s\S]{0,400}status: "awaiting"', html)


# ─── 状态机与锁定态 ─────────────────────────────────────────────────────────


def test_only_confirmed_applications_can_be_registered(html):
    assert 'function canRegister(app) { return app.status === "confirmed"; }' in html
    assert 'app.status = "registered";' in html


def test_three_lock_states_have_explicit_reasons(html):
    assert "患者尚未确认办理住院" in html
    assert "申请单已取消，不能办理登记。" in html
    assert "该申请单已办理" in html


def test_submit_button_starts_disabled_and_follows_gate(html):
    assert re.search(r'id="btnSubmit"[^>]*disabled>确认办理住院登记<', html)
    assert "el.btnSubmit.disabled = !gate.ok;" in html
    assert "勾选「已核对患者身份与门诊申请单一致」后才能提交。" in html


# ─── 提交链路 ───────────────────────────────────────────────────────────────


def test_submit_goes_through_confirm_dialog(html):
    assert 'id="modalConfirm"' in html
    assert "function submit()" in html
    assert 'openModal($("modalConfirm"))' in html


def test_confirm_dialog_can_jump_back_to_contact_step(html):
    assert 'id="cfBack"' in html
    assert "selectStep(1)" in html
    assert "el.cName.focus()" in html


def test_registration_number_is_generated_per_day(html):
    assert 'var prefix = "ZY" + TODAY.replace(/-/g, "");' in html
    assert "function nextRegNo()" in html
    assert 'var TODAY = "2026-11-12";' in html


def test_cancelling_requires_a_reason(html):
    assert 'id="ccReason"' in html
    assert 'if (!reason) { $("ccErr").hidden = false; return; }' in html
    assert 'app.status = "cancelled";' in html


# ─── 空态与滚动 ─────────────────────────────────────────────────────────────


def test_empty_states_are_honest_text(html):
    assert "没有符合条件的申请单" in html
    assert "当前筛选条件下没有登记记录" in html
    assert "<img" not in html


def test_layout_scrolls_inside_panes_not_the_page(html):
    assert "overflow: hidden" in _block(html, "body")
    assert len(re.findall(r"overflow: auto", html)) >= 3
