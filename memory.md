# 项目长期上下文

## 2026-10-19：核心应用用户可见文案 i18n 设计

- 用户确认核心应用分批整理用户可见文案；复用后端 `src/octop/i18n/{en,zh}.json` 与 `tr()`/domain helpers、Dashboard `dashboard/src/locales/{en,zh}.json` 与 i18next，不新建字符串配置层。
- 只迁移实际显示给用户的文案；API/数据库/协议标识、日志、测试/开发文本、生成产物和独立 Demo 排除。API 错误迁移须保留当前错误码、status、响应 envelope 与字段契约。
- 设计文档 `docs/specs/2026-10-19-core-user-visible-i18n-design.md` 已确认；实施计划 `docs/specs/plans/2026-10-19-core-user-visible-i18n.md` 经审阅并已由用户批准在当前会话分批执行。
- 2026-10-19 已迁移部分核心 API 验证 detail：SkillHub、Agent 工具设置、钉钉授权、子 Agent、移动设备状态和记忆提取设置；维持原 status、异常类型及 detail envelope。Dashboard 已迁移 Home 资料保存/改密成功提示及 SkillPackages FreeLLM 提交成功提示，复用既有 locale 树。
- 本批验证：相关后端集成测试组合 24 passed；`tests/unit/i18n` 排除旧文案断言后 79 passed、1 deselected；Dashboard 相关 Vitest 27 passed、TypeScript 编译通过、locale 键一致性 1 passed。全套 i18n 仍有既有失败 `test_format_path_outside_root_zh_guides_to_storage_root`，测试预期与工作区已有授权工作区/附件提示不一致。
- 尚未完成：API 其他直接错误详情审计、CLI/IM/服务端状态文案、Dashboard 剩余用户可见字面量及最终分层复查。当前结果是进行中的切片，不能标为全量 i18n 整理完成。

## 2026-10-19：入院登记 Demo

- 用户先要求文档，随后授权按已审阅设计开发原型页面和 FastAPI 服务；用户明确要求严格遵循原图页面结构，不增加自创 UI。交付目录为 `demos/admission-registration/`；旧 React 入院 Demo 保持不动。
- 技术栈以用户最后指定的 **Vue 2 + Element UI** 为准，后端 Python 3.12 + FastAPI。字段按截图左右字段并集共14项，两页表单为 F01–F08、F09–F14，末页卡片直接确认提交，无独立核对页，共5个页面状态。
- 医院/读卡/档案/字典/登记接口全部由独立 demo 后端 mock；ASR/TTS 继续使用平台维护的服务与配置；AI 复用当前 `/api/admission-demo/extract`，由后端固定目标代理，不接受客户端传入地址。
- AI 每次只发送当前录音转写，不使用或存储患者历史上下文。只映射联系电话、详细地址、紧急联系人姓名、关系；身份只读，婚姻/职业等使用标准控件。人工输入优先，冲突候选须明确采用。
- 前后端从 `contracts/admission-fields.schema.json` 共享字段校验；文档交接清单 `demos/admission-registration/docs/07-handoff-api.md` 记录 mock/平台接口的参数、响应和错误处理。mock 结果驻留进程内存，不用于真实患者办理。

## 2026-10-17：对话文件工作流需求

- 用户确认目标是按 ChatGPT 式文件交互完善 Octop/LYRA：读取、解读、展示文件；随后要求完整范围及详细、全面的方案文档。
- 完整方案包括上传、预览、内容理解、来源定位、多轮追问、生成、在线修改和导出；主入口 `/home`，兼顾 `/chat`。
- 截图中的 Requesty、免费模型额度、每日发现是示例内容，不是产品开发指令。
- 需求与验收：`docs/specs/2026-10-17-chatgpt-file-experience-requirements.md`。
- 详细设计：`docs/specs/2026-10-17-chatgpt-file-experience-design.md`。
- 开发计划：`docs/specs/plans/2026-10-17-chatgpt-file-experience.md`。
- 用户已明确授权按照完整方案实施，并要求严格规范测试、第一性原理和对抗测试。方案状态从草案转为实施基线；其中的限额仍须按设计验证，尚未完成的能力不能记为已上线。
- 代码检查发现现有上传、图片模型输入、预览、知识库解析、DOCX Markdown 编辑及线程成品记录可复用；通用附件主要仍为路径提示。现有知识库解析返回扁平文本，不具备这里规划的统一位置引用合同。
- 根目录此前不存在 `memory.md`。工作区已有大量其他任务的未提交改动，后续实施不得覆盖或批量格式化这些改动。
- 三份方案已完成审查，用户随后明确授权按其完整范围实施。实施计划当前状态和差距记录在 `docs/specs/plans/2026-10-17-chatgpt-file-experience.md`；需求和设计规格分别在相邻 `docs/specs/` 文件。
- 2026-10-17 已交付文件读取首切片：migration 024 双方言、文件身份/revision/segment/task repo、上传登记和旧返回字段兼容；受限 TXT/MD/code、CSV/TSV、PDF 文本、DOCX、XLSX/XLSM、PPTX 抽取；隔离子进程读取 API；上传文件在发送时校验归属并注入有 locator 的 untrusted model context；聊天附件历史保留 ID/read status 并显示状态。
- 本切片的定向后端验证：`47 passed, 1 skipped`，包括文件 parser/worker/service/context、绑定单测、数据库和 upload/read integration。Ruff check 与 21 个 Python 文件的 format check 通过。Dashboard 附件/历史测试中原 10 项通过，新增消息卡测试曾发现并修复测试桩参数缺省问题，修复后的单测和 TypeScript 编译仍需确认最终结果。
- 真实失败/防护：多 Sheet 汇总 cell 预算、Office ZIP bomb/路径穿越、worker 超时 kill+wait、API owner/thread/revision 校验和上传 hash/size 检查已有测试或保护。尚未完成旧 preview/download 全面授权审计、任务持久队列/OCR、模型工具注入攻击验证。
- 尚未完成：持久任务状态机/重启恢复/OCR；分段/搜索/任务/capabilities API 和按需读取；Home/Chat 共用预览及引用跳转；在线编辑、版本冲突、Office 生成、导出和完整 AC 验收。当前首切片不能宣称为 ChatGPT 文件体验完整交付。
- 验证使用 `\.venv\Scripts\python.exe -m pytest`（当前 shell 没有 `uv`）。`make all` 未运行，因为 `format-all` 会写入大量其他任务未提交文件；i18n 有一项此前在预先修改的 `infra/i18n/domains/stream.py` 相关失败，须后续从干净基线复核。未跑 PostgreSQL/Linux/真实模型、浏览器闭环或部署。

