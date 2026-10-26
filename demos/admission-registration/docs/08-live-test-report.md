# 住院登记 Demo 真实测试报告（2026-10-19）

测试对象：`http://127.0.0.1:8200/creations` 页面及其两个住院登记入口
- 内置 React 页 `/admission-demo`（卡片「住院登记 Mvp 接入模型」）
- Vue 2 原型 `/admission-registration/index.html`（卡片「智能入院登记」，iframe 弹层打开）
- 后端 `/api/admission-registration/v1/*` + `/api/admission-demo/extract`（FastAPI 内置 mock，非 8765 独立服务）
- 语音 `/api/voice/tts`、`/api/voice/stt`（doubao）

方法：本地签发 admin JWT（同 `sign_token` 算法）直打 HTTP 接口 + Playwright 驱动本机 Edge（1440×1000、伪造麦克风）走真实页面全流程。

## 结果总览

| 阶段 | 结果 |
|---|---|
| A 鉴权与基础（无 token 401 / 带 token 200 / creations 卡片 / voice 配置） | 6/6 |
| B mock 业务（regions/validate/verify/submissions 全边界，29 例） | 27/29，2 个 FAIL 实锤 1 个设计缺陷 |
| C AI 提取契约（白名单/歧义/双号码/敏感字段/422/401，12 例） | 11/12，Happy path 被环境阻塞 |
| D 语音（TTS 出流、TTS→STT round-trip、空音频、格式、鉴权，6 例） | 6/6 |
| E 页面真实走查（creations→点卡→P01→P05 全流程） | 通过（P05 正确显示「已有登记记录」） |
| 自动化套件 | 后端 pytest 14/14；前端 vitest 38/38 |
| React 版 `/admission-demo` 页面渲染 | 通过，无 JS 错误 |

## 缺陷清单（按严重度）

### P0-1 语音输入主路径必现 500：Doubao ASR 不接受 webm/opus
- 现象：真实浏览器（Edge 伪造麦克风）点击麦克风→停止→`POST /api/voice/stt` 返回 **500**；日志根因：
  `ValueError: Doubao ASR does not support audio format 'audio/webm;codecs=opus'; upload WAV or MP3`
- 影响面：`voiceRecorder.js` 的首选录音编码就是 `audio/webm;codecs=opus`（真实 Chrome/Edge 均如此），**所有真实用户的语音输入都会 500**，不是测试假设备的产物。应用层兜底正常（显示「语音识别暂不可用」），但 R05 语音补录功能实际不可用。
- 佐证通路本身没病：用 doubao TTS 产出的 MP3 回喂 `/api/voice/stt`，**完整识别**「我的手机号是13812345678，紧急联系人是张三。」
- 修复方向（三选一，需产品决策）：① 后端 doubao 适配器支持 webm/opus（服务端转码）；② 前端改录音管线（AudioContext 采 PCM 自封装 WAV）；③ 切换支持 webm 的 STT provider（如腾讯实时 ASR ws 链路）。

### P1-1 AI 激活模型指向网关已下线的模型 ID
- active model = `free/step-5-preview-free`；8766 网关 catalog 中**没有该 ID**（现存 `Step 5 Preview` 等 9 个），调用报 `404 model_not_found`，实测 `ai/candidates` 与 `admission-demo/extract` 均返回空 `{}`。
- 加重问题：`extract_registration_fields` 把一切失败吞成 `{}`，前端据此提示「未发现可安全回填的字段」——**模型挂掉时提示文案误导**（应为「AI 暂不可用」）。建议区分「模型无输出」与「调用失败」两种状态。
- 网关当时未运行（后台启动任务被用户取消，未重启）；网关现存模型中 `agnes-2.5-flash`/`agnes-3.0-flash` 返回 200 可用，`Step 5 Preview` 402、GLM/deepseek 502、Atria 429。
- 验证建议：修好激活模型 ID 后重跑 C1 用例。

### P1-2 mock 提交四态中「明确失败」「结果待确认」不可达（违反 PRD §9）
- `DemoStore.submit` 以 idNumber（固定 DEMO-ID-0001）记 `patient_submissions`：一旦 success 登记过，之后任何新 key 提交均返回 `already_registered`，`mockScenario=failed/unknown` **永远无法触发**；PRD §9/R08 要求 P05 四态（成功/明确失败/已登记/待确认）可演示。
- 更严重：`unknown` 会写入 `patient_submissions`，同患者后续所有提交（含正常流程）全部永久返回 `unknown`，与「查询明确后转入对应结果」的设计矛盾。
- 建议：mockScenario 不应被患者级历史遮蔽；unknown 只在 (identityToken, key) 维度生效。

