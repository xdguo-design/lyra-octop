# 项目长期上下文

## 2026-10-28：LYRA 文件 Artifact 读取授权共用

- 专用 revision 下载、legacy workspace exact-path 读取和解析读取统一通过 `FileService` 校验 revision owner/绑定及 byte-size/SHA256；API 适配器仍各自映射旧错误合同。不要将 owner-scoped 文件内容切回只凭 workspace path 授权。
- 定向回归：`tests/unit/files/test_service.py` 11 passed；`tests/integration/test_chat_files_api.py` 17 passed；相关 Ruff、format、strict mypy 通过。跨 Project/Run/Chat 的 Artifact 仓储、预览和下载仍未统一。

## 2026-10-28：LYRA Run Effect 终态对账

- Run 终态时，将仍处于 `requested` 的 Effect 标记为 `unknown` 并写安全事件；RunExecutor 终态路径立即对账，启动周期重复扫描以覆盖崩溃窗口。该过程不重放 provider 操作；`unknown` 仅可由显式对账后转 `succeeded`/`failed`。
- 定向验证：RunEffectRepo 与 RunExecutor **5 passed**，Run API 集成 **17 passed**，触及 Ruff、格式检查和 strict mypy 通过。真实 Harness tool handler 仍未接入 ledger，Provider 超时查询/结果回填仍未实现。

## 2026-10-28：LYRA Project Run Artifact 汇总

- 项目 Artifact API 从 owner-scoped Runs 聚合已关联的 ChatFile revisions，按 `revision_id` 稳定去重并复用 Chat/Run 的认证下载 URL；只涵盖 Run 已登记的 revision，不能视作任意 Chat/Project 文件的通用仓储。查询会重验 File owner、Agent、Thread 与 revision 绑定。
- 定向验收：Run Artifact 集成 **1 passed**（含跨 Run 去重、URL 一致、错绑 Thread 隐藏），Project Runs UI **3 passed**，Dashboard `npx tsc -b` 成功，i18n **80 passed**，Ruff、Prettier、strict mypy 通过。

## 2026-10-27：LYRA 线程内 DOCX 文本 Artifact

- Chat 文件 API 可把 Markdown 创建/修订为有效 DOCX，并以同一 revision 的 Markdown 读回；转换复用 `infra/utils/doc_edit.py`，读写均在线程池执行。快速编辑只接受 `origin_kind=generated`，上传 DOCX 仍由受限 FileWorker 解析，避免将不可信 ZIP/XML 直接交给编辑转换器。
- DOCX 转换限 200,000 个字符与 10,000 行，并校验 XML 不允许的控制码；超限返回双语 `DOCUMENT_CONVERSION_LIMIT`。生成内容通过既有 ChatFile revision、CAS、SHA256 和 owner/thread 授权。DOCX 为 Markdown 的简化呈现，不保留页面布局、图片等复杂排版。

## 2026-10-26：Team Inbox 与 Run 审计映射

- 每个 Harness `job_id` 唯一映射到 owner-scoped Run/Step。派工前先让 Harness 解析主持人/成员授权，再持久化 queued 状态，之后才提交同一 job ID；没有原始任务 prompt 入事件。
- RunRepo 对状态更新以事务 + version CAS 写审计事件；同用户回调幂等，跨用户不可见；排队失败记录固定 `team_member_failed`，成员成功/失败/取消/中断映射为终态，避免将未可信异常或 prompt 写入摘要。
- 当前每个 inbox 是独立 Run；并发冲突终态回调由事务保障只有一个获胜，已有 SQLite 仓储竞态测试；还没有 Team 父级聚合、取消主动传播、重启恢复或端到端成员并行/乱序回调验证。取消 Run 的终态需要 Harness 实际回调确认，不能把 cancel_requested 伪报为已停止。

## 2026-10-26：HITL 审批审计

- 现有 HITL 暂停由 `HitlChannelCoordinator` 统一登记/决策；待办的工具请求参数用安装级 Fernet key 加密存入 `hitl_approvals`，不写明文审计；终态决定与 `tool_approval.decision` 同事务 CAS 写入，并清空终态加密参数。Coordinator 重建后可按用户/Agent/Thread/session 恢复仍有效待办，Team 成员 pause 保存成员 Agent/Thread 恢复目标。非持久 Coordinator 保持旧 resume 失败重试合同；持久路径先提交决定再恢复，crash 后不盲目重放。
- 审计与未过期 pending 可跨进程从 DB 查询/恢复；Harness checkpoint 单独持久化。持久决定以 CAS 抢占，只有胜者可恢复图，败者不得调用 Harness；终态会清空密文。若进程在决定提交后、图恢复前崩溃，状态保持 terminal 且不自动重放，因此仍可能需要人工对账。工具 read/write/external-send 分类和高风险强制审批已接入；RunEffectRepo 在执行写入前绑定 owner Run/Step、scope 与同一 Agent/Thread 的 owner approval。HITL 请求本身仍未写入 Run ID 或资源 scope，Run executor 未接通前不得声称端到端关联完成。审计记录不得被当成执行队列。
- Dashboard HITL resume 必须先通过用户+Agent+Thread 所有权校验，并要求同一用户、Agent、Thread 的唯一 pending 或通过 pending_id 精确选中的待办；不允许因 pending 缺失或多个待办歧义就直接用客户端 thread_id/decisions 调用 Harness。Harness checkpoint 与待办元数据可恢复；RunEffectRepo 提供 owner-scoped 幂等写入台账并支持 unknown 对账，但尚未接到 Harness executor，approved 仍不代表副作用成功，崩溃后不自动重放。

## 2026-10-26：文件解析来源定位升级

- 聊天附件解析已将 XLSX 引用定位到具体 sheet/cell。解析合同含 `file_id/revision_id/parser_version/content_hash/locator/coverage`；解析器版本提升后，读取旧 revision 会以已读 parser version 做 CAS 原子替换 segment，重复或过期 worker 不得覆盖较新结果。
- 当前解析仍受输入字节、单元格、字符和 segment 上限约束；XLSX 公式使用 `data_only=True`，没有缓存值时不声称获得公式结果。OCR/视频抽帧仍按真实能力报告。
- 解析 revision 状态区分 stored、processing、ready、partial、needs_ocr、unsupported、failed；processing lease 60 秒，过期读取面显示可重试 stored。解析失败与不支持格式使用不同 API 错误。当前按请求同步解析，不伪报 queued；没有跨平台 OS 级内存硬限。
- 原始 revision SHA256 校验失败时，以 parse_version CAS 清空 locator segments 与 coverage 并标记 failed；迟到 parser 在 failed 状态不能提交，防止旧提取文本继续从 segments/search 路径返回。
- 线程内 TXT/MD/CSV 新建和编辑复用 `chat_files/chat_file_revisions`，原始 revision 不变；编辑使用 `base_revision_id` CAS，输掉并发的 draft 仍作为旧 revision 的子分支保留，409 `details.revision_id` 可定位该分支。此路径还未统一 Project/Run artifacts，也没有差异合并 UI。
- 文件详情 revision 下载使用专用 `/files/{file_id}/revisions/{revision_id}/content` 路由；先校验当前用户拥有该文件、revision 属于文件，再读取 workspace bytes 并检查 SHA256。不要给 owner-scoped Artifact 返回通用 workspace path 下载 URL，否则共享 Agent 用户可能绕过 file owner 检查。
- Chat TXT/MD/CSV 编辑器读取当前线程 revision 使用 `/files/{file_id}/revisions/{revision_id}/text?thread_id=…`；该入口也必须核验 user/Agent/Thread/file/revision 与 SHA256，不能用通用 workspace read 替代。冲突时保留本地 draft 与分支 revision，只有用户显式选择后才基于最新 revision 重试。

## 2026-10-26：Workbench 项目指令与 Run 上下文快照

- 项目指令保存 `instructions_revision`，更新必须提供 `expected_revision` 并以 CAS 拒绝旧写入。创建 Run 时快照当前指令 revision/内容和项目绑定的 KB IDs；快照不会因后续项目修改而变化。
- Run 创建前按当前用户重新校验所有绑定知识库可见性。Run 创建时同时捕获 schema_version=1 的规范化 Agent 配置快照，以 Fernet 加密保存并校验 SHA-256；内容相同复用不可变版本，`current` alias 指向最新版本，Run 固定 `agent_version_id`。创建时有效 capability grant 也保存为只审计快照；未来执行器仍必须在读取资料时重新验权。
- Run 可显式引用最多 50 个来源文件 revision，按用户/Agent/Thread 三重绑定重验后快照 thread_id、revision、SHA256、MIME、size；不保存文件正文或宿主路径。执行器读取文件时仍须即时验权。
- Home 项目菜单提供项目指令编辑；快速切换项目时旧响应按序号丢弃，避免跨项目内容覆盖；保存携带当前读取到的 revision。

## 2026-10-26：通用 Run/Step/Event 持久化首切片

- GAP-003 首切片新增 `/api/runs` 的创建、列表、详情、steps 和有序 events 读取；只创建 `created` 持久记录，不启动执行器。Run/Step 状态转换带 version 乐观锁；failed/interrupted Step 重试时增加 attempt。
- Migration 031 SQLite/PostgreSQL 双版本创建 `runs`、`run_steps`、`run_events`。Run 按 owner 隔离；`Idempotency-Key` 在 owner 范围唯一且按请求哈希拒绝异请求复用；项目创建只接受当前用户拥有的工作台项目。`input_ref` 是不含原始 prompt 的不透明引用，执行器读取前必须重新验权。
- 每 Run 事件序号上限为 100,000；达到上限的状态迁移会整体回滚。SQLite 同版本并发迁移由 CAS 验证单一胜者；PostgreSQL 竞争行为仍需目标环境验证。
- `POST /api/runs/{run_id}/cancel` 对未启动任务写 `cancelled`，对 queued/running/waiting_approval 写 `cancel_requested`；重复请求幂等。当前没有 Run 执行器，所以该状态不代表实际协程/Team 已停止；外部副作用也不可由取消回滚。
- RunRepo 提供 executor-instance 原子 claim、300 秒以内心跳租约和 1 小时最大运行预算；租约过期将 Run/活动 Step 标为 interrupted 并写事件，不自动重排，以免未知外部副作用被重复执行。当前没有消费队列/运行 Harness 的执行器，取消尚不能强停；PostgreSQL SKIP LOCKED/迁移竞争需环境验证。
- Home 项目菜单的任务记录视图只读 Run/Step/Event 服务端状态；在执行器和 Task step 尚未创建前保持真实空列表/created 状态，不模拟进度。
- 验证：Run/P0/i18n/OpenAPI 定向回归 30 passed；`test_db_pool.py` 20 passed、1 skipped；涉及 Python 文件 Ruff 与 strict mypy 通过。未验证真实 PostgreSQL，也未接 Team、审批、worker 或跨重启恢复。

## 2026-10-27：G3 mock capability contract

- 增加 owner-scoped mock AppRegistration / CapabilityGrant，read/write scopes 分开，grant 可过期和撤销，app 停用会在每次授权检查时立即拒绝；仅允许内置 admission-registration scope，不接受任意 URL 或 provider 凭据。
- 真实 EHR/Provider 隔离环境当前不可用。mock repo/API 和 SQLite migration 可测试，但不能据此宣称外部业务读写、审批关联、幂等副作用或超时对账已交付；这些验收在计划中标记 BLOCKED。

## 2026-10-27：Run capability scope audit snapshot

- Run 创建时快照当时有效且启用 app 的 grant ID、app key、registration ID、expiry 与 read/write scopes；过期、撤销或停用 grant 不进入新 Run 快照，幂等重放保留既有快照。Dashboard 详情显示该信息并标注仅审计用途。
- 此快照不是授权凭证；任何未来 Run executor / ContextAssembler 在每次能力读取或写入前必须按当前 owner/agent/scope/expiry/app-enabled 状态重新验权。撤权不得被既有 Run 快照绕过。

## 2026-10-27：Run external effect ledger

- 未发布 schema 032 增加 `runs.capability_scopes_json` 和 owner-scoped `run_effects`；启动修复会为已到当前版本但缺列/表的 SQLite/PostgreSQL 数据库幂等补齐。不要修改已发版迁移；当前未发布 schema 增量继续折入 032。
- `RunEffectRepo.request` 只允许 owner/agent 匹配且处于 running 的 Run/Step，并在写前检查当前启用 app 的 write grant 与 owner 已批准、未过期 HITL 记录。外部幂等键按 registration 唯一；重用时请求/资源/审批身份必须一致。只存 SHA-256 和安全元数据，不落请求正文或业务资源。
- 状态先写 `requested`；崩溃或超时不能安全重试时应保留/转为 `unknown`，仅可显式对账到 `succeeded`/`failed`。这只是 executor 可用的台账合同，当前没有 Harness Run executor 调用它，因此不能推断外部写入已发生或成功。

## 2026-10-27：高风险工具强制审批

- 内置工具、插件工具和运行时 MCP 使用保守风险分类：只将明确只读工具视为 read，已知外发动作及读取环境变量（可能将密钥暴露给模型）标为 external_send，其余（包括未知 MCP）按 write 处理。write/external_send 在 Harness 编译工具图前加入 HITL；本会话 allow-all/allow-tools 不能跳过强制审批，已有工具 `when` 条件继续保留。
- 全局 HITL 默认关闭仍保持不变，但风险写入单独强制审批；因此配置未启用 HITL 的旧实例首次使用写工具时会出现审批中断。HITL API 覆盖批准/拒绝入口；RunEffectRepo 仅提供预留记录、哈希、授权复核和对账状态机，不代表工具已经执行或外部服务已成功。副作用台账与 Harness executor / Provider 调用仍未集成。
- Dashboard 的 allow-all/allow-tools 会话自动恢复也仅对明确只读工具生效；高风险待办不再显示可记住策略的 Allow 菜单，必须逐次人工决定。前端分类保持保守：未知工具不允许自动恢复。
- Agent 在 Harness 注册后仍需完成 MCP 注入和强制审批策略编译；AgentManager 的 delivery entry 会等待该启动阶段完成，避免并发首轮对话抢在 HITL 策略安装前调用工具。
- `tool_execution_may_pause()` / `GET /api/settings/hitl.show_approval_ui` 必须告知前端/CLI/Slash 始终可能出现审批，因为高风险写工具默认强制 HITL；管理员关闭全局 HITL 仍只关闭非强制的通用审批，不改变强制审批。
- Run Events API 对持久化 payload 按 allowlist 投影；Step 失败摘要仅允许固定错误码，避免把 prompt、患者数据、凭据、异常文本或未来误加的嵌套字段回传。该投影不会让 Run 记录具备执行能力。