## 2026-10-17：对话文件缺陷初审与修复

- 用户选择修复初审的五项问题。实现内容：pytest 测试包冲突修复；文件读取返回全部受限解析段（目标 250 段用例）；扫描 PDF 无文字但有图像时标记 `needs_ocr` / 非完整；同 revision 并发解析只条件提交一次；创建页集成测试同步 `card_meta` 契约。
- 验证：定向后端测试 `55 passed, 1 skipped`；Chat/Home 前端相关 Vitest `29 passed`；Dashboard `npx tsc -b` 通过；Ruff 目标文件检查与格式检查通过；`git diff --check` 通过。
- 全量 `.venv\Scripts\python.exe -m pytest -m "not live" -q` 因 Windows 执行超过 10 分钟仍约 4% 而中断。候选失败复现结果为 `9 failed, 12 passed, 49 skipped`；失败位于本轮五项改动外：4 个旧迁移测试在 Windows 以 GBK 默认编码读取 UTF-8 SQL；3 个测试仍固定断言 schema 版本 21（当前为 24）；captcha 集成期望列表缺少当前 `image` 提供方；i18n 错误文案测试仍按旧“存储根目录”文案断言，而当前未提交工作树使用附件/授权工作区恢复提示。后续应在干净基线上确认来源，再决定是否修正这些旧测试/契约。
- 新增 Grok Bot / ChatGPT 改进路线：`docs/specs/plans/2026-10-17-chatgpt-grokbot-improvement-roadmap.md`。参考 OpenGrokBot 社区替代项目（非 xAI 官方源码）与 ChatGPT 官方能力概览；规划分阶段文件工作流、联网/数据分析、Teammate 审批与任务、Projects/Memory/routines，并记录对抗场景。该路线是计划，不代表能力已实现。
- 本次未运行 `make all`（其 format-all 会改写大量既有未提交文件），未运行真实浏览器/模型、PostgreSQL 或 Linux 验收；未提交、推送或部署。全仓包含许多其他任务的既有未提交改动，继续工作时须保持不动。

## 2026-10-17：对话功能深度回归

- Dashboard Chat + Home 全集 91 个测试文件 / 562 个用例，串行和 2-worker 两种调度均通过（562/562）。第一次默认高并发运行曾出现 6 个失败，集中于 `TrajectoryInspector.test.tsx` 和 `useChat.history.test.ts`；两文件独立运行 15/15 通过，后续全套在两种调度下通过，暂作为并发调度非确定性风险记录，没有修改相关业务或测试代码。
- 后端对话范围组合通过：`284 passed, 2 skipped`，用时 103 秒，覆盖 Chat API/history/HITL、文件/附件/上传、Agent composer/artifacts、gateway 图片和流、versioned history、Chat WebSocket、语音 STT WebSocket。
- `tests/integration/test_e2e_golden_path.py` fake-harness 用户旅程：`2 passed`，验证管理员/用户认证、创建 Agent、聊天 WebSocket token/done 和线程标题，以及从专家创建 Agent 后聊天。
- 全仓没有已配置的浏览器端 Playwright/Cypress E2E 入口；现有 golden path 使用 HTTP/WebSocket test client 和 fake harness，不代表真实浏览器/真实 LLM 端到端验收。OCR、真实模型、Linux/PostgreSQL、完整 AC01–AC10 仍待覆盖。全仓 non-live pytest 仍有前次记录的旧测试/工作区契约失败，不能记为全仓绿灯。

## 2026-10-17：AI 自助入院登记 Demo

- 用户确认此 Demo 选用 Octop 平台；开发方案先评审，尚未授权按方案继续实现。
- 语音供应商与部署/隐私边界尚待评审；不能把 Demo 的语音供应商选择当作生产医疗数据合规结论。


- 2026-10-17 用户批准开始实现：Demo 页面与交互归档在 dashboard/src/pages/AdmissionDemo/，通过 Octop Dashboard /admission-demo 访问；语音使用 Octop 当前 Provider 配置，选型建议腾讯 ASR + MiMo TTS，凭证需管理员在 Octop 配置。首轮实现加入语音输入、AI 回复自动朗读/重播、录音打断播报、离页停止播放及语音手机号尾号脱敏。生产环境第三方语音处理边界仍待院方评审。


- 2026-10-17 Demo 首轮页面完成：登记旅程、三栏 kiosk 布局、Octop STT 输入、AI TTS 自动播报/重播、录音打断/卸载停止及播报号码脱敏。定向前端测试 11/11、ESLint、`npx tsc -b` 与临时目录 Vite 生产构建通过。真实服务/设备尚未试音；`uv` 与本地 `.venv` 均不可用，未跑后端 pytest。

## 2026-10-18：入院 Demo 语音服务选型

- 用户选择火山引擎豆包语音 API，不调用或嵌入豆包输入法 UI；同一 Provider 提供豆包 ASR 2.0 一句话识别与 TTS 2.0 播报，Demo 继续使用 Octop 统一 STT/TTS 接口。
- 已接入 Provider 预设、服务端 ASR WebSocket、TTS HTTP 流、设置页 API Key/音色配置和真实探测入口。API Key 只留在服务端 Provider 存储；语音 Provider 列表只返回 `api_key_configured`，既有密钥留空编辑时保留。
- 当前默认 ASR 资源 `volc.seedasr.sauc.duration`、TTS 资源 `seed-tts-2.0` 和默认音色 `zh_female_wenjingmaomao_uranus_bigtts`。控制台开通、额度费用和医院真实数据处理边界需由部署方确认。无有效 API Key 时只完成协议/模拟探测测试，未宣称真实云端识别和试听通过。
- Octop 侧栏已加入住院登记 Demo 入口，Demo 独立 kiosk 页顶栏可返回平台，并预取平台当前语音配置；此路线继续限定为认证用户可见的演示流程，不连接真实 HIS/医保/微信/短信。

## 2026-10-18：创作页职责范围

- 用户明确要求“创作”页不显示 Agent。创作页只管理平台、应用/小程序、网站/服务和代码仓库；Agent 仍由 Agent 页面与相关聊天入口管理。

## 2026-10-18：入院 Demo 语音输入提示

