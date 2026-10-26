# 入院登记页面改版实施计划

> **给代理执行者：** 按 `- [ ]` 跟踪；先在 `develop` 最新提交上建立 `codex/` 功能分支，再逐项执行。不要提交或推送，除非用户另行授权。当前工作区含大量无关未提交文件，不得重置、批量格式化或覆盖。每项先写 Vitest 失败用例，再实现最小行为。服务端合同见 `docs/specs/plans/2026-10-19-admission-conversation-development.md`，本计划的申请单、session、turn 与提交调用必须严格匹配该合同。

**目标：** 将当前 Vue 入院 Demo 改为参考图风格的分步办理体验，新增申请单列表/确认页、独立最终核对页和 AI 对话辅助，并提供真实录音音量波形。

**架构要点：** 继续使用 `demos/admission-registration/frontend` 的 Vue 2、Element UI 和现有 ASR/TTS；`App.vue` 只协调页面状态与 API，不再承担所有弹窗和对话渲染。业务页由申请单、表单、核对、结果组件组成；同一固定语音栏在各阶段调用服务端会话接口，UI 不自行推断权威患者或申请单状态。

**技术栈：** Vue 2.7、Element UI、Vite、Vitest、Vue Test Utils；在 `demos/admission-registration/frontend` 执行 `npm test -- --run`、`npm run typecheck`、`npm run format:check` 和 `npm run build`。

**关联设计文档：** `docs/specs/2026-10-19-admission-conversation-redesign-design.md`；API 依赖：`docs/specs/plans/2026-10-19-admission-conversation-development.md`。

## 2026-10-20 执行与回归记录

- 参考图改版已接入 Octop 创作页：AI 首页、独立身份核验、本人入院申请单（含科室和计划入院时间）、分步表单、AI 对话、修改候选确认、独立核对及结果流程均已实现。
- 图2语音栏固定在底部；波形使用麦克风 analyser 的真实 RMS 状态，录音静音与检测到声音分别显示。自动测试覆盖波形与停止清理；本轮未请求麦克风权限，因此没有真实硬件录音验收。
- 两轮自动回归每轮均为：Vue 73 passed；Octop admission domain/DB/API 71 passed、1 skipped；旧 Demo API 6 passed。最终小改动后再次复跑前端全测、typecheck、format check、build 和服务端全套目标测试；Ruff、ruff format、diff check 通过。
- 浏览器验收通过：新首页、身份卡比例、申请单信息与 gate、表单/对话布局；服务重启后重新模拟核验并恢复同一申请单/会话；当前 Qwen 使用合成语句成功回填 3 项候选并继续询问下一项。
- 按需注册 Element UI 实际使用的 8 个控件后，JS bundle 从 1.295 MB / gzip 366 KB 减至 650 KB / gzip 189 KB（约减半）；仍略高于 500 KB 提示线。
- 未覆盖：生产浏览器完整提交两次、真实麦克风权限/不同噪声、897/1413/390 等完整视口矩阵、大字体与触摸边界、100 次资源泄漏检查及 Lighthouse/交互性能基线。

---

## 文件变更清单