## 2026-10-26：PPT 建稿前对话连续性

- PPT 工作台对话在作品创建前按用户与专家保存为草稿日志；重进工作台且暂无作品时恢复该日志。首次创建作品后将草稿日志迁移到作品对话并删除草稿键；模型或动作执行错误也保留该轮内容。
- 合稿时大纲解析失败显示大纲错误（原先被误标为 SVG 错误）；大纲、SVG 结构/安全校验失败均最多自动重试一次，校验白名单不放宽。
- 不新增数据库表，继续使用 settings KV。对话仍按最近 60 条有界保留；不同用户/专家的草稿隔离。

## 2026-10-26：PPT 制作工作台完成首版

- Octop「创作」增加正式 PPT 工作台：作品按用户和专家隔离、复用所选专家模型；提供大纲生成、逐页 SVG 生成/修改、编辑预览、恢复进度与 PPTX 下载。文档与运行方式见 `docs/ppt-studio.md`；实施计划见 `docs/specs/plans/2026-10-24-ppt-workbench.md`。
- 持久化复用 settings KV 和 revision CAS，不新增数据库表。模型任务逐页 checkpoint；SVG 使用受限白名单解析；PPT Master 固定 commit `0396656f4f5c28ba8096e8339716c338a576996c`，仅在临时目录处理已校验 SVG。导出产物写专家工作区。
- 导出改用 `AgentManager.workspace_for_agent()`，停止状态的专家也可从其持久工作区导出。安装器在本机 Octop 数据目录安装运行时；真实导出成功，生成并验证 16,840 字节 PPTX。
- 验证：后端单元 27 项、API 集成 3 项、前端 6 项、i18n 80 项通过；PPT 相关 Ruff、mypy、TypeScript、ESLint 与生产构建通过。全仓 `make all` 未执行以免改写其他未提交改动；未做真实模型内容生成和远端部署。

## 2026-10-24：PPT 工作室范围与页面预览

- 用户指定围绕 `hugohe3/ppt-master` 建设专用 PPT 制作页，首版范围为大纲、逐页修改、预览和 PPTX 下载。随后要求先看页面；尚未批准正式架构或选定视觉方向。
- 一次性原型在 `dashboard/prototypes/ppt-studio/index.html`，包含 A 三栏制作、B 大纲总览、C 沉浸画布，通过 URL `?variant=A|B|C` 和底部切换器选择。原型用内存示例，AI 修改为本地规则演示，导出入口仅说明，刷新重置；不可当作正式功能已完成。
- 原型用仓库官方 Logo，无新增依赖、生产路由或数据库变更。启动命令见同目录 `NOTES.md`；本次预览地址 `http://127.0.0.1:8767/`，三方向截图为 `preview-{A,B,C}.png`。后续按用户选定方向实施时，需保留原型与真实生成能力的区分。

## 2026-10-23：工作台深度思考开关

- 工作台模型选择弹层持续显示当前服务商的模型；点服务商标题可从相邻菜单切换服务商，菜单底部进入模型管理。配置了 reasoning efforts 的模型用横向滑块展示所有离散档位，调整档位会启用推理并保存到会话；只有开关能力的模型用“关闭/开启”两档滑块。OpenCode 不显示这些推理控件。

## 2026-10-23：平台/团队专用 Agent 的聊天可见性

- Agent 使用持久化的 `chat_visible` 元数据控制是否出现在主对话侧栏与选择器中；该标记不改变 Agent 的启停、共享权限或团队内部可调用性。专家管理页始终保留该 Agent，可由所有者或管理员恢复显示。
- 新增字段折入当时未发布的 migration 029（SQLite/PostgreSQL 双版本），默认可见以兼容已有 Agent。

## 2026-10-23：专家头像预设

- 专家编辑/创建抽屉只提供油画头像预设和自定义图片上传，不展示 Lucide 备选图标。预设选择先在表单预览，保存时持久化 `icon_name`；如原有自定义头像图片，保存后清除图片以显示所选头像。团队头像入口保持原行为。
- 专家头像共有十二张经典油画风格生成头像（`painting-*`）；JPEG 资源缩至 512px 后随前端打包，保存在 `icon_name` 中并在专家列表与聊天头像共用渲染。

## 2026-10-23：工作台文件夹回收站

- 首页项目下的文件夹删除改为移入回收站：保留文件夹记录与任务归属，回收站列表提供恢复；回收期间禁止将新任务归入该文件夹。回收站仅展示当前用户数据，项目删除时沿用已有级联清理。
- 空白首页输入区底部收紧内边距、控制间距和下边距以节省高度。模型选择器继续在控制栏保留；源码中没有独立的输入区顶部模型重复标签，因此未移除附件行。

## 2026-10-22：创作页 GitHub 项目 Docker 启动

- 用户将 GitHub 项目启动范围从单个受信任本地 profile 扩展为所有已登记仓库。仅管理员能启动；Octop 将仓库浅克隆到 `~/.octop/projects/github/` 的条目专属目录，只构建根目录 Dockerfile，并要求数值 TCP `EXPOSE` 端口。镜像不自动更新；Compose 和多端口仓库暂不支持。远程部署配置 `OCTOP_WORKBENCH_PREVIEW_DOMAIN` 和 wildcard DNS/TLS/Nginx，预览走独立随机子域名，容器端口仍仅绑定 loopback。
- 容器端口仅绑定 loopback；运行时限制 1 GiB 内存、2 CPU、256 进程，drop capabilities 并启用 no-new-privileges。仓库 Dockerfile 在镜像构建时执行，管理员必须信任仓库；Octop 主机需要 Git 与 Docker daemon。停止会保留容器数据和代码，删除/改 URL 会停服务但保留文件。
- 详细规格：`docs/specs/2026-10-22-github-docker-preview.md`。测试用模拟 Docker 命令验证克隆、构建、启动/停止；真实 Docker 启动需在安装 Docker 的 Octop 主机验证。

## 2026-10-22：OpenCode ACP 同机部署

- Octop 与 OpenCode 首期部署在同一台 Linux 服务器；ACP 页面用管理员操作调用 OpenCode 官方 v2 安装脚本，以 Octop 服务账户安装并自动启用其 ACP Runner（`opencode acp`）。不需要 SSH 或 sudo。模型发现读取同一服务账户的 OpenCode 凭据，尚需该账户完成一次 OpenCode 登录。

## 2026-10-22：登记对话回复的播放按钮

- 所有助手回复的小喇叭须落在所属消息卡片内，不额外占一列；“患者信息填写”与必填进度同排，带标题回复放标题右侧，普通回复放卡片右上角。固定 320px 外框下检查不横向溢出。

## 2026-10-22：嵌入登记页部署须包含动态校验分片

- 主 JS 会动态导入 `validation-qwrx2ErE.js`；此前只同步入口/主 JS/CSS，漏掉此分片。缺失资源被 Octop SPA fallback 以 HTTP 200、`text/html` 返回，单查状态码无法发现故障。
- 已补齐缺失分片；该构建全部 7 个静态资源经 HTTPS 字节比对通过，JS MIME 正确，无头 Edge 实际动态 import 成功并返回校验函数导出。以后前端部署须清点完整构建依赖、先上传资源再替换入口，同时验证内容与 MIME；保留旧哈希资源供已打开页面使用。

## 2026-10-22：入院登记字段提取 503 的执行步数上限

- 线上候选接口 502 的实际上游为 `/api/admission-demo/extract` 503；提供商探测正常。真实 Agent 对照证明：一次模型响应、零次工具调用的正常流程需要 13 个 LangGraph 节点，旧 `max_iters=12` 在最后收尾前触发 `GraphRecursionError`，并非模型工具循环。
- 专用 Agent 的图执行上限改为 32；原有 30 秒模型超时、20 轮办理门禁和模型输出上限保持不变。初始化会同步修正已有 Agent 配置，保留其模型绑定。不要把图步数等同于模型调用次数。
- 已窄部署 `/root/.octop/venv/lib/python3.12/site-packages/octop/infra/admission_demo.py` 并重启 `octop`；备份后缀为 `.bak-codex-20261022-023628`，HTTPS 健康检查通过。相关 51 项单元/API测试和两文件 Ruff 检查通过；部署后合成会话 + 真实模型 + 两页提取/候选 HTTP 链路返回 200、5/5 必填字段、完整手机号，未覆盖生产认证或重放患者资料。
- 模型输入的全局 PII 保护仍会遮挡手机号；现有候选校验已允许从原话唯一且不属于联系人的有效号码恢复电话，应保留此回填与全局密钥/PII保护。

## 2026-10-22：入院登记首次麦克风请求部署

- 线上旧 `app.html` 仍引用先等待 `/voice/active` 再请求麦克风的脚本；首次按住会丢失浏览器用户手势激活。部署了本地已验证的前端入口 HTML、JS 和 CSS 到 `/root/.octop/venv/lib/python3.12/site-packages/octop/dashboard/admission-registration/`，没有重启 Octop。入口备份为同目录 `app.html.bak-codex-20261022-021257`；HTTPS 返回 200 且新哈希资源内容匹配。
- 用户需关闭旧登记页并重新打开加载新入口；浏览器麦克风仍必须从 HTTPS 或 localhost 使用。

## 2026-10-22：按住说话直接触发麦克风

- 按住录音入口须在 `pointerdown` 用户手势内立即调用 `getUserMedia()`；`/voice/active` 预检仅保留给点击式语音入口，不能挡在按住入口和麦克风请求之间，否则浏览器可能丢失本次授权激活。语音录音可用性仍受 HTTPS/localhost 和站点麦克风权限约束。

## 2026-10-22：AI 字段抽取在地区服务故障时降级

- `/ai/candidates` 的字段抽取不应被独立地区树服务故障整体阻断。地区服务异常或返回无效树时，使用内置地区树继续抽取；常见电话等字段仍应回填，动态地区数据恢复后继续优先使用动态数据。异常日志不得包含本轮患者回答。

## 2026-10-22：首页语音按钮不可用提示

- 麦克风 API 需要 HTTPS（或 localhost）；用户从 HTTP IP 打开 `/creations` 时无法录音。首页原本虽检测并设置 `voiceError`，但错误区被首页反馈显隐条件隐藏。首页麦克风区直接显示可操作错误，文字输入入口仍可用；要启用真实录音，部署访问地址必须使用 HTTPS。

## 2026-10-22：入院登记地区 MCP 按需加载与降级

- 地区下拉树通过独立只读 REST API 读取，不依赖 MCP。入院 Agent 仅在本轮输入包含地址提示或行政区名称时请求 `china_address_resolver`；其它字段抽取不触发它。
- 地址解析所需 MCP 加载失败时，本轮模型抽取重试一次且不带 MCP，避免可选连接器故障阻断登记；非 MCP 错误仍按原路径报错。

## 2026-10-22：手机号编辑态和表单地区数据

- 电话号码仅在数字键盘关闭时脱敏；`AdmissionForm` 与最终核对页编辑器在键盘打开期间显示完整输入值，原始值只保存在表单状态。地区表单默认经受认证的同源 `/admission-registration-api/v1/regions` 读取 Demo 完整地区树；Octop 代理到配置的 `ADMISSION_API_ORIGIN`。可通过 `VITE_REGIONS_API_URL` 显式覆盖为独立只读服务地址，跨域时需配置服务 CORS。
- 表单手动修改仍以 `manual_edit` 保存会话修订，但不追加或朗读到 AI 对话；AI 对话仅显示用户与 AI 的交互内容。

## 2026-10-21：申请单摘要单行字段及核验后提示

- 用户要求申请单摘要字段标签和值并排显示；身份核验后明确提示将补填的资料。摘要保留两列分组，每条标签和值同一行；欢迎提示逐项列出联系电话、婚姻状况、职业、紧急联系人姓名/关系，并注明身份识别已提供姓名、身份证号、国籍和民族，可选补充地址及工作单位。

## 2026-10-21：身份证读卡区提示圈动效

- 用户希望身份证读卡器图内原有的大蓝圈闪动；不在小屏/错误位置叠加新轮廓。对原图目标区做对位柔光脉冲，减少动态效果时停用动画并保留静态柔光。缩小读卡器图以保证下方模拟刷卡按钮可见；语音提示按钮放入卡片左下角，不再单独占行。

## 2026-10-21：手动修改与语音回填参考布局

- 用户补充自助机入院登记主流程图，确认仅参考手动修改和右侧第5栏“语音录入/识别结果/编辑”的展示布局，保留现有操作逻辑。现有14字段、长页、已确认的AI解析/内容确认标题、自动回填、编辑保存和最终提交门禁继续使用，不新增“确认填入”步骤或业务弹窗。
- 手动两组表单改为浅蓝标题栏、白色字段区、左标签右控件；控件34px、主操作42px，婚姻四项一行，职业六项两行。核对页、申请单摘要及语音核对摘要用分隔行对齐标签和值，原编辑按钮加装饰铅笔图标并保持可访问名称。
- 195项前端回归最终复跑通过；Vue类型、涉及文件Prettier及嵌入构建通过。首次回归用例全过但测试环境销毁后出现一次Element UI restoreBodyStyle延迟回调异常，同命令复跑正常，未改依赖。合成资料浏览器检查319px/620px无横向溢出，14字段完整、编辑入口可打开控件；截图`demos/admission-registration/e2e/artifacts/reference-{manual-319,manual-620,edit-319,voice-result-319}-20261021.png`。临时布局预览页已移除，未实测真实语音或全仓make all。

## 2026-10-21：自助机底栏及蓝色录音动效