- 用户确认在录音期间显示本地麦克风音量响应波形。波形只观察已授权录音流，不存储额外音频；录音停止后归零。录音与识别状态需明确提示点击开始、说完再次点击停止。
- 当前入院 Demo 激活豆包 STT；“未识别语音内容”对应识别接口返回空文本。未做真实麦克风试音，仍需在页面用非隐私语句验证收音与云端识别。
- 2026-10-18 用户复测后仍反馈无法录音：前端改为录音期间明确显示“等待声音输入”或“已检测到声音”，用于区分本机收音与云端识别；MediaRecorder 停止事件改为监听器，避免覆盖麦克风轨道清理回调。Dashboard 类型检查与生产构建通过，但由于不能代用户授权/开启麦克风并向豆包发送语音，真实硬件收音和识别仍待页面端复测。
- 2026-10-18 语音故障继续修复：服务端豆包响应含非零 `code` 时此前仍可能返回空文本，现改为抛出识别错误；浏览器录音转 WAV 后检测数字静音，显示麦克风输入错误并跳过上传；空识别提示改为“没听清”及重试建议。Python 编译、Dashboard 类型检查和生产构建、`git diff --check` 通过。更新的 Python 后端尚未加载到当前运行实例：本机进程重启命令被执行策略拦截；当前 `/api/health` 仍返回 200。真实麦克风和豆包云端仍需重启后页面实测。
- 2026-10-18 首页语音入口根因：`AdmissionDemo` 首页麦克风此前只播报引导，只有“补充必要信息”步骤才调用录音。现已让该入口各步骤都实际录音；转写在首页可见，但身份识别/入院确认之前禁止提交信息提取。Dashboard Prettier、TypeScript、生产构建及 `git diff --check` 通过；尚未进行真实麦克风/云端识别复测。

## 2026-10-18：住院登记 Demo 独立后台服务

- 用户确认入院语音登记后台单独进程/端口运行，并和 Demo 一起交付；通过 Octop 同源 API 代理，复用 Octop 活跃模型配置和数据库。语音识别文本以 JSON 字符串输入，返回字段必须按 Demo 表单 6 个字符串字段逐项映射，缺失值为空字符串；有效草稿先保存，患者确认后标记提交。不接真实 HIS。
- 设计规格：`docs/specs/2026-10-18-admission-demo-backend-service-design.md`；独立文档审查已批准，等待用户审阅，尚未实施。

## 2026-10-18：创作卡片分类可编辑

- 住院登记 Demo 等内置创作卡片的默认分类由代码定义，不是自动识别。用户确认在内置卡片编辑弹窗增加“平台 / 应用（小程序）”分类选择，保存到当前用户；分类只影响创作页筛选和卡片分类，不改变内置应用的路由或打开行为。
- 已实现：`creation_card_meta` 持久化可空分类（迁移 v25）；编辑弹窗通过现有元数据 API保存分类；未设置时回退代码默认值。API 兼容未提交分类字段的旧客户端，数据库和 Pydantic 都限制分类为 `platform` / `applet`。
- 已验证：Dashboard 生产构建、Prettier、TypeScript；后端 Ruff 检查/格式检查及 Python 编译；本机 Octop 重启后 `/api/health` 返回 `ok=true`、数据库已连接，创作页面成功加载 Demo 卡片且编辑弹窗显示分类下拉框。未运行 pytest。

- 内置应用卡片若允许编辑名称/说明或移动文件夹，新增 ID 也要同步加入 `src/octop/api/routers/creations.py` 的 `_BUILT_IN_APPS`；否则对应保存接口会返回 404。住院登记 Demo 曾因遗漏此同步导致保存失败，现已补齐。

- 2026-10-19 用户确认内置创作卡片的可编辑分类包括“平台”“应用 / 小程序”“网站 / 服务”“代码仓库”；分类只改变创作页展示和筛选，保留卡片原有路由/打开行为。分类约束须在 API、Dashboard 类型和数据库迁移中一致扩展，并保留既有分类数据。已扩展至 v26，SQLite 重建元数据表保留原行，PostgreSQL 替换 CHECK 约束。`npm run build`（含 `tsc -b`）通过，页面已显示四项。未运行测试；当前 8200 端口的 Python 服务未重启，因此后端迁移和新 API 校验需服务重启后生效。

## 2026-10-18：豆包 TTS 音色选择

- 用户确认在语音设置的 Doubao Voice 配置弹窗中提供可搜索的 TTS 2.0 中文公版音色下拉选择，并保留自定义音色 ID；不接云端动态音色目录或试听。
- 保留原服务端默认音色 `zh_female_wenjingmaomao_uranus_bigtts`，并兼容已保存的非内置音色值。设计规格：`docs/specs/2026-10-18-doubao-tts-voice-selector-design.md`。

## 2026-10-18：住院登记 Demo 创作入口

- 用户确认在“创作”页加入住院登记 Demo 内置卡片，归入“应用 / 小程序”，点击后在当前 Octop SPA 内导航至 `/admission-demo`。复用创作页已有搜索、分类、收藏和归档能力，不新增后端 API 或数据库作品记录，也不在 iframe 中嵌套平台。

## 2026-10-18：创作页职责范围

- 用户明确要求“创作”页不显示 Agent。创作页只管理平台、应用/小程序、网站/服务和代码仓库；Agent 仍由 Agent 页面与相关聊天入口管理。

## 2026-10-19：独立语音识别页

- 新增认证后的独立页面 `/speech-recognition`，从“创作”页的“应用 / 小程序”卡片打开并可返回创作页；复用 `useVoiceInput` 与当前 STT 配置，不新增后端识别接口。
- 页面展示当前识别服务、录音/识别状态、服务端录音音量反馈及识别文本；浏览器原生识别显示停顿后自动结束提示，避免误导用户点击停止。
- 定向前端用例 4/4 通过，TypeScript、ESLint、Prettier 和生产构建通过。浏览器页面已渲染检查；实际麦克风授权与豆包云端识别未测试，需用户在页面点击麦克风后验证。

## 2026-10-19：聊天语音识别可靠性

- 实时 STT WebSocket 的服务端 ready 等待和停止后的最终结果等待各设 15 秒上限；超时触发统一错误收尾，避免输入框永久处于录音/识别状态。实时音频初始化中途失败时停止已取得的麦克风轨道并关闭 AudioContext。
- 验证：实时 STT 客户端与 Chat 麦克风按钮定向测试 24/24 通过，Dashboard `npx tsc -b`、相关文件 Prettier 和 `git diff --check` 通过。真实麦克风/服务商识别仍需用户本机授权后验证。

