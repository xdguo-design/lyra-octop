# 聊天自动选择连接器实施计划

**目标：** 普通 Craft 聊天不展示连接器清单或手动选择控件，后端自动提供当前用户已启用且获授权的连接器，由 Agent 判断是否调用及使用哪个。

**非目标：** 不改 Cron、IM、连接器管理页、HITL 或连接器副作用审批；不实现意图分类、懒加载或聊天内手动 connector 限制。

**架构要点：** Dashboard composer 移除 connector chips、picker、connector 名称建议和 per-agent 选择状态。WS 对新客户端显式发送 `connector_selection_mode: "auto"`，不发送 Dashboard 侧 connector 名单。后端只在 Craft 自动解析当前用户可见、active 且有凭据的 connector 名称，并复用现有验证、注册路径；Ask/Plan 服务端强制空集。未带新字段的旧请求保持原有兼容行为。

**技术栈/运行方式：** Python/FastAPI、React/TypeScript；后端 `uv run pytest`，前端 `cd dashboard && npx vitest run ...` 与 `npx tsc -b`。

**关联设计：** `docs/specs/2026-10-16-chat-auto-connector-selection-design.md`

---

## 文件变更清单

- 修改：
  - `dashboard/src/pages/Chat/hooks/useChatComposerResources.ts` — 去除 connector 逐项选择和默认值加载，不再维护 connector 选择状态。
  - `dashboard/src/pages/Chat/hooks/useChatSend.ts`、`dashboard/src/pages/Chat/index.tsx`、`dashboard/src/pages/Chat/components/ChatInput.tsx` — 消息和队列快照不再依赖 connector 名单，普通 Craft 发送使用 auto 模式。
  - `dashboard/src/pages/Chat/components/ChatInputPreviewBar.tsx`、`dashboard/src/pages/Chat/components/ConnectorPickerPopover.tsx`、`dashboard/src/pages/Chat/components/ChatInputActionsRow.tsx` — 移除 composer connector chips 和 picker 入口；删除变为无引用的组件/属性。
  - `dashboard/src/pages/Chat/hooks/useSlashMentionInput.ts` — 不在聊天输入建议中列出 connector 名称，保留 Agent/Skill 等其他建议。
  - `dashboard/src/pages/Chat/hooks/chatStore.ts` — 发 WS 时发送 `connector_selection_mode: "auto"`，不发送 `mcp_servers`。
  - `dashboard/src/pages/Chat/utils/chatStorage.ts` — 删除 connector per-agent 保存/读取 helper，保留知识库存储 helper。
  - `src/octop/api/routers/chat/models.py` — 解析可选的 connector mode 字段，旧客户端字段缺失时保持兼容。
  - `src/octop/api/routers/chat/turn.py` — Craft auto 按当前用户权限解析 connector；Ask/Plan 不论请求内容都强制空集。
  - `src/octop/api/routers/agent_tools.py` — readiness 在无显式选择时按同一 auto 有效集合报告。当前 Dashboard 未调用此 endpoint，不新增 UI。
- 测试：
  - `dashboard/src/pages/Chat/hooks/useChatComposerResources.test.tsx` — 替换 connector per-agent 持久化测试，确认 composer 不再暴露或读取该选择。
  - `dashboard/src/pages/Chat/hooks/chatStore.connectorSelection.test.ts` — 覆盖普通 Craft 发送传 auto mode 且不传 connector 列表、Ask/Plan 不发送 connector。
  - `tests/unit/api/test_chat_composer_context.py` — 覆盖自动有效集合、Ask/Plan 服务端限制及旧 payload 兼容。
  - `tests/unit/api/test_tool_readiness.py` — 覆盖 auto readiness 范围和非 Craft 不预加载。
  - `tests/unit/connectors/test_default_open.py` — 仅在现有回归覆盖不足时补充，确认 Cron/IM/default_open 行为未改变。

## 任务列表

### 任务 1：从 chat composer 移除 connector 选择界面

**涉及文件：** `useChatComposerResources.ts`、`useChatSend.ts`、`useSlashMentionInput.ts`、`ChatInput.tsx`、`ChatInputPreviewBar.tsx`、`ConnectorPickerPopover.tsx`、`ChatInputActionsRow.tsx`、`index.tsx`、`utils/chatStorage.ts` 及对应前端测试。

- [ ] **步骤 1：先更新失败测试。** 在 `useChatComposerResources.test.tsx` 删除 per-agent connector selection 行为断言，新增断言：切换 Agent/会话不会恢复旧 connector 选择；composer 对外不再提供 connector selection 值/保存动作。补 slash mention 测试，确认 connector 名称不会出现在输入建议中。
- [ ] **步骤 2：运行并确认失败。** `cd dashboard && npx vitest run src/pages/Chat/hooks/useChatComposerResources.test.tsx src/pages/Chat/hooks/useSlashMentionInput.test.ts`。预期旧状态和 connector 建议仍存在，新增断言失败。
- [ ] **步骤 3：做最小 UI 移除。** 删除聊天输入 chips、connector picker 入口和 connector 名称建议；移除对应的状态、per-agent localStorage 读写及失效属性/函数。保留连接器管理页、技能/Agent 选择、知识库选择及其他 `default_open` 消费者。
- [ ] **步骤 4：验证前端目标用例。** 重跑步骤 2 命令，并运行 `cd dashboard && npx tsc -b`；预期测试通过、类型检查退出码为 0。