- 用户要求对照自动机交互原型调整布局、字号、按钮及底部导航。底栏恢复返回、首页圆按钮和紫色用户图标的白色胶囊；资料来自当前办理的患者并脱敏，未核验不显示固定示例身份。原倒计时仍在同一行，窄屏省略“倒计时”字样但保留秒数与辅助文本；首页/退出沿用办理确认，“退出登录”不注销外层Octop账号。
- 快捷按钮高42px、文字14px；去除首页底栏挤入麦克风区的负边距。录音视觉使用蓝色麦克风、扩散光圈和真实音量驱动的中间高两侧低波形，上滑取消变红；减少动态效果时停用扩散动画。保留既有按住说话、松开发送、上滑取消手势，实际录音开始后才显示光圈。
- 11个前端测试文件195项通过；最终语音/底栏23项复跑通过；Vue类型、涉及文件Prettier及嵌入构建通过。浏览器319px/620px均无横向溢出，首页按钮在办理中先显示退出确认。截图为`e2e/artifacts/reference-{home-319,home-620,listening,cancel}-20261021.png`，说明在`docs/17-reference-style-alignment.md`（均相对于Demo目录）。录音截图通过临时组件预览与合成音量验收，不代表真实麦克风/云端ASR联调；临时预览页已移除，未跑全仓make all。

## 2026-10-21：AI解析与内容确认消息标题

- 用户要求模型回填结果增加“AI 解析”标题，资料补充/是否进入核对的确认提示增加“内容确认”标题。复用患者信息开场卡片的标题栏；“AI 解析”保留模型名在正文中，其它普通回复不统一加标题。
- `ConversationMessage` 由患者信息标记、显式标题或模型名称决定展示标题，只有患者信息卡片显示必填进度；确认提示在App共用消息追加入口标记，覆盖自动追问和保存对话后的回复。消息正文、脱敏、播放内容及原业务流程不变，历史归档继续保留展示元信息。
- 验证：消息组件及完整登记流程148项回归通过；Vue类型检查、Prettier检查、嵌入构建和diff检查通过。未跑全仓make all或真实麦克风联调；旧作品页面需关闭后重新打开加载新构建。
- 浏览器使用合成资料实测“AI 解析”和“内容确认”标题均显示，截图 `demos/admission-registration/e2e/artifacts/ai-analysis-content-confirmation-20261021.png`。

## 2026-10-21：患者信息开场卡片标题及动态必填进度

- 用户要求患者信息开场说明模仿下方补充卡片的标题栏，左侧为“患者信息填写”，右侧为“必填（已填数/总数）”。总数从两组字段配置中过滤required且非readonly字段实时计算，填写数跟随当前表单；不硬编码5，不给普通AI回复增加标题。
- 开场消息用展示标记识别；已完成阶段归档时保存进度快照，防止提交后表单清理导致历史卡片归零。复用下方补充卡片的标题栏样式，原消息正文、脱敏、播报及业务校验不变。
- 验证：患者流程及消息组件146项回归通过；Vue类型检查、涉及文件Prettier检查、嵌入构建和diff检查通过。浏览器实测0/5→1/5，截图 `demos/admission-registration/e2e/artifacts/patient-info-header-20261021.png`。未跑全仓make all或真实麦克风联调；已打开的旧iframe需退出作品后重新打开加载新构建。

## 2026-10-21：候选回填回复分区展示

- AI候选回填的对话回复按“已回填，请核对 / 需要补充 / 校验提示”等小节换行显示，字段值各占一行；模型名称仍单独显示，数据库仍保存带换行的纯文本回复，不增加API或Schema字段。

## 2026-10-21：内嵌登记页的独立 API 代理缺失

- 排查 `/creations` 语音转写后提示“本轮对话未能保存”：本机 `8200` 上 `/admission-registration-api/v1/ai/candidates` 与 `/admission-registration-api/v1/sessions/{id}/turns` POST 均返回405；独立 Demo 服务 `8765` 在线，相应原生接口对空请求返回422，说明接口存在。
- 该前缀的转发原先只配置在 Demo Vite 开发服务器，直接从 Octop `8200` 提供构建产物时不会生效。AI抽取失败后再保存错误回复也失败，后者覆盖前者，最终只显示保存失败。
- 用户随后授权修复：`api/routers/admission_demo_proxy.py` 为上述两个POST接口提供已登录用户的纯HTTP转发，默认目标 `http://127.0.0.1:8765`，复用进程环境 `ADMISSION_API_ORIGIN` 可配置可信内部地址。不搬迁 Demo 业务规则，不把前端保存绕回原生平台路径。保留后端状态码和续期token；64KiB请求上限、不跟随重定向、不透传Cookie，连接失败502/超时504/非JSON响应502；错误文案进入后端中英文bundle。
- 验证：代理与原登记API集成26项通过，新增代理最终13项复跑通过，i18n80项通过，Ruff检查/格式、代理模块mypy严格检查通过。重启本机8200后，用合成资料真实调用模型提取5个必填字段、经过8765保存并从平台重新读取核对revision与事实值，均200；未执行最终登记提交。全仓make all未运行（本机无make，且format-all会改写大量预存工作）。
- 浏览器从创作列表打开“智能入院登记”，模拟刷卡、确认申请单并发送合成资料，实测五个必填字段回填且回复正常保存，无原保存失败提示；截图 `demos/admission-registration/e2e/artifacts/admission-proxy-fixed-20261021.png`。另观察到模型对已回填的完整手机号仍重复追问补全号码，属独立抽取/澄清文案问题，本轮未改。

## 2026-10-21：区分办理过程提示和待确认申请单

- 用户要求区分“正在身份核验/查询申请单”等过程状态，以及需要本人核对决定的业务信息。有效申请单不再用一整段播报文本展示，改用带标题、有效状态、分项字段和“待您确认后继续办理”说明的申请单卡片；原确认按钮独立保留。语音播报内容和申请单查询/确认门禁不变。无记录、多记录或查询错误仍用普通提示。
- 对话区不再重复提供“模拟刷卡”按钮，身份核验只保留读卡卡片中的主操作。测试文字输入直接替换底部话筒并保留切回语音图标；同一时刻只显示一种输入方式。

## 2026-10-21：流程和对话按发生顺序向下追加，倒计时统一到底栏

- 用户再次明确全页后产生的内容必须放在已有条目之后。流程历史及已结束阶段的消息位于当前操作区之前；当前表单/核对/结果接在末尾，本阶段新回复继续追加在其下方。后台消息数组保留完整历史，仅按阶段切分展示；消息脱敏、字段强调和单条播放共用同一组件。异步切换时已生成的下一阶段消息不能归入上一阶段，退出或重新核验清理展示历史。
- 首页显示原 380 秒计时，办理阶段显示原 300 秒空闲计时；统一放在底栏与退出同一行。身份核验卡片和表单移除各自独占一行的计时展示，空闲提醒与超时清理逻辑不变。

## 2026-10-21：移除办理阶段旧对话面板装饰

- 用户明确新版不再显示附带大机器人、“智能登记对话”标题、副标题、字体按钮和“手动填写”的旧面板。共用对话组件移除这些装饰，办理阶段也使用透明连续消息布局；保留消息、业务操作、独立自动播报开关和必要的收起图标。

## 2026-10-21：嵌入页面避免复用旧语音栏

- 外层 `index.html` 已要求重新验证，但内层 `app.html` 可能仍被浏览器缓存并引用旧脚本，导致办理阶段重现紫色语音球及“手动输入”按钮。舞台每次打开为内层 HTML 增加时间参数，保留 `test-input=1` 传递；脚本和图片仍按资源哈希复用缓存。已打开的办理流程需退出后重新打开才能加载新版本。

## 2026-10-21：麦克风旁提供文字切换图标

- 用户要求麦克风右侧同一行显示旋转箭头按钮，点击打开现有文字对话输入；普通页面即可使用，覆盖此前入口仅限 `test-input=1` 的限制。麦克风仍居中，图标不新增一行；录音、识别或禁用时禁止切换。测试参数仍兼容。

## 2026-10-21：各办理阶段沿用首页麦克风样式

- 用户明确进入身份核验后底部不能切换为另一套语音栏。首页和各办理阶段复用已确认的小号蓝色麦克风、居中提示与测试文字入口；文字入口由 `test-input=1` 控制。保留录音、识别、错误反馈及原有倒计时机制。

## 2026-10-21：快捷办理入口收起导诊对话

- 点击“我要办理住院登记”进入身份核验时收起先前展开的导诊对话，不自动显示附带机器人和历史消息的“智能登记对话”面板。消息记录保留；主动打开文字或语音对话时仍可显示，语音意图进入办理的流程不受此快捷按钮调整影响。

## 2026-10-21：新增内容后整页跟随到底部

- 用户要求新信息出现时已有内容整体上推、页面保持最底部。由 App 观察整页实际尺寸变化，统一滚到文档末尾，覆盖回复追加、流程卡片与延迟排版；移除消息组件只滚到消息末尾的独立逻辑。初始首页及退出/重置保留顶部位置，后续新增办理内容滚到页底。

## 2026-10-21：对话退出入口去重

- 首页对话末尾入口文案改为“退出智能登记”；该入口显示时不显示底部重复的“退出”按钮。关闭对话或进入办理阶段后沿用原底部退出入口。

## 2026-10-21：滚动条覆盖整页

- 用户再次明确右侧滚动条必须延伸到页面底部，不能在麦克风区上方结束。移除覆盖自然长页规则的视口高度锁定与主内容内部滚动；首页、办理和对话共用文档滚动，保留语音输入条贴底行为。

## 2026-10-21：首页麦克风区倒计时

- 用户要求在首页“点击，开始对话吧”处增加 380 秒倒计时。进入首页开始递减，到 0 停止，再次进入首页重新计时；此显示计时不触发退出，也不改变办理流程原有 300 秒空闲清理机制。
- 用户要求倒计时不单独占一行；提示与倒计时同一行居中，窄屏长状态提示省略显示，倒计时保持完整。

## 2026-10-21：住院登记测试文字输入入口

- 测试人员可访问 `/creations?test-input=1` 显示首页“手动输入”入口；按钮打开现有文字对话输入框。参数经 Dashboard iframe、原型舞台 iframe 传入应用。常规 `/creations` 不显示入口。

## 2026-10-21：入院登记单页追加与独立播报开关

- 用户明确确认：**整个登记流程只有一个长页面**，身份核验、申请单、两组登记信息、核对、结果按流程向下追加；已完成阶段保留脱敏只读记录，当前操作在末尾。此决定覆盖此前“独立步骤页替换内容”的呈现规则。业务状态和服务端身份/申请单/校验/提交门禁继续生效。
- 手动表单和 AI 对话在同页共用资料与流程记录；AI 消息按时间顺序追加，登记结果直接显示在当前页。完成、明确退出、超时或重新核验身份会清理当前记录，避免旧身份内容混入新流程。
- 页面使用独立自动播报开关，默认关闭；开启后新 AI 回复与追问排队播放，关闭时停止当前语音并清空待播。每条回复旁喇叭只手动播放该条，不改变自动开关；此决定覆盖此前“点消息喇叭同时切换自动模式”的规则。
- 核心约束记录在 `demos/admission-registration/README.md`、`docs/02-prd.md`、`docs/03-prototype.md` 与 `docs/04-development.md`。

## 2026-10-21：入院登记统一入口与对话/语音视觉

- 用户确认最终入口为 `/creations`，直接替换原创作列表；复用现有 `/admission-registration/index.html` 构建，不复制 Demo UI。
- `/creations` 必须路由到原型本身，不能仅在旧创作列表里打开预览；此前代码只新增了 iframe 组件但未接入路由，现已接上并保留全屏入口。旧 React Demo 路径 `/admission-demo` 重定向到唯一入口。
- 进入 AI 对话后收起首页内容，机器人保持原始图像比例和自适应尺寸（高度 `clamp(150px, 42vw, 210px)`）。
- 按住说话保留黑色 55% 全屏蒙层、中央发送/取消提示和底部波形胶囊；松开发送立即切入 AI 对话，在识别完成前显示识别状态，并用轻量过渡衔接，不缩放/重排原型尺寸。真实麦克风交互仍需浏览器权限联调。
- `/creations` 内预览登记原型时，首页底栏“上一步”关闭外层预览回到创作列表；登记流程中的其他页面仍执行内部返回。

## 2026-10-21：BigModel GLM 推理开关

- 专家编辑页依赖 `/api/providers/resolved` 返回的 `reasoning_config` 展示推理模式选项。已保存的 Zhipu/BigModel provider 模型可能不含该元数据；对于 `bigmodel.cn` 上的 `glm-4.7*` / `glm-5*`，按 `thinking` adapter 推断为可切换，默认 `auto`。
- 若专家编辑页未出现深度思考选项，先检查 resolved model 的 `reasoning_config`，再核对运行中的 Octop 进程是否加载了最新 Provider 能力代码。

## 2026-10-21：入院登记地址歧义处理

- 入院登记资料 Skill 遇到多个无法归属的地址、含糊地区或详细地址冲突时，模型负责识别具体不确定字段并生成直接面向患者的澄清问题；其它明确候选正常返回。
- 抽取结果以结构化 `fields`、`uncertain_fields`、`clarification`、`clarification_choices` 分离传输；Demo API 映射成 `fields`、`uncertainFields`、`clarification`、`clarificationChoices`，前端显示模型问题，未确认字段不回填。Skill 每次抽取均从源码文件读取。
- 地址歧义存在有限且有原文依据的候选时，Skill 应在追问中带出完整地址，并返回最多 4 个字段化、互斥的 `clarification_choices`；界面提供单选，患者也可通过语音复述，候选作为新回答重新抽取。无可靠候选时保持开放式追问。
- Skill 不在运行时自行改写。持续改进需把脱敏失败样例转成回归案例，经人工审阅、测试和版本化发布；禁止用患者原始资料直接训练或自动覆盖生产 Skill。

## 2026-10-21：住院登记参考图样式调整