- 修改：
  - `demos/admission-registration/frontend/src/App.vue` — 页面状态机、路由 API 编排、会话生命周期；不放业务规则。
  - `demos/admission-registration/frontend/src/api/admission.js` — 申请单、会话、轮次、提案、review、提交的 typed-by-contract API wrapper。
  - `demos/admission-registration/frontend/src/logic/voiceFlow.js` — 录音、ASR、会话 turn、AI 返回和迟到响应协调。
  - `demos/admission-registration/frontend/src/utils/voiceRecorder.js` — 音频 analyser/RMS 回调以及停止/销毁清理。
  - `demos/admission-registration/frontend/src/components/VoiceStage.vue` — 图2底部麦克风、实时波形、静音/有声提示、手动输入和录音状态。
  - `demos/admission-registration/frontend/src/components/IdentityCard.vue` — 与总体视觉统一的身份验证步骤及状态。
  - `demos/admission-registration/frontend/src/components/AdmissionForm.vue` — 基本/补充信息分步显示，保留14字段合同和区域选择。
  - `demos/admission-registration/frontend/src/components/ResultPanel.vue` — 原结果和查询状态与新流程一致。
  - `demos/admission-registration/frontend/src/model/formConfig.js` — 页面步骤、字段分组、labels 和本地化/展示模型（不增加无合同的可写字段）。
  - `demos/admission-registration/frontend/src/assets` — 仅在已有机器人、读卡设备素材不满足新图时调整现有资源引用；不增加大体积装饰素材。
  - `demos/admission-registration/frontend/tests/full-workflow.test.js` — 页面顺序、权限边界、申请单 gate、字段回填、最终确认、提交。
  - `demos/admission-registration/frontend/tests/voice-recorder.test.js` — analyser 静音/有声、阈值稳定性和资源释放。
  - `demos/admission-registration/frontend/docs/03-prototype.md`、`demos/admission-registration/README.md`、`demos/admission-registration/docs/07-handoff-api.md` — 当前页流程与操作说明。
  - `docs/specs/2026-10-19-admission-conversation-redesign-design.md`、`memory.md` — 只同步已批准设计和真实实现差异，不把未验收能力标为已完成。
- 新建：
  - `demos/admission-registration/frontend/src/components/AdmissionApplicationList.vue` — 本人申请单列表、申请单详情和确认选择。
  - `demos/admission-registration/frontend/src/components/ReviewPanel.vue` — 独立核对页、只读摘要、按分组编辑入口、确认版本显示。
  - `demos/admission-registration/frontend/src/components/ConversationDialog.vue` — AI问答记录、待确认字段变更卡、语音/文本入口；一个模态层协调对话和修改确认。
  - `demos/admission-registration/frontend/tests/admission-pages.test.js` — 申请单、review、dialog 的组件/键盘/响应式行为。

## 计划任务

### 任务 1：首页与全局框架视觉重做

**涉及文件：** `src/App.vue`、`src/components/ConversationCard.vue`、`src/components/BottomBar.vue`、`src/model/formConfig.js`、`tests/full-workflow.test.js`

- [ ] **步骤 1：写失败用例。** 首页显示大机器人、Neusoft/时间/帮助、四个可点击快捷问题和底部语音入口；未认证时不显示患者姓名/电话；快捷“我要办理入院”与语音语义入口走同一页面动作；非支持业务显示“当前页面没有该业务功能”；重置后不能露出上一位患者资料。
- [ ] **步骤 2：确认失败。** 在前端目录运行 `npm test -- --run tests/full-workflow.test.js`。预期：新布局/账号隐私/快捷项断言失败。
- [ ] **步骤 3：重构首页壳层。** `App.vue` 保留顶栏、当前步骤主区、固定底栏；首页按图1浅蓝白/蓝色主操作视觉布置，不让当前屏出现滚动条；视口矮或大字体时内容区可滚动但 scrollbar 隐藏，且不能裁剪表单。账号只在认证后显示，`BottomBar` 独立管理患者摘要与退出。
- [ ] **步骤 4：回归。** `npm test -- --run tests/full-workflow.test.js`。预期：首页快捷路由与未登录用户栏用例通过。

### 任务 2：身份后强制申请单页

**涉及文件：** `src/App.vue`、`src/api/admission.js`、`src/components/AdmissionApplicationList.vue`、`tests/admission-pages.test.js`、`tests/full-workflow.test.js`

- [ ] **步骤 1：写失败流程测试。** 身份成功后先调用本人申请单列表；0单停在申请单空态并提供重试/帮助；多单展示申请号、科室、计划入院时间等摘要并要求只选一单；一单仍需明确确认；过期、取消、已使用不能确认；申请单详情不得由 AI 补写；切换患者清除此前申请单和草稿。
- [ ] **步骤 2：确认失败。** `npm test -- --run tests/admission-pages.test.js tests/full-workflow.test.js`。预期：组件和 `applications` 页面状态不存在。
- [ ] **步骤 3：接入服务端申请单接口。** API wrapper 调用已登录平台的申请单查询/确认端点；组件展示设计规定的申请号、脱敏患者、入院科室、计划入院时间、医生/开单时间、住院类型、诊断、病区和状态。时间使用 API 返回的医院时区格式化，不用浏览器裸 `toLocaleString()`。无提供数据展示“未提供”，不自行制造患者/业务事实。
- [ ] **步骤 4：回归 gate 与多单选项。** 同步骤 2 命令。预期：任何无效/未确认选择不能进入表单，唯一有效单也能明确确认后开始会话。

