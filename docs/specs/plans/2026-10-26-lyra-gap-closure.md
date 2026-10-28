# LYRA Octop 功能差距补齐实施计划

> **给执行者：** 本计划按里程碑顺序在当前 `dev` 工作区执行；未完成所有里程碑前不提交。已有工作区改动归用户所有，提交时只暂存本计划新增的内容和本任务明确修改的代码。

**目标：** 以可验证的 Run、Project Context、SourceSpan、Artifact、Approval 和 AgentVersion 合同补齐 LYRA 评估中的端到端缺口，并在所有阶段验收后将本任务改动提交到 `dev`。

**架构要点：** 保留 FastAPI、现有 Harness、Teams、Cron、Memory、ACP/MCP 与连接器；先通过 SQLite/PostgreSQL 持久化 Run/Step/Event 和权限合同，再逐步接入文件、Team、外部系统及 Agent 治理。任务状态、来源与成果必须来自服务端事实，外部副作用须有审批、幂等和对账记录。

**技术栈：** Python 3.12、FastAPI、同步 SQLite/psycopg repo、React 18/TypeScript；后端使用 `uv run --no-sync pytest`、Ruff、`mypy --strict`，前端使用 Vitest、`npx tsc -b`、Prettier。

**关联设计文档：** `C:/Users/xdguo/Downloads/LYRA_Octop_Gap_Assessment_v1.0.md`；现有文件工作流计划 `docs/specs/plans/2026-10-17-chatgpt-file-experience.md`。

---

## 约束与状态口径

- 评估基线是 `dev@58ccabd4768adc6f6176d83def1c89f104d01e16`。当前工作区有大量既有改动，不能把它们视作本计划成果或验收通过。
- 本计划中的 **实现** 表示代码已存在；**验证** 必须有本机命令或目标环境证据；仅有测试文件不等于通过。
- 本计划的粗排只表示顺序，不承诺日历工期。Provider、PostgreSQL、多实例、真实业务应用的环境缺失必须记录为 BLOCKED，不能报告 PASS。
- 不引入 Kafka、Redis、Celery 或 Kubernetes；除非负载/容灾证据证明数据库驱动执行器无法满足目标。
- 高风险 EHR 写入、任意宿主文件访问、未经审批的外部发送不进入首期。

## 关键失败场景与防护

| 失败场景 | 防护 | 验证 |
|---|---|---|
| 其他用户猜到 thread ID 后直接 POST approve | resume 同时校验 Agent 可访问性、thread owner 和 pending 的 user/agent/thread；任一不匹配就不调用 Harness | `uv run --no-sync pytest tests/unit/api/test_chat_hitl_resume.py -q` |
| 进程重启导致内存 pending 丢失，客户端仍提交旧决定 | 仅从加密 owner-scoped `hitl_approvals` 还原有效记录；决定 CAS 持久化后不自动重放 | Coordinator 重建恢复、跨用户拒绝、过期密文清理和重复决定审计测试；副作用对账仍未完成 |
| 文件 revision 并发覆盖或存储字节被篡改 | base-revision CAS 保留分支；读取时重验 owner/thread/revision 和 SHA256 | `tests/integration/test_chat_files_api.py::test_text_artifact_revision_uses_cas_and_keeps_stale_revision` |

## 交付切片和依赖

```text
G0 基线/权限
   └─ G1 Run/Step/Event + Team + Approval + Recovery + Context
         ├─ G2 SourceSpan + Artifact + 文件成品
         └─ G3 工作台执行视图
                └─ G4 业务能力网关 + 发布 E2E
                       ├─ G5 Deep Research / Analysis / Media
                       └─ G6 AgentVersion / Evaluation / Routine / Memory governance
```

G2 的解析和 Artifact 合同可与 G1 UI 并行，但必须先冻结共同身份、版本与权限合同。AgentVersion 字段必须从 G1 Run schema 开始预留。

## G0 — 基线与跨权限安全（GAP-001/002）

**已完成：** 读取评估文档、`memory.md`、功能清单及现有文件计划；确认工作区改动未等同已验收。既有项目分享/撤权、聊天附件权限/版本等集成测试已覆盖多个核心边界；M0 回归曾通过 30 项，Run/API 与文件来源扩展后本轮相关测试通过 36 项；`tests/unit/db/test_db_pool.py` 为 20 passed、1 skipped。

**待完成：**

- [x] 建立 User、Agent、Project、File/Revision、Thread、Share、Tool/Runtime 权限矩阵，映射现有测试并明确缺失路径（`docs/testing/2026-10-26-lyra-permission-matrix.md`）。
- [x] User、Agent、Project、File/Revision、Thread 的跨用户/共享边界集成回归已覆盖；本轮权限矩阵相关 66 passed。
- [x] Run worker 的身份来自服务端 owner-scoped Run 和 Thread；执行输入只从持久化用户消息读取，Agent、Thread 和 message role/ID 在启动与执行期重验。`tests/integration/test_runs_api.py::test_run_start_requires_owned_persisted_user_message` 覆盖 owner 隔离和执行输入合同。Harness 模型不能通过消息参数覆写这些身份字段。
- [x] SQLite owner/permission 查询经本地集成回归验证；目标环境未提供 PostgreSQL，权限查询对照在矩阵中标为未验证。
- [x] 更新 `docs/features.md`、`docs/testing/2026-10-27-lyra-gap-closure-status.md` 和本矩阵；只将有实际测试证据的本地能力标为 PASS，Provider/PostgreSQL 保持 BLOCKED/未验证。

**完成门槛：** 越权读写回归通过；当前 WIP 文件与基线提交区分清晰；未解决高风险项有负责人和明确阻断范围。

## G1 — 持久任务控制面（GAP-003–007、012）

### G1.1 Run/Step/Event 基础（GAP-003）

**当前状态：** Migration 031/032 含 SQLite/PostgreSQL Runs、Steps、Events、lease、AgentVersion 与执行关联字段；`/api/runs` 提供 owner-scoped 创建/查询/Steps/Events/start/cancel/effects。服务启动后由单进程 worker 消费输入绑定的 queued Run；输入和上下文来源在执行期重验。Team Inbox dispatch 保持独立，不被普通 Run worker 消费。PostgreSQL 与真实 Provider 尚未验证。