## 2026-10-19：入院 Demo 语音提交门槛

- 用户要求语音识别成功不弹人工输入窗，转写显示在语音区下方；用户选择身份识别和入院安排确认后才自动发送给 AI，之前仅在当前页面显示。本地化 AI 失败反馈保留转写，手动输入入口继续可用。
- 录音开始与识别完成时都必须处于 details 阶段才自动提交，避免身份确认前开始的录音在稍后泄露联系人信息。
- 实现位于 `dashboard/src/pages/AdmissionDemo/`；定向测试 11/11、`npx tsc -b`、ESLint、生产构建和 `git diff --check` 已通过。实际麦克风与线上 AI 服务未做端到端验证。
- 设计规格：`docs/specs/2026-10-19-admission-demo-voice-flow-design.md`。
- 入院 Demo 页脚的“返回首页”指本流程首页（身份识别），触发 `restart()` 清空演示状态；不应导航到 Octop `/home` 工作台。

## 2026-10-19：入院 Demo 语音面板按原型调整

- 用户反馈语音控制区未按原型展示。底栏扩展至主内容全宽；录音时增加计时、单独的结束按钮和宽波形区，转写/临时识别文本放在语音区下方。只有麦克风提供非零音量反馈才显示波形；原生识别无音量数据时保留录音状态，不伪造波形。
- 更新 `docs/specs/2026-10-19-admission-demo-voice-flow-design.md`。入院 Demo 定向测试 12/12、TypeScript、ESLint、Prettier 和生产构建通过；8200 页面重新加载后已目视确认底栏横向扩展。真实麦克风/服务商录音未进行，需用户授权后验证。

## 2026-10-19：创作项目内置预览

- 用户要求 `data-upload-product` 在 Octop 内置网页中打开，页面顶部提供“← 创作”和项目名，关闭后回到创作列表。用户已确认复用创作页现有项目启动服务及全屏 overlay；仅精确匹配此受信任项目时，管理员标题、缩略图和“打开预览”按钮打开 Octop 管理的本地服务，GitHub 地址保留为源码链接。非管理员和其他作品打开行为不变。
- iframe 使用启动 API 返回的 URL 原样加载，不构造 localhost/域名；项目未启动或启动失败时不展示空白 iframe，沿用现有错误提示。返回不会停止后台服务。
- 设计规格：`docs/specs/2026-10-19-creation-local-preview-in-app-design.md`。新加预览定向用例通过；TypeScript、ESLint、Prettier、生产构建与 `git diff --check` 通过。Creations 全集为 10 通过、1 个旧测试失败：仍断言当前内置列表没有的“门诊电子病历模板工作台”。浏览器验证时未登录的 `/creations` 重定向至 `/login`，所以实际启动服务与 iframe 尚未在已登录页面验证；需用户登录后复测。

## 2026-10-19：创作页紧凑卡片与语音封面

- 用户确认创作页默认采用紧凑卡片：桌面约四列，窄屏自适应减少列数，不增加布局切换；卡片操作与打开路由不变。
- 卡片封面改为 16:9，小于原先的网格最小宽度与间距，说明最多显示两行并通过原生 title 提示查看完整内容。语音识别卡使用 `dashboard/public/speech-recognition/home-cover.svg` 本地静态首页样式图；当前浏览器无有效登录态，封面按语音页现有布局制作，不是从运行页面直接截取的截图。
- `cd dashboard && npm run build`（含 TypeScript 检查）通过，Vite 提示已有模块混用动态/静态导入及若干大 chunk；未运行测试。当前登录态不足以在创作页做真实浏览器目视验收。

## 2026-10-19：数据转换平台创作封面

- 用户提供数据转换平台登录页截图，指定用作创作卡片封面。已将图片加入 `dashboard/public/workbench/thumbs/data-upload-product.png`，仅针对精确匹配的受信任项目显示；若该作品有用户设置的缩略图，则用户缩略图优先。

## 2026-10-19：邮箱注册与管理员审批

- 用户确认注册标识使用完整邮箱地址本身作为用户名；邮箱验证码通过全局 SMTP 发送，注册成功后账号状态仍为 `pending`，复用现有管理员用户列表审核流程。
- 设计基线：`docs/specs/2026-10-19-email-registration-design.md`。代码验证码用独立 HMAC 密钥 `OCTOP_EMAIL_CODE_SECRET`；SMTP 使用全局 `OCTOP_SMTP_*`；发码有 CAPTCHA、IP 限流、邮箱冷却、有效期/尝试次数限制。
- 表 `email_verification_codes` 折入当前未发布 migration 026（SQLite/PostgreSQL），启动时还会幂等修复版本已到 26 但缺表的数据库。
- 本次目标性验证：注册/验证码/仓储单测与集成测试 19 passed；i18n 79 passed，1 个已有 stream 文案断言因工作树内 `stream.py` 文案不匹配而排除；Dashboard TypeScript/Prettier、目标 Ruff 检查完成情况见任务结束说明。
- 2026-10-19：用户要求替换注册页旧 Logo，并选择“替换为新图片”；生成透明底红色章鱼图标 + 深色 Octop 字标，保存到 `dashboard/public/logo_horizontal_octop.png`，注册页浅色主题使用新图，深色主题暂沿用现有白色资源。
- 注册页与设置向导浅色主题共用新横向 Logo；深色主题沿用现有白色版。

## 2026-10-19：入院登记演示患者头像

- 身份识别成功后，患者侧栏显示本地合成的虚构患者头像；身份识别前仍不显示患者信息。头像不代表 HIS/证件照数据，界面明确标注为演示头像。
- 资源：`dashboard/public/admission-demo/patient-portrait.webp`（512×512 WebP，约 29 KB）。定向 Admission Demo 测试 12/12、TypeScript、ESLint、Prettier 和生产构建通过。真实患者照片/HIS 传输未接入。

## 2026-10-19：入院登记原型与Python mock服务