- 用户明确本轮以样式为主：图一用于手动填写的浅蓝自助机、白色表单、控件和底栏；图二用于机器人、左右聊天气泡和语音状态。保留 Vue2 Demo 现有完整14字段及身份核验、本人申请单、最终核对和模拟提交门禁，不照搬参考图的字段。
- **最新纠正**：用户用手机长页截图明确“整体变长，可以很长很长”。此前将“比例”理解成固定1:3是误解，已废止。当前页面宽度适配视口（桌面最大620px），高度由内容自然增长；不锁定一屏高度，表单/对话区不再内部滚动，由浏览器整页滚动。语音/文字输入栏滚动时贴底，回复增加时滚动到最新内容，开始/重置办理时清零整页滚动位置。
- 历史1:3截图`e2e/artifacts/proportion-{manual,ai}-20261021.jpg`仅记录已废止的展示。自然长页浏览器验证用20轮合成对话，319×884视口下整页8862px高，聊天区8506px高且overflow为visible，无横向溢出；截图更新为`e2e/artifacts/natural-long-*.jpg`。
- 自然长页验证：166项前端回归、类型/格式检查、嵌入构建和diff检查通过；390×640矮屏下手动页自然增高至890px，8项字段完整保留、主内容overflow为visible，无横向溢出。未做真实语音/模型联调或全仓make all。
- 用户再次强调自动增长的是中间的对话内容区，随问题和回答逐轮追加、保留全部历史。浏览器通过合成资料按钮连续追加3轮，消息数1→3→5→7，对话区高度100→291→481→672px，整页增长至1040px；首轮及最新轮均保留，无内部滚动，输入栏贴底。当前自然高度实现已满足，无需增加固定高度或按轮估算高度的逻辑。截图`e2e/artifacts/conversation-grow-by-round.jpg`。
- 用户要求对话气泡旁不显示小人，已移除消息头像和相应CSS占位，扩宽文字气泡；顶部大机器人保留。浏览器确认消息区无头像、顶部机器人仍在；类型、格式和嵌入构建通过。本次纯展示改动未重跑业务测试，截图`e2e/artifacts/conversation-no-avatar.jpg`。
- 用户要求机器人背景透明：使用内置imagegen处理原图，新增`frontend/src/assets/nurse-bot-transparent.png`（RGBA，四角alpha为0），首页/手动页/对话顶部改用该图并去除multiply混色。旧`nurse-bot.png`保留；提示词记录在`docs/nurse-bot-transparent-prompt.txt`。Alpha检查、页面目视、类型/格式/嵌入构建通过，未重跑业务测试。
- 用户要求细滚动条：保持宽度适配、内容自然增高和整页滚动，文档右侧使用浅蓝圆角滚动条。Chromium/WebKit为4px，Firefox使用原生thin回退；浏览器实测390×640视口时滚动条4px，页面高727px，无新增内部滚动框。纯CSS变更，格式/嵌入构建通过，未重跑业务测试，截图`e2e/artifacts/page-thin-scrollbar.jpg`。
- 用户要求参考问诊截图中“回答不完整后针对缺漏继续补充”的形式，内容仍是住院登记。已在连续对话末尾加入补充卡片，基于现有字段配置显示必填完成数、剩余项及当前字段问题，复用标准字典按钮和原保存/校验链路；已填项不再列入，选填可明确跳过，首轮完整说明、冲突确认和核对页不显示此卡。无新增后端接口或业务数据。167项前端回归、类型/格式/嵌入构建及合成资料页面验证通过；截图`e2e/artifacts/admission-incomplete-follow-up.jpg`。真实语音未复测。
- 用户反馈办理指引样式未实现并确认按附图复现：首页“帮助”打开单步遮罩，页面变暗、高亮下方语音入口，底部显示白色说明卡和蓝色按钮；关闭后原办理流程不变。窄屏浏览器目视确认遮罩与高亮位置正常；非首页仍保留原提示。
- AI 页面由遮罩弹窗改为页面内连续对话；切换手动填写保留资料和消息。患者信息开场从字段配置生成已带入/必填/选填清单；对话跨两组表单询问和提取，资料填写后统一进入核对页，手动页仍按两页推进。此决定替代旧的同款遮罩弹窗与 AI 分页填写展示。
- 现有地区、认证、冲突确认、20轮上限和后端接口复用；未新增依赖或改后端。现场语音/模型与真实医院接口不能由样式回归替代验收。
- 验证：Vue 前端165项回归、类型检查、Prettier检查、平台嵌入构建及定向diff检查通过；浏览器用合成资料目视核对319px与620px页面，截图保存在Demo的`e2e/artifacts/style-*-20261021.jpg`。未跑全仓`make all`（本机无make且工作树含大量其他任务改动），未运行真实模型/麦克风或医院接口联调。

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

- 用户指出前一轮未按参考图重做；在已确认设计上完成 Vue 入院登记页面改版并嵌入 Octop 创作页。首页/身份核验/申请单/分步表单/AI 对话/独立核对/结果页按单页流程切换；申请单只读并显示入院科室、计划入院时间等信息。2026-10-20 用户明确每人同一时间只能有一份住院申请，因此唯一有效单自动选中且不显示选择按钮，继续前仍需确认，服务端保留归属和有效状态校验。详见 `demos/admission-registration/docs/03-prototype.md`。
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
- 用户确认本页必填内容完成后先询问是否补充本页其它内容；可自由回答或说“跳过”，仍有空选填字段时再次询问，全部补齐后再确认继续。说“跳过”/“继续下一页”推进，最后一页进入核对页，不自动提交；“暂不继续”停留当前页。
- 地区口述可省略省名时，仅当地区树中市+区路径唯一才回填省市区代码；存在歧义时不猜，要求手动选择。翻页成功提示必须等会话写入和分页校验/推进成功后显示。
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
- 2026-10-21 再次确认入院登记助手应显示在专家页；Agent 未丢失，`/api/agents` 路由额外过滤无个人所有者的 Agent 导致隐藏。移除该过滤，默认列表包含已启用且显式共享的平台 Agent，未共享和已禁用的平台 Agent 仍隐藏；共享不授予所有者权限。
- 2026-10-21 20:40（Asia/Shanghai）已按原 `start-octop.bat` 成功重启本机8200服务，健康检查 `ok=true`；专家页恢复6个专家，入院登记助手显示运行中，数据库配置 `max_iters=12` 已同步。20:41自然语音提交仍失败，最新错误已变为 `ContextOverflowError: Context remains above the input budget after compaction`；2000 tokens输入预算保持不变，此问题尚待修复，不能宣称模型链路已恢复。

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

## 2026-10-20：入院登记 Demo 首屏 Bundle 优化

- Vite 原单一入口 JS 为 666.96 KB（gzip 193.37 KB）；构成包含重复 Vue runtime，以及首页提前载入的 AJV/Schema/地区树。
- 将 `vue` 统一 alias 到 ESM runtime，并在用户选择申请单进入表单前懒加载校验模块和地区数据；保留 500 KB 默认 chunk 告警阈值。
- 构建后入口 JS 降为 328.37 KB（gzip 94.21 KB）；表单校验异步 chunk 为 269.17 KB（gzip 71.75 KB），构建无超限告警。
- 回归：前端 120 tests、页面流程 19/19、页面 AI/Skill 用例 3/3；类型检查、生产构建与内嵌 Dashboard 构建通过。

## 2026-10-20：入院登记智能语音对话跨页保持

- **旧范围已被用户后续明确纠正覆盖**：文字和语音只要首页打开了对话，都必须跨页保留同一段消息；结果页也保留到完成/退出/超时。以下“仅语音”记录不再是现行约束。

- 用户确认：仅首页麦克风入口启动的办理在切页时保持对话框；文字入口仍收起。身份核验页对话框提示“请将证件放置到读卡区，然后点击“模拟刷卡”。”并提供按钮复用现有 `verifyIdentity()`；关闭弹窗中止未完成核验，结果页/重置清除来源状态。
- 已实现于 Demo `App.vue` / `ConversationDialog.vue`：同一提示显示并由现有 TTS 播报，身份页按钮在核验中禁用。模态弹窗保留至后续申请单、表单和核对页；用户收起后不自动重开。
- 验证：Demo 前端全套 135 tests、类型检查和 `build:dashboard` 通过；`git diff --check` 通过。`npm run format:check` 因 35 个既有/其他文件格式告警失败，未执行全目录格式写入以免覆盖工作区已有改动。未做真实麦克风/浏览器手工旅程测试。

## 2026-10-20：入院登记对话流式回答与核对确认设计

- 用户确认后续设计方向：首页流程答疑走现有 admission Agent/Skill 真流式输出；所有对话消息显示 Octop 服务端时区的发送时间；表单 AI 回填回复需列明本轮实际填写的字段和值，并明确列出空白选填项，补充或显式跳过后才推进；核对页对话显示格式化、脱敏的当前登记摘要，口头“确定”在核对页触发现有核对并提交流程。
- 回填摘要由已应用字段和表单元数据计算，不另调模型；核对卡从响应式表单派生，不复制一份完整个人信息到对话 turn。只有完整校验为 `answer_question` 的意图分类才可启动流式答疑；回答流本身没有业务动作权限，身份核验/提交门禁不变。
- 用户进一步确认采用两阶段首页答疑：先完整校验意图，只有 `answer_question` 才对同一 Agent/Skill 发起流式回答；接受该答疑路径增加一次模型调用及耗时/成本。
- 用户补充要求流式答疑正文前显示本次调用的模型名称；采用提供商模型配置的展示名，缺失时回退模型 ID，无法解析时不编造名称，模型标签与回答保持同一条消息。
- 规格文档：`demos/admission-registration/docs/specs/2026-10-20-admission-conversation-stream-summary-design.md`。这是已确认的设计基线，尚未实施；继续前需完成规格审阅与用户文档确认。

## 2026-10-20：入院登记 Demo 的 AI 抽取错误区分

- 前端不再把所有抽取 401 合并成“登录或身份核验已失效”：根据后端 detail 区分 Octop 平台登录失效与 Demo 身份核验失效。Demo AI 代理把 Octop 上游 401 映射为明确的平台登录错误；其他上游 HTTP 错误继续映射为 502。
- 抽取成功但本轮会话保存失败时，保留已回填字段并明确提示“候选信息已回填，但本轮对话未能保存”，避免用户误以为抽取失败。
- 前端 `full-workflow.test.js` 与后端 `test_ai_api.py` 覆盖对应回归路径。现场 Demo 后端未运行，因此本次无法读取历史服务日志，也无法确认当时失效的是哪类 token；需在页面重测区分验证。

## 2026-10-20：入院登记对话 AI 回复自动播报

- 用户确认：点击 AI 回复旁的喇叭播放该条并开启后续 AI 回复自动播报；再点击关闭。偏好跨身份核验、申请单、表单和核对页保持；流程重置时清除。
- Demo 复用现有平台 TTS 与单一 audio 播放器；仅实时新增 assistant 回复显式触发播报，历史恢复与切页不触发。录音时沿用现有停止播报行为；关闭播报会中止当前 TTS。
- 规格：`demos/admission-registration/docs/specs/2026-10-20-conversation-tts-autoplay-design.md`，经审查通过。
- 验证：Demo 全套前端 136 tests 通过；`npm run typecheck` 与 `npm run build` 通过。未验证真实音频设备/云端 TTS 播放。

## 2026-10-20：AI 对话确认本人入院申请单

- 用户确认：对话框打开时，进入本人入院申请单页后不通过页面按钮推进；AI 对话基于申请单查询结果说明内容，必须点击对话框“确定申请单并继续”才调用既有确认流程。收起对话后恢复普通页面操作；申请人姓名摘要复用 `maskName()`。
- 无有效申请单、多份有效申请单或查询失败时显示说明且不提供确认按钮。复用服务端申请单归属/状态校验、请求中禁用和父级页面状态，不额外调用模型。
- 规格：`demos/admission-registration/docs/specs/2026-10-20-application-page-ai-confirm-design.md`，经审查通过。
- 验证：Demo 前端全套 139 tests、类型检查、独立生产构建、Octop 嵌入构建及 `git diff --check` 通过。Demo 真实服务与浏览器/设备旅程尚未验证。

## 2026-10-20：修正所有入口的连续对话与页面引导

- 用户现场复测纠正：从首页打开对话后，后续切页不可关闭或替换前面的对话；AI 每次进入新页必须说明当前页和下一步操作。最新指令覆盖旧“仅语音入口保持”设计。
- 根因：`begin()` 按语音标记关闭文字对话，模板又按页面切换三个消息数组。已移除来源标记，保留可见状态，并以 `dialogMessages` 作为连续显示记录；业务数组仍用于原有持久化。表单提问也追加保留，结果页显示到完成/退出/超时；重置清空。
- 本地浏览器已实际验证：首页文字需求→身份核验→模拟刷卡→本人申请单→对话按钮确认→基本信息，原消息仍可滚动查看，并出现各页提示。截图：`demos/admission-registration/e2e/artifacts/dialogue-continuity-20261020.png`。真实麦克风与云端播报效果未验。
- 最终验证：Demo 前端 140 tests、`npm run typecheck`、`npm run build:dashboard` 与 `git diff --check` 通过。未运行全仓 `make all`，其格式写入会影响大量其他任务的未提交文件；全套测试仍输出既有 KeypadDialog anchor 类型警告。

## 2026-10-20：对话框录音波形

- 用户要求对话框底部录音时显示波形，明确知道录音是否开始。对话框现传入现有 `volumeLevel` / `soundDetected`，与原语音栏共用 `VoiceWaveform`，不使用假的循环音量动画。
- 录音期间以波形、正在录音/等待声音文案和“结束录音”按钮替换输入区；打开麦克风和识别中显示对应状态，识别结束恢复原输入及草稿。识别中即使旧 recording 标记未清理也不显示波形或停止按钮。
- 验证：Demo 前端全套 141 tests、类型检查、嵌入构建通过；真实麦克风收音/音频上传未代用户实测。

## 2026-10-20：手机号回答字段上下文与界面脱敏

- 用户只回复完整 11 位手机号时，当前登记对话若正等待联系电话，提取请求需附带“联系电话”字段上下文；原始回复继续用于表单候选校验与会话记录，聊天气泡和页面展示继续由 `maskText` 脱敏。其他输入与多个号码仍走原提取/安全校验。
- 实际页面测试：合成手机号裸回复失败；带“我的联系电话是”的手机号识别成功。修复后新增回归测试验证裸号码会以字段上下文+原号码发给提取接口，气泡只显示脱敏值。Demo 前端 142 tests、类型检查、嵌入构建和 `git diff --check` 通过；真实麦克风未验。

## 2026-10-20：入院登记追问时限制非当前字段回填

- 有必填字段等待回答时，模型仍可能把用户话语中的旧字段值/字段标签误判成新候选，导致重复播报“已回填”而没有承接当前问题。保留当前待答字段的自由回答；其他字段只有当本轮原话先明确字段标签、再包含对应值时才接受，避免把“我的工作单位”误填成单位名称。
- `demos/admission-registration/frontend/tests/full-workflow.test.js` 覆盖重复“我的工作单位，职业是职工”时仍追问紧急联系人。同步补齐 3 个分页测试的选填字段场景数据后，该工作流文件 112 tests 全部通过；测试仍会输出既有 KeypadDialog `anchor` 类型警告。