### 任务 3：信息表单与独立最终核对页

**涉及文件：** `src/App.vue`、`src/components/AdmissionForm.vue`、`src/components/ReviewPanel.vue`、`src/model/formConfig.js`、`tests/admission-pages.test.js`、`tests/full-workflow.test.js`

- [ ] **步骤 1：写失败用例。** 申请单确认后进入基本信息 F01–F08，再进入补充信息 F09–F14，再进入独立核对；14项字段各有唯一来源；身份认证字段只读；申请单字段只读；已有可编辑字段仍能手动输入。核对页显示全部已采集字段与申请摘要；编辑入口回对应表单且保留其余值；未完成必填项或存在未决 proposal 时不可确认。
- [ ] **步骤 2：确认失败。** `npm test -- --run tests/admission-pages.test.js tests/full-workflow.test.js`。预期：没有 `review` 页面及 edit-to-page 路由。
- [ ] **步骤 3：按流程拆分。** 页面顺序定为 `home → identity → applications → form(step 1/2) → review → result`。`ReviewPanel.vue` 按基本/补充/申请单分组呈现，长内容可展开；修改任何值即撤销之前已确认的 review revision。不得把原型图中缺少业务合同的字段新增为可编辑项。
- [ ] **步骤 4：回归全流程。** `npm test -- --run tests/admission-pages.test.js tests/full-workflow.test.js`。预期：完整流程只能在当前版本 review 有效后触发提交。

### 任务 4：AI对话面板与修改确认

**涉及文件：** `src/App.vue`、`src/logic/voiceFlow.js`、`src/components/ConversationDialog.vue`、`src/components/VoiceStage.vue`、`src/api/admission.js`、`tests/admission-pages.test.js`、`tests/full-workflow.test.js`

- [ ] **步骤 1：写失败用例。** 语音/文字输入都创建一次 session turn；多个字段的一句话都显示候选；缺必填时 AI 每次问一个关键项；`“住院登记/入院登记/帮我办理住院”` 路由到当前办理步骤；其他意图明确提示无此功能。对已确认值提议不同内容时，保留旧值并展示字段/旧值/新值/“保留”/“确认修改”卡；按钮与针对本 proposal 的明确语音选择调用同一确认操作；含糊“好”不误改。
- [ ] **步骤 2：确认失败。** `npm test -- --run tests/admission-pages.test.js tests/full-workflow.test.js`。预期：对话面板、跨页候选及当前提案确认行为不存在。
- [ ] **步骤 3：实现单层对话界面。** 在当前业务阶段打开 modal/大屏对话面板，显示 AI 提问、患者回答、识别结果及字段回填。模态内部滚动、背景页面固定；修改确认卡放在对话流内，不再嵌套第二个 el-dialog。关闭对话不清空草稿。转写可人工更正；文本和语音进入同一 server session turn；AI只给允许的字段/动作。
- [ ] **步骤 4：回归语义、拒绝和过期响应。** 同步骤 2 命令。预期：语音同意/拒绝等同按钮；输入提示注入无法更改 owner、申请单或身份字段；旧 session 响应不能更新新会话。

### 任务 5：真实语音波形与可访问控制

**涉及文件：** `src/utils/voiceRecorder.js`、`src/components/VoiceStage.vue`、`src/logic/voiceFlow.js`、`tests/voice-recorder.test.js`、`tests/full-workflow.test.js`