- 用户在先前“只出文档”后重新授权按文档实施；最终技术栈明确为 Vue 2 + Element UI、Python 3.12。旧 React `/admission-demo` 保持未改。
- `demos/admission-registration/` 已包含 Vue 2.7/Element UI 原型、独立 FastAPI mock/校验服务、前后端共用的 `contracts/admission-fields.schema.json` 与地区 mock 树。PRD 全14字段按3页填写、核对和结果页实现；认证和提交情景可切换，登记 mock 在进程内存，具有同键幂等、查询、摘要冲突检查、会话TTL及状态容量界限。
- 模型无需多轮历史：每次只把当前已认证登记阶段的转写通过后端代理至 Octop `/api/admission-demo/extract`。不保存患者/对话历史或转写；后端转发固定配置平台 origin 与 bearer，传递平台续期 token，并对白名单、原文精确来源、单一手机号、歧义及共享字段合同复验；人工已有值不被覆盖，冲突候选需主动采用。ASR/TTS由页面调用平台现有路由；院内身份、地区和登记均为mock。
- 前后端开发服务各端口时不共享 Octop localStorage，所以真实语音/AI须部署在 Octop 同源反向代理下；后端默认 loopback，不得公网直曝。Demo 不适用于真实住院登记。
- 新建 backend editable venv 安装通过；后端 13 项测试、Ruff check/format、pip check 通过；前端 4 项测试、Vue模板检查、Prettier、生产构建通过；Vite 浏览器首页与本地 mock HTTP smoke 已验证。平台真实 token、麦克风、ASR/TTS/模型未做在线联调。Vue2 EOL与主bundle约327KB gzip为已知限制。
- 用户确认读卡终端是示意图，作用是提示扫码位置；P02 不再在核验文案下方展示大图，改为文案旁缩略图按需打开大图，并用独立“开始模拟核验”按钮触发 mock。App-flow 回归、Vue 类型检查和 Dashboard 静态构建通过。

## 2026-10-19：入院申请单点击朗读

- 用户选择改造申请单现有按钮；按钮仅在用户点击后朗读申请单页面展示的申请号、患者姓名、科室、医生、日期、住院类型、病区、诊断、来源、医保与确认状态，进入页面不自动发声。复用现有 `speakAssistant`，保留号码脱敏。
- AI 提取继续使用 Octop 当前激活的默认模型。实际默认模型服务 `127.0.0.1:8766` 当前无监听；已观察到模型连接失败日志。不得未经用户同意改为外部智谱服务处理患者输入。

## 2026-10-19：入院登记 Vue 原型接入创作平台

- 用户已批准将 `demos/admission-registration/` 作为 Octop 内置作品加入创作，并选择同源静态托管 + Octop API 路由 + 创作页内嵌预览。此前 `localhost:5173` 仅是开发服务器，不能作为正式卡片地址。
- 设计规格：`docs/specs/2026-10-19-admission-registration-creations-design.md`。规格经审阅并由用户确认，已按确认方案实施。
- 原型继续使用内存 mock，不连接真实医院；改造不得影响旧 React `/admission-demo`。同源入口是为了保留原型调用平台语音/AI所需的登录 token。
- Vue 静态产物同源发布到 `/admission-registration/`；API 全部要求认证并按登录用户隔离模拟会话/提交。构建顺序为 Dashboard 之后 Vue 子应用，因为 Dashboard 构建会清空其输出目录。
- 回归复查：目标后端 9 项、Vue 前端 6 项通过；浏览器内嵌页打开、身份页入口与返回均通过。当前浏览器状态显示“语音识别暂不可用”，页面/iframe 正常，ASR/麦克风未做联调。
- 用户指出创作卡缺少首页图；现用原型设计稿中的 AI 首页区域制作 16:9 封面 `dashboard/public/admission-registration-home-cover.jpg`，卡片指向该资源并有预览卡片回归断言。Dashboard 与 Vue 发布构建通过；在线服务器当前未运行，故本轮未完成浏览器目视验收；整份 Creations 测试仍有一项既有缺失内置作品断言失败。
- 用户确认入院办理应切换主内容区，不与首页纵向拼接；办理的身份核验和表单阶段仍保留语音操作区，结果页隐藏。`App.vue` 首页重置同时改用 voiceFlow 已有 `stopVoiceSession()`，修复此前调用不存在清理方法导致无法重置的路径；2026-10-19 app-flow 5 项、类型检查、格式检查和托管静态构建通过。
- 用户补充要求自动覆盖入院登记全部可交互流程。`frontend/tests/full-workflow.test.js` 覆盖首页进入、身份核验成功/失败/超时/并发点击、表单两页校验与屏幕键盘、退出确认、提交 422/4xx/5xx、未知结果查询/重试、已有登记、语音录制/转写/候选/服务故障与超时、播报成功/失败、空闲清理等。前端完整 Vitest 36/36、vue-tsc、Prettier 通过；Demo FastAPI 14/14 和 Octop 关联 mock API 测试 6/6 通过。音频设备/真实云服务和浏览器目视流程由本地自动化 mock，不代表现场硬件/云端联调。
- 用户要求入院登记原型顶部显示当前时间；当前按浏览器设备本地日期时间格式显示，每30秒刷新。固定时钟与跨分钟回归用例已加入 `frontend/tests/full-workflow.test.js`。
- 用户指出 P02 需要明确的“模拟刷卡”按钮；按钮触发已有 mock 身份核验 API，读卡器图片仍为位置示意。完整前端回归用例确认按钮文案与核验事件。
- 用户确认重新布局保留两段表单；主画布最大宽度620px，窄屏不横向溢出，首页/业务内容区独立纵向滚动，顶部、语音区和底部导航保持可见。
- 用户要求切换/提交时必填校验错误字段红框闪烁；字段修正后清除对应旧错误，减少误导。
- 用户明确“自助模式”按钮仅首页存在，身份核验与两页表单隐藏该按钮，语音控件居中保留。
- 用户澄清当前缺失的是首页对话提示卡，不是“自助模式”卡；首页卡片仍由 `ConversationCard` 渲染。回到首页时需把 `.page-content` 滚动位置复位，避免卡片留在视口上方。自助模式仍仅首页显示。
- 用户要求倒计时实时变化；身份页和两页表单统一从 idleGuard 获取每秒剩余值，活动重置300秒，原有30秒宽限提示与清理流程保留。Vue 全套回归38/38通过。
- 用户指出第二页布局/读卡器位置不对；身份页改为居中核验卡，读卡器缩略提示在标题旁按需放大，提示和模拟刷卡按钮居中，倒计时在卡片底部。
- 用户反馈表单末页右箭头不能继续；末页箭头改为“提交并查看结果”，复用确认提交的全表校验、提交中防重复及结果流程，不新增表单页。
- 用户提供患者信息页新截图并反馈原型页面杂乱；表单阶段按浅蓝外层 + 白色信息卡重排，移除表单页重复的进入状态条，窄屏压缩行高/标签列，语音转写状态跟随窄屏收紧。保留两页字段、校验、倒计时与提交行为。