## 2026-10-20：选填资料需明确补充或跳过

- 表单页必填项完成后，AI 逐项列出本页仍为空的选填内容，并告知可以一轮补充多项；这些选填项未处理前不显示翻页按钮。明确说“跳过/不填”或“继续下一页”等推进指令才会略过选填并进入下一页/核对页；“暂不继续”只停留当前页。填完后继续走原有校验和保存流程。
- Demo 前端全套 145 tests、类型检查、`npm run build:dashboard` 与 `git diff --check` 通过。测试仍有既有 `KeypadDialog anchor` Vue 警告；未进行浏览器现场复测。

## 2026-10-20：翻页前预告下一步问题

- 当患者当前页信息已完成、对话展示“继续下一页”选项时，提示必须说明下一页会先问什么；按下一页当前缺少的必填字段、选填字段或核对状态动态预告。患者说“你的问题”“回答什么问题”等时，重复当前对话提示，不进入字段抽取；继续下一页仍按显式选择推进。
- `tests/full-workflow.test.js` 覆盖下页提示预告及“你的问题”回复；该文件 113 tests 通过，`npm run typecheck` 通过。既有 KeypadDialog `anchor` 类型警告仍出现。
- 2026-10-20 本地浏览器自动旅程：模拟刷卡→确认演示申请单→录入演示联系电话→进入补充信息→说“你的问题”→选“未婚/职工”；页面按序回复婚姻、职业，再问紧急联系人。未提交登记；截图 `.playwright-mcp/admission-dialog-e2e.png`。

## 2026-10-20：AI 回复中的表单字段关键词高亮

- 用户确认：AI 回复里的表单字段标签自动加粗并标蓝，关键词从现有字段配置动态读取；患者消息保持原样。覆盖历史消息及没有对话记录时显示的首条提示。字段标签按长词优先拆分，避免“紧急联系人姓名”只高亮末尾“姓名”；普通文本仍经过原脱敏处理。
- Demo 前端全套 147 tests、类型检查、`npm run build:dashboard` 与 `git diff --check` 通过。Prettier 检查报告 App.vue、ConversationDialog.vue、full-workflow.test.js 有格式差异；未全文件格式化，以免重写已有的其他未提交改动。真实浏览器视觉复测未做。

## 2026-10-20：核对页聊天显示登记摘要和下一步

- 核对页聊天在“信息核对”提示后显示由申请单和响应式表单实时派生的分组摘要，沿用字段显示规则并遮罩姓名、证件号、电话；摘要不写入持久化 turn。明确说明确认提交会提交模拟登记，并给出“确认提交”及“职业改为学生”式修改提示。核对页不显示独立的 `aiNotice` 状态条；内容和下一步只通过摘要与聊天提示呈现。
- `demos/admission-registration/frontend/tests/full-workflow.test.js` 覆盖摘要内容、脱敏、修改后实时刷新及不持久化；Demo 前端全套 148 tests、类型检查和生产构建通过。测试仍有既有 `KeypadDialog anchor` Vue 警告。

## 2026-10-20：AI 回复显示实际模型名称

- 用户要求在 AI 回答上方标出模型名称。只对实际调用模型后产生的字段提取/回填回复显示；名称取调用时配置的模型显示名，无显示名则回退模型 ID。固定系统提示不标注，TTS 仍只朗读原回复。
- Octop 提取 API 与 Demo 代理透传 `modelName`；前端将名称附在当前内存对话消息并在回复气泡上方显示，不写入历史 turn 存储。旧服务缺字段时继续兼容。
- 后端定向单测和两组入院 API 集成测试共 52 passed；Demo 后端 24 passed；前端工作流与语音阶段 120 passed、类型检查和生产构建通过；Ruff 与 `git diff --check` 通过。未做真实浏览器视觉复测；模型名在页面刷新/从存档恢复后不保留。

## 2026-10-20：追问后旧手机号与回填提示重复显示

- 根因是 `ConversationDialog` 仅检查最后两条消息来隐藏已持久化的 `transcript`，且仅检查最后一条来隐藏已显示的 `aiNotice`；新选填问题作为下一条 AI 消息追加后，旧手机号和旧“已回填”提示被再次渲染。
- 改为以最近一条患者消息为边界识别该轮转写和回复；后续 AI 引导消息不会破坏去重，新回答仍在处理期间显示。回归用例先复现了第二条手机号，再在修复后通过；相关前端 121 tests、类型检查、嵌入构建与 `git diff --check` 通过。

## 2026-10-20：核对对话框内直接提交

- 最终核对页的智能登记对话框增加“确认并提交入院登记”按钮；仅在核对页且存在有效申请单时显示。按钮沿用原有提交对话和登记链路，保留确认修订、字段校验及幂等提交行为；处理期间禁用。
- 回归覆盖对话框按钮触发原提交链路；full-workflow 115 tests、前端类型检查、生产构建和 Dashboard 嵌入构建通过。

## 2026-10-20：核对页语音转写后再提交

- 根因：录音识别完成后立即将结果送入对话处理；误识别为“确认提交”会直接提交，患者没有检查或改写转写的机会。
- 核对页语音识别现在只把转写放入可编辑对话输入框并打开对话框；患者修改后点击“发送”才处理。它可以撤回误识别的提交意图；手动点击“确认并提交入院登记”仍沿用既有校验与提交流程。
- 回归测试确认识别成“确认提交”不会自动提交，改成“不要提交”发送后仍停留核对页；full-workflow 116 tests、类型检查、Dashboard 嵌入构建和 `git diff --check` 通过。

## 2026-10-20：核对页同页修改并回显核对结果

- 核对页分组信息支持原地编辑；修改即时刷新页面摘要和对话框中的摘要，完成修改后沿用现有保存链路，不跳离核对页。AI 回填和逐字段选择回复具体回显已录入字段和值；姓名、电话等敏感值沿用脱敏规则。
- 前端 full-workflow 117 tests、类型检查、Dashboard 生产构建及 `git diff --check` 通过。真实医院提交不在此 Demo 范围内；原型仅走模拟提交链路。

## 2026-10-20：语音静音自动停止倒计时

- 语音录入在用户开始说话后，静音 3 秒自动停止；界面按剩余秒数显示倒计时，检测到新的说话声音即清除倒计时并重新计时。初始等待说话不触发自动停止。
- 录音器与语音界面定向测试 12 passed、Demo 前端类型检查及 Dashboard 嵌入构建通过；已刷新并重新打开当前原型页。

## 2026-10-20：入院登记原型交互红队测试发现

- 浏览器实际流程覆盖模拟刷卡、申请单确认、基本信息、补充信息、核对页；未点击最后的模拟提交。
- 交叉/异常输入：山东省下不提供沈阳市；直接输入“山东省沈阳市沈河区”未回填；辽宁省下可继续选择沈阳市、沈河区。10 位手机号、11 位 0 开头手机号及纯数字紧急联系人均被字段校验拦截。
- 发现风险：输入“婚姻状况未婚又已婚”时 AI 未追问而直接回填“已婚”并回显；表单允许“未婚 + 配偶”进入最终核对页，缺少冲突确认。数字键盘每次按键会在对话中追加一条重复的“手动修改联系电话 已将修改保存到本次办理会话”消息。
- 最终核对页的同页编辑可将关系改为“非亲属”，摘要立即更新；测试未做真实提交。

## 2026-10-20：入院登记地址省市冲突提示

- 对话输入的地址包含不匹配的省和市时，按现有地区树识别具体冲突并说明该城市所属省份；例如“山东省沈阳市”提示沈阳市属于辽宁省。要求用户确认正确地址，不自动改写或回填。
- 入院登记前端增加省市冲突交互回归用例；全量测试、类型检查和 Dashboard 嵌入构建通过。
- 同一规则已扩展到省-市和市-区县层级：根据地区树定位冲突字段及其实际所属城市/省份，不回填冲突地址；两种错误组合均由前端回归和浏览器实际交互验证。

## 2026-10-20：入院登记字段错误具体提示

- AI 候选接口现在同时返回未通过校验的字段原因；前端把错误翻译为具体可操作的提示。无效电话说明11位号码要求；不支持的职业显示系统职业选项并由患者点选；同一枚举字段出现多个互斥值时要求明确选一项。明确提问中的当前字段会随纯答案一起送入候选解析，以便识别例如“护士”或10位号码。
- 明确填写的值优先用于校验，模型不能把不支持的职业擅自改成合法选项；女儿/儿子仍按现有规则归一为“子女”。前端 158 tests、后端 Demo 27 tests、类型检查、嵌入构建及 Ruff 通过。

## 2026-10-20：入院登记首页识别“住院登记”

- 首页把独立短语“住院登记”/“入院登记”（可带句末标点）确定性路由为开始模拟登记，避免模型将这个常见短需求判为 unknown；其他自然语言仍使用 admission-router。
- `tests/unit/test_admission_demo.py` 覆盖两种短语、空格/标点和不调用模型；unit 30 passed，相关 integration 组合 75 passed，修正旧断言后 3 个意图用例通过。Dashboard 生产构建、wheel 构建、Ruff 与 `git diff --check` 通过。经 SSH 将 wheel 同步到 `119.3.216.103`，备份旧包和 SQLite DB 后重启 Octop；远程 `/api/health` 正常、直接分类返回 `begin_admission`，线上 Dashboard bundle 与本地哈希相同。无模型 token 时未做模型依赖的真实对话验证。

## 2026-10-21：入院登记未标注地址归入详细地址

- 用户先明确：未标注地址不应猜为籍贯。抽取 Skill 加入规则和示例；后端不再把未标注地区候选直接写入籍贯/现住地区级联字段。该默认语义随后由用户补充的“完整省市区 + 具体地点”拆分规则细化，见下一条。
- 用户报告 Demo 打不开；确认 `src/octop/dashboard/admission-registration/` 构建产物目录缺失，导致内嵌 `/admission-registration/index.html` 落入主 SPA 404。执行 Demo `npm run build:dashboard` 生成静态目录后，刷新创作页并实测 iframe 成功显示 Demo 首页。
- 用户随后明确补充：完整未标注地址“辽宁省沈阳市大东区黎明广场”应拆成现住地区“辽宁省沈阳市大东区”和详细地址“黎明广场”。这条 Demo 地址拆分逻辑应放在 `demos/admission-registration/frontend/`，不能放在 Octop 通用抽取后端；显式“籍贯”地区由前端从原话直接恢复，不依赖模型返回；裸地址只填现住地址和详细地址。后续截图确认即使“详细地址”字段值重复带省市区，也要从中拆出“现住地址”。

## 2026-10-21：入院登记 AI 逻辑归属与20轮上限

- 用户明确：Octop 负责提供 Agent、Skill、模型；登记业务编排、上下文拼装、地区拆分、枚举校验和轮次限制由 `demos/admission-registration/backend/` 独立 FastAPI 负责，不把业务逻辑新增到 `src/octop/`。
- 首次打开空办理会话时一次性询问登记信息，后续根据缺失必填项追问；首次回答并行提取两页。推理上下文包含结构化事实、压缩历史、最近5轮和末尾最新回答。裸完整地址归为现住地区+详细地址；籍贯必须有明确语义。枚举只接受标准选项或已知关系别名。
- 20轮按会话的对话操作计数，由 Demo 后端的 AI 与保存 turn 门禁共同执行；达到上限拒绝新对话，直接页面编辑仍可保存并核对。并发 turn 保存依靠已有会话 revision 条件更新，最多一条同 revision 请求可成功。
- 2026-10-21 定向 Demo 后端 36 tests 通过；Ruff check/format、前端 Vitest 162 tests、Vue 类型检查、Vite 构建和项目 Prettier 格式检查通过。未动 Octop 后端文件；生产必须把 `/admission-registration-api/` 反向代理到独立 Demo 服务。未跑全仓 `make all`，因为仓库有大量预存未提交改动，`format-all` 会批量改写无关文件。
- 用户补充入院登记 Agent 不需要深度思维或扩展输出；专用平台 Agent 固定设置 reasoning disabled、max_iters=12、max_input_length=2000、temperature=0.2、max_tokens=512，并在后续初始化时同步到已有 Agent。日志确认 max_iters=3 会触发 LangGraph Recursion limit 错误，用户同意上调到12；30秒请求超时和20轮患者会话限制保持独立不变。

## 2026-10-21：工作台项目限时分享

- 工作台项目分享使用高熵 bearer token；数据库只保存 SHA-256 哈希，创建时明文只返回一次。分享支持 1 小时至 30 天，可列出并撤销；项目删除级联删除分享记录。
- 公开只读页无需 Octop 登录，展示项目树、文件夹、已分配任务及任务中的用户/助手文本对话；工具输出、附件和项目代码不通过公开分享暴露。匿名访问响应禁缓存、禁引荐来源并加 noindex。
- 定向集成覆盖匿名只读、项目/任务隔离、撤销、有效期校验和无效 Unicode token；项目分享 API 的 schema migration 当前为 027（SQLite/Postgres）。

## 2026-10-21：工作台项目操作日志页面

- 新增独立管理菜单“操作日志”（`/admin/audit-log`），按已确认的工作台项目和起止时间过滤；旧 `/admin/audit` 入口重定向到新页。仍保留安全设置中的旧审计页签。
- 审计行增加可空 `project_id`，未发布 v27 SQLite/PostgreSQL migration 添加字段和索引；`_ensure_workbench_schema` 做幂等补列以兼容已记录 v27 的本地数据库。记录项目/文件夹创建、修改、删除，会话归属调整及分享链接创建/撤销；查询项目选项来自已有项目操作记录，已删除项目用 ID 显示。
- 验证：工作台 + 管理审计集成测试 18 passed；后端 Ruff check/format、前端 ESLint 与 Vite production build 通过。`npm run build` 的 TypeScript 阶段报告既有 `dashboard/src/pages/Chat/hooks/useChatAttachments.ts:109` 可能为 undefined 的附件类型错误；本轮未改该文件。整个仓库有大量预存未提交改动，不运行 `make all`。
- 已知范围：不记录普通聊天消息、模型/工具内部事件或工作台项目之外的平台操作；没有日志的旧项目不会出现在项目筛选项中。
- 后续完整回归补充：先发现 v22 水位重跑 v27 时 `audit_log.project_id` 重复添加；已将 SQLite v27 修复改为幂等 helper（同时补建分享表），复现测试通过。更新后审计调用方/数据库/工作台相关测试 187 passed、1 skipped；前端权限路由与侧栏定向测试 14 passed；最终 `npm run build`（TypeScript + Vite）通过。`sidebarNavLayout.test.ts` 仍有一个与本变更无关的既有失败：期望列表未包含工作区已有的 `admission-demo` 菜单项。