- [ ] **步骤 1：编写音量回调失败测试。** mock Web Audio `AnalyserNode`：静音 RMS 显示“正在听，等待您说话”且低幅平稳波形；连续超过阈值显示“检测到声音”并按音量映射波形高度；阈值附近通过连续帧去抖；录音停止/异常/离页均停轨、关闭 AudioContext、取消 animation frame。
- [ ] **步骤 2：确认失败。** `npm test -- --run tests/voice-recorder.test.js`。预期：当前 `VoiceRecorder` 没有 `onLevel` 或 analyser 生命周期用例失败。
- [ ] **步骤 3：接入录音流 analyser。** `VoiceRecorder` 使用 `getUserMedia` 已取得的同一 stream 建 `AudioContext`/`AnalyserNode`，每帧给 UI 音量/RMS和静音/有声状态；不存储或上传音量数据、不用随机波形。按图2样式呈现左麦克风、中间波形/操作提示、右侧手动输入；支持 pointer hold/release，pointer cancel/滑出取消，键盘可切换开始/结束，不双重触发。60秒上限、空音频不上传、权限拒绝提示沿用现有门槛。
- [ ] **步骤 4：验证音频生命周期。** `npm test -- --run tests/voice-recorder.test.js tests/full-workflow.test.js`。预期：静音与有声状态可区分且每条轨道/AudioContext/RAF 在停止和取消后清理；真实麦克风另做合成语句手工验收。

### 任务 6：修改、语音确认提交与结果体验

**涉及文件：** `src/App.vue`、`src/components/ReviewPanel.vue`、`src/components/ResultPanel.vue`、`src/logic/voiceFlow.js`、`tests/full-workflow.test.js`

- [ ] **步骤 1：写失败用例。** 只有核对页当前 revision、申请单仍有效、字段校验通过、无未决修改时，点击“确认提交”才触发 submit；语音“提交入院登记”只在同等条件下触发；录音中/AI理解中/旧核对版本/其他页面的“确定”不会提交；提交按钮防重复；结果状态准确区分已登记、处理中、失败及重试查询。
- [ ] **步骤 2：确认失败。** `npm test -- --run tests/full-workflow.test.js`。预期：当前结果页前直接提交，无独立核对 revision 保护。
- [ ] **步骤 3：实现前端提交意图和确认状态。** 核对页按钮创建明确用户意图；AI语音结果只映射受控 `confirm_submission`，server 再核验 owner、application、session revision、有效字段和幂等键。前端不把模型回复文本当成功；成功文案只依据服务端真实响应。
- [ ] **步骤 4：回归提交竞态。** 同步骤 2。预期：双击、重复turn、超时重试不重复登记；提交时单被撤销时展示拒绝并回到申请单/帮助状态。

### 任务 7：设计/合同文档和联调回归

- [ ] `demos/admission-registration/frontend` 执行 `npm test -- --run`，预期 Vitest 全通过。
- [ ] `npm run typecheck`、`npm run format:check`、`npm run build`，预期无类型、格式、Vite 错误。
- [ ] 从仓库根目录执行 `make build-frontend` 仅在明确允许覆盖现有生成目录时运行；该命令同时构建整个 Dashboard 并安装两套 npm 依赖。若不运行，单独运行 admission Demo build，并记录 Octop 打包产物尚未重建。
- [ ] 页面真机/浏览器按序验收：首页 → 身份失败/成功 → 无单/一个单/多个单 → 基本/补充表单 → 语音跨页提取 → 有值修改确认/拒绝 → 核对编辑 → 点击与语音提交 → 结果查询 → 退出后不泄露旧患者内容。
- [ ] 在 897×764、窄移动视口、短高度、大字体、键盘操作和触摸按住场景检查：常用终端布局不出现整页滚动条；短屏仍能滚动内容；底部语音栏不挡操作；波形仅在真实录音期间出现；对话内部滚动不推动页面。
- [ ] 更新 `03-prototype.md` 和 README 以与实际流程一致；同步旧 PRD 中“身份后直接表单”“AI不保存上下文”等已失效描述。真实 ASR/Qwen 使用合成句手动联调，不能把 mock 单测表述成真实麦克风/HIS验收。

### 任务 8：第一轮回归——组件、交互和流程完整性

