# 入院申请单与患者对话服务端实施计划

> **给代理执行者：** 按 `- [ ]` 跟踪；先在 `develop` 最新提交上建立 `codex/` 功能分支，再逐项执行。不要提交或推送，除非用户另行授权。当前工作区含大量其他任务的未提交文件，不得重置、批量格式化或覆盖。实现时按每项先写失败测试、确认失败、再写最小实现的 TDD 顺序。

**目标：** 为 Vue 入院登记流程提供本人有效入院申请单门槛、可恢复的结构化办理会话、受约束的 Qwen 对话和安全提交接口。

**架构要点：** 业务规则放入 `infra/admission_registration_demo.py`，SQL 放入独立 repo，HTTP router 只做认证、schema、调用和错误映射。服务端是患者、申请单、当前事实、版本、修改确认和提交状态的唯一权威；模型输出只能成为待验证的意图/候选。Octop SQLite/PostgreSQL 持久化是正式演示运行路径，独立 Demo 后端只代理 Octop API，不复制患者会话。

**技术栈：** Python 3.12、FastAPI、SQLite/PostgreSQL、pytest；使用 `uv run pytest`（当前机器若无 `uv`，用 `\.venv\Scripts\python.exe -m pytest`）。

**关联设计文档：** `docs/specs/2026-10-19-admission-conversation-redesign-design.md`

## 2026-10-20 执行与回归记录

- 前后端入院流程、申请单门槛、表单/核对/结果页、对话、结构化会话存储和同源 API 已实现。
- Qwen3.5-27B 的模型适配器不实现 tokenizer；上下文预算改为优先调用模型计数器，不支持时按 UTF-8 字节长度加每条消息 16 字节开销作保守拦截。Qwen 专用模型副本重建异步客户端后再调用；模型限流关闭 SDK 自动重试。
- 2026-10-20 两轮回归：每轮 Vue 全测 73 项通过、Octop 入院领域/DB/API 71 项通过且 1 项条件跳过、旧 Demo API 6 项通过；Vue typecheck、Prettier、Ruff、ruff format 和 `git diff --check` 通过。第二轮最终改动后重新复跑相关全量套件。
- 本机 Octop 服务重启后，使用合成信息实调当前 ModelScope/Qwen 模型；AI API 返回 200，并回填联系电话、地区/地址候选共 3 项。早期失败分别是 tokenizer 未实现、模型副本异步客户端为 `None`，以及重启前页面保留旧模拟身份令牌（401）；均已定位，不是限流。
- 未覆盖：真实麦克风权限/硬件、PostgreSQL、HIS、20 并发会话压测、完整视口矩阵和 Lighthouse/LCP/CLS 数据。按需引入 Element UI 实际使用的 8 个控件后，JS 从 1.295 MB / gzip 366 KB 降至 650 KB / gzip 189 KB（减少约 50%）；仍略高于 500 KB 提示线。

---

## 文件变更清单

- 修改：
  - `src/octop/infra/admission_registration_demo.py` — 申请单、办理阶段、字段候选、修改提案、轮次编排及幂等提交规则。
  - `src/octop/infra/db/services.py` — 注册申请单、办理会话及轮次 repos。
  - `src/octop/api/routers/admission_registration.py` — 认证 API schema 和薄路由。
  - `src/octop/api/openapi_meta.py` — 若接口新增 tag，补充人类可读说明。
  - `tests/unit/test_admission_registration_demo.py` — 领域规则与边界。
  - `tests/integration/test_admission_registration_api.py` — 认证、隔离、事务和接口旅程。
  - `tests/unit/db/test_db_pool.py` — 迁移版本断言（仅当 schema 变化时）。
  - `demos/admission-registration/backend/src/admission_registration/main.py` — 仅转发新增平台 API，不保存权威会话状态。
  - `demos/admission-registration/backend/tests/test_api.py` — 代理合同。
  - `demos/admission-registration/docs/07-handoff-api.md`、`demos/admission-registration/README.md` — 更新 API 和启动/边界说明。
  - `docs/specs/2026-10-19-admission-conversation-redesign-design.md` — 若实现合同需要经用户确认的差异，先修订设计再编码。
