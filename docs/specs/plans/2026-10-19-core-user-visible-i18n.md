# 核心应用用户可见文案 i18n 整理实施计划

> **给代理执行者：** 推荐配合 `subagent-driven-development（子代理驱动开发）`（每任务独立子代理 + 两阶段审查）或在本会话内按勾选逐步执行并在批次节点与用户确认。任务使用 `- [ ]` 勾选跟踪。

**目标：** 将核心应用中实际面向用户、尚未本地化的硬编码文案迁入现有中英文资源，并保持协议和业务行为不变。

**架构要点：** 后端复用 `src/octop/i18n/{en,zh}.json`、`tr()` 和现有 domain helper；Dashboard 复用 `dashboard/src/locales/{en,zh}.json` 与 i18next。只迁移经调用路径确认会展示给用户的文案；API、数据库和协议标识保持稳定。按独立领域分批，每批先锁定候选文件，再编辑对应资源和调用点。

**技术栈：** Python 3.12、FastAPI、pytest（`uv run pytest`）、React 18、TypeScript、i18next、Vite。

**关联设计文档：** `docs/specs/2026-10-19-core-user-visible-i18n-design.md`

---

## 文件变更清单（先写这个再拆任务）

- 修改：
  - `src/octop/i18n/en.json`、`src/octop/i18n/zh.json`（后端权威文案）
  - `src/octop/i18n/domains/*.py`（仅当同一命名空间有重复调用或需统一格式化时添加薄 helper）
  - `src/octop/api/**/*.py`、`src/octop/infra/**/*.py`、`src/octop/cli/**/*.py`（仅修改审计确认的用户可见文案调用点）
  - `dashboard/src/locales/en.json`、`dashboard/src/locales/zh.json`（Dashboard 文案）
  - `dashboard/src/**/*.ts`、`dashboard/src/**/*.tsx`（仅修改审计确认的 UI 文案调用点）
- 验证：
  - `tests/unit/i18n/test_errors.py`、`tests/unit/i18n/test_dashboard_locale_keys.py`（复用现有后端/前端键一致性与错误文案检查；若目标行为已被覆盖，不改测试文件）
  - 按实际触及领域运行相邻的 `tests/unit/`、`tests/integration/` 和 Dashboard 测试

不修改 `src/octop/dashboard/`、独立 Demo、文档生成物和工作区中与本任务无关的文件。

## 任务列表

### 任务 1：审计并整理后端 API 错误与验证文案

**涉及文件：**
- 修改：`src/octop/api/app.py`、`src/octop/api/routers/**/*.py` 中审计确认的用户错误响应；`src/octop/infra/errors.py`（仅在现有错误码无法表达该语义时）；`src/octop/i18n/en.json`、`src/octop/i18n/zh.json`
- 验证：`tests/unit/i18n/test_errors.py`、相关 API 单元/集成测试

- [ ] **步骤 1：定位 API 错误响应字面量**
  - 运行：`rg -n 'HTTPException|detail=|raise OctopError' src/octop/api src/octop/infra/errors.py`
  - 按请求 locale、响应 envelope 和前端消费路径检查命中项；输出文案迁移候选，排除 HTTP 状态、字段名、路径、机器可读标识和只用于日志的内容。
- [ ] **步骤 2：用现有测试锁定错误契约**
  - 运行：`uv run pytest tests/unit/i18n/test_errors.py -q`
  - 预期：当前基线通过；保留错误码、HTTP 状态、响应结构和动态参数约定。
- [ ] **步骤 3：迁移确认的用户错误文案**
  - 已使用 `OctopError` 的调用点保留原有错误码、状态和 envelope；只迁移用户看到的固定 message，动态参数保持不变。
  - 直接使用 `HTTPException` 的调用点继续使用 `HTTPException`，在原 `detail` 位置返回按请求 locale 翻译的文本；保留 status、headers、响应 envelope 和字段类型。为这类 detail 在后端 locale bundle 增加独立命名空间，不将它们强行改造成 `ErrorCode`。
  - 例如，已有 `ErrorCode.AUTH_FAILED` 使用 `errors.AUTH_FAILED`；固定 validation detail 使用独立 `api.validation.*` 键。请求路径、输入字段名等契约值不翻译。