- [ ] 在 Demo frontend 运行全量 `npm test -- --run`、`npm run typecheck`、`npm run format:check` 和 `npm run build`。预期所有现有及新增测试通过、构建成功；出现失败先修复并重跑，不允许跳过失败用例。
- [ ] 手工完成第一轮正常用户主路径：首页 → 身份认证 → 本人申请单 → 基本/补充信息 → AI/手工录入 → 核对 → 修改任一字段 → 重新核对 → 提交 → 结果查询 → 退出。另覆盖无申请单、多个申请单、申请单过期、字段缺失、AI 限流和 AI 超时状态。
- [ ] 对抗验证：患者 A 退出后立即进入患者 B；AI 响应过程中切页/手工改值；两次确认提案；提交时申请单失效；录音权限拒绝、静音、噪声、录音中断、60 秒上限、pointer cancel、重复点击。预期不串患者、不丢转写、不误提交、不出现假波形或麦克风资源泄漏。
- [ ] 第一轮门槛：完整流程各页均可到达且受前置条件控制；页面和 API 对同一 session/revision 保持一致；无阻断级错误、无身份或申请单绕过；所有已发现缺陷修复并复跑相关用例后才进入第二轮。

### 任务 9：第二轮回归——稳定性、视口与页面性能

- [ ] 用生产 build 在当前 Octop 浏览器内连续完整走两次流程：第一遍正常提交，第二遍拒绝修改、主动重试模型错误并退出。刷新/重启前后按设计重新认证恢复会话；确认退出或过期后旧患者内容不闪现。记录浏览器控制台、网络请求、接口耗时和未完成请求清理情况。
- [ ] 视口矩阵检查：897×764（当前页面参考）、桌面 1413×764、窄屏 390×844、短屏 390×640、大字体/200%缩放、键盘 Tab/Enter 和触摸按住/滑出。预期滚动条隐藏但内容仍可滚动；固定语音栏不遮字段/按钮；对话历史只在面板内部滚动；焦点顺序、可见焦点和无障碍名称可用。
- [ ] 在同一机器、同一生产 build 上对主页和身份页各采 3 次 Lighthouse/浏览器 Performance 数据，记录 LCP、CLS、JS bundle 大小和页面错误；目标 LCP ≤ 2.5 秒、CLS ≤ 0.1。通过 Chrome Event Timing 的 `PerformanceObserver` 记录至少 20 次主交互事件到下一次绘制的响应时间，p95 ≤ 200 毫秒，作为本地交互响应门槛（不将实验室样本误称为真实用户 INP）。录音波形更新应限帧，静音时不发生高频页面重绘；若本地环境/登录保护不能可靠测量，记录该项未测并用真实点击响应时间补充，不假报通过。
- [ ] 在 10 分钟窗口内重复开始/取消录音并执行 100 次页面状态切换，检查没有持续增长的活动 AudioContext、麦克风 track、RAF、计时器或重复事件监听；每次停止/取消/离页均回到零活动录音资源。只用合成音频做自动测试，真实麦克风只做少量手动短句，不保存声音。
- [ ] 第二轮门槛：两次生产构建旅程成功；视口矩阵无遮挡或信息裁剪；性能指标达到目标，或有明确的环境限制及已修复的实际瓶颈记录；浏览器控制台无未处理异常。任何回归缺陷修复后，重新执行第一轮相关测试，再重复受影响的第二轮项目。

## 对抗性页面验收

- 切换患者或退出后，姓名、电话、转写、波形、对话和申请单卡片均不得短暂显示上一用户内容。
- 用户拒绝麦克风、无声音、背景噪音、权限初始化中取消、按住时切后台、快速双击：无假波形、重复请求或遗留音轨。
- AI 处理期间换页、退出、换人或手工编辑：迟到结果必须因 turn/session/revision 不匹配而丢弃。
- 申请单加载慢、空列表、多条、过期和提交前撤销：界面不能通过跳步或浏览器状态绕过服务端门槛。
- 表单视口不足、大字体/缩放及键盘焦点：内容不丢失、不被固定栏遮住，所有操作有可见焦点和可访问名称。
- 改值后用户说“不要改”或重复确认：旧值只在明确同意后替换；重复提交只显示同一服务端结果。

## 实施顺序与依赖

先完成服务端计划中的任务 1–5，再按本计划任务 1–7 实施，之后按顺序完成第一轮和第二轮回归。任务 2 的页面不可用本地假列表代替正式接口；组件开发可用固定测试 fixture，但合并前必须接真实 Octop API mock。服务端会话 schema 和 session/turn 请求响应合同未通过时，不开发第二套客户端状态存储。