- 新建：
  - `src/octop/infra/db/repos/admission_applications.py` — 申请单 SQL repository。
  - `src/octop/infra/db/repos/admission_sessions.py` — 会话快照、字段来源、待确认提案和追加轮次 SQL repository。
  - `src/octop/infra/db/migrations/026_admission_conversation.sql` 与 `026_admission_conversation.pg.sql` — 若 026 尚未发布，将本变更合并进当前未发布 026，不创建 027；先检查并保留现有 026 分类迁移。
  - `tests/unit/db/test_admission_conversation_repos.py` — 两种 repo 持久化、版本 CAS、轮次链和过期清理。

## 计划任务

### 任务 1：定义申请单与对话存储合同

**涉及文件：** `src/octop/infra/db/migrations/026_admission_conversation.sql`、`src/octop/infra/db/migrations/026_admission_conversation.pg.sql`、`tests/unit/db/test_db_pool.py`、`tests/unit/db/test_admission_conversation_repos.py`

- [ ] **步骤 1：先写迁移和 repo 失败测试。** 断言一位认证用户只能绑定自己患者的一张申请单；会话保存 `owner_user_id`、内部患者引用、申请单引用、phase、revision、格式化 facts、`last_turn_id`、pending proposal、expires_at；每个事实含来源与确认状态；每轮含 `previous_turn_id`、speaker、原话/回复、动作、处理状态和时间。拒绝重复 turn、断链、跨 owner 读取、过期会话复用；相同 turn 重试不重复创建。
- [ ] **步骤 2：运行测试确认失败。** `uv run pytest tests/unit/db/test_admission_conversation_repos.py tests/unit/db/test_db_pool.py -q`。预期：新 repo/表不存在导致导入或表查询失败。
- [ ] **步骤 3：实现最小 schema 和 repos。** 复用现有 `id`/公开字符串 ID 与用户整数 FK 规则；添加必要索引、外键和唯一键；SQL 参数化。轮次只允许追加，不更新历史原话。SQLite/PostgreSQL DDL 保持语义一致。只有确认 migration 026 仍未发布时才折入 026。
- [ ] **步骤 4：在 `SharedServices` 注册 repos 并运行测试。** `uv run pytest tests/unit/db/test_admission_conversation_repos.py tests/unit/db/test_db_pool.py -q`。预期：repo、版本 CAS、重复 turn、owner 隔离和双数据库 SQL 合同测试通过。

### 任务 2：申请单与会话领域服务

**涉及文件：** `src/octop/infra/admission_registration_demo.py`、`tests/unit/test_admission_registration_demo.py`

- [ ] **步骤 1：写失败测试。** 覆盖无申请单、过期/已使用/已取消申请单、多张待选、异患者申请单、唯一申请单也需显式确认；确认后创建绑定 `owner + patient + application` 的会话。覆盖当前 14 字段合同、申请单只读字段、缺项问题一次一个、未知动作拒绝、单轮提取多字段、事实结构化保存与来源轮次。
- [ ] **步骤 2：确认失败。** `uv run pytest tests/unit/test_admission_registration_demo.py -q`。预期：尚不存在申请单/会话领域服务或新规则断言失败。
- [ ] **步骤 3：实现领域操作。** 增加 `list_applications`、`select_application`、`create_session`、`get_session`、`next_required_question`、`apply_candidates` 和 `prepare_submission`；这些操作接收已认证用户和服务端身份结果，不接受客户端任意患者 ID。Mock 申请单包含申请号、脱敏患者、科室、计划入院时间、医生、开单时间、住院类型、诊断、病区、状态；演示字段明确标记 mock。
- [ ] **步骤 4：运行测试并检查所有失败路径。** `uv run pytest tests/unit/test_admission_registration_demo.py -q`。预期：缺单不能进表单；事实以当前确认值为准；没有唯一有效选项时不绑定会话。