## 2026-10-21：工作台项目绑定 RAG 知识库

- 用户确认把平台知识库管理接入工作台项目。现有工作台 `project_id` 是项目边界；一个项目可绑定多个当前用户可见的知识库，绑定信息在 `workbench_project_knowledge_bases` 持久化并从工作台项目菜单管理。
- 已分配到项目的会话每轮自动把该项目绑定的可见知识库纳入 `search_knowledge` 范围；用户当前轮显式选择的库仍保留，并与项目库合并。已有知识库 owner/shared 检查继续控制实际检索访问。绑定不向公开项目分享页暴露。
- 项目知识库绑定当前按精确项目匹配，不从父项目继承到子项目。Schema 融入尚未发布的 v27（SQLite/PostgreSQL 双方言），`_ensure_workbench_schema` 幂等创建以兼容已记 v27 的本地库。
- 定向后端：17 passed；工作台 Dashboard 用例：19 passed；TypeScript 编译结束无报错；Ruff 检查和 `git diff --check` 通过。当前 Home 文件 Prettier 检查仍报告格式差异；该文件含有大量既存未提交工作，本轮未全文件格式化以免扩散改动。全仓 `make all` 未运行。

## 2026-10-21：独立行政区划服务插件

- 用户选择独立服务 + 通用 MCP；项目位于 `demos/administrative-regions/`，地区同步、管理页和 MCP 属于 Demo 插件本身，Octop 不新增地区专用服务、Dashboard、MCP 路由或定时任务。Octop 通过既有 MCP 连接器接入；入院 Demo AI 使用配置的只读 API，表单默认通过同源 Demo API 获取完整地区选项。
- 独立服务从民政部公开接口导入并校验三级树，原子更新持久缓存，每周一 03:00 按配置时区同步；管理和 MCP 操作要求至少 32 字符 bearer token。地区唯一命中返回规范路径；歧义返回最多 10 条候选路径及总数，由住院登记 Agent 追问用户确认，候选截断时询问补充省市。
- 防护覆盖上游响应大小/结构错误、缓存体积与树完整性、同步中断时保留旧缓存、MCP body 限额、未授权管理调用及包含空格的原文偏移。上游无 SLA，失败时继续使用最后有效缓存。
- 入院 Demo 的地区树和 AI 地区校验可配置到此服务；Octop 原入院 Demo 解析器保留既有标签前缀/唯一性兼容行为，不承载同步、外部地区服务缓存或定时调度。

## 2026-10-21：Codex 接入 Serena MCP

- 用户授权为 Codex 安装试用 Serena；采用官方 `uv tool install -p 3.13 serena-agent`，安装版本2.1.0，与 Octop 应用依赖和部署无关。
- Codex 用户配置新增 `mcp_servers.serena`，原有 MCP 经解析比较完全一致；修改前备份为 `C:/Users/xdguo/.codex/config.toml.before-serena-20261021-141035.bak`。核验期间 Codex model 设置发生外部变化，已保留，不恢复覆盖。使用 Serena 可执行文件绝对路径，并给其子进程 PATH 加入 `C:/Users/xdguo/.local/bin`；否则 Python 语言服务找不到 uv/uvx。启动超时60秒、工具超时240秒，首次语言服务初始化曾超过60秒。
- 本仓库 `.serena/project.yml` 启用 Python、TypeScript，缓存/配置通过 `.git/info/exclude` 本地排除；Serena Dashboard 仅监听回环地址，不自动弹出。未更改现有 Codex hooks。默认v2 REPL接口提供 initial_instructions、activate_project、serena_repl，符号查询走 `s.lsp`。

## 2026-10-21：住院登记 Agent 地址 MCP 接入

- 入院登记共享 Agent 默认绑定 `china_address_resolver`；第一页资料抽取仅在该 MCP 已绑定且当前用户有权限时启用它，意图分类、冲突确认和第二页不开放。Skill 仅发送地址中的地区片段，用唯一解析结果补齐省市区；道路/门牌不推断，歧义时追问。
- 本机 Octop 连接器和 Agent 绑定原本已存在，但 `127.0.0.1:8210` 地址服务未启动。启动服务后，通过 Octop harness 的 `MultiServerMCPClient` 发现4个工具并调用 `regions_resolve`：`沈阳市大东区黎明广场` 唯一返回 `辽宁省沈阳市大东区`；`大东区黎明广场` 与 `朝阳区` 返回空，避免猜测。
- `tests/unit/test_admission_demo.py` 33 passed；Ruff check、目标文件 format check 和 `git diff --check` 通过。未调用真实 LLM 做端到端生成；地址服务当前以本地进程运行于 127.0.0.1:8210。
- MCP真实只读测试通过：OctopServer类结构、run_foreground_blocking函数体及 CLI 引用、TypeScript markSetupRequired函数、FastAPI build_app 函数体及其在 launch.py/integration tests 中的调用方；查询前后四个源文件SHA-256保持一致。验证脚本、完整结果和使用/移除说明在 `C:/Users/xdguo/.codex/serena-smoke/`。
- 当前既有聊天没有自动新增Serena工具；新开Codex聊天后检查 `/mcp`，若仍缺失再重启桌面端，并用绝对项目路径激活。未执行全仓onboarding、Vue语言服务配置、编辑重构测试或Token节省率测量。无业务代码变更，未运行全仓make all。
- 行政区 MCP 对外名称从 `administrative_regions` 改为 `china_address_resolver`，显示名为“中国行政区划地址解析”；同步更新 Demo Agent 绑定、地址抽取 Skill 和测试夹具，保留服务包/目录名不变。
- `regions_resolve` 对同名地区返回最多 10 条完整候选路径和候选总数；住院登记 Skill 使用候选路径追问，不再只收到空结果。行政区服务测试 8 项通过，Octop MCP 客户端实测“朝阳”返回北京、吉林长春、辽宁朝阳市/朝阳县 4 个候选；未运行真实 LLM 对话验收。

## 2026-10-21：住院登记模型上下文压缩

- 用户要求控制并压缩每次模型输入，入院登记 Agent 的 `max_input_length` 设为 2000 tokens；结构化事实、申请单摘要和当前回答优先保留，超预算时先丢弃最早的历史轮次。
- Demo 与 Octop 调用边界均增加 6000 UTF-8 字节上限作为输入保护；这是传输体积保护，不等同于服务商 tokenizer 的精确计数。模型实际 token 上限由 Agent runtime 设置。

## 2026-10-21：入院登记手机号与语音底栏回归

- 患者原话恰有一个11位手机号码且不是联系人号码时，即使模型因PII打码标记不确定，也允许按原文确定性回填；多个号码及联系人号码仍不自动回填。
- 对话框打开时语音错误只在对话消息区显示一次；办理页内容区预留吸底语音栏所需滚动空间，避免操作按钮被遮挡。

## 2026-10-21：入院登记表单控件对齐 PRD

- PRD F12 约束职业选项为职工、农民、退休、无业、学生、其他且不预选，没有规定必须用下拉框；按患者体验反馈，职业使用与婚姻状况一致的单选按钮组。表单分组标题与字段间距保持紧凑。

## 2026-10-21：智能入院登记首页倒计时延迟启动

- 首页380秒倒计时在首页首次交互后启动；后续点击或键盘操作重新计满，静置页面不消耗时间。复用页面根节点的活动入口，进入办理页时维持既有会话倒计时行为。
- 前端组件和完整流程149项定向测试通过；Prettier检查及嵌入 dashboard 构建通过。

## 2026-10-21：身份证识别卡与申请单紧凑布局

- 读卡器图片缩小并按原图纵横比显示；图片内既有大蓝圈通过对位柔光闪动，不增加可见的第二圈。语音重播按钮放在卡片左下角，不占内容行。
- 申请单的编号、状态和八项信息合为同一网格，宽屏按“标签/值/标签/值”四列展示，窄屏自动改为两列标签/值。

## 2026-10-22：住院登记流程回归

- 联系电话进度按字段校验结果计数；数字键盘编辑期间暂缓保存，关闭键盘时合并保存一次。`KeypadDialog.anchor` 可接收 DOM `Element`。AI候选测试的响应模型默认包含 `clarificationChoices: []`，精确响应断言应覆盖此默认字段。
- 页面回归使用模拟刷卡和虚构资料；10位电话为0/5、11位电话为1/5。AI拒绝无效关系“父子”，接受合法关系“父母”，必填进度达5/5并进入核对页；本地代理集成测试27项通过，未执行最终登记提交。

## 2026-10-22：入院登记固定宽度与独立服务依赖

- 原型页面和内嵌 iframe 的最大宽度统一为 320px，避免外层预览变宽后使用宽屏断点，令申请单按钮与卡片发生横向溢出；页面高度仍随内容增长。
- 确认申请单后，前端会向独立 Demo 后端请求地区数据，后端再读取 8210 地区服务。若 8765 未运行，同源代理返回“登记服务暂不可用”；两项服务恢复后，重新模拟刷卡可继续办理。此本地运行依赖已写入 Demo README。
- 确认申请单成功进入资料填写时默认使用语音输入；患者仍可用底部按钮切换文字输入，再切回语音。此默认方式只在成功进入表单时重置，不改变患者主动切换的后续状态。

## 2026-10-22：入院 Demo 意图路由性能

- 路由调用保持使用入院 Demo Agent 自己绑定的模型及 `admission-router` Skill；全局活动模型不参与替换。隐藏运行时工具时额外屏蔽工具目录遗漏的 `delete`，语义解析不需要该能力。
- Demo Agent 配置 `model_retry_enabled=false`，避免额度耗尽时 Octop 外层重试多轮。glm-5.3-flash 当前返回 429（5 小时额度上限）；实测从约 10.47 秒/3 次调用缩至约 2.93 秒/1 次 Agent 模型调用（HTTP 429）。成功语义解析时延仍需额度恢复后复测；OpenAI SDK 内部仍会重试。

## 2026-10-23：EHR 工作站文档治理与入口

- `E:\old\pd\docs\DOCUMENT_STANDARD.md` 规定 PRD/ADR/证据/生成物/归档与知识库索引的权威来源；EHR 工程仓以 `docs/engineering/agent-team-operating-model.md` 定义 Agent 责任和交接，避免把旧 003/020 事实混为新平台规则。
- Octop `/ehr` 保持知识检索为默认首页并保留图谱，同时链接现有项目、代码工作区、源码仓库、文档中心、知识库和 Agent 管理入口。当前改动提供导航和协作标准，不代表服务器已登记私有仓库、完成知识库重建或创建了团队成员。
- 首页沿用 Octop 主导航，不重复绘制工作站侧栏；搜索页采用暖白医学编辑部视觉，首屏聚焦大搜索框并默认检索全部来源，知识图谱、项目文档、代码和 Agent 能力作为次级入口。本轮代码与生产构建已完成，尚未部署：当前源码树有多组其它未提交前端改动，不能把整包静态文件直接发布以免顺带上线无关更改。
- 搜索首页默认检索全部来源；可切换医疗结构化集合（药品、诊疗项目、诊断、知识、频次、用法）、已索引文档和代码。“已索引文档”只代表当前索引，不暗示 PD HTML 已被收录。展示来源路径，不把未校准的混合检索分数显示成百分比。
- `yy` RAG 的 BM25 关键词分在过滤候选集内归一化，避免其他类型文档压低筛选结果；改动已部署到 `ehr-rag.service` 并重启生效。PD 当前 RAG loader 不读取 HTML/图片，EHR/PD 文档索引需单独整理补齐。
- 旧 yy 源码冻结且已有代码图谱，默认以 GitHub 固定提交和现有图谱作历史证据，不将完整源码复制到服务器；图片按引用保留，只有未来需要 OCR/多模态检索时再建立图片索引。
- Octop 已有 GitHub 项目导入及受限 Docker 预览能力（需主机 Docker、项目根 Dockerfile 的数值 EXPOSE 端口；公网预览另需预览域名代理配置）。无需另造代码执行平台；是否可用须以目标服务器配置和部署状态为准。
- 用户确认的原型服务器是 `http://119.3.216.103/`，不是 WorkBuddy 云沙箱。已部署 Octop `/ehr` 工作站与经平台登录鉴权的 RAG 代理；健康检查正常、9 个 Agent 运行，未认证代理返回 401，RAG 8600 仅回环监听。旧 `yy/rag-service/deploy.sh` 使用 `rsync --delete` 并同步旧代码/数据，禁止对该目标原样运行。

## 2026-10-23：EHR 工作站部署到原型服务器

- 用户通过截图提供 SSH 认证信息并授权部署到 `119.3.216.103`；截图中的密码仅用于交互式 SSH 登录，不得写入记录或复述。此前云端 WorkBuddy 地址不作为部署目标。
- 已创建 root-only 回滚备份 `/root/.octop/backups/ehr-predeploy-20261023T090024Z`，含在线 SQLite `.backup`、config、systemd unit 和已安装 Octop 包。部署 Octop wheel `octop-1.0.2b7`（SHA256 `a10580bac42f619e332d4157c358a56756a704dfd9c510b8393c24855a9ffb05`）；重启后健康接口正常，`agents_running=9`。
- RAG/图谱作为 systemd 服务 `ehr-rag.service` 运行于独立低权限用户 `octop-rag`，只绑定 `127.0.0.1:8600`；未在公网开端口。数据包仅含检索运行模块、7,492 条筛选后索引、7,355 节点/7,932 边图谱和 ONNX 模型；不含旧 yy 全源码和原始 HIS 数据。检索 `/api/search` 的“阿司匹林”返回药品结果；图谱搜索同词返回节点；健康检查 `ok=true`。`8600` 公网探测超时。
- EHR 前端默认走 Octop 同源 `/api/ehr-rag`，后端代理复用 Octop 登录用户鉴权；未登录 `/api/ehr-rag/api/health` 返回 401。`/ehr` 返回 SPA 页面。相关代理/config/前端测试本地定向回归已通过（37 后端、8 前端；TSC/Ruff/构建也通过）。
- RAG runtime bundle 缺少原 `sources.py`，导致首次启动失败。为让预建索引/图谱只读查询运行，在服务器补了一个兼容模块，`_is_test_record` 当前固定返回 false；当前检索不调用图谱重建逻辑。若以后要重建/增量构建图谱，必须先恢复原项目准确的测试记录过滤实现，不能依赖此兼容模块。
- Docker daemon 已启动（Docker 29.6.1）；启动时发现并恢复了既有 Portainer 容器。Octop 当前未设置 `OCTOP_WORKBENCH_PREVIEW_DOMAIN`，Nginx 未发现预览代理配置，因此容器运行能力可用，但浏览器公网预览仍需配置域名/DNS/代理。文档/图片未重新导入知识库，旧 yy 图片也未建立 OCR/多模态索引；需后续按 `E:\old\pd\docs\DOCUMENT_STANDARD.md` 精简文档并再入库。