- [ ] **步骤 4：验证错误键与相关路由**
  - 运行：`uv run pytest tests/unit/i18n/test_errors.py tests/integration/test_scalar.py -q`
  - 运行：`uv run pytest tests/unit/api/test_exception_handlers.py tests/integration/test_scalar.py tests/integration/test_subagents_api.py tests/integration/test_skill_packages_api.py tests/integration/test_skills_api.py tests/integration/test_security_api.py tests/integration/test_onnx_models_api.py tests/integration/test_memory_api.py tests/integration/test_channels_api.py tests/integration/test_channel_probe_draft.py tests/integration/test_channel_test_endpoint.py tests/integration/test_auth_register.py tests/integration/test_auth_flow.py -q`
  - 预期：异常 envelope 与本批触及的端点行为通过；只保留与本批实际修改端点对应的测试文件，避免无差别运行整个集成套件。

### 任务 2：整理后端 CLI、IM 与服务端状态文案

**涉及文件：**
- 修改：`src/octop/cli/**/*.py`、`src/octop/infra/gateway/**/*.py`、`src/octop/infra/setup/**/*.py`、`src/octop/infra/users/**/*.py`、`src/octop/infra/voice/**/*.py` 中审计确认的用户可见输出；`src/octop/i18n/en.json`、`src/octop/i18n/zh.json`、必要时 `src/octop/i18n/domains/*.py`
- 验证：`tests/unit/i18n/` 下对应领域测试、`tests/unit/infra/setup/test_service.py`、`tests/unit/infra/setup/test_self_update.py` 及相邻 CLI/gateway/users/voice 测试

- [ ] **步骤 1：定位服务端输出入口**
  - 运行：`rg -n 'click\.(echo|secho)|print\(|MessageEvent|reply|tr\(|logger\.' src/octop/cli src/octop/infra/gateway src/octop/infra/setup src/octop/infra/users src/octop/infra/voice`
  - 逐个检查命中点上下文，纳入 CLI 人类可读输出、IM 回复、用户可见状态和提示；排除 `--json` 机器输出、日志、协议/工具名、路径和调试内容。
- [ ] **步骤 2：按命名空间迁移文案**
  - 文案键放入现有后端英文/中文 bundle；已有多调用点的命名空间复用 `domains/` helper；调用点使用当前已解析的用户/请求/渠道 locale，不另造语言来源。
  - 插值变量仅保留动态值，例如 agent 名称、服务状态、剩余时间；固定文案不再直接写在调用点。
- [ ] **步骤 3：验证所涉领域与语言键**
  - 运行：`uv run pytest tests/unit/i18n -q`
  - 运行：`uv run pytest tests/unit/cli tests/unit/gateway tests/unit/users tests/unit/infra/setup tests/unit/test_voice_formats.py tests/unit/test_voice_manager.py tests/unit/test_voice_probe.py tests/unit/test_voice_realtime.py tests/unit/test_voice_stt_probe.py -q`
  - 预期：键一致性与 CLI、gateway、users、setup、voice 领域用例通过。

### 任务 3：整理 Dashboard 页面和组件文案

**涉及文件：**
- 修改：`dashboard/src/**/*.tsx`、`dashboard/src/**/*.ts` 中审计确认的可见文本；`dashboard/src/locales/en.json`、`dashboard/src/locales/zh.json`
- 验证：对应页面/组件测试、`tests/unit/i18n/test_dashboard_locale_keys.py`、TypeScript 检查