- [x] 补齐基础 Run/Step 状态转换、重试 attempt、终态与版本 CAS 边界测试；非法转换和过期版本拒绝。
- [x] 为状态转换事件增加安全投影；Step 失败只接受固定 error code，API 仅返回状态、固定错误码和静态 kind/source，原始 prompt、患者数据、凭据、异常文本及未知嵌套字段均不返回。
- [x] 建立稳定的单调序号事件游标；覆盖分页、负游标校验、跨用户事件/Steps 隐藏和幂等 key 用户隔离。
- [x] Run 事件序号设置每 Run 100,000 条硬上限，超限事务回滚；SQLite 并发同版本状态更新仅允许一个 CAS 胜者。
- [ ] PostgreSQL 并发行为待实机验证。
- [x] Run 持久化 `agent_version_id` 和项目上下文/来源 revision 快照；预算由 v32 Run lease `max_runtime_seconds` 表达。未定义触发主体合同，暂不暴露该字段。
- [ ] 在可用环境运行 SQLite 与 PostgreSQL migration/repo 对照；PostgreSQL 未配置时保持未验证状态。

**验证：** `uv run --no-sync pytest tests/unit/db/test_run_repo.py tests/integration/test_runs_api.py tests/unit/db/test_db_pool.py -q`；`mypy --strict src/octop`；OpenAPI 检查 `/api/docs`。

### G1.2 Team 与 RunStep 对接（GAP-004）

- [x] 盘点 `infra/agents/teams`、Team Inbox、后台 `ask_agent` 和成员回叫实现，以 Harness `job_id` 为稳定 inbox ID，唯一映射至一个 owner-scoped Run/Step。
- [x] 鉴权解析成功后先写 queued Run/Step，再将同一 `job_id` 入队；开始、完成、失败和取消以事务事件更新同一记录，入队异常落固定脱敏错误码。
- [x] 派工时由 Harness 解析当前调用用户、主持人与成员关系；来源 thread 存在时再次校验其 owner 和主持 Agent，Repo 的状态更新按 Run owner 隔离。
- [x] 测试重复建单/回调幂等、并发 start CAS、跨用户隐藏、排队失败、取消/中断终结及“授权→持久化→入队”顺序。
- [x] RunExecutor 内发起的 Team 派工通过执行上下文关联到父 Run；子 Run 继承父 Project/Thread，新增 owner-scoped `/runs/{run_id}/children` 和项目详情子任务状态视图。父 Run 在子任务活动时保持运行；全部结束后按成员失败、中断、未知外部副作用或 Harness 的成功/失败/审批等待结果收敛，并在一个事务中锁定父行、写入状态事件和释放 lease。Team Inbox 派工也有 dispatcher lease 和心跳。新增独立 Fernet 密文 payload 表保存未启动派工的恢复输入，v32 数据库有幂等 repair；启动先原子接管过期且 Run/Step 仍 queued 的任务，再恢复相同 inbox ID，运行期每 5 秒扫描。父 Run 必须仍运行且 lease 有效；旧 dispatcher 被 lease owner fencing 拒绝。running/cancel-requested 仍分别收敛为 interrupted/unknown_external_effect，不自动重放；终态事务清除密文。SQLite migration、claim/fencing、恢复输入和 Team 回归通过。PostgreSQL、多进程 Inbox 实机验收和活动成员工具强制中断仍未完成。

### G1.3 审批与副作用台账（GAP-005）

- [x] 现有 HITL 工具暂停/决定通过 `audit_log` 持久留痕；只记录 owner、Agent、thread、工具名与批准/拒绝/过期决定，不记录工具参数正文。审批决定在恢复工具前写审计；审计 Repo 重建后仍可读取；重复相同决定幂等。
- [x] Dashboard resume 要求当前用户拥有该 Agent+Thread 且有匹配 pending record；pending 丢失/过期时 fail closed；多个待办时必须由 pending_id 精确选择。审批请求加密保存到 `hitl_approvals`，Coordinator 重建后可恢复待办并校验 owner；终态决策和审计同事务 CAS 写入，终态时清空加密参数。Team 成员待办同时持久化成员 Agent/Thread 恢复目标。
- [ ] Harness checkpoint 可跨进程保留，但“批准已提交、图恢复尚未完成”时当前 fail closed 且不重放决定，仍没有可靠的恢复投递队列；approved 只表示用户决定，不代表工具副作用成功。PostgreSQL 实际 migration/repo 对照尚未验证。
- [x] 工具按 read/write/external-send 分类；内置写工具、插件工具及未知 MCP 默认必须 Approval，审批中断在工具调用前配置；后端线程绕过和 Dashboard 自动恢复仅允许明确只读工具。专项分类、绕过和 HITL API 回归通过。
- [x] RunEffectRepo 为 owner-scoped Run/Step 持久化 provider idempotency key、请求/资源/结果哈希、approval 引用、决定用户/过期时间和 requested/succeeded/failed/unknown 状态；unknown 可显式对账为 succeeded/failed；写入前同事务重新检查 active write scope 和 owner approval。`GET /api/runs/{run_id}/effects` 只返回安全元数据。
- [x] Run 进入 succeeded/failed/interrupted/cancelled/unknown_external_effect 后，未回报结果的 `requested` effects 会转为 `unknown` 并追加安全事件；RunExecutor 启动周期和终态路径都会执行对账，重复调用幂等，且不重放副作用。仓储和 RunExecutor 定向回归通过。
- [ ] Effect ledger 已有 SQLite 仓储合同，但尚未从 Harness 工具执行器调用；真实 provider 结果与 timeout reconciliation 仍未验收。Approval 决定不能作为外部操作成功凭据。
- [ ] Run worker 已能执行保存消息并将 HITL pending 关联回原 Run/Step；RunEffect ledger 仍未接入 Harness 工具 handler，因此拒绝/撤回/过期时真实工具调用计数、scope-to-effect 绑定和 Provider 对账仍未验收。
- [x] 复用 `POST /api/agents/{agent_id}/chat/hitl/resume` 审批 API；路由有 SSE/OpenAPI 说明，缺失或歧义 pending 使用中英文文案，跨用户或 pending 缺失在恢复 Harness 前拒绝（`tests/unit/api/test_chat_hitl_resume.py`）。