## 2026-10-23：EHR 工作站接入 Octop 创作平台

- 用户澄清工作站应作为截图所示 Octop「创作 → 平台」中的内置作品，而不是独立站点。`BUILT_IN_CREATIONS` 新增 EHR 知识工作站卡片，点击进入同平台 `/ehr`；标题说明提供中英双语。该页面复用 Octop Agent/知识库入口，临床检索和图谱仍读取同机回环 RAG 服务。
- Creations 页面回归 16 项通过；dashboard 生产构建成功。只更新服务器内置 dashboard 静态文件，先备份至 `/root/.octop/backups/ehr-creations-card-20261023/dashboard-before.tar.gz`，新 `index.html` 最后替换；保留旧哈希资源。用户打开 `/creations` 后若缓存旧 UI，需硬刷新。

## 2026-10-23：入院登记 Agent 调用与会话修复

- 初始登记使用 page=0 的单次结构化提取；重复并发 turn 请求在同进程合并，地区树按 5 分钟缓存，技能文本只在首次读取磁盘。入院调用可覆盖 Agent 默认输出上限（路由 256、确认 64 tokens），其他 Agent 仍保持原有运行参数优先级。
- Demo 与平台登记接口统一限制完整模型输入请求为 2,000 tokens：只发送精简的登记技能系统提示和脱敏后的动态 JSON，超限优先裁剪最旧历史，必需内容仍超限则返回 413；Agent 绑定模型不变，直连调用由 AgentRegistry 调用跟踪保护。2026-10-23 复测时，登记 Agent 实际绑定 `Zhipu Coding Plan (BigModel)/glm-5.3-flash`（全局活动模型虽为 ModelScope Qwen）；5 次真实合成请求输入 834–857 tokens，预检 1,109–1,130，均为单次调用且无工具，模型阶段 2.22–6.15 秒（中位 3.86 秒）。PII 脱敏后手机号由候选校验从唯一原话恢复通过；一次合成“职业工程师”未回填且触发澄清，需按职业白名单口径继续验证。 临时将内存模型引用切到 ModelScope Qwen 另测 3 次：输入 856–857 tokens、预检 1,117–1,118、单次调用，模型阶段 1.82–3.89 秒（中位数 2.45 秒），手机号恢复 3/3；学生职业通过，工程师/教师职业触发澄清。 2026-10-24 已窄同步 admission_demo.py 与该 Skill 到 119.3.216.103，远端备份 `/root/.octop/backups/admission-ai-2k-1792851601`；服务重启后 active、健康 HTTP 200、OpenAPI 中两个登记 AI 路由均已挂载。 两份 `.tmp` 部署脚本中的明文 SSH 凭据已改为读取 `OCTOP_DEPLOY_PASSWORD` 环境变量；远端 root 凭据未轮换，需由管理员安排轮换。
- 保留 20 轮交互上限、结构化字段校验、逐字段待确认和保存失败时前端撤回尚未持久化的候选值；历史按 previousTurnId 链排序。联系人电话不得误填患者电话；地区模型返回规范全路径时仅在患者原话包含对应行政区名称后接受。模型非 JSON 输出按无效响应失败处理。

## 2026-10-25：EHR业务与开发一体化文档标准

- 用户要求优先发布可指导业务与开发的高标准文档，涵盖流程、节点/状态变化、003/020双版本源码差异、图表联动、工程规范与验收；不是仅做文档分类治理。
- 文档主源：`E:\old\pd\docs\standards\EHR-BDS-001-business-engineering-standard.md`，版本1.0-candidate，In Review；同目录HTML阅读版、source-evidence.json和release-manifest.json。18节正文、3张SVG与Mermaid源、9节点联动、10项差异示例。
- 本次直接读取yy固定提交`99753aa844237286d9b7c87f561d6103d31bda77`中003/020各Controller与查询Command共四文件指定片段；不是全74项功能审核；没有运行旧客户端、数据库、支付/医保。yy未配置origin，不编造远程源码链接。
- 远端目标119.3.216.103；通过已授权SSH和BackendWorkspace.upload_bytes/download_bytes发布到共享工作区`/root/pd/docs/standards/`；产品F3XN0N与开发CBJWCP实际共享/root/pd，主持人SEAG8N工作区单独。平台已有五个相关Agent/主持人default_model均为Zhipu Coding Plan (BigModel)/glm-5.3-flash（本次远端CLI回读）。
- BackendWorkspace在此远端版本是同步接口，system_files_path必须为workspace-relative `.octop`；上传文件用实际local_shell root=/ backend及upload_bytes/download_bytes精确回读，不用猜测filesystem backend映射。保持已部署Octop服务不重启。
- 本次优先文档发布；第15节已写DOC-01至DOC-06分工，未新触发远端团队自动执行。当前无新增公开HTTP文档路由，入口为Octop产品/开发Agent工作区；不可把文件已上传说成已进入知识库索引或业务Approved。

## 2026-10-26：创作页手动更新 Git / CNB 项目

- 创作页可在内置应用卡片编辑窗口绑定 HTTPS GitHub 或 CNB（`cnb.cool`）仓库，并由管理员在卡片手动更新；独立仓库项目卡也保留更新入口。GitHub 支持公开仓库；CNB 通过「连接器」保存加密 Access Token，Git 操作时用临时凭据文件认证并随操作清除。更新使用 `git pull --ff-only`，发现本地改动、origin 不匹配或远端分叉时失败关闭。
- 仓库克隆/更新到每个卡片独立的 `~/.octop/projects/` checkout。仓库项目卡更新后清理旧预览容器和镜像，重新启动预览会重建；绑定到内置应用卡片的仓库用于拉取并保存源码，不会替换应用自带的静态发布包。
- 内置应用卡片可选绑定分支；留空时拉远程默认分支，也可以填 `main`、`dev`、`release/...`。切换前先检查工作区干净，显式 fetch 远程分支并用 `git switch` 切换，最后只允许 `git pull --ff-only origin <branch>`；旧卡片留空仍按远端默认分支更新。

## 2026-10-26：LYRA 原型评审首个页面切片

- 新增全局 `/runs` 运行记录列表与 `/runs/:runId` 详情；它和计划任务 `/tasks` 分开。列表使用现有 owner-scoped Runs API，支持状态筛选、分页和刷新；详情展示运行元信息、步骤与事件摘要，不展示输入引用或原始事件负载。
- UI 严格按服务端状态呈现：创建记录不代表执行器已启动；取消请求只有服务端确认后才显示 `cancelled`，运行中取消显示 `cancel_requested`。本切片不提供执行/重试功能。

## 2026-10-26：LYRA V2.2 全页面开发路线

- 全量页面/跨页计划位于 `docs/specs/plans/2026-10-26-lyra-page-development.md`，按 19 项拆为核心对话与 HITL、项目/运行、知识/创作/EHR/连接器/个人设置、移动响应式/设计规范及延期概念页。
- V2.2 是产品范围与状态语义，不是静态 HTML 的代码指令。项目详情必须先确认对象和共享权限；应用目录与系统管理总览属于 P2，不默认新增。
- 2026-10-27 用户明确要求将项目详情、应用目录和系统管理总览纳入开发，并确认项目先使用所有者与可撤销分享链接、应用目录使用现有应用与管理入口。页面以现有服务端对象和权限为准；不新增成员协作或应用安装能力。
- `/chat` HITL 确认卡现对参数名中的 password/passwd/secret/token/credential/authorization/cookie/API key/private key 进行递归值隐藏，保留参数名和提示；不杜撰接口未提供的权限来源或影响范围字段。定向测试、i18n、TSC、ESLint、Prettier 通过。

## 2026-10-27：定时任务与通用运行记录入口

- `/tasks` 页头提供“全部运行记录”入口导航到 owner-scoped `/runs`。Cron 任务详情里的历史仍由 Cron API 提供，状态为 `running/ok/error/cancelled/interrupted`；它与通用 Run/Step/Event 资源没有一一映射，不能把单条 Cron 历史伪装成 `/runs/:runId`。
- Login 的初始化探测不可用时仍留在登录页；认证失败保留输入并重置 CAPTCHA。Experts 对共享 Agent 的变更入口按所有者/管理员条件门控，服务端仍为权限最终边界。

## 2026-10-27：知识文档状态文案

- 知识文档 API 的 `processing` 覆盖解析、分块、嵌入和索引写入，不拆成客户端无法确认的解析中/索引中子状态。卡片与表格统一显示 pending「待处理」、processing「处理中」、ready「可检索」、failed「失败」；失败原因来自服务端 `error_message`。可见知识库读取由服务端 `get_readable_base` 校验，写操作需 `knowledge_bases` 权限并由服务端检查 owner/admin。
- EHR 默认同源 `/ehr-rag` 由 Octop 认证代理并限制上游路径；用户可在浏览器 localStorage 配置绝对 URL，随后请求直连该主机且不经 Octop 身份认证。部署需确保自定义 EHR 服务自带适当访问控制，不能把浏览器 URL 配置当成服务端权限边界。

## 2026-10-27：LYRA effect idempotency concurrency

- RunEffectRepo 在事务内使用唯一键冲突安全插入；并发同键请求只有获胜事务写 `external_effect.requested` 事件，竞争请求读取已有行并校验 owner、Run/Step、Agent、scope、资源/请求哈希及 approval。不同操作复用同一 registration-scoped key 时返回冲突。SQLite 并发回归通过；PostgreSQL 事务/锁行为仍待环境验证。
- 当前 MCP cache 和 RunEffect 仓储定向回归 8 passed；本轮全量非 live 后端 4,915 passed、211 skipped，dashboard Vitest 1,486 passed，strict mypy（622 files）、src/tests Ruff check+format、dashboard lint errors 检查与 TypeScript 通过。PostgreSQL、Provider 和其他计划中明确未实现的 Run executor/Artifact 功能仍不得报告为已验收。

## 2026-10-27：LYRA saved-message Run executor

- Run start 只能引用同一 owner、Agent、Thread 中已持久化的 human/user 消息 ID；worker 再次校验 owner、Agent 当前分享状态、Thread、message role/ID 和 active user。模型收到的身份元数据由服务端生成，原始输入不写入 Run 行。
- 单进程 RunExecutor 仅领取绑定 saved-message 的 queued Runs；Team Inbox 的 Run 不进入该 worker。Project 指令使用创建时 revision 快照，Knowledge Base 按当前用户重新校验，源文件逐次检查 owner/Agent/Thread/revision/hash；输入文本总量受限并标为不可信资料。
- Run 创建的 HITL pending 持久关联原 run_id/step_id；恢复同一 Harness checkpoint 后更新原 Run/Step。取消 waiting_approval 会终结 Run/Step 并过期关联 pending，活动 Run 取消会传播到当前协程。当前版本漂移会 fail closed 且不调用 Harness；尚未按旧 AgentVersion 创建独立 graph，因此旧版本实际执行仍未实现。RunEffectRepo 也尚未接入 Harness 工具 handler。
- 最终非 live 后端完整回归 4,921 passed、211 skipped；Dashboard `--maxWorkers=4` 全量回归 1,487 passed。Run/HITL 变更后定向集合 59 passed；Search/Media/Voice mock contract 集合 40 passed。LYRA Run/ProjectContext Dashboard 文件定向回归 5 passed；TSC、ESLint、Prettier 与生产构建通过。PostgreSQL、Provider、隔离业务端无环境时保持未验证/BLOCKED。

## 2026-10-27：LYRA Run Artifact 关联

- `run_artifacts` 关联 Run 与不可变 `chat_file_revisions(file_id, revision_id)`；API 对外以 `revision_id` 作为稳定 `artifact_id`，注册时事务校验 Run owner、Agent、Thread 与文件 revision 一致，数据库复合外键禁止 file/revision 错配。Project ID 从关联 Run 继承，不复制文件或暴露 workspace path；数据库内部关联键不对外暴露。
- Run Artifact API 支持幂等登记与 owner-scoped 列表；Run 页面可将当前 thread 文件版本关联并通过现有 revision 下载接口读取。当前仍需人工关联，尚未从 Harness 生成器自动发现/登记，也未统一所有 Project/Chat 文件入口。SQLite 新库 migration 与已有 v32 数据库的 schema repair 必须保持同定义；PostgreSQL 实机尚未验证。

## 2026-10-27：LYRA Team Run 取消

- Run cancel 对 Team `team_dispatch` Step 调用 TeamManager，给运行中的 Harness Inbox job 发取消信号。Inbox 不存在（例如进程重启丢失内存队列）时，owner-scoped Run/Step 结束为 `interrupted`，不报告成功或已取消；活动 job 必须等 Inbox 回调终态。
- Harness Inbox 对已执行中的不可中断工具没有通用强制终止保证；取消不会撤销既有外部副作用。Team 父 Run 汇总、持久 Inbox 重建与进程崩溃后的自动重新调度仍未实现。

## 2026-10-27：LYRA 文本 revision 冲突合并保护

- Chat TXT/MD/CSV 编辑冲突时读取并展示当前服务端 revision，同时保留本地分支内容；只有本地文本被编辑成合并结果后才启用基于最新 revision 的保存。不会自动把本地草稿覆盖到新 revision。

## 2026-10-27：LYRA Team 子 Run 关联

