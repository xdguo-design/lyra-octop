"""智能入院登记 Demo 的浏览器端自动化测试。

不依赖 Playwright MCP：直接用 playwright 驱动本机 Edge，把本地 Octop 的
admin token 注入 localStorage 后打开同源 Demo 页面，逐页断言。

用法：
    .venv/Scripts/python.exe demos/admission-registration/e2e/browser_e2e.py [--headed]

前置：Octop 已在 http://127.0.0.1:8200 运行。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
import traceback
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "src"))

from octop.infra.auth.tokens import sign_token  # noqa: E402

BASE = "http://127.0.0.1:8200"
DEMO_URL = f"{BASE}/admission-registration/"
OCTOP_DB = Path.home() / ".octop" / "octop.db"
ARTIFACTS = Path(__file__).resolve().parent / "artifacts"


@dataclass
class Case:
    name: str
    status: str = "SKIP"
    detail: str = ""
    shot: str = ""


@dataclass
class Run:
    cases: list[Case] = field(default_factory=list)
    console_errors: list[str] = field(default_factory=list)
    failed_requests: list[str] = field(default_factory=list)

    def record(self, case: Case) -> Case:
        self.cases.append(case)
        mark = {"PASS": "PASS", "FAIL": "FAIL", "SKIP": "SKIP"}[case.status]
        print(f"[{mark}] {case.name} :: {case.detail}")
        return case


def mint_token() -> str:
    con = sqlite3.connect(f"file:{OCTOP_DB.as_posix()}?mode=ro", uri=True)
    try:
        row = con.execute("select v from secrets where k='jwt'").fetchone()
    finally:
        con.close()
    if row is None:
        raise SystemExit("octop.db 中没有 jwt 密钥，无法签发测试令牌")
    return sign_token(bytes(row[0]), sub=1, uname="admin", role="admin", ttl_seconds=3600)


def wait_idle(page: Page, ms: int = 500) -> None:
    page.wait_for_timeout(ms)


def texts(page: Page, selector: str) -> list[str]:
    return [t.strip() for t in page.locator(selector).all_inner_texts() if t.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--headed", action="store_true", help="显示浏览器窗口")
    parser.add_argument("--only", default="", help="只跑名字包含该子串的用例")
    args = parser.parse_args()

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    token = mint_token()
    run = Run()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=not args.headed)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        context.add_init_script(
            f"try{{localStorage.setItem('auth_token', {json.dumps(token)});}}catch(e){{}}"
        )
        page = context.new_page()
        page.on(
            "console",
            lambda m: run.console_errors.append(m.text) if m.type == "error" else None,
        )
        page.on(
            "requestfailed",
            # 页面切换时被主动 abort 的请求（如 TTS）不算缺陷
            lambda r: (
                run.failed_requests.append(f"{r.method} {r.url} {r.failure}")
                if "ERR_ABORTED" not in (r.failure or "")
                else None
            ),
        )

        def case(name: str) -> Case:
            return Case(name=name)

        def shot(name: str) -> str:
            path = ARTIFACTS / f"{name.replace(' ', '_').replace('/', '_')}.png"
            page.screenshot(path=str(path), full_page=False)
            return path.name

        def guard(fn):
            """按 --only 过滤后执行；异常记为 FAIL 并截图，不中断后续用例。"""
            if args.only and args.only not in fn.__name__ and args.only not in fn.__doc__:
                return
            try:
                fn()
            except Exception as exc:  # noqa: BLE001
                c = case(fn.__doc__ or fn.__name__)
                c.status = "FAIL"
                c.detail = f"{type(exc).__name__}: {exc}".replace("\n", " ")[:300]
                with suppress(Exception):
                    c.shot = shot(f"FAIL_{fn.__name__}")
                run.record(c)
                traceback.print_exc()

        # ---------------- P01 首页 ----------------
        def c01_home_skeleton():
            """P01 首页骨架: 品牌、机器人、四个快捷问题、序列号"""
            page.goto(DEMO_URL, wait_until="domcontentloaded")
            page.wait_for_selector(".mascot-stage", timeout=15000)
            c = case(c01_home_skeleton.__doc__)
            brand = page.locator(".brand-name").inner_text().strip()
            bot = page.locator(".mascot-image").is_visible()
            prompts = texts(page, ".prompt-button")
            serial = page.locator(".serial-line").inner_text().strip()
            ok = brand == "Neusoft" and bot and len(prompts) == 4 and "NS1" in serial
            c.status = "PASS" if ok else "FAIL"
            c.detail = f"brand={brand} bot={bot} prompts={len(prompts)} serial={serial}"
            c.shot = shot("P01_home")
            run.record(c)

        def c02_shortcuts():
            """P01 快捷问题文案符合 formConfig.SHORTCUTS"""
            expected = [
                "直接说科室名称或不舒服症状挂号",
                "帮我打印检查检验报告单",
                "我要报告解读",
                "可以说帮我入院登记",
            ]
            c = case(c02_shortcuts.__doc__)
            actual = texts(page, ".prompt-button")
            c.status = "PASS" if actual == expected else "FAIL"
            c.detail = f"actual={actual}"
            run.record(c)

        def c03_unsupported():
            """P01 超范围问题走固定回复且停留首页"""
            c = case(c03_unsupported.__doc__)
            page.locator(".prompt-button").nth(1).click()
            page.wait_for_selector(".conversation-dialog", timeout=8000)
            wait_idle(page, 800)
            msgs = texts(page, ".conversation-message--assistant")
            still_home = page.locator(".mascot-stage").is_visible()
            ok = any("暂不支持" in m for m in msgs) and still_home
            c.status = "PASS" if ok else "FAIL"
            c.detail = f"assistant={msgs} home={still_home}"
            c.shot = shot("P01_unsupported")
            page.locator(".conversation-dialog__header button").click()
            wait_idle(page, 300)
            run.record(c)

        def c04_enter_identity():
            """P01→P02 最后一个快捷问题进入身份核验"""
            c = case(c04_enter_identity.__doc__)
            page.locator(".prompt-button").nth(3).click()
            page.wait_for_selector(".identity-stage", timeout=10000)
            c.status = "PASS"
            c.detail = "identity-stage 已渲染"
            c.shot = shot("P02_identity")
            run.record(c)

        def c05_identity_widgets():
            """P02 身份核验: 读卡提示、模拟刷卡按钮、300s 倒计时"""
            c = case(c05_identity_widgets.__doc__)
            copy = page.locator(".reader-copy").inner_text().strip()
            trigger = page.locator(".reader-trigger").inner_text().strip()
            countdown = page.locator(".reader-countdown").inner_text().strip()
            remain = int("".join(ch for ch in countdown if ch.isdigit()) or 0)
            ok = "模拟刷卡" in copy and "刷卡" in trigger and 0 < remain <= 300
            c.status = "PASS" if ok else "FAIL"
            c.detail = f"trigger={trigger!r} countdown={countdown!r}"
            run.record(c)

        def c06_verify_identity():
            """P02→P03 模拟刷卡后进入本人入院申请单"""
            c = case(c06_verify_identity.__doc__)
            page.locator(".reader-trigger").click()
            page.wait_for_selector(".application-panel", timeout=20000)
            page.wait_for_selector(".application-card", timeout=20000)
            cards = page.locator(".application-card").count()
            c.status = "PASS" if cards >= 1 else "FAIL"
            c.detail = f"申请单卡片数={cards}"
            c.shot = shot("P03_applications")
            run.record(c)

        def c07_requires_selection():
            """P03 未选申请单时继续按钮不可用"""
            c = case(c07_requires_selection.__doc__)
            btn = page.locator(".application-continue")
            disabled = btn.is_disabled()
            c.status = "PASS" if disabled else "FAIL"
            c.detail = f"continue disabled={disabled}"
            run.record(c)

        def c08_enter_form():
            """P03→P04 选中申请单后进入表单第一页"""
            c = case(c08_enter_form.__doc__)
            page.locator(".application-select").first.click()
            wait_idle(page, 300)
            btn = page.locator(".application-continue")
            c.detail = f"选中后可点={not btn.is_disabled()}; "
            btn.click()
            page.wait_for_selector(".form-panel", timeout=20000)
            title = page.locator(".form-title").inner_text().strip()
            c.status = "PASS" if "入院登记信息" in title else "FAIL"
            c.detail += f"form-title={title}"
            c.shot = shot("P04_form_step1")
            run.record(c)

        def c09_readonly_masked():
            """P04 姓名/身份证只读且脱敏显示"""
            c = case(c09_readonly_masked.__doc__)
            ro = page.locator(".readonly-value")
            count = ro.count()
            labels = [ro.nth(i).get_attribute("aria-label") for i in range(count)]
            values = [ro.nth(i).inner_text().strip().split("\n")[0] for i in range(count)]
            name_val = values[0] if values else ""
            id_val = values[1] if len(values) > 1 else ""
            ok = count >= 2 and "*" in name_val and "*" in id_val
            c.status = "PASS" if ok else "FAIL"
            c.detail = f"readonly={count} labels={labels} name={name_val!r} id={id_val!r}"
            run.record(c)

        def c10_required_blocked():
            """P04 缺必填项时点下一页被拦截并定位字段"""
            c = case(c10_required_blocked.__doc__)
            page.locator('.page-arrow[aria-label="下一页"]').click()
            wait_idle(page, 700)
            errors = texts(page, ".field-error")
            still_form = page.locator(".form-panel").is_visible()
            c.status = "PASS" if errors and still_form else "FAIL"
            c.detail = f"errors={errors} still_form={still_form}"
            c.shot = shot("P04_required_blocked")
            run.record(c)

        # ---------------- P04 表单填写 ----------------
        def tap_keypad(digits: str) -> None:
            page.locator(".phone-display").click()
            page.wait_for_selector(".keypad-panel", state="visible", timeout=5000)
            for ch in digits:
                page.locator(".keypad-grid .el-button", has_text=ch).first.click()
            # 键盘浮层绝对定位在电话字段下方，会盖住籍贯/现住地址，点空白处收起。
            page.locator(".form-title").click()
            page.wait_for_selector(".keypad-panel", state="hidden", timeout=5000)

        def pick_cascader(field_id: str, path: list[str]) -> None:
            page.locator(f"#{field_id}").click()
            page.wait_for_selector(".el-cascader__dropdown:visible", timeout=5000)
            for label in path:
                page.locator(
                    ".el-cascader__dropdown:visible .el-cascader-node__label",
                    has_text=label,
                ).first.click()
                wait_idle(page, 350)

        def pick_select(field_id: str, option: str) -> None:
            page.locator(f"#{field_id}").click()
            page.wait_for_selector(".el-select-dropdown:visible", timeout=5000)
            page.locator(
                ".el-select-dropdown:visible .el-select-dropdown__item",
                has_text=option,
            ).first.click()
            wait_idle(page, 250)

        def c11_phone_keypad():
            """P04 数字键盘输入手机号并脱敏显示"""
            c = case(c11_phone_keypad.__doc__)
            tap_keypad("13900001111")
            wait_idle(page, 300)
            shown = page.locator(".phone-display").inner_text().strip()
            ok = shown == "139****1111"
            c.status = "PASS" if ok else "FAIL"
            c.detail = f"显示={shown!r}"
            run.record(c)

        def c12_regions():
            """P04 籍贯/现住地址三级级联可选"""
            c = case(c12_regions.__doc__)
            pick_cascader("nativeRegion", ["辽宁省", "沈阳市", "浑南区"])
            pick_cascader("residentRegion", ["北京市", "朝阳区"])
            # 级联控件的选中文本在内部 input 的 value 上
            shown = page.locator("#nativeRegion input").input_value().strip()
            resident = page.locator("#residentRegion input").input_value().strip()
            c.status = "PASS" if "浑南" in shown and "朝阳" in resident else "FAIL"
            c.detail = f"籍贯={shown!r} 现住={resident!r}"
            run.record(c)

        def c13_to_step2():
            """P04 第一页通过校验后进入补充信息页"""
            c = case(c13_to_step2.__doc__)
            page.locator("#addressDetail").fill("测试路1号")
            page.locator('.page-arrow[aria-label="下一页"]').click()
            page.wait_for_selector("#marriage", timeout=8000)
            wait_idle(page, 400)
            errs = texts(page, ".field-error")
            c.status = "PASS" if not errs else "FAIL"
            c.detail = f"step2 已渲染, errors={errs}"
            c.shot = shot("P04_form_step2")
            run.record(c)

        def c14_step2_required():
            """P04 补充信息页缺必填项被拦截"""
            c = case(c14_step2_required.__doc__)
            page.locator(".confirm-submit").click()
            wait_idle(page, 700)
            errs = texts(page, ".field-error")
            on_form = page.locator(".form-panel").is_visible()
            c.status = "PASS" if errs and on_form else "FAIL"
            c.detail = f"errors={errs}"
            run.record(c)

        def c15_fill_step2():
            """P04 填写婚姻/职业/联系人/关系"""
            c = case(c15_fill_step2.__doc__)
            page.locator(".marriage-options .el-radio-button", has_text="已婚").click()
            pick_select("occupation", "职工")
            page.locator("#emergencyContact").fill("张三")
            pick_select("relationship", "子女")
            page.locator("#employerName").fill("晨光健康科技")
            wait_idle(page, 300)
            vals = {
                "marriage": page.locator(".marriage-options .el-radio-button.is-active")
                .inner_text()
                .strip(),
                # el-select 把 :id 直接给了内部 input，显示值取 input_value
                "occupation": page.locator("#occupation").input_value().strip(),
                "relationship": page.locator("#relationship").input_value().strip(),
            }
            ok = (
                vals["marriage"] == "已婚"
                and "职工" in vals["occupation"]
                and "子女" in vals["relationship"]
            )
            c.status = "PASS" if ok else "FAIL"
            c.detail = f"{vals}"
            run.record(c)

        def c16_review():
            """P05 进入独立核对页，字段回显且敏感字段脱敏"""
            c = case(c16_review.__doc__)
            page.locator(".confirm-submit").click()
            page.wait_for_selector(".review-panel", timeout=8000)
            wait_idle(page, 600)
            body = page.locator(".review-panel").inner_text()
            has_mask = "139****1111" in body
            no_plain = "13900001111" not in body
            groups = page.locator(".review-group").count()
            c.status = "PASS" if has_mask and no_plain and groups == 2 else "FAIL"
            c.detail = f"groups={groups} 脱敏={has_mask} 明文泄漏={not no_plain}"
            c.shot = shot("P05_review")
            run.record(c)

        def review_values() -> dict[str, str]:
            rows = page.locator(".review-fields > div")
            out = {}
            for i in range(rows.count()):
                row = rows.nth(i)
                out[row.locator("span").inner_text().strip()] = (
                    row.locator("strong").inner_text().strip()
                )
            return out

        def c17_back_to_edit():
            """P05 返回修改可回到表单，改动后重新核对生效"""
            c = case(c17_back_to_edit.__doc__)
            before = review_values().get("职业")
            page.locator(".review-panel").get_by_role("button", name="返回修改").click()
            page.wait_for_selector(".form-panel", timeout=8000)
            page.wait_for_selector("#occupation", timeout=8000)
            pick_select("occupation", "其他")
            page.locator(".confirm-submit").click()
            page.wait_for_selector(".review-panel", timeout=8000)
            wait_idle(page, 600)
            after = review_values().get("职业")
            # 把职业行滚进视口，截图才看得出改动
            page.locator(".review-fields > div", has_text="职业").first.scroll_into_view_if_needed()
            wait_idle(page, 300)
            notice = page.locator(".transcript-status")
            notice_text = notice.inner_text().strip() if notice.count() else ""
            c.status = "PASS" if after == "其他" and before != after else "FAIL"
            c.detail = f"职业 {before!r}→{after!r} 提示={notice_text!r}"
            c.shot = shot("P05_review_after_edit")
            run.record(c)

        def c18_submit():
            """P06 核对页提交后得到模拟回执且声明未向医院提交"""
            c = case(c18_submit.__doc__)
            page.locator(".review-submit").click()
            page.wait_for_selector(".result-panel", timeout=30000)
            wait_idle(page, 600)
            body = page.locator(".result-panel").inner_text()
            receipt = page.locator(".receipt strong")
            receipt_id = receipt.inner_text().strip() if receipt.count() else ""
            ok = receipt_id.startswith("SIM-") and "未向医院提交" in body
            c.status = "PASS" if ok else "FAIL"
            c.detail = f"receipt={receipt_id} 声明={'未向医院提交' in body}"
            c.shot = shot("P06_result")
            run.record(c)

        def c19_finish():
            """P06 完成并返回首页，清空本机办理状态"""
            c = case(c19_finish.__doc__)
            page.locator(".result-panel").get_by_text("完成并返回首页").click()
            page.wait_for_selector(".mascot-stage", timeout=8000)
            wait_idle(page, 400)
            c.status = "PASS" if page.locator(".mascot-stage").is_visible() else "FAIL"
            c.detail = "已回到首页，无残留办理页"
            run.record(c)

        # ---------------- 接口级：鉴权 / 幂等 / 会话隔离 ----------------
        api_cache: dict = {}

        def api_chain() -> dict:
            """在同一页面上下文里用 fetch 走一遍完整办理链路，返回各步观测值。"""
            if api_cache:
                return api_cache
            api_cache.update(
                page.evaluate(
                    """async () => {
                const root = '/api/admission-registration/v1';
                const tok = localStorage.getItem('auth_token');
                const call = async (path, init = {}) => {
                  const res = await fetch(root + path, {
                    ...init,
                    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, ...(init.headers || {}) },
                  });
                  const body = await res.json().catch(() => ({}));
                  return { status: res.status, body };
                };
                const out = {};

                const noauth = await fetch(root + '/validate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fields: {} }),
                });
                out.noauth = noauth.status;

                const v = await call('/identity/verify', {
                  method: 'POST',
                  body: JSON.stringify({ method: 'id_card', mockScenario: 'success' }),
                });
                const ident = v.body.identityToken;
                const apps = await call('/applications?identityToken=' + encodeURIComponent(ident));
                const appId = apps.body.items[0].id;
                const sel = await call('/applications/select', {
                  method: 'POST',
                  body: JSON.stringify({ identityToken: ident, applicationId: appId }),
                });
                const sessionId = sel.body.sessionId;
                const sess = await call('/sessions/' + encodeURIComponent(sessionId) + '?identityToken=' + encodeURIComponent(ident));
                const fields = {
                  ...v.body.fields,
                  phone: '13900002222',
                  marriage: '已婚',
                  occupation: '职工',
                  emergencyContact: '李四',
                  relationship: '配偶',
                  addressDetail: '测试路9号',
                };
                const rev = await call('/sessions/' + encodeURIComponent(sessionId) + '/review', {
                  method: 'POST',
                  body: JSON.stringify({ identityToken: ident, expectedRevision: sess.body.revision, fields }),
                });
                const payload = {
                  identityToken: ident,
                  applicationId: appId,
                  sessionId,
                  reviewRevision: rev.body.reviewRevision,
                  idempotencyKey: 'e2e-' + Date.now(),
                  mockScenario: 'success',
                  fields,
                };
                const s1 = await call('/submissions', { method: 'POST', body: JSON.stringify(payload) });
                const s2 = await call('/submissions', { method: 'POST', body: JSON.stringify(payload) });
                const s3 = await call('/submissions', {
                  method: 'POST',
                  body: JSON.stringify({ ...payload, fields: { ...fields, phone: '13900003333' } }),
                });

                // 重新核验会清除该患者旧办理会话
                const v2 = await call('/identity/verify', {
                  method: 'POST',
                  body: JSON.stringify({ method: 'id_card', mockScenario: 'success' }),
                });
                const oldSession = await call(
                  '/sessions/' + encodeURIComponent(sessionId) + '?identityToken=' + encodeURIComponent(v2.body.identityToken),
                );
                out.oldSessionStatus = oldSession.status;

                out.revStatus = rev.status;
                out.reviewRevision = rev.body.reviewRevision;
                out.s1 = { status: s1.status, receipt: s1.body.receiptId, state: s1.body.status };
                out.s2 = { status: s2.status, receipt: s2.body.receiptId };
                out.s3 = { status: s3.status, detail: String(s3.body.detail || '').slice(0, 80) };
                return out;
              }"""
                )
            )
            return api_cache

        def c20_api_auth():
            """接口级：无 Authorization 访问业务接口返回 401"""
            c = case(c20_api_auth.__doc__)
            data = api_chain()
            c.status = "PASS" if data["noauth"] == 401 else "FAIL"
            c.detail = f"no-token status={data['noauth']}"
            run.record(c)

        def c21_api_idempotent():
            """接口级：相同幂等键重复提交返回同一回执"""
            c = case(c21_api_idempotent.__doc__)
            data = api_chain()
            s1, s2 = data["s1"], data["s2"]
            ok = (
                s1["status"] == 200
                and s2["status"] == 200
                and s1["receipt"]
                and s1["receipt"] == s2["receipt"]
            )
            c.status = "PASS" if ok else "FAIL"
            c.detail = f"首次={s1} 重放={s2}"
            run.record(c)

        def c22_api_conflict():
            """接口级：同幂等键换内容提交被 409 拒绝"""
            c = case(c22_api_conflict.__doc__)
            data = api_chain()
            s3 = data["s3"]
            c.status = "PASS" if s3["status"] == 409 else "FAIL"
            c.detail = f"status={s3['status']} detail={s3['detail']!r}"
            run.record(c)

        def c23_api_session_isolated():
            """接口级：重新核验后旧办理会话不可再读取"""
            c = case(c23_api_session_isolated.__doc__)
            data = api_chain()
            c.status = "PASS" if data["oldSessionStatus"] != 200 else "FAIL"
            c.detail = f"旧会话读取 status={data['oldSessionStatus']}"
            run.record(c)

        for fn in (
            c01_home_skeleton,
            c02_shortcuts,
            c03_unsupported,
            c04_enter_identity,
            c05_identity_widgets,
            c06_verify_identity,
            c07_requires_selection,
            c08_enter_form,
            c09_readonly_masked,
            c10_required_blocked,
            c11_phone_keypad,
            c12_regions,
            c13_to_step2,
            c14_step2_required,
            c15_fill_step2,
            c16_review,
            c17_back_to_edit,
            c18_submit,
            c19_finish,
            c20_api_auth,
            c21_api_idempotent,
            c22_api_conflict,
            c23_api_session_isolated,
        ):
            guard(fn)

        context.close()
        browser.close()

    passed = sum(1 for c in run.cases if c.status == "PASS")
    print(f"\n== {passed}/{len(run.cases)} PASS ==")
    if run.console_errors:
        print("console errors:", run.console_errors[:5])
    if run.failed_requests:
        print("failed requests:", run.failed_requests[:5])
    (ARTIFACTS / "last_run.json").write_text(
        json.dumps(
            {
                "cases": [c.__dict__ for c in run.cases],
                "console_errors": run.console_errors,
                "failed_requests": run.failed_requests,
                "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return 0 if passed == len(run.cases) else 1


if __name__ == "__main__":
    raise SystemExit(main())