### G1.4 租约、恢复与取消（GAP-006）

- [x] RunRepo 增加原子 executor-instance claim、最多 300 秒 heartbeat lease、每次运行 1 小时硬预算和过期租约 reconciliation；双实例 CAS 只允许单一领取者，心跳身份必须匹配。
- [x] 进程 lease 过期后 Run 和运行中的 Step 转为 `interrupted` 并写事件；当前绝不自动重排，因为尚无安全重试分类和外部 effect 对账事实。
- [x] Run executor 采用已保存 Chat 用户消息作为输入合同：`thread_id` 与 `input_ref=message_id` 随 Run 固定保存；启动 API 与 worker 分别按 Run owner、Agent、Thread、消息角色/ID 复验。原始 prompt 不复制到 Run 行。
- [x] 服务启动后单实例消费有输入绑定的 queued Run；使用现有 Run/Step lease、心跳和 CAS，按项目指令快照、当前可见 KB、拥有的不可变文件 revision 组装上下文；外部文件文本标注为不可信来源并限制总字符数。Team Inbox Run 不进入该消费队列。
- [x] HITL pending 持久关联 run_id/step_id；暂停时 Run/Step 进入 waiting_approval，Dashboard 恢复同一 checkpoint 后更新原 Run/Step，拒绝/错误写固定错误码。取消等待审批的 Run 会终结原 Run/Step 并过期对应 pending；活动 Run 收到 cancel_requested 后 worker 取消当前协程。真实 Provider 副作用仍未在无环境做实测。
- [ ] 生产多实例状态汇总、外部写入 `unknown_external_effect` 对账及审批后进程崩溃恢复仍待接入/目标环境验收。
- [x] API 按 Run 状态区分立即取消与 `cancel_requested`，重复调用幂等、跨用户隐藏；明确取消不回滚外部副作用。
- [x] RunExecutor 在当前 Harness stream 活动时传播取消到执行协程；等待审批时取消并清理关联 pending。取消 parent Run 会扫描其 Team dispatch 和直接子 Run 的 dispatch，并调用 Harness inbox `cancel(job_id)`；并发 enqueue/cancel 通过 dispatch lock 排序，Inbox 缺失时持久任务收敛为 interrupted。`tests/unit/gateway/test_global_processor_team.py` 与 `tests/integration/test_runs_api.py` 覆盖活动取消、进程丢失、父子传播与 enqueue/cancel 竞态；本轮完整非 live 后端回归通过。
- [x] Team Inbox Run 使用现有 `runs.lease_owner/lease_expires_at` 标记所属进程；本进程只续自己的 queued/running 派工租约。重启恢复仅接管 payload 已加密持久化、Run/Step 均为 queued、父 Run 仍有效且 lease 到期的任务；claim 原子更换 lease owner，旧 worker 的 start CAS 随后失败。未启动但没有可恢复密文的历史任务收敛为 interrupted；已启动派工记为 `unknown_external_effect`，均不会自动重放。RunRepo 的 SQLite lease fencing、过期收敛与 TeamManager 恢复回归通过；PostgreSQL 实机验证未做。
- [x] 覆盖 lease 过期、错误 executor 心跳拒绝、双实例并发 claim、interrupted 不自动重排和 attempt 不增加。
- [ ] 真实杀进程/崩溃恢复演练、跨进程取消、Provider `unknown_external_effect` 对账和重试安全分类尚未验收；本地执行期取消及 Team inbox 主动取消已按上述合同实现并由回归覆盖。

### G1.5 Project Context 与执行视图（GAP-007/012）

- [x] 在现有 WorkbenchProject 上保存带 CAS revision 的项目指令和知识库绑定；Run 创建时校验 KB 当前可见并保存不可变指令/KB ID 快照。
- [x] Home 项目菜单可编辑项目指令；加载竞态按请求序号丢弃过期响应，保存沿用已读 revision。
- [x] Run 创建支持显式文件 revision 引用：校验当前用户、Agent、Thread 三重绑定，快照 thread/file/revision/hash/MIME/size，不复制正文或宿主路径。
- [x] Run 创建时将规范化 Agent 配置生成带 schema_version、SHA-256、Fernet 加密的不可变 AgentVersion；内容相同复用版本，`current` alias 只指向最新捕获版本；Run 响应固定 `agent_version_id`，幂等重放保留原 Run 的版本。
- [ ] 执行器尚不能用旧 AgentVersion 构建独立 Harness graph；当前只在执行前比较配置版本，不匹配则 fail closed。配置漂移不调用 Harness 的回归已通过；按固定版本真正执行仍待完成。
- [x] Run 创建时冻结有效 App grant 的 registration/app/grant、到期时间和 read/write scopes；详情页仅作审计展示，幂等重放保持创建快照。快照不授予权限，执行时重新验权仍待 ContextAssembler/执行器接入。
- [x] Run worker 对 Project、KB 与 File revision 做执行期复验；Project 指令来自不可变快照，KB 重新按当前用户可见集合校验，附件经 `FileService.read` 逐次校验权限与 SHA256；无效来源使 Run 失败，不静默忽略。Run API/首页显示安全 provenance（revision、hash、KB 数量）。
- [x] 项目菜单可读取服务端持久 Run/Step/Event；Run 详情显示服务端状态和执行上下文来源，不展示假进度。
- [x] Home 项目 Run 详情已整合 Team 子任务、HITL Chat 跳转、固定错误码、Artifact 元数据与认证下载；项目 Run UI 回归覆盖 Team child 展示、审批路由和 Artifact 入口。此项是 owner-scoped 只读整合，不代替人工审批或提供任意文件下载。
- [x] RunExecutor 对相同任务文本分别注入不同 ProjectContext 的回归证明上下文不串项目；项目指令 revision 快照在创建后更新仍保持原值的 API 回归已通过。
- [ ] 通过浏览器刷新/重登恢复 Run 详情仍未做端到端验收。