- [ ] **步骤 1：定位 React 中的直接可见文本**
  - 运行：`rg -n 'message\.(error|success|warning|info)|notification\.|placeholder=|title=|aria-label=|>[^<{]+<' dashboard/src --glob '*.tsx' --glob '*.ts'`
  - 对每个命中项检查 JSX、组件属性和触发路径；纳入用户实际看到的按钮、标题、提示、占位、通知、空状态和 accessibility label；排除 API 字段、工具调用参数、代码示例、测试快照和动态用户内容。
- [ ] **步骤 2：迁移并同步两种语言**
  - 使用组件现有 `useTranslation()`/`t()`；按所属页面或组件已有命名空间添加 `en.json`、`zh.json` 键。不要增加 i18n 封装层，不要把可访问性文案留作视觉上的硬编码。
  - 示例：`message.error("Load failed")` 改为 `message.error(t("creationsPage.messages.loadFailed"))`，并在两种 locale 中维护对应值；新增键沿用所在页面当前命名空间。
- [ ] **步骤 3：验证 locale 键、类型和受影响组件**
  - 运行：`uv run pytest tests/unit/i18n/test_dashboard_locale_keys.py -q`
  - 运行：`cd dashboard && npx tsc -b`
  - 运行：`cd dashboard && npm test`
  - 预期：中英文 locale 键一致，TypeScript 编译通过，Dashboard 测试套件通过。

### 任务 4：最终分层复查与交付

**涉及文件：**任务 1–3 中实际修改的源文件与 locale 资源；不新增扫描器或运行时配置。

- [ ] **步骤 1：检查补丁边界**
  - 运行：`git status --short`、`git diff --check`
  - 逐个审阅本计划实际修改的源文件与 locale 文件 diff；不把工作区内其他文件的既有 diff 纳入本次审查。
  - 预期：仅本计划列出的源文件与资源有本任务 diff；无空白错误，不包含本工作区原有改动。
- [ ] **步骤 2：核对残留字符串类别**
  - 对任务 1–3 的候选清单逐项标记“已迁移”或“保留原因”；剩余项仅限设计文档排除的协议值、字段键、日志、测试/开发内容和生成文件。
- [ ] **步骤 3：复跑相关验证并汇总**
  - 运行任务 1–3 中与最终 diff 对应的命令；不要执行会批量重写文件的 `make format-all`。
  - 预期：相关测试与类型检查通过；最终说明迁移范围、保留类别、命令结果和未覆盖风险。

## 执行决策

- 实施前在当前工作区逐文件核对 `git diff`，不得还原、格式化或覆盖其他任务改动。
- 先完成任务 1；若错误响应结构需要改动，暂停并向用户说明，因为批准设计要求 API 契约保持不变。
- 用户已授权按完整计划在当前会话分批执行，常规批次间无需再次确认；遇到会改变已批准范围或 API 契约的情况再暂停说明。不提交、不推送、不部署。

## 执行进度（2026-10-19）

- 用户已批准在当前会话分批执行；无需再次逐批确认。
- 后端 API 已迁移 SkillHub 校验、Agent 工具设置、钉钉授权、子 Agent、移动设备状态和记忆提取设置中的一组用户可见 detail。相关路由测试覆盖请求 locale，保留原 HTTP 状态与 `detail` envelope。
- Dashboard 已迁移 Home 资料保存/改密成功提示与 SkillPackages FreeLLM 提交成功提示。
- 验证：相关后端集成用例组合 24 passed；`tests/unit/i18n -k "not test_format_path_outside_root_zh_guides_to_storage_root"` 为 79 passed、1 deselected；Dashboard 相关 Vitest 27 passed、`npx tsc -b` 通过，Dashboard locale 键一致性测试通过。
- 已知基线失败：`test_format_path_outside_root_zh_guides_to_storage_root` 断言旧“存储根目录”措辞，与当前工作区既有附件/授权工作区提示不一致；本次未改该测试或文案。
- 未完成：继续 API 直接错误 detail 分类/迁移，完成 CLI、IM 与服务端状态文案批次，继续 Dashboard 用户可见文案扫描，最后做残留分类和补丁复查。