## 2026-10-19：入院登记真实测试缺陷修复

- 根据 `demos/admission-registration/docs/08-live-test-report.md`，录音上传前转换成 WAV，避免 Edge/Chrome 默认 WebM/Opus 被 Doubao STT 拒绝；AI 模型不可用显式报 503，保留转写供手工补充；模拟提交情景按幂等请求隔离，避免 unknown 污染后续演示。
- FPK 发布流程也构建 Vue 入院登记静态应用，Dashboard 与 Vue 顺序构建以避免 dashboard 输出清理掉子应用。
- 当前平台激活模型/网关状态没有更改；真实麦克风、Doubao 云 ASR、已登录浏览器视觉回归仍须上线环境再确认。自动回归截至修复：Vue 40、Octop 16、独立 Demo API 14 全部通过；`vue-tsc`、Prettier、Ruff 通过。Dashboard + Vue 托管静态包按发布顺序成功构建，仅有大 chunk 警告。

## 2026-10-19：入院登记提取 Qwen3.5-27B 延迟

- ModelScope `Qwen/Qwen3.5-27B` 的思考模式关闭参数仅应用于 `/api/admission-demo/extract`，不改 Octop 全局默认模型；当前范围精确到 27B，不包括其他 Qwen3.5 型号。
- 实测同一合成样例默认思考约 14.1 秒，附加 `chat_template_kwargs.enable_thinking=false` 后约 4.8 秒，四个字段正确提取。单次实测不是延迟 SLA。

## 2026-10-19：入院登记身份页与首页分离

- 最新决定（2026-10-19）：底栏身份信息应与身份核验返回的患者档案为同一人；表单与结果页显示核验患者姓名（脱敏）和联系电话，电话随语音或手工补录同步更新。首页、身份核验页隐藏患者信息条。固定 `DEMO_USER` 只保留终端序列号/版本，不再用于患者身份展示。此决定覆盖此前固定终端账号显示规则。
- 用户后续澄清身份核验是 AI 判断意图后进入的独立第二页，不得与首页混排。身份页替换首页主内容区，只保留顶部、语音区、导航和序列号；机器人、问候及快捷入口仅首页显示。`App.vue`、流程测试和 `03-prototype.md` 按此更新。
- 后续对照原型图，身份核验卡移除标题旁小缩略图，改为居中显示大比例读卡器示意图，指引在图上方、“模拟刷卡”按钮在图下方、倒计时在卡片左下角；短视口按高度缩小图片以保留按钮和倒计时可见，保留按钮触发 mock 核验的行为。
- 页面联调发现前后端模拟地区树要保持一致；模型抽取漏拆时，仅可在原话明确标注籍贯/现住地址后兜底恢复已知级联地区，不能凭单独地区词推断字段。当前已补入沈阳市沈河区。
- 自助终端预览不显示内容区滚动条；短视口下压缩首页布局确保快捷按钮完整可见，较长的表单内容仍支持触控/滚轮滚动。

## 2026-10-19：入院登记首页语音意图路由

- 首页语音经 Octop 当前活动模型判断；“我要办理入院”“我要入院”“办理住院”“住院登记”等明确语义映射到“可以说帮我入院登记”动作并进入身份核验；明确请求挂号、打印报告、报告解读等当前未实现功能时提示“当前页面没有这个功能”；含糊、无法理解或模型不可用时显示“未能识别”。
- 四个快捷入口均可点击并复用同一动作分发器；当前只实现入院流程，其他快捷功能显示“当前页面没有这个功能”，不伪装为已实现或语义未识别。
- 首页及身份核验页不显示姓名、电话或账号用户条；表单和结果页继续显示固定演示终端账号。身份核验仍须“模拟刷卡”控件，AI 不得调用身份核验/提交。
- 表单语音候选仍使用 `/api/admission-registration/v1/ai/candidates` + `/api/admission-demo/extract`；首页意图使用新认证 API `/api/admission-demo/intent`，仅接收 `begin_admission`、`unsupported`、`unknown` 三种固定意图。
- 所有首页 ASR 转写均由当前活动模型按整句语义分类；“入院登记”“住院登记”等作为 prompt 中的等义示例，不做前端必配字符串映射；否定表达不触发。

## 2026-10-19：入院登记完整地区树与回填

- 用户确认地区范围为大陆 31 个省级单位 + 香港、澳门，排除台湾县市级；只覆盖区县级，不含街道、社区、门牌。Markdown 只记录来源与许可，不充当匹配主数据。
- 固定采用 `uiwjs/province-city-china` 的 `gh-pages/level.json` 快照，commit `547ade93bc913de0c937200d4fa218d05c0ba97b`，SHA-256 `56cc63e475d2851315d2ff68ea97aee8b67956352093db406db36a2e76cfb43`；上游 MIT 许可条款随 Demo 文档与 Octop wheel 保留。
- JSON 当前含 33 个省级入口、3,243 个节点（2,877 个叶子）。共享 Demo 合同与 Octop wheel 地区数据必须一致；源文件与包内副本由单测校验。
- 实际路径遵循数据源：末级选择路径为 2 段或 3 段；禁止插入虚假城市/代码。前端 cascader 递归建树，前后端均验证合法父子路径和末级叶节点。
- 地址语音候选在界面显示省/市/区中文名称，不展示内部行政区划代码；采纳候选时仍保存原代码路径。
- 有效 AI 候选自动回填并覆盖档案初值及旧 AI 值；仅用户手工修改过的字段保留原值，冲突候选须明确采纳。
- 手工字段冲突改为逐项弹窗，显示当前值和识别值；点击或在弹窗中录音均可选择采纳/保留。语音选择经认证的 `/api/admission-demo/candidate-confirmation` 调用当前活动模型判断，无法判断时不改值；弹窗禁用关闭、遮罩和 Esc 跳过，迟到响应须按字段和值快照丢弃。
- 两份入院登记候选解析（Octop 内置 API、独立 Demo API）在模型漏拆地区字段时，只根据明确的“籍贯/现住地址”等标签从本轮转写恢复已知地区；未标注的地区仍不猜字段，未收录地址留在详细地址。截图原句手机号 `13478878803` + 沈河区籍贯/现住地有自动回填回归。
- 验证：Octop 地区单测 + 入院登记 API 集成 `16 passed`；独立 Demo backend `22 passed`；Vue 全测 `58 passed`、`vue-tsc`、Prettier、Ruff 与 Vite production build 通过。Vite 仍显示既有约 1.27 MB JS bundle 警告。