**G1 完成门槛：** 完成评估切片 A；Run 状态完全由服务端持久化；Team/审批/恢复可审计；跨重启不盲目重放外部副作用。

## G2 — 可信资料与成果文件（GAP-008–010）

### G2.1 解析状态与 SourceSpan（GAP-008）

- [x] 复用现有文件 worker、不可变 revision、segment、locator、SHA256 和 coverage 合同；API SourceSpan 返回 `file_id/revision_id/parser_version/content_hash/locator`，XLSX 精确到 sheet/cell。
- [x] parser version 变更时通过旧版本 CAS 原子替换旧 segment，防止过期定位缓存残留，并阻止并发或旧进程覆盖新解析结果。
- [x] 解析状态以服务端事实记录：预解析 `stored`、在途 `processing`（60 秒 lease）、解析后 `ready/partial/needs_ocr`、失败 `unsupported/failed`；过期 lease 在读取面显示为可重试的 `stored`。错误格式和解析失败分别映射到对应 API error。
- [x] Coverage 报告真实处理单元数、截断、空单元和 OCR 需求；SourceSpan 给出 PDF 页、工作表/单元格、演示文稿页/shape、段落/表格行及文本行位置。
- [ ] 目前是按请求同步解析，没有后台队列，因此不伪报 `queued`；`needs_ocr` 当前只报告 PDF 图像页，不表示已完成 OCR。将提取文本交给模型后的 prompt-injection 防护尚需在执行期 ContextAssembler 验收；OS 级跨平台内存硬限仍缺失。
- [x] Parser locators 已覆盖 PDF page、XLSX sheet/cell、PPTX slide/shape、DOCX paragraph/table row 和文本行；新增 PDF/DOCX/PPTX 精确位置回归。
- [x] ZIP/Office 解析设置文件数、解压字节、压缩率上限；worker 有运行超时、输入/输出/字符/segment 限制。
- [ ] 当前没有跨平台 OS 级 worker 内存硬限；解析器本身只提取文本不执行文档代码，但将不可信文本交给模型时的提示注入防护尚未验收。

### G2.2 Artifact、修订和权限（GAP-009）

- [x] Chat 的不可变 `revision_id` 作为 Run Artifact API 对外 `artifact_id`，同一 revision 关联多个 Run 时身份一致；Run/Project 继承该 revision 与来源元数据。当前仅统一稳定身份，不是跨实体通用 Artifact 仓储。
- [x] 新增 owner-scoped 项目 Artifact 列表，将该项目 Run 已关联的文件 revision 按稳定 revision ID 去重；Chat、Run、Project 下载复用相同 authenticated content URL，跨 Run 重复关联只显示一条。Run API 集成和 Project Runs UI 定向回归通过。
- [x] Chat TXT/MD/CSV 写操作使用 base_revision + CAS；并发失败返回 409 并保留为以旧 revision 为 parent 的分支 revision，不静默覆盖。
- [x] revision 下载 URL 通过文件/用户/Agent 所有权查询授权，校验 revision 与文件绑定并在返回前比对 SHA256；共享 Agent 下跨用户下载 404，损坏内容返回 `FILE_INTEGRITY_FAILED`。旧 workspace file/download/doc/media exact-path 入口也会查询登记 revision、owner 与软删除状态并校验 SHA256，防止共享 Agent 直接猜路径绕过。
- [x] 专用 revision 下载、旧 workspace exact-path 读取和解析读取统一复用 `FileService` 的 revision 归属查询及 byte-size/SHA256 校验；入口保留各自现有的 HTTP 错误映射。服务单测覆盖 owner 拒绝、旧 path 读取和损坏字节拒绝，Chat Files API 与 legacy workspace owner/hash 集成回归通过。
- [x] 线程内 TXT/MD/CSV 编辑器只调用绑定当前 thread 的精确 revision 读取接口；读取每次校验 owner/Agent/Thread/file/revision 与 SHA256。旧版本并发冲突保留本地草稿并允许用户显式基于最新版本重试。
- [x] Chat TXT/MD/CSV CAS 冲突会显示最新服务端版本与本地草稿的逐行差异；LCS 仅在不超过 20 万字符且 100 万 DP 单元时计算，超限明确退回手动对照，避免大文件阻塞界面。通用 UI 冲突解决面板仍未实现。
- [ ] Home、Chat、项目文件区尚无通用 Artifact 仓储和统一预览入口；项目汇总目前只覆盖已关联 Run 的 revision，不代表所有 Chat/Project 文件自动进入 Artifact 列表。revision 下载授权由 `FileService` 统一校验。
- [x] 共享 Agent 的通用 workspace tree、glob、grep 与 archive 会隐藏其他用户及软删除 ChatFile revision 的路径；通用 exact-path 读取仍校验 owner、删除状态和 SHA256。ChatFile 删除会尽力删除 revision bytes，删除失败时 soft-delete 记录仍阻止旧 URL 返回正文；ZIP merge/replace 跳过已登记 revision 的同路径内容，replace 只清理未受保护路径。相关文件/Workspace/archive 集成回归 50 passed。未引入自动过期删除策略，避免在没有保留期合同的情况下清理用户数据。owner-scoped content URL 不包含 workspace path。

### G2.3 文档成品链（GAP-010）

- [x] 首切片已交付线程内 TXT/MD/CSV 创建和不可变 revision 编辑 API 与 Chat 文本编辑器，使用现有 inbound workspace、附件权限和 SHA256；并发冲突保留分支并由用户显式选择基于最新版本重试。
- [ ] 通用 DOCX/XLSX/PPTX 创建编辑、PDF 标注/转换仍未交付；Chat 已可创建和编辑受限 Markdown 转换的生成型 DOCX revision，上传的 DOCX 仍走隔离解析，不进入该快速编辑器。
- [ ] 生成工具返回存储对象后，服务端检查 MIME/签名/容器结构/非空/大小；通过验证后登记 Artifact。
- [ ] 真实成品可预览、下载、重登恢复；原件保留，转换损失和能力缺失显式提示。
- [x] 已复核现有 PPT Studio 导出/下载校验并运行 presentations service 25 项回归；该专用 PPTX 流程不是通用 Artifact，不覆盖 DOCX/XLSX/PDF。

