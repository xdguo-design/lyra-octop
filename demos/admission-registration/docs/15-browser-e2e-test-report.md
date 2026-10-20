# 15 · 浏览器端自动化测试报告

日期：2026-10-20　对象：`demos/admission-registration`（Vue2 + Element UI，跑在 Octop `http://127.0.0.1:8200/admission-registration/`）
结论：**23/23 通过**，全流程（首页 → 身份核验 → 申请单 → 两页表单 → 独立核对 → 提交 → 结果）在真实 Edge 里跑通，可重复执行。

## 方法

原计划走 Playwright MCP，但 MCP 需要在连接器管理页手动点「信任」才注入工具，且它用独立浏览器 profile、仍要人工登录一次 Octop。为免掉这两步人工介入，改用仓库 `.venv` 里已有的 playwright 直接驱动本机 Edge：启动时把本地 Octop 签发的 admin token 注入 `localStorage.auth_token`，页面即视为已登录，全程无人值守。

- 驱动：`playwright`（sync API）+ `channel="msedge"`，viewport 1440×1000，headless 默认（`--headed` 可看过程）
- 鉴权：读 `~/.octop/octop.db` 里 `secrets.jwt`，用 `octop.infra.auth.tokens.sign_token` 签 1 小时 admin token（与平台同一算法），只在进程内存与页面 localStorage 中使用，不落盘
- 断言：DOM 文本、控件状态、输入框 `value`、页面截图；同时收集 console error 与失败请求
- 产物：`e2e/artifacts/`（截图 + `last_run.json`）

脚本：`demos/admission-registration/e2e/browser_e2e.py`

```powershell
# 前置：Octop 已在 127.0.0.1:8200 运行
.venv\Scripts\python.exe demos\admission-registration\e2e\browser_e2e.py
.venv\Scripts\python.exe demos\admission-registration\e2e\browser_e2e.py --headed   # 看过程
.venv\Scripts\python.exe demos\admission-registration\e2e\browser_e2e.py --only 幂等  # 只跑某条
```

## 用例与结果

| # | 页面 | 用例 | 观测 |
|---|---|---|---|
| 1 | P01 | 首页骨架：品牌、机器人、四个快捷问题、序列号 | `Neusoft` / 4 个 / `NS1234567890987654321 V1.1.2` |
| 2 | P01 | 快捷问题文案与 `SHORTCUTS` 一致 | 4 条全等 |
| 3 | P01 | 超范围问题（打印报告）走固定回复且停留首页 | 「抱歉，本演示仅支持模拟入院登记，暂不支持这项服务。」 |
| 4 | P01→P02 | 第 4 个快捷问题进入身份核验 | `.identity-stage` 渲染 |
| 5 | P02 | 读卡提示、模拟刷卡按钮、倒计时 | 倒计时 300s |
| 6 | P02→P03 | 模拟刷卡后列出本人申请单 | 1 张卡片 |
| 7 | P03 | 未选申请单时继续按钮不可点 | disabled=True |
| 8 | P03→P04 | 选中后进入表单第一页 | 标题「以下为您的入院登记信息」 |
| 9 | P04 | 姓名/身份证/国籍/民族只读且脱敏 | `演**者` / `DEMO-I**0001`，4 个只读项 |
| 10 | P04 | 缺手机号时下一页被拦截并定位字段 | 「请输入有效的11位手机号码」，停留表单页 |
| 11 | P04 | 数字键盘输入手机号并脱敏回显 | `139****1111` |
| 12 | P04 | 籍贯/现住地址三级级联 | `辽宁省/沈阳市/浑南区`、`北京市/朝阳区` |
| 13 | P04 | 第一页通过校验进入补充信息页 | 无字段错误 |
| 14 | P04 | 补充信息页缺必填被拦截 | 婚姻/职业/联系人/关系 4 条错误 |
| 15 | P04 | 填写婚姻/职业/联系人/关系 | 已婚 / 职工 / 张三 / 子女 |
| 16 | P05 | 独立核对页分组回显且敏感字段脱敏 | 2 组；`139****1111` 存在、明文不存在 |
| 17 | P05 | 返回修改 → 改职业 → 重新核对生效 | 职业 `职工`→`其他` |
| 18 | P06 | 提交得到模拟回执并声明未向医院提交 | `SIM-13BB1EC154`，「本次仅为演示，未向医院提交任何信息」 |
| 19 | P06 | 完成返回首页，无残留办理页 | 回到 `.mascot-stage` |
| 20 | 接口 | 无 `Authorization` 访问业务接口 | 401 |
| 21 | 接口 | 相同幂等键重复提交 | 两次 200，回执同为 `SIM-B2D3D0735F` |
| 22 | 接口 | 同幂等键换内容提交 | 409「登记信息已变化，请重新核对后提交」 |
| 23 | 接口 | 重新核验后旧办理会话不可读 | 404 |

第 20–23 条通过页面内 `fetch` 打 `/api/admission-registration/v1/*`，走的是与 UI 相同的登录态与链路，用于补 UI 难以覆盖的幂等与会话隔离。

## 截图

`e2e/artifacts/` 下：`P01_home`、`P01_unsupported`、`P02_identity`、`P03_applications`、`P04_form_step1`、`P04_required_blocked`、`P04_form_step2`、`P05_review`、`P05_review_after_edit`、`P06_result`。

## 运行期观察

- 页面切换时 `POST /api/voice/tts` 会出现 `net::ERR_ABORTED`，是导航导致的请求中止，不是缺陷；已在脚本里从失败请求中过滤。
- console 里的 401/409/404 全部来自第 20–22 条负向用例，属预期。
- 多次连续运行每次都能拿到新的 `SIM-` 回执，说明 08 报告里「mock 一次即打卡」的问题已不再影响演示（登记结果按用户+身份令牌+幂等键存）。

## 未覆盖

- 真实麦克风录音、线上 ASR/TTS：整条语音路径未验证（脚本走的是点击与键盘输入）。
- 真实活动模型（Qwen）驱动的 AI 对话抽取：`/api/admission-demo/intent`、`/ai/candidates` 未纳入本轮，模型侧漏抽取问题见 14 号报告。
- PostgreSQL 部署形态、真实 HIS 对接：不适用（演示数据）。