## 2026-10-19：入院登记活动模型切换

- 用户明确选择 `ModelScope / Qwen/Qwen3.5-27B`；已通过 `octop models active` 将平台默认活动模型切换到该模型。入院登记仍按每次请求读取活动模型，并仅在此模型的演示调用中关闭思考模式。
- 截图中的城市级籍贯/现住址可被 Qwen 提取，但表单地区路径要求区县叶节点，不能凭空补区县；详细地址候选可安全回填。实际整句调用约 1.3 秒，超时问题由原活动模型 `glm-5.3-flash` 的 30 秒提取超时引起。
- ModelScope 返回 HTTP 429 时，入院登记 API 保留 429 并在页面提示“AI 服务请求过于频繁，请稍后重试；转写内容已保留。”；Qwen 演示调用关闭 SDK 自动重试，避免重试等待将 429 掩盖成通用不可用状态。

## 2026-10-19：入院登记新视觉与患者对话改版方向

- 用户提供新的五屏总图及身份认证对话图，要求重做当前Vue入院应用，底栏改用第二图语音栏；录音波形必须区分真实有声和静音，支持AI询问、患者语音回答的对话面板，并复核原始流程说明。
- 用户明确澄清缺失的是“入院申请单”：必须有本人有效入院申请单才能办理，申请单应展示入院科室、入院时间等信息。当前Vue应用认证后直接进表单，申请单只在旧React Demo中展示，不能算当前应用已完成。
- 用户新要求格式化保存患者对话、最后交互和重要信息，修改经确认后替换，并控制上下文和双链存储；此新要求取代此前本轮转写无历史/不落盘的方向。存储期限、双链具体结构与语音提交边界仍属于方案草案，不能记录为已批准或已实现。
- 设计 `docs/specs/2026-10-19-admission-conversation-redesign-design.md` 已由用户确认；演示对话及字段变更记录保留24小时，录音不持久保存。独立申请单确认页、最终信息核对页、最终页明确语音提交已纳入实施基线。服务端与存储计划为 `docs/specs/plans/2026-10-19-admission-conversation-development.md`；页面改版计划为 `docs/specs/plans/2026-10-19-admission-page-redesign.md`。用户要求交付前执行两轮回归：第一轮验证功能、流程、安全和故障边界；第二轮验证完整旅程、重启/长时稳定性、视口和性能指标。计划已写好，尚未进入业务代码实施。

## 2026-10-20：入院登记改版实施及 Qwen 联调

- 用户指出前一轮未按参考图重做；在已确认设计上完成 Vue 入院登记页面改版并嵌入 Octop 创作页。首页/身份核验/申请单/分步表单/AI 对话/独立核对/结果页按单页流程切换；申请单只读并显示入院科室、计划入院时间等信息，必须明确选择后才能办理。详见 `demos/admission-registration/docs/03-prototype.md`。
- 固定语音栏按参考图2布局；录音时用真实麦克风 RMS 音量生成波形，区分静音与检测到声音，停止/异常清理音轨、AudioContext 和动画帧。自动覆盖生命周期；本轮未授权浏览器麦克风权限，真实设备测试未做。
- 格式化会话上下文含当前事实、申请单摘要、待确认修改、最近交互与双链 turn；保存24小时，不落盘音频。确认的修改替换事实，模型仅提出候选，不可改身份/申请单或提交。服务重启后重新核验此前可恢复同一会话；该恢复行为已于 2026-10-20 被“成功重新认证必须清空旧会话”的用户决定取代。
- 已修复 Qwen3.5-27B 两个真实调用缺陷：LangChain token counter 抛 `NotImplementedError` 时改用 UTF-8 字节数加消息开销作为上下文保守上限；模型副本清空 OpenAI 客户端后调用 `validate_environment()` 重新创建 max_retries=0 客户端。另一次重启测试中旧页面身份令牌失效是 401，需重新模拟刷卡，非 AI 限流。
- 2026-10-20 同源 Octop 页面用纯合成测试语句实调 ModelScope/Qwen，AI endpoint 200，3项电话/地区/详细地址候选回填并继续询问下一项。不要把此结果描述成真实患者或生产 HIS 测试。
- 两轮回归均运行前端 Vitest 73 项、Octop admission unit/DB/API 71 项（1项条件跳过）、旧 Demo API 6 项；typecheck、Prettier、Ruff、ruff format、diff check、Vite build通过。最终小改动后又复跑前端全套和后端目标套件。
- 为减小首屏 JS，将 Element UI 从整库导入改为按实际使用的8个控件单独注册；Vite JS 从1.295 MB/gzip366 KB降至650 KB/gzip189 KB（约减半），仍略高于500 KB单 chunk提示线。
- 已知限制：未测真实麦克风、PostgreSQL、HIS、并发负载、完整视口/Lighthouse性能矩阵。测试有既存 KeypadDialog anchor prop warning 和 ldap3 依赖弃用警告。

## 2026-10-20：入院登记首页对话弹窗

- 用户确认首页“手动输入”复用对话面板：宽屏左侧显示 AI 意图解读/回答，右侧提供文本与语音输入；手机端按微信式气泡聊天布局，底部紧凑输入栏切换文字/语音。首页底部语音栏也需降低高度。
- 保留现有首页意图分类，不新增生成式回复；对话记录只驻留当前页面状态，关闭保留，开始入院办理时收起，重置时清空。表单页原持久化对话行为不变。
- 实现与规格：`demos/admission-registration/docs/11-manual-chat-dialog-design.md`；前端定向 app-flow 测试、typecheck 与 Vite build 验证。
- 2026-10-20 用户指出首页对话应有 AI 解读和回答；此前“不新增生成式回复”的约束由此更新。首页继续使用 Octop 当前活动模型，但接口现在返回固定白名单意图及受限长度的自然语言回答；仅意图字段可以启动身份核验，AI 回答不能核验身份、提交或完成登记。回答限制在入院登记流程范围，不提供诊断/治疗/用药建议。
- 用户进一步确认严格按页面能力回答：AI 需区分明确开始办理、询问办理流程、未实现功能、含糊意图；办理问答留在首页，挂号/打印/报告解读/真实医院查询等明确说明不支持，仅 `begin_admission` 进入身份核验。
- 用户确认主页快捷按钮提示也进入对话弹窗；主页和表单页的用户转写、AI 回复/状态/错误仅在弹窗内展示，身份核验页语音提示维持原样。`11-manual-chat-dialog-design.md` 已补验收项；前端全套 76 项通过，typecheck 和嵌入静态资源构建通过。
- 用户要求固定选项字段提供按钮直选且同类操作一致；婚姻状况、职业、与患者关系复用表单枚举，选择值直接写入字段并作为 `manual_edit` 会话事件保存；电话、地区及自由文本保持原控件。Demo 前端全套 79 项通过，typecheck 和嵌入静态资源构建通过；构建仍报告 JS chunk 约656 KB。
- 用户确认本页必填内容完成后由对话框询问是否继续，确认后自动通过现有分页校验前进；最后一页进入核对页，不自动提交。按钮和明确的语音/文字“继续”回答等价，暂不继续则停留当前页。
- 2026-10-20 用户确认首页与表单页聊天对话框统一为截图式遮罩模态弹窗；两页均可点遮罩或关闭按钮收起，打开时锁定底层页面滚动。实现位于 `demos/admission-registration/frontend/src/components/ConversationDialog.vue` 与 `style.css`；Vite 生产构建和 Prettier 检查通过，未运行测试或浏览器视口实测。