**验证：** `uv run --no-sync pytest tests/unit/files tests/integration/test_chat_files_api.py tests/unit/db/test_db_pool.py tests/unit/i18n -q`；dashboard 文件 API Vitest 与 `npx tsc -b`；真实打开 DOCX/XLSX/PPTX/PDF 样本仍待交付成品格式时执行。

**G2 完成门槛：** 完成评估切片 B；权限、版本冲突、SourceSpan 和真实可打开成果均有证据，Home 与 Chat 显示同一 Artifact。

## G3 — 受控业务平台接入与发布证据（GAP-011/013）

**当前状态：BLOCKED（真实联调）** 用户确认当前没有隔离 EHR 测试环境或 Provider 凭据；本阶段只能实现/验证模拟契约，不能完成真实业务端发布证据。

- [x] 实现 mock AppRegistration 和 CapabilityGrant：owner 隔离、read/write scope 分离、到期/撤销、停用即时拒绝；真实外部适配器未实现。
- [ ] **BLOCKED：** 选隔离测试应用完成真实首接入；当前没有隔离 EHR 环境或 Provider 凭据。
- [ ] **BLOCKED：** 外部写动作与 run_id/approval_id/idempotency key 关联、超时后查询业务端状态；当前没有外部写入执行器或目标系统。
- [x] Mock 覆盖授权、撤权、无效 scope、过期、停用、重复撤权及 owner 隔离；外部重复提交、超时不确定、人工对账保持 **BLOCKED**。
- [ ] **BLOCKED（部分）：** SHA/schema/自动化门禁由最终本地验收补证；Provider smoke、外部 E2E 和业务回滚演练缺少环境。

**阻断条件：** 没有隔离业务测试环境或凭据时只完成适配器契约和模拟测试，GAP-013 不得标记完整 PASS。

## G4 — 研究、分析和多模态（GAP-014–016）

**当前状态：BLOCKED（Provider 验收）** 用户确认目前没有外部测试环境；缺少 Provider 能力和配额证据时，不报告真实研究/分析/音视频验收通过。

- [x] 使用现有 Search、STT、媒体 Provider mock adapter contract 做离线回归：Search/Media API、Voice manager/format/STT 集合 40 passed；这只证明配置与适配器边界，不代表下面的复合能力已经实现。
- [ ] Deep Research：研究计划、多轮搜索、来源交叉核验、矛盾保留、SourceSpan 引用、可下载报告和重放。
- [ ] 数据分析：独立受限 worker，禁网、CPU/内存/时长/输出目录受限；统计结果由真实代码计算并保存环境/输入 revision/异常行。
- [ ] 音视频：盘点已有 STT/TTS/image provider；按附件格式报告真实覆盖，补录音无 Provider/拒权、图片超额、视频抽帧未启用时的降级。
- [ ] 三项能力均复用 Run、SourceSpan、Artifact 和相同所有权校验，不各建一套下载/任务状态。

**验收：** 对应 T-12–T-16 用例通过；报告引用可核验、统计可复算、Provider 缺失时无假成功。

## G5 — Agent 治理与受控进化（GAP-017–025）

- [x] AgentVersion：不可变加密配置快照、schema_version、内容哈希、`current` 别名和旧 Run 固定版本；EvaluationSuite 及发布门禁仍未实现。
- [ ] EvaluationSuite：固定样例、安全用例、成本/时延/接管率；失败阻止 stable 发布，结果可复核。
- [ ] RoutineVersion：可测试、暂停、恢复、重复防护；Cron 只作为触发源，不复制调度状态机。
- [ ] Model Policy：通过 freellm-gateway 适配器使用配额、路由、用量和回退，不复制供应商凭据账本。
- [ ] Memory：来源、项目/用户 scope、TTL、纠错、撤回和撤权即时生效；事实源仍留在业务系统。
- [ ] Trace/Run/Audit/Artifact 使用稳定关联 ID；敏感日志脱敏且有访问审计。
- [ ] Role/Skill 版本先做引用与依赖，再做“候选经验→离线评测→人工审批→发布/回滚”；流程可视化最后做。

**验收：** 对应 T-19、T-23、T-24、T-25 用例通过；发布失败不会改 alias，回滚只移动 alias，不改历史 Run。

## 最终发布门禁与提交

- [ ] G0–G5 所有任务有 PASS/FAIL/BLOCKED 证据，不把未提供的外部环境报成 PASS。
- [x] 后端：Ruff check、Ruff format check、`mypy --strict src/octop` 和完整 `.venv/Scripts/python.exe -m pytest -n 4 -p no:testmon -m "not live" -q` 均通过；最新 pytest 为 4,958 passed、211 skipped、0 failed（2026-10-27，本轮 workspace ChatFile 读/写路径隔离后）。
- [x] Dashboard：Vitest 283 files / 1,504 tests passed、`npx tsc -b` passed、ESLint 0 errors / 70 warnings、`npm run build` 成功（最后一次全量结果见状态报告）。
- [ ] 额外执行 SQLite/PostgreSQL migration 兼容、目标浏览器 E2E、provider/业务测试服务联调、恢复与回滚演练。当前机器没有 `OCTOP_TEST_POSTGRES_URL`、运行中的 PostgreSQL 服务或 Docker，PG 实机验证无法在此环境执行。
- [x] API/功能说明、测试状态和 `memory.md` 已更新；部署文档没有变更（当前阶段没有部署配置改动）。真实 Provider/EHR、PostgreSQL 实机、浏览器 E2E、恢复/回滚演练仍 BLOCKED/未验证。
- [ ] 最终审查 `git diff --cached`；只暂存本计划和本任务明确改动。不得暂存此前用户的未提交/未跟踪文件，不跳过 hook 以带红测试提交。
- [ ] 所有阶段完成后，在当前 `dev` 分支提交一次，不推送、不合并到其他分支。

## 当前进度