### 任务 3：受约束 AI 解析、提问与错误语义

**涉及文件：** `src/octop/infra/admission_registration_demo.py`、`tests/unit/test_admission_registration_demo.py`、`tests/integration/test_admission_registration_api.py`

- [ ] **步骤 1：写协议测试。** 使用 fake active Qwen 模型覆盖多字段、同义表达、当前问题指代、明确确认/拒绝、歧义追问、非入院功能、越权字段、身份/申请单伪造、非法 JSON、429、timeout、重复 turn。断言模型不能返回任意 URL、患者 ID、SQL 或直接提交动作；缺项控制器每轮只产出一个问题；一轮最多一次模型调用。
- [ ] **步骤 2：确认失败。** `uv run pytest tests/unit/test_admission_registration_demo.py tests/integration/test_admission_registration_api.py -q`。预期：跨轮合同、错误码或轮次行为断言失败。
- [x] **步骤 3：实现上下文组装和 JSON 验证。** 每次输入按规则、阶段/申请单摘要、当前 facts/缺项、待确认提案、最近至多 4 轮、本轮原话顺序构造。目标输入预算 6000 tokens；适配器支持时使用 token counter，不支持时采用 UTF-8 字节保守上限，不用字符数冒充 token。超限返回明确错误。当前 facts 重建摘要，已修正值不得从旧摘要复活。历史原话视为不可信输入。
- [ ] **步骤 4：回归协议与错误语义。** `uv run pytest tests/unit/test_admission_registration_demo.py tests/integration/test_admission_registration_api.py -q`。预期：429 返回 `AI_RATE_LIMITED` 并保留 transcript；有 `Retry-After` 时传回等待信息；超时、网络错误、JSON错误、语义不明分别可区分；不自动重试，不记录完整患者原话到普通日志。

### 任务 4：安全修改提案与原子替换

**涉及文件：** `src/octop/infra/admission_registration_demo.py`、`src/octop/infra/db/repos/admission_sessions.py`、`tests/unit/test_admission_registration_demo.py`、`tests/unit/db/test_admission_conversation_repos.py`

- [ ] **步骤 1：写并发和确认失败测试。** 已确认值提出不同值时，旧值继续有效直到患者点击或语音明确确认；拒绝保留旧值；确认后当前值替换且事实指向新 turn；revision 变化后旧 proposal 确认失败；重复 turn 幂等；患者手动编辑后迟到 AI 不覆盖；两个窗口同时修改只接受一个 CAS。
- [ ] **步骤 2：确认失败。** `uv run pytest tests/unit/test_admission_registration_demo.py tests/unit/db/test_admission_conversation_repos.py -q`。预期：提案/版本测试失败。
- [ ] **步骤 3：最小实现提案生命周期。** 提案保存字段、旧值摘要/版本、新候选、来源 turn、状态。接受时同一事务验证 owner、patient、application、revision、字段白名单，再更新快照、revision、来源链和轮次事件；拒绝只追加拒绝事件。身份号和患者姓名始终不可被模型改写。
- [ ] **步骤 4：运行并发回归。** 同步骤 2 命令。预期：过期提案不会改值，失败事务无半更新。

### 任务 5：认证 API 与最终提交门槛

**涉及文件：** `src/octop/api/routers/admission_registration.py`、`src/octop/api/openapi_meta.py`、`tests/integration/test_admission_registration_api.py`