## 2026-10-20：重新认证清空入院演示会话

- 用户明确授权对 Octop 平台入院登记接口做窄改：每次成功重新认证都必须开始新会话；此前设计中“服务重启后可在24小时内恢复同患者会话”的行为被此决定取代。失败认证不清除数据；清理仅限当前平台用户和当前模拟患者，其他用户/患者会话保留。
- 重新认证撤销该患者旧演示身份令牌并删除该患者旧登记会话，数据库级联删除 turns；新申请单选择按当前认证档案建立新会话。同一新令牌的重复/并发选择须幂等并保留当前编辑内容。
- 实施位于 `src/octop/api/routers/admission_registration.py`、`src/octop/infra/admission_registration_demo.py` 与 `src/octop/infra/db/repos/admission_sessions.py`；测试覆盖重新认证清理、失败认证保留、范围隔离和幂等。模拟服务不连接真实 HIS。

## 2026-10-20：入院登记平台 Agent 与 Skills

- 用户确认入院登记助手应作为平台 Expert 显示在 `/experts`，并要求 Agent 与相关 Skills 使用 Octop 平台对象模型创建和调用。
- 采用共享 `expert` Agent（`octop-admission-demo`）及绑定在其 workspace 的两项平台 Skills：意图路由、患者资料补全（含候选冲突确认）。服务启动时经 AgentRegistry 幂等创建 Agent/Skills；Demo 每次调用按任务选择单个 Skill，业务端保留结构化输出校验。
- `/experts` 卡片列表展示 API 返回的共享 Agent，沿用现有 owner 权限门禁；模型推理不启用 Agent memory、JSONL memory、checkpointer、session log 或 Langfuse。患者对话留存仍由入院 Demo 后端上下文工程既有约定控制。
- 共享列表 SQL 已修正为把 `user_id IS NULL` 的平台级共享 Agent 包含在内；部署当前代码后需重启服务，让启动初始化建立 Agent/Skills，再刷新 `/experts`。

## 2026-10-20：入院登记不确定字典值的对话兜底（重点）

- P0 验收：关系/职业等字典字段无法从口语可靠抽取或归一化时，不猜测、不静默跳过；对话直接展示平台表单同款标准选项，由患者点选后再按手动修改保存。典型例句：“她是我的女儿”抽取不到关系、“职业改成护士”不在职业字典。
- 填写页与核对页显式修改字典字段但模型未给候选时，维持现有值并显示对应选项；必填关系字段缺失时也显示八项选项。Skills 负责只输出可靠候选；追问和标准按钮由 Demo UI 承担。
- 验证：`tests/full-workflow.test.js` 加入上述两类回归；重启 Octop 后再从 `/admission-registration/` 用真实平台模型复测，以区分旧服务进程和模型行为。
- 2026-10-20 用户明确授权后已重启 8200（进程启动时间 15:06，Asia/Shanghai）；健康检查正常，Demo 已加载最新嵌入前端资源，专家页已显示运行中的“入院登记助手”（`octop-admission-demo`）。此前的重启审批阻碍已解除；真实模型抽取样本仍待复测，再决定是否调整抽取提示词。

## 2026-10-20：入院专家的管理按钮与头像

- 用户要求入院登记助手具备同页其他专家的底部按钮并配置头像。保留平台共享专家的所有权；卡片与表格按现有后端规则对管理员开放管理入口，普通共享用户仍不能管理。卡片编辑入口须从可见专家列表取目标，不能只查询自有专家列表。
- 默认头像复用 Demo 护士机器人，固定资源 `/experts/avatars/admission-assistant.png`；创建时设置，已有专家仅在头像为空时补齐，保留用户自定义头像。共享卡片无个人 owner 时只显示共享标记，不显示空白“来自”。
- 定向验证：共享专家前端权限用例 8 项、入院 Agent/API 后端 34 项通过；Ruff 与严格 mypy 通过。
- Dashboard 类型检查与生产构建、Demo 嵌入构建通过，8200 已重启且健康检查正常；浏览器确认护士头像、底部管理按钮、编辑抽屉，以及“更多→技能”中两项已启用的入院技能。
- Windows 运行服务时 `octop.exe` 被占用，检查使用 `uv run --no-sync` 避免自动重装。`uv sync` 会移除未写入锁文件的可选依赖；本次发生后已按原版本恢复全部 13 项额外依赖。

## 2026-10-20：入院 Demo 意图 Skill 与首页兜底文案

- 入院 Agent 调用的 Skill 正文从包内 `admission_demo_skills/<slug>/SKILL.md` 读取，并显式作为 system 消息发送；该链路不依赖 harness 的运行时 `skills:[slug]` 查找（不稳定且 workspace 缺 Skill 时会报 `path_not_found`）。调用请求继续传 `skills: []`，Agent 共享 workspace 初始化仍保留两项 Skill 文件。
- 首页将 `unsupported` 和 `unknown` 明确分开：不支持的服务说明 Demo 能力范围；无法判断时请用户重述。服务端固定意图回复、Vue 对话回复及流程/测试报告同步。
- 验证：入院 Agent 单测与 API 集成测试 40 passed；Vue 完整流程 92 passed；独立 Demo `build:dashboard` 成功，`git diff --check` 通过。构建有既有大 chunk 提示。