- [x] M0 读取基线与工作区状态；P0 权限、附件、历史和 Run 回归 30 passed。
- [x] Run/Step/Event 持久化首切片；数据库迁移回归 20 passed、1 skipped；Ruff/mypy 通过。
- [x] Run 事件游标及跨用户隔离测试；XLSX 三工作表单元格定位和 parser-v2 缓存 CAS 升级；SourceSpan API 合同；相关 Run/File 定向回归 39 passed。
- [x] Dashboard API 类型 `npx tsc -b` 通过；本次 touched Python Ruff/mypy 通过。
- [x] Project instructions CAS、跨用户 404、Run 不可变上下文快照及 SQLite 折叠 migration 回归 25 passed、1 skipped。
- [x] Project Context 首页编辑 UI 与乱序请求回归：1 passed；`npx tsc -b`、相关文件 Prettier 和 `git diff --check` 通过。
- [x] RunRepo 事件上限与并发 CAS 回归：9 passed；SQLite 事件上限不产生部分状态变更。
- [x] Run 显式文件 revision 快照及跨用户拒绝、RunsRepo、migration 回归：33 passed、1 skipped。
- [x] Run 取消 API owner scope/幂等回归及 i18n：85 passed；运行中的取消只记录请求状态，未接实际执行器。
- [x] PDF/DOCX/PPTX SourceSpan locator 单测：15 passed（含此前 CSV/XLSX/文本定位与压缩包边界）。
- [x] 文件解析状态/lease、损坏完整性状态、worker 错误和 unsupported/read failure API 分类回归：文件单元 + API 集成 51 passed；前端状态标签 Vitest 通过，`npx tsc -b` 通过。
- [x] 校验失败会 CAS 失效该 revision 的旧解析版本并删除缓存 segment；迟到 worker 不可在 failed 状态回写，避免原始附件已变更后仍通过 segments/search 暴露旧提取文本。
- [x] Team Harness inbox 与持久 Run/Step owner 隔离、重复回调、并发 start、入队失败、取消和中断终结回归通过；Team Repo/网关定向集合 67 passed。
- [x] Chat TXT/MD/CSV 线程文件创建、并发 CAS、双草稿 revision 可读和冲突 409 API 已实现；文件 API/解析/DB/i18n 回归 158 passed、1 skipped；包含共享 Agent 跨用户下载 404 与损坏 revision 完整性拒绝；前端 Vitest 2 passed、`npx tsc -b` 和 ESLint 通过。
- [x] HITL 审批审计记录接入现有 `audit_log`，事件不含原始工具参数；网关/Team/Dashboard HITL 回归 96 passed，含批准审计先于成员恢复与失败时保留既有待办语义；持久化与去重单测、strict mypy 通过。
- [x] 修复 Dashboard resume 的 fail-open/歧义选择：当前用户必须拥有目标 thread；缺失 pending 被拒绝；多个 pending 时必须给出 pending_id。API route regression 覆盖无 pending、他人 thread 有本用户 pending、同 thread 多 pending，见下方合计。
- [x] 审批 API 和 HITL channel 回归：`test_chat_hitl_resume.py`、`test_hitl_resume_validation.py`、`test_hitl_channel.py` 共 44 passed；连同 `tests/unit/i18n` 合计 124 passed；`mypy --strict src/octop`（613 files）和 touched Ruff check/format 通过。
- [x] HITL durable pending/加密/owner 隔离/Team 恢复目标/过期清密/决定审计 CAS 回归；Run lease 和 HITL/Team/Files/Workbench 联合回归 298 passed、2 skipped；严格 mypy（615 files）和 touched Ruff 通过。
- [x] 修复双请求并行审批时 CAS 输家仍可恢复 Harness 的竞态；并行双 Coordinator 仅一个决定胜出，Dashboard CAS 输家不调用 Harness；HITL API/Coordinator 复跑 46 passed，严格 mypy 再次通过。
- [x] revision 专用下载接口不再把用户文件 URL 暴露为通用 workspace 路径；共享 Agent 跨用户拒绝与 SHA256 损坏拒绝集成回归通过。
- [x] Chat 文本编辑器与 thread-scoped TXT/MD/CSV revision 读取：Chat Files API 集成 12 passed；Vitest 3 files / 23 tests passed；`npx tsc -b` passed；ESLint 0 errors（ChatInput 有 3 条既有 hooks warnings）。JSDOM 打印 Ant Design `getComputedStyle(pseudoElt)` 未实现警告，不影响断言。
- [x] Home 项目 Run 历史/步骤/事件只读视图组件回归：1 passed；`npx tsc -b` 通过。
- [x] AgentVersion 首切片：加密、哈希校验和不可变配置快照，Run 固定版本且配置变化后的幂等重放不漂移；Run 详情显示固定版本 ID；JSON ID 列规范化避免重复版本。Runs API/RunRepo/SQLite migration 回归 43 passed、1 skipped，前端 Run 视图 4 passed，`npx tsc -b`、`mypy --strict src/octop`（617 files）及 Ruff check/format check 通过。
- [x] 更新 `docs/features.md`，仅描述可验证的 Run 记录 API/只读界面并明确未启动执行器。
- [x] ChatFile legacy workspace exact-path 读取、共享 Agent 列表与 archive 隔离：集成回归 48 passed；Ruff check/format 和 strict mypy 全仓通过。
- [x] Workspace ZIP merge/replace 导入不得覆盖已登记 ChatFile revision；受保护路径导入跳过并返回 warning，replace 清理时保留路径及其祖先目录。新增 API 与 archive 单测，ChatFile/Workspace/archive 定向回归 50 passed；最终完整非 live 回归 **4,958 passed、211 skipped、0 failed**。
- [x] 全量静态门禁：Ruff check、Ruff format check（1,271 files）、`mypy --strict src/octop`（612 source files）均通过。
- [x] G3 模拟授权控制面：SQLite/PostgreSQL schema、owner-scoped API、能力 scope 校验、双语错误码、未来到期时间校验、撤权/停用即时生效；Repo/API/migration/OpenAPI/i18n 回归 105 passed、1 skipped，Ruff 与严格 mypy 620 文件通过，Dashboard TypeScript 通过。真实 EHR/Provider 联调、外部写入幂等与超时对账仍 BLOCKED。
- [x] Run Events API 仅输出 allowlist payload；Step failure 仅保存 `execution_failed`、`provider_unavailable`、`approval_rejected`、`team_member_failed` 固定码。RunRepo/API/G3 联合集合 27 passed；Ruff 与 strict mypy 通过。
- [x] G1.3 工具风险审批与副作用台账首版：内置写工具、插件和运行时 MCP 在 Harness 编译前加入强制 HITL；插件名称避开内置名，来源为 MCP 的工具强制审批；后端和 Dashboard session bypass 仅允许明确只读操作，Agent 首次注册完成策略初始化前的并发调用等待 ready；RunEffectRepo 验证 owner Run/Step、当前 write scope 和 owner approval，保存哈希及 requested/succeeded/failed/unknown 状态；后端 HITL/session/Agent/plugin/connector 定向集合 416 passed、2 skipped，Run effect/Run/API/migration/OpenAPI 集合 48 passed、1 skipped；全量 strict mypy 通过。Dashboard 针对性回归 17 passed、TSC 通过、ESLint 0 errors / 70 warnings；设置/API/CLI/网关回归 40 passed。真实 Harness 调用、重启恢复执行和 Provider 对账仍未实现。
- [x] 修复 RunEffectRepo 并发幂等竞态：使用唯一约束的 `ON CONFLICT DO NOTHING RETURNING` 决定唯一写入者，竞态输家读取既有行并校验所有者、Run/Step、Agent、scope、资源/请求哈希及审批；并发仓储回归验证只创建一个 effect。真实 PostgreSQL 并发仍未实机验证。
- [x] G2 Artifact 首个可用垂直切片：Run 可将同 owner/Agent/Thread 下的 Chat file revision 以稳定 `artifact_id` 登记到 `run_artifacts`，重复登记幂等，列表只返回元数据与 owner-scoped 内容 URL；Run 详情支持关联当前会话 revision 并下载。SQLite/PostgreSQL v32 migration 与已到 v32 数据库的幂等 repair 对齐；Runs API、RunRepo、DB migration 回归 **51 passed、1 skipped**，Dashboard Run 页面 **4 passed**，TSC、Ruff 与全量 strict mypy 通过。尚未接 Harness 生成器自动登记，且非 Project/Run/Chat 通用仓储。
- [x] Team Run 取消闭环首切片：API 发出持久 `cancel_requested` 后取消对应 Harness Inbox job；已不在进程内的 Inbox 不会留下永久挂起记录，而是将 Run/Step 终结为 `interrupted`；活动取消仍等待 Inbox 回报终态。Run cancel/API/Repo 定向回归 **19 passed**。
- [x] G2 文本冲突合并保护：Chat TXT/MD/CSV CAS 冲突时显示服务端最新 revision 与本地分支草稿；未修改草稿时禁用覆盖按钮，用户编辑合并内容后才可按最新 revision 创建下一版。定向 Vitest **2 passed**。
- [x] G1 Team 父子关联首切片：RunExecutor 的 `ContextVar` 将 owner/run ID 传到 Team 派工；Repo 只接受同 owner、同 host Agent 的活动父 Run，子 Run 继承 Project/Thread。普通 Run 响应不暴露父字段；新增子任务 API 与 Home 状态列表。父 Run 取消（包括等待审批和重复请求）会向直接子派工重发取消信号；同进程派工与取消通过锁顺序化，PostgreSQL 创建派工时锁定父行。RunExecutor/RunRepo/TeamManager/Run API 定向回归 **93 passed**，Home 面板 **2 passed**；PostgreSQL 与多进程 Inbox 未实机验证。
- [x] 2026-10-27 接入单进程 saved-message RunExecutor、`POST /api/runs/{run_id}/start`、执行期 owner/Agent/Thread/message 与项目/KB/文件 revision 复验、HITL run/step 关联、审批恢复后 Run/Step 收敛；Team Inbox 不由普通 worker 消费。版本漂移 fail-closed 回归证明 Harness 未被调用。取消等待审批的 Run 会结束 Run/Step 并过期 pending。验证：非 live 后端 **4,916 passed、211 skipped**；新增 Run/HITL cancel 集合 **59 passed**；Dashboard **1,486 passed**；`mypy --strict src/octop`（623 files）、Ruff `src tests`、dashboard TSC、ESLint（0 errors）、选定前端 Prettier 和 production build 成功。PostgreSQL/Provider 无环境仍未验证；RunEffect 未连入真实 Harness handler、旧 AgentVersion graph 与 G2/G5 剩余项仍未完成。
- [x] 2026-10-27 ChatFile 通用 workspace 路径隔离：共享 Agent 的 tree/glob/grep/archive 隐藏其他用户与软删除文件；legacy exact-path reads 验证 owner/deleted/SHA256；删除 draft 后尝试清除存储 revision。定向 API/archive 集合 **48 passed**；Ruff check/format（1,290 files）、strict mypy（625 files）及完整后端非 live **4,950 passed、211 skipped、0 failed** 通过。自动过期清理没有确定保留期合同，未设置推断删除策略。
- [x] 最新完整非 live 后端回归 **4,921 passed、211 skipped、0 failed**；Dashboard 全量 Vitest **279 files / 1,487 tests passed**；`npx tsc -b`、ESLint quiet、选定文件 Prettier 检查、Dashboard production build 成功；Ruff check/format（1,287 files）和 `mypy --strict src/octop`（623 files）通过。Vite chunk/dynamic import 警告保留为现有风险。
- [x] 全量 `uv run --no-sync pytest -n 4 -m "not live" -q` 复跑通过：4,902 passed、211 skipped、0 failed；Ruff check + format check（1,278 files）和 `mypy --strict src/octop`（617 source files）通过。Windows 旧 SQL 测试已显式 UTF-8，AgentManager 测试工厂补齐活动时间状态，POSIX vendor shell 测试按平台跳过，连接器顺序断言更新。
- [x] Team 父 Run 聚合收敛成功/失败/审批等待路径；子 Run 活动时父 Run 保持 lease 心跳，完成后同事务释放 lease。新增 Team dispatcher lease heartbeat 与过期收敛；Run/Team 定向集合 **105 passed**，本轮 lease fencing 专项 **5 passed**。完整后端非 live回归（lease 实现前）**4,937 passed、211 skipped、0 failed**；Dashboard **282 files / 1,498 tests passed**；最新 Ruff check + format check（1,289 files）、`mypy --strict src/octop`（624 files）通过。完整后端和 Dashboard 回归将在本轮其余改动稳定后重跑。
- [x] Dashboard 默认并行全量 Vitest 首跑有 17 failures；对失败套件作定向回归并修正 EHR 测试合同、Creations mock 参数和跨平台用例后，`npm run test -- --maxWorkers=4` 全量通过：708 suites、1,481 tests；`npx tsc -b` 通过。
- [x] 本轮全量复验：`.venv\\Scripts\\python.exe -m pytest -n 4 -m "not live" -q` 通过（4,915 passed、211 skipped、0 failed）；Dashboard `npm run test -- --maxWorkers=4` 通过（279 files、1,486 tests），`npx tsc -b`、`npm run lint -- --quiet` 通过；`mypy --strict src/octop`（622 files）、`ruff check src tests`、`ruff format --check src tests` 通过。仓库根级 Ruff 被预存 `.tmp` / demo 文件中的无关问题挡住（161 lint findings、47 files would reformat），没有改写这些文件。
- [x] 本轮修复两条 MCP cache 回归测试的 AgentManager 手动装配，显式提供默认安全策略且不跳过工具风险审批；MCP cache 与 run-effect 仓储定向回归共 8 passed。
- [x] G0 完整权限矩阵：跨用户/共享 Agent/Thread/Workbench/File/HITL/Run 权限集合 **126 passed**；另有新 Run Artifact owner/Agent/Thread 绑定和 Team cancel/restart 路径独立 API 回归。
- [ ] 剩余实现/验收：Effect ledger 尚未接入真实 Harness/provider handler；旧 AgentVersion graph、跨 Project/Run/Chat 通用 Artifact、通用 Office 成品、Deep Research/受限分析、Evaluation/Routine/Model Policy/Memory 治理仍未完成。PostgreSQL/多进程、浏览器 E2E、真实 Provider/EHR 与进程恢复/回滚演练未验证或 BLOCKED。
- [ ] 全部可实现能力完成、外部阻断项有明确验收证据后，按用户要求只在当前 `dev` 做一次本地提交，不推送。
- [x] 项目任务历史增加 Run Artifact 元数据与认证下载，复用 Run Artifacts API 和 revision 内容 URL，不复制权限逻辑；`ProjectRunsDialog` 回归 2 passed，`npx tsc -b` 与触及 TSX Prettier 检查通过。
- [x] Run Artifact API 将 `artifact_id` 统一映射为 immutable `revision_id`；同一 revision 跨 Run 返回同一 ID，旧 Run 关联行不需迁移。定向 API 回归 1 passed，覆盖跨 Run 同一身份、同 Run 重试幂等及 owner/thread 隔离。
- [x] G2.3 DOCX 垂直切片：Chat 线程内以 Markdown 创建/编辑真实 DOCX revision，下载后可由 python-docx 重开；读写转换放在线程池，限制 200k 字符/10k 行。上传 DOCX 不进入该转换器，仅在受限 FileWorker 流程解析；Chat Files API 17 passed、编辑器 Vitest 3 passed、TSC 与 strict mypy 通过。
- [x] Run 历史详情显示服务端 allowlist 投影的固定 `error_code`，中英文案来自 dashboard locale；API 不增加原始异常或事件正文。i18n 回归 80 passed，Runs/ProjectRuns 详情 UI 定向回归 8 passed，TSC 与触及 TSX Prettier 检查通过。
- [x] 项目 Run 详情对 `waiting_approval` 状态提供回到绑定 Agent/Thread Chat 的入口，保留现有人工确认流程；Run/ProjectRuns 详情 UI 回归 9 passed，i18n 80 passed，TSC、ESLint quiet、触及 TSX Prettier 与 dashboard static serving 6 passed。
- [x] RunExecutor 输入组装回归证明来源文件正文会显式标记为 untrusted data，并要求模型不得执行文件内指令；`tests/unit/test_run_executor.py` 3 passed。这只验证边界合同，不等于对抗模型评测。
- [x] 全局 Run 详情加载现有 owner-scoped effects API，按 scope 展示 requested/succeeded/failed/unknown；unknown 明确警告应先查业务系统。Runs 页面回归 6 passed，TSC、ESLint quiet 与 Prettier 通过；相关 i18n / RunExecutor 回归 83 passed；没有接外部执行器或提供自动重试。
- [x] Dashboard 本地文件的 Ant Design/JSDOM 伪元素警告仍存在。
- [x] 早期全量回归曾遇到 admission-registration 舞台壳断言失败，修正后单测 6 passed；此历史记录已被后续完整非 live 回归 **4,958 passed、211 skipped、0 failed**（2026-10-27）覆盖。
- [x] Dashboard 全量 Vitest 最新运行：280 files passed、2 files timed out，1498 passed / 3 timed out；两个超时文件以单 worker 定向复跑后 21 passed。暂不把高并行全量结果写作 PASS，最终发布门禁需再复跑。
- [x] 复核已有 PPT Studio 专用输出：只导出完整 PPTX、校验非空/包结构/大小并在下载时再次校验；`tests/unit/presentations/test_service.py` 25 passed。此路径不等于通用 Run/Chat Artifact，也不覆盖 DOCX/XLSX/PDF。
- [x] Chat 文件 revision 冲突新增有资源上限的行差异视图；单测覆盖插入/删除/对齐/限额，冲突合并 UI 组件回归共 5 passed，Dashboard TSC、触及文件 ESLint quiet 和 Prettier 通过。
- [x] Dashboard 低并发全量复跑成功：283 个测试文件、1,504 tests passed，0 failures/timeouts；耗时 835.53 秒。
- [x] 修正内嵌 Admission Registration 静态入口测试后，后端非 live 全量复跑 **4,943 passed、211 skipped、0 failed**（972.61 秒）；Ruff check/format（1,289 files）和严格 mypy（624 files）通过。
- [x] RunExecutor 项目上下文隔离增加回归：相同任务文本下两个项目的专属指令互不泄漏；test_run_executor.py **4 passed**，Ruff check/format 通过。