### 任务 2：实现 auto WS 协议和服务端权限解析

**涉及文件：** `chatStore.ts`、`models.py`、`turn.py`、`test_chat_composer_context.py`、WS payload 测试。

- [ ] **步骤 1：增加协议失败测试。** 后端断言 `connector_selection_mode="auto"` 在 Craft 展开当前 user 的 active、credentialed、可见实例及其 enabled custom MCP；禁用、无凭据、非 active 和其他用户 private 实例不进入列表。Ask/Plan 即使附带 auto 或伪造 `mcp_servers` 也必须为空。mode 缺失时旧请求沿用已有 `mcp_servers`/default_open 语义。前端断言普通 Craft payload 传 auto、不传 `mcp_servers`；Ask/Plan 不携带 connector 列表。
- [ ] **步骤 2：运行并确认失败。** `uv run pytest tests/unit/api/test_chat_composer_context.py -q`；`cd dashboard && npx vitest run src/pages/Chat/hooks/chatStore.connectorSelection.test.ts`。预期缺少 mode resolver 与 WS 字段断言失败。
- [ ] **步骤 3：实现服务端 resolver。** `ChatTurnBody` 和 `UserTurnWsFrame` 接受可选 `connector_selection_mode: Literal["auto"] | None`。Craft auto 使用现有 connector service 按 `user.id` 获取可见、active、有凭据的连接器，再调用现有 validator/`prepare_chat_mcp`。Ask/Plan 覆盖为空并忽略客户端 connector 名单。缺少 mode 时不改变旧行为；Cron/IM 不经过新分支。
- [ ] **步骤 4：验证协议回归。** 重跑步骤 2 两条命令，并运行 `uv run pytest tests/unit/connectors/test_default_open.py -q`；预期通过且 `default_open` 既有规则不变。

### 任务 3：Readiness 和全量质量门

**涉及文件：** `src/octop/api/routers/agent_tools.py`、`tests/unit/api/test_tool_readiness.py`。

- [ ] **步骤 1：增加 readiness 测试。** auto 未指定选择时，readiness 使用当前用户自动有效集合；未启用、无凭据和不可见实例不预加载；Ask/Plan 不调用 `prepare_chat_mcp`；显式旧查询参数保持兼容。
- [ ] **步骤 2：运行并确认失败。** `uv run pytest tests/unit/api/test_tool_readiness.py -q`。预期默认仍根据 default_open/专家选择，而非 auto 有效集合。
- [ ] **步骤 3：对齐 readiness。** 无显式选择时按 turn resolver 同一来源解析 auto 范围并准备工具；Ask/Plan 不预加载；显式选择继续使用既有验证路径。此 endpoint 当前没有 Dashboard 调用方，不添加新 UI。
- [ ] **步骤 4：运行聚焦和全量验证。**
  ```powershell
  uv run pytest tests/unit/api/test_chat_composer_context.py tests/unit/api/test_tool_readiness.py tests/unit/connectors/test_default_open.py -q
  cd dashboard; npx vitest run src/pages/Chat/hooks/useChatComposerResources.test.tsx src/pages/Chat/hooks/useSlashMentionInput.test.ts src/pages/Chat/hooks/chatStore.connectorSelection.test.ts
  npx tsc -b
  cd ..; make all
  ```
  预期所有命令退出码为 0。API 改动后查看 `/api/docs` schema；最后检查 `git diff --check`、`git status -sb`，保留既有未提交改动，不创建提交。

## 失败场景与防护

- 用户伪造 connector 名称或尝试跨用户调用：后端按请求用户解析权限范围，并沿用现有 validator。
- Ask/Plan 请求伪造 auto 或 connector 列表：服务端以会话模式为准，强制空集。
- 连接器授权失效或上游不可用：未授权项不加载；注册/调用失败沿用现有错误路径，不将“工具可见”当作“服务可用”。
- 工具数量增加导致上下文占用上升：自动范围仅包含已启用且有凭据的实例；本次不新增分类器，后续若有实测性能问题再单独设计。
- 旧客户端未发送 mode：继续使用旧 payload 语义，避免协议升级造成回归。

## 完成检查

- [ ] `make all`、前端目标 Vitest 和 `npx tsc -b` 全部通过。
- [ ] `/api/docs` 中相关 schema 可读，`git diff --check` 通过。
- [ ] 未提交或推送；仅保留本功能相关改动。