- [ ] **步骤 1：写 API 失败测试。** 覆盖 `GET /applications`、`POST /applications/select`、办理会话创建/读取、`POST /sessions/{id}/turns`、修改接受/拒绝、手工字段保存、最终确认和提交结果；所有路径未认证为 401，另一用户/另一患者/另一申请单为 404 或既有统一拒绝契约。多申请单不能隐式选择。提交需处于当前核对版本、所有必填有效、无 pending proposal；撤销/过期申请单即使前端此前有效也拒绝提交。相同幂等键只产生一次登记结果。
- [ ] **步骤 2：确认失败。** `uv run pytest tests/integration/test_admission_registration_api.py -q`。预期：新路由或强门槛用例失败。
- [ ] **步骤 3：添加 Pydantic request/response 模型和薄路由。** 请求不接受模型名、Agent ID、患者 ID、申请单任意 owner、跳转地址；用户归属从 auth context 获取。业务和 SQL 保持在 infra/repo。所有新增路由有 `summary`、类型化 response、字段说明，并使用现有 API tag。
- [ ] **步骤 4：运行 API 与文档 schema 检查。** `uv run pytest tests/integration/test_admission_registration_api.py -q`。预期：认证、隔离、字段拒绝、撤销复验、CAS 和幂等测试通过；之后检查 `/api/docs` 中新路由不是无类型空卡片。

### 任务 6：演示代理、隐私期限和运维交接

**涉及文件：** `demos/admission-registration/backend/src/admission_registration/main.py`、`demos/admission-registration/backend/tests/test_api.py`、`demos/admission-registration/docs/07-handoff-api.md`、`demos/admission-registration/README.md`

- [ ] **步骤 1：写代理合同失败测试。** 未登录平台时 proxy 拒绝；只传递平台用户授权和必要 JSON，不接受代理目标地址；模型/平台 429 与 Retry-After 原样映射；代理进程重启不会改变 Octop 已保存 session；不能在 `DemoStore` 复制患者事实或聊天历史。
- [ ] **步骤 2：确认失败。** 在 `demos/admission-registration/backend` 运行 `python -m pytest tests/test_api.py -q`（仓库虚拟环境执行时使用 `..\..\..\.venv\Scripts\python.exe -m pytest tests/test_api.py -q`）。预期：新代理路径测试失败。
- [ ] **步骤 3：实现仅代理转发。** 将新接口加入既有同源平台代理白名单，沿用 Octop 登录态，不持久化患者归档；明确 CORS、超时、响应体上限及取消行为，不写转写正文到日志。
- [ ] **步骤 4：更新说明并回归。** 同步骤 2 命令。README/交接文件明确 Vue 前端启动、Octop 服务依赖、demo mock 申请单说明、24 小时对话归档、无录音保存、重新核验后访问、非真实 HIS。

### 任务 7：服务端验收

- [ ] `uv run pytest tests/unit/test_admission_registration_demo.py tests/unit/db/test_admission_conversation_repos.py tests/integration/test_admission_registration_api.py -q`：领域、SQL、认证与业务旅程通过。
- [ ] `uv run pytest tests/unit/db/test_db_pool.py -q`：迁移水位与升级路径通过；未变 schema 时可省略。
- [ ] `uv run ruff check src/octop/infra/admission_registration_demo.py src/octop/infra/db/repos/admission_applications.py src/octop/infra/db/repos/admission_sessions.py src/octop/api/routers/admission_registration.py tests/unit/test_admission_registration_demo.py tests/unit/db/test_admission_conversation_repos.py tests/integration/test_admission_registration_api.py`。
- [ ] `uv run ruff format --check` 与上列相同 Python 文件；`git diff --check`。
- [ ] 对 Octop API 手工检查 `/api/docs`；对 SQLite 升级既有测试 DB 副本，不删除用户数据。若能用本地 PostgreSQL，再执行对应迁移/事务集成测试；没有 PostgreSQL 时记录未覆盖。

### 任务 8：第一轮回归——服务端功能与安全