- RunExecutor 运行的 async context 将父 Run/owner 传给同一执行中的 Team dispatch；TeamManager 在入队前校验 owner，RunRepo 再校验父 Run 属于同一 owner、host Agent 且仍 running。子 Run 继承父 Project/Thread，并通过 `/api/runs/{run_id}/children` owner-scoped 查询；普通 Run API 响应不暴露 parent_run_id。
- 父 Run 的取消与重试会向自身和直接子 Run 派工发信号；同进程的入队和取消扫描共享锁，PostgreSQL 派工事务锁定父行。Team 派工/Run Repo/API 定向回归 93 passed，Home 项目 Run 子任务视图 2 passed；PostgreSQL 和多进程 Inbox 未实机验证。父状态聚合、常规 Chat turn 父 Run 关联和 Inbox 重启恢复未实现。

## 2026-10-27：LYRA Team 父 Run 聚合

- 父 Run 在 RunExecutor 的 Harness stream 结束后，必须等所有 Team dispatch 子 Run 进入终态，再收敛父 Step/Run；子任务失败优先归为 `failed/team_member_failed`，中断或取消归为 `interrupted`，未知副作用归为 `unknown_external_effect`，否则保留 Harness 的成功、失败或 `waiting_approval` 结果。等待期间继续 heartbeat；事务中更新父状态/事件并清除 lease，避免失败、审批等待时遗留活跃租约。
- PostgreSQL 锁父行的 SQL 路径已实现但未实机验证；Inbox 仍是内存队列，重启恢复与多进程协调未完成。RunExecutor 串行消费会使单个等待子任务的父 Run 延迟后续普通 Run，未来应基于负载和运行限制再决定并发模型。
- 父 Run 聚合/审批等待/执行器定向回归 8 passed；完整非 live 后端 4,937 passed、211 skipped；Dashboard 282 files / 1,498 passed；Ruff 1,289 files、strict mypy 624 source files、Dashboard TSC/ESLint/build 均通过。

## 2026-10-27：LYRA Team Inbox lease fencing

- Team Inbox 的 Run 使用 `runs.lease_owner/lease_expires_at` 记录 dispatcher 实例；同一实例对本地 queued/running job 每 10 秒续租，丢失 lease 时取消本地 Inbox job。RunExecutor 每 30 秒只收敛已过期的 Team lease，所以多 worker 不会仅因另一个实例刚启动就判定活动 job 失效。
- 过期 queued 派工归为 `interrupted`；过期 running/cancel-requested 归为 `unknown_external_effect`，从不自动重放。Inbox 消息正文仍未持久化，服务重启后不能恢复执行；这只使旧状态最终可见、避免永久悬挂。真实 PostgreSQL 与多进程压力未验证。
- Team/Run 定向集合 105 passed，新 lease/reaper 子集 5 passed；Ruff 与 strict mypy 通过。上一轮完整后端 4,937 passed、211 skipped 是 lease 改动前结果，最终完整回归必须重跑。

## 2026-10-27：LYRA 项目 Run Artifact 入口

- Home 项目 Run 历史加载 owner-scoped `/runs/{run_id}/artifacts`，显示文件名与 revision 并使用已有 `downloadAuthFile` 调用受保护 content URL；不引入 workspace path 或另一套下载授权。Run 详情还展示 owner-scoped Effect scope/status，unknown 提示先核查业务系统，不提供自动重试或假对账。Run Event API 的安全 allowlist 错误码现在由 Run/Project 详情双语显示，不呈现异常正文；waiting_approval Run 可回到其绑定 Agent/Thread Chat，由已有 HITL UI 完成用户决策，工作台不代批。组件测试覆盖 API 加载、认证下载、审批路由、Run Event 固定错误码与 Run Effect unknown 状态展示；Run/ProjectRuns UI 9 passed。dashboard i18n 与 RunExecutor 组合回归 83 passed，TSC、ESLint quiet 和 touched TSX Prettier 通过。Dashboard 全量在 4-worker 下 1498 passed、3 timeout；AdmissionDemo/Channels 两个文件单 worker 定向 21 passed，最终全量门禁仍待重跑。Dashboard 子应用 static serve 测试需区分 iframe 舞台壳 `index.html` 与实际入口 `app.html`。RunExecutor 执行期会将项目指令和引用文件文本作为 JSON 上下文，并明确标记来源文件为不可信数据；`tests/unit/test_run_executor.py` 验证恶意指令字符串被标记、任务文本边界保持，未模拟模型是否会抵抗该指令。

## 2026-10-27：LYRA Chat 文本 revision 行差异

- TXT/MD/CSV CAS 冲突 UI 逐行对比服务端最新版本与本地草稿；使用 LCS 输出新增/删除/相同行，最多 20 万字符及 100 万矩阵单元，超限保留手动查看/合并路径，避免大文件触发无界计算。
- 行差异和冲突 UI 定向 Vitest 5 passed；TSC、相关 TSX ESLint quiet 与触及文件 Prettier 通过。JSDOM 仍打印 Ant Design 伪元素样式未实现警告。
- 本轮 Dashboard 全量低并发测试通过：283 files / 1,504 tests，无失败或超时，835.53 秒。
- 随后端全量复跑通过：4,943 passed、211 skipped、0 failed（972.61 秒）；Ruff check/format（1,289 files）和 strict mypy（624 files）通过。
- RunExecutor 项目上下文隔离回归对相同任务文本使用两个不同 ProjectContext，确认各自 prompt 不含另一个项目专属内容；test_run_executor.py 4 passed。

## 2026-10-27：LYRA Team Inbox queued crash recovery

- Team dispatch 的 queued 输入载荷放入独立 `team_dispatch_payloads`，使用专属 SecretRepo Fernet key 加密，不进入 Run/Step/Event API 投影；输入限 1 MiB。完成、失败、取消或中断事务清除密文。
- AgentManager 启动完成后、RunExecutor 启动前先扫描一次并原子 claim lease 已过期且 Run/Step 都为 queued 的 dispatch；运行期每 5 秒扫描。恢复使用原 inbox ID，提交前重新校验 owner、来源 thread，并调用 Harness `submit_peer` 的当前成员授权解析。claim 先更新 lease owner，旧实例的 start 被 fencing 拒绝。子派工的父 Run 还必须为 running 且父 lease 有效。
- running/cancel-requested 不恢复，保留 unknown external effect / existing reaper 语义；无有效密文、解密失败或当前授权失效时固定收敛为失败且不记录异常或任务正文。没有 secret repo 的轻量/测试装配不启用恢复。
- Team/Run/migration 定向回归 111 passed、1 skipped；完整非 live 后端 4,947 passed、211 skipped、0 failed；Ruff check/format（1,290 files）与 strict mypy（625 source files）通过。本节 supersedes 前文“Inbox 未持久化/queued 重启后不可恢复”状态。PostgreSQL 实机与多进程负载仍未验证。

## 2026-10-27：LYRA Chat File legacy workspace read guard

- 对 `/workspace/file`、`/workspace/download`、`/workspace/doc` 和媒体预览读取已登记 ChatFile revision 的旧 workspace 路径时，重新查询 agent、owner、删除状态与 revision SHA256；不唯一、软删除、跨用户或字节已变化时 fail closed。共享 Agent 用户不能通过猜 `inbound/...` 绕过精确的 File API owner 检查。
- 删除仍是 DB soft delete，物理 workspace bytes、通用 tree/archive 隐藏与过期清理未统一；这些路径仍需后续处理。Chat Files/Workspace 集成回归 38 passed。PostgreSQL / remote backend 实机未验证。

## 2026-10-27：LYRA ChatFile workspace listing/archive isolation

- Agent owner 的 workspace tree、glob、grep、ZIP archive 必须过滤已登记的其他用户和软删除 ChatFile 路径；exact-path 读取继续检查唯一 owner、deleted_at 和 SHA256。删除 draft 后尝试物理移除其 revision bytes；若存储删除失败，软删除元数据仍使旧 URL fail closed。
- 不自动清理未绑定草稿或历史 revision；删除保留期尚无合同，未经确认不能设置推断的自动数据清理期限。
- ChatFile/Workspace/archive 集成回归 48 passed；Ruff check/format 1,290 files 和 strict mypy 625 source files 通过。新的全量后端测试与 PostgreSQL/remote backend 实机验证待完成。
- Workspace ZIP merge/replace 导入必须跳过所有已登记 ChatFile revision 路径；replace 清理只移除未受保护内容，保留受保护 revision 与祖先目录。冲突路径以 warning 告知；扩展定向回归 50 passed，最终完整非 live 后端回归 4,958 passed、211 skipped、0 failed。首轮全量出现一次 locale parity failure，i18n 子集 80 passed 且最终完整复跑通过；未改 locale。

## 2026-10-27：Team Agent 流启动失败误报

- Chat composer 显式选择的模型会覆盖 Agent 绑定默认模型；截图当时选中 `ModelScope/Qwen`，所以该轮并非使用绑定的 GLM-5.3-Flash。
- 流报错中的 `SEAG8N` 是 Team host Agent ID。按需启动逻辑在 `_start_agent` 启动失败后会返回，但 `_ensure_running` 仍继续调用 Harness，最终将缺少注册项的 `KeyError(agent_id)` 显示成模型错误。已在工作区增加启动失败短路并用 `AGENT_FAILED` 映射，同时加单测；10 项定向测试和 Ruff 检查通过。
- 远端 Team host 启动失败的具体原因仍需查看服务器 `last_error`/日志；本地补丁未提交或部署，浏览器自动化读取远端详情超时，SSH 当前不可用。

## 2026-10-27：入院登记首页分层意图路由

- 首页意图链路保留“入院登记/住院登记”精确匹配短路；其他表达先尝试已配置且已下载的本地 ONNX embedding 对固定意图样例做 cosine 排序，再使用 Octop「模型与算力」中已配置的 `groq` 供应商和 `qwen/qwen3.8-27b` 做严格 JSON Schema 意图决策。Groq 未配置、模型不可用、限流、超时、输出无效或置信度不足时回退原绑定模型；开始办理阈值 0.9，其他意图为 0.8。发到 Groq 的用户原话先做 PII mask；流程问答仍由原绑定模型生成文本。
- 不再要求单独的 `OCTOP_ADMISSION_DECIDER_API_KEY`；决策器复用 provider repo 中已配置的 base URL、密钥和启用模型。仅用无患者信息样例实测 Groq API：Qwen 3.8 27B 对入院开始、问候、流程问答、无关输入分别返回预期类别，confidence 0.95–1.0。聊天中出现的 API key 应撤销并在管理页轮换；源代码不保存该 key。
- Groq 切换后入院路由与 config 单测 85 passed、API 集成 14 passed；触及文件 Ruff check/format 和 admission/config/API strict mypy 通过。全仓 `make all` 未运行。实时 Groq API 用四条不含患者信息的例句分类通过；项目端复用 provider 配置的 API 调用由 fake provider 单测覆盖，未对本地运行实例的 DB provider 记录做真实端到端调用。
# 2026-10-27：EHR 门诊收费交付中心

- EHR 工作站右侧入口由泛化医学问答改为门诊收费交付中心，展示 `E:\old\pd` 的 PRD 主源与私有仓库 `xdguo-design/ehr-platform` `dev` 分支的真实代码映射，并提供受登录保护的 `/ehr-demo/charging/chargeworkbench` 运行入口。
- 当前 `ehr-platform` 只完成收费草稿首切片；正式支付、票据、退费与日结不得标记为已完成。PRD `PRD-001` 仍为 `In Review`，其余实现规格展示为 `Partial`。
- 现有 GitHub 工作台导入只支持公开仓库，不能把私有 `ehr-platform` 伪报为已自动拉取/一键启动；后续需要服务器现有 checkout 路径或私有仓库凭据接入，才能注册真正可启动的工作台项目。

## 2026-10-28：EHR 匿名只读交付入口

- EHR 创作卡保持内部打开 `/ehr`，复制链接改为 `/public/ehr`。公开路由位于 AuthGuard 与 Octop 主布局之外，不加载侧栏、AgentProvider、设置或内部工作台链接。
- 匿名访问不使用共享/代理账号自动登录；服务端仅豁免 `/api/public/ehr/health` 与 `/api/public/ehr/search`。搜索固定为公开医学类型，按客户端限流，并过滤代码、文档、Agent、workspace、内部路径及非白名单元数据。
- 公开页只展示门诊收费 PRD/代码文件的只读对应关系，不提供私有仓库、PRD 正文、代码工作区或运行 Demo 的跳转。当前变更尚未部署到 `119.3.216.103`，远端上线必须在恢复部署通道后再验收。

## 2026-10-28：ACP Runner 直聊模型设置

- ACP 直聊模型默认值保存在用户级 Runner 配置的 `default_model`，必须在各自 Runner 编辑面板中选择；来源是该 Runner 的 ACP `config_options`，不能假设 CLI 都使用同一 `--model` 参数。工作台直聊使用该默认值并隐藏通用模型选择器；未暴露模型选项的 Runner 使用 CLI 自身默认值。
- 直聊与模型发现按 Runner ID 通用化；模型发现仅对已启用 Runner 执行。旧版 per-agent OpenCode `acp.default_model` 作为兼容回退，清空新 Runner 默认值后不再回退到旧字段。

## 2026-10-28：Octop 上的 HIS 证据驱动研发

- 用户要求 HIS 收费等后续工作由 Octop 按 PRD、目标院区证据和现有代码持续生成，并双向同步前端与交互原型。业务基线：现行 020；003/020 冲突保持待决；ehr-auth 本地账号密码、首次启动创建管理员并强制改密；真实医保/支付/票据接口无契约/联调环境时仍为 TODO。
- Octop 已有项目指令/知识库 Run 快照和只读源码浏览，但 `GET /workbench/projects/{id}/code` 不能写入仓库。EHR 专家模板可规范需求追溯与交付；在隔离可写工作树、差异审阅和验证执行能力落地前，不得宣称 Octop Run 已修改目标仓库。

## 2026-10-28：HIS PRD 文档入口与正式登录路由

- `/ehr/prd` 内展示完整 PRD 正文；`dashboard/src/pages/EhrWorkbench/PRD.md` 是从 `E:\old\pd\prd\经济\门诊收费\PRD-门诊收费-重梳理草案.md` 同步的构建快照，源 PRD 更新后必须同步此文件再构建前端。
- `/ehr/login` 与首页登录入口应打开 `ehr-platform-console` 的正式 `/login` 页面（本地 Vite 默认 `5190`，部署时通过 `VITE_EHR_CONSOLE_URL` 配置基地址）。不要在 Octop 里模拟认证成功；当前 Console 的 API 仍接旧认证，不能称为 ehr-auth/HIS 认证验收，需待 ehr-auth 实现和接入后升级。