### P2-1 mock store 为进程内存，演示一次即「打卡」
- 实测：API 测试登记过一次 DEMO-ID-0001 后，页面 E2E 提交落到 P05「已有登记记录」。真实演示场景同理——**每次演示前需重启 Octop 服务**清空内存。

### P2-2 部署的 Vue 构建与源码曾不同步
- 测试初期 iframe 加载旧包（按钮「开始模拟核验」），14:50 构建刷新后与源码一致（「模拟刷卡」）。建议把 frontend 构建纳入 Octop 发布流程，避免上线包陈旧。

## 已验证正常的关键行为

- 鉴权：无 token 一律 401（AUTH_FAILED），伪造/失效 identityToken 401，只读字段（姓名/证件/国籍/民族）篡改 409，幂等同 key 同内容同回执、同 key 不同内容 409，短 idempotencyKey 422，顶层多余字段 418→422。
- 校验：手机号/婚姻枚举/职业枚举/地区三级路径/单位名非法字符/缺字段/额外字段全部 422 且错误定位到字段。
- 页面流程：creations 两卡入口（点卡→iframe 弹层 / 站内路由）均正常；P02 倒计时 300s；身份只读掩码（演**者 / DEMO-I**0001）；三级地区级联（辽宁省/沈阳市/浑南区、北京市/北京市/朝阳区）；必填缺失时提交被拦截并定位；P05 结果态渲染正确。
- 语音输出：真实页面多次 `200 POST /api/voice/tts`（MP3 66KB）；语音输入 round-trip 完整识别（见 P0-1）。
- 语音区空结果/失败提示、AI 候选只回填白名单四字段（phone/addressDetail/emergencyContact/relationship）、歧义词（可能/或者/也许）整体拒填、文本双号码拒收 phone、敏感字段（姓名/身份证）不进候选——全部按 PRD 行为。

## 环境备注

- 测试期间为跑通 AI 实测曾后台启动 8766 FreeLLM Gateway，被用户取消后未再重启；8766 当前离线，AI happy-path 验证保持阻塞结论。
- API 测试在 demo store 中留下一条 DEMO-ID-0001 success 登记记录，下次演示前需重启 Octop 服务。
- `/api/setup/status` 与 teacher 头像在日志中显示 requestfailed，直连均为 200，属 SPA 路由切换的浏览器端中止噪音，非缺陷。

## 复现方式

- HTTP 级：` Authorization: Bearer <admin JWT>`，用例见会话脚本（test_stage_b/c/d.py，位于本次会话工作目录）。
- 页面级：Playwright + Edge executable_path，`--use-fake-device-for-media-stream`，iframe 内 `.mic-button` 两段式录音。

## 2026-10-19：针对本报告缺陷的修复回归

- 浏览器录音产生的 WebM/Opus 在提交 STT 前转换为单声道 PCM16 WAV；新增 WAV 头/采样信息测试，并验证上传文件名与 `audio/wav` 类型。真实 Edge 麦克风录音与 Doubao 在线识别尚未复测。
- AI 模型调用失败现在由两条提取 API 明确返回 `503 AI_MODEL_UNAVAILABLE`，前端保留转写并提示手动补充；无有效候选/不可解析模型输出仍可返回空候选。没有改动当前激活模型或触发外部模型调用，因此之前报告里的模型配置问题仍需管理员修正并在线验证。
- mock 登记结果仅按用户、身份令牌和幂等键存取；`success/failed/already_registered/unknown` 情景由当前请求显式决定，`unknown` 不再污染同患者后续新请求。复测不再需要为清空患者级模拟登记而重启服务。
- FPK 工作流的两个构建步骤现在都先构建 Dashboard，再构建入院登记 Vue 子应用；`Makefile build-frontend` 本来已有这两个步骤。工作流 YAML 已解析通过；本地按相同顺序完成 Dashboard 与 Vue 静态生产构建，Vue bundle 输出到 `src/octop/dashboard/admission-registration/`。构建有 chunk 体积提示，不影响成功产物。
- 自动化验证：Vue Vitest 40/40，`vue-tsc --noEmit` 通过，Prettier 检查通过；Octop 相关单测/集成测试 16 passed，独立 FastAPI mock 服务 14 passed；Ruff check/format 通过。
- 自动化环境使用 mock 模型、mock STT 与 mock API；尚未覆盖真实麦克风/云端 ASR、激活模型可用性及登录后的浏览器视觉回归。