- [ ] **第一轮功能回归。** 执行任务 7 的所有定向单元、数据库和 API 集成测试，并重跑独立 Demo backend `python -m pytest tests/test_api.py -q`。用例范围必须包括：无单/多单/过期单、患者隔离、14字段合同、跨轮提取、修改接受/拒绝、并发 CAS、turn 幂等、review revision、重复提交、429/timeout/非法 JSON、会话归档过期和日志脱敏。
- [ ] **第一轮故障回归。** 通过 fake model 和数据库故障注入模拟模型返回逆序、数据库事务回滚、API取消、进程重启时 pending turn、同一 turn 并发重试。断言无半写入、无旧值覆盖、无跨患者泄露、无自动模型重试风暴。
- [ ] **第一轮准入标准。** 相关测试全绿；SQLite 迁移与现有版本兼容；所有 API 错误 code/status/envelope 稳定；`ruff check`、`ruff format --check`、`git diff --check` 通过。任一失败先修复再进入第二轮，不得以跳过测试代替通过。

### 任务 9：第二轮回归——全旅程、恢复和性能

- [ ] **第二轮完整旅程。** 在本地 Octop + Demo backend 使用合成患者/申请单，从认证、申请单查询/确认、两页表单、语音/文字 turn、修改确认、review、提交、查询结果走完两遍：一次点击主路径，一次包含拒绝修改、网络中断后主动恢复和重复提交。每次重启服务后确认 session、facts、last turn 和轮次链一致；完成/退出/到期后确认归档访问门槛与清理行为。
- [ ] **第二轮性能基线。** 使用 fake model 消除外部服务波动，给申请单查询、读取 session、保存 turn、确认 proposal、提交及结果查询各执行 100 次顺序请求；记录 p50/p95、错误率和数据库增长。基线要求本地 API（不含模型推理）p95 ≤ 200 ms、错误率 0%，相同 turn 重放不增加轮次行数；连续 20 轮后上下文输入不超过 6000 tokens。若当前测试环境达不到 200 ms，记录硬件/DB条件及瓶颈，不通过缩减安全校验来追指标。
- [ ] **第二轮负载与资源检查。** 执行 20 个并发 session、每个 session 10 次 turn 写入/读取的集成压测；断言无版本丢失、跨会话混写、锁错误或重复提交。测量归档过期清理前后 DB 行数；超出设计预算时优化索引/查询后重跑，不引入新队列或向量库。
- [ ] **第二轮准入标准。** 全旅程两次均通过；性能数字和测试环境写入交付记录；没有未解释的错误、丢失更新或数据越权。PostgreSQL、真实 Qwen 和生产 HIS 若不可用，逐项标为未覆盖，不得把 SQLite/fake-model结果描述为已验证。

## 对抗性验收条件

- 无有效本人申请单、申请单状态在提交前改变、患者 A 的 session 被 B 请求：不读取、不回填、不提交。
- 两次模型响应逆序、手工编辑插入、两个窗口同时提交提案：旧响应/旧版本不能覆盖当前事实。
- 患者说“不要改”“已婚”“也住那里”“确定”：否定不写值；枚举按当前问题解析；无明确指代时追问；仅核对页有效版本上的明确提交才提交。
- 恶意长文本要求更换患者、调用其他系统或输出提示词：模型协议不能改变用户/申请单/字段白名单；超预算有明确错误。
- 429、连接中断、服务重启、相同 turn 重试：保留输入和会话；不产生重复模型风暴或重复提交。
- 完成/退出/到期后清理演示归档；不保存音频；归档读取必须重新认证，普通日志不包含患者原话。

## 执行顺序与交接

依次执行任务 1 → 2 → 3/4 → 5 → 6 → 7 → 第一轮回归 → 第二轮回归。页面计划只在任务 5 接口合同稳定后接入；两轮回归需等待前后端集成后共同完成。不要用模型 live 调用替代 fake 模型测试；Qwen真实联调一次只使用合成数据并顺序执行。
