# 对话文件工作流：分阶段开发计划

日期：2026-10-17。状态：用户已授权实施；这是分阶段计划，未完成项不得宣称已交付。

**目标：** 在 Home/Chat 完成文件上传、理解、来源定位、连续追问、生成、在线修改、版本管理和导出闭环。

**架构要点：** 保留现有上传、聊天传输、工作区和文档查看器；增加文件领域合同、结构化读取及受控任务；生成/修订保留不可变版本，不引入必需外部服务。

**技术栈：** 现有 Python 3.12+/FastAPI/asyncio/SQLite/PostgreSQL、React/TypeScript；已有解析、Office、图片和浏览器依赖。

**关联规格：** [需求与验收](../2026-10-17-chatgpt-file-experience-requirements.md)、[详细开发设计](../2026-10-17-chatgpt-file-experience-design.md)。

## 1. 执行约束和工作量

- 本计划覆盖用户要求的完整范围；每个阶段都有可运行交付，但不能把首阶段当成总体完成。
- 先确认设计，再逐任务开发。测试先覆盖外部行为和真实失败模式，不为简单样式改动堆测试。
- 当前工作区有大量其他任务修改；实施先记录基线，禁止 reset、清理未跟踪文件或把其他任务一并提交。
- 不自动 commit/push/部署。开发分支从用户指定基线创建；仓库日常功能默认以 develop 为基线，但本地 dev 是已有工作，未经确认不切换丢失上下文。
- 新测试文件在对应任务中创建；本文所有新增 API/工具/文件名都是拟实施合同，不代表已存在。
- 时间估算按一名熟悉代码库的全栈工程师、已有可用测试环境计算；有效工程时间约 24–35 人日，实际排期随基线、模型联调、版式转换和共享 Agent 隔离调整。

| 里程碑 | 任务 | 工作量估算 | 可演示结果 |
|---|---|---|---|
| M0：合同与基线 | T00–T01 | 2–3 人日 | 现状证据、权限模型、迁移策略、文件身份 |
| M1：可靠读取 | T02–T04 | 5–7 人日 | 核心格式有真实正文、coverage、失败状态 |
| M2：对话与展示 | T05–T07 | 4–6 人日 | Home/Chat 一致预览、引用、追问、多文件比较 |
| M3：修改与生成 | T08–T11 | 7–10 人日 | 新版本保存、基础在线编辑、有效 Office 成品 |
| M4：导出与恢复 | T12–T13 | 3–4 人日 | PDF/多格式导出、删除/重启/取消恢复 |
| M5：发布验收 | T14–T15 | 3–5 人日 | 全套质量门禁、真实浏览器闭环、部署手册 |

依赖主线：`T00 → T01 → T02/T03 → T04 → T05/T06 → T07 → T08 → T09/T10/T11 → T12 → T13 → T14 → T15`。斜杠仅表示可独立安排，不要求派发并行代理。

## 2. 文件影响清单

### 复用和必要修改

- 后端上传/发送：`src/octop/api/routers/uploads.py`、`api/common/attachments.py`、`api/routers/chat/{turn,serialize,models}.py`。
- 模型输入/工具：`src/octop/infra/gateway/process/harness_request.py`、`infra/agents/manager.py`、`infra/agents/middleware/{binary_read_guard,thread_artifacts}.py`。
- 解析/编辑：`src/octop/infra/knowledge/{parse,ocr}.py`、`infra/utils/doc_edit.py`，现有兼容入口保留。
- 组合根和 DI：`src/octop/infra/db/services.py`、`infra/server.py`、`api/app.py`、`api/openapi_meta.py`。
- 前端合同：`dashboard/src/api/modules/upload.ts`、`pages/Chat/hooks/{sseHelpers,useChat,chatStore,useChatAttachments}.ts`、`pages/Chat/utils/chatAttachments.ts`。
- 前端页面和预览：`pages/Home/index.tsx`、`pages/Chat/{index,ChatFilePreviewContext}.tsx`、`pages/Chat/components/{MessageFileCard,MessageBubble,FilePanelContent,ChatDockPanels}.tsx`、`components/{DocumentPreviewCore,PdfDocumentPreview}.tsx`。
- 国际化和部署文档：后端/前端 en/zh、README、`.env.example`（只有新增实际配置才修改）、现有 CI 和容器配置（按实现需要）。

### 建议新增

- 后端：`src/octop/infra/files/{__init__,models,service,parse,tasks,worker,tools,edits,exports}.py`，`infra/db/repos/chat_files.py`，`api/routers/files.py`。
- 前端：`dashboard/src/api/modules/files.ts`，`pages/Chat/components/{ChatAttachmentList,FileReadStatus,FileCitation,FileVersionSelector,FileEditor}.tsx`，`pages/Chat/hooks/useFileTask.ts`，`utils/parseFileCitations.ts`。
- 迁移：依 T00 的发布状态核查选定编号的 SQLite/PostgreSQL SQL 对；不在草案中硬编码未知版本号。
- 测试：按下列任务逐项列出；夹具使用合成文档和临时目录，不能提交真实用户文件。
- 人类文档：`docs/chat-files.md`，涵盖使用、运行、测试、部署、格式支持、错误恢复和限制。

模块文件可以在实施中合并为空间适当的邻近模块，但公开合同、测试范围和层级边界不能省略。

## 3. 逐项实施任务

### T00：冻结现状、权限和兼容基线

涉及现有上传/发送/预览/知识库解析/文档编辑测试、`tests/unit/db/test_db_pool.py`、迁移目录和发布记录。

- [ ] 阅读 `memory.md`、本组规格及最近相关修改；保存 `git status --short`，确认当前分支和未提交改动来源。
- [ ] 运行下方现有回归入口，分别记录通过、失败、环境缺失，不能把基线失败归给本功能。
- [ ] 确认当前实际 schema（源码断言为 22）和已发布/未发布状态，决定迁移折入或新编号，并写入 memory。
- [ ] 审计 private/shared Agent 在 upload、preview、download、workspace、shell 工具处的访问边界；新能力首先限定私有 Agent owner。
- [ ] 确认模型视觉、OCR、Chromium、字体、原版式转换器的实际能力，形成机器可查询的 capabilities 合同。

完成条件：有可复现的基线报告；新方案不依赖无法验证的“工具已就绪”；迁移编号和权限边界有依据。

### T01：文件身份、版本基础和上传合同

新建 `infra/files/models.py`、`infra/db/repos/chat_files.py`；修改 services、uploads、attachments、ChatTurnBody；创建所选迁移 SQL 对。

- [ ] 先创建 `tests/unit/files/test_file_identity.py`、`tests/integration/test_chat_files_api.py`，覆盖同名文件、不同用户、首次线程绑定、跨线程拒绝、旧响应兼容。
- [ ] 实现四张表及 repo 的 SQL CRUD；插入原始版本和当前指针使用事务；public ID 外键符合仓库约定。
- [ ] 上传在现有返回字段上增加 file_id/revision_id/size/read_status；工作区写入失败、DB 失败执行可验证的补偿。
- [ ] 新结构块按可信记录解析，禁止客户端用 file_id 配另一个路径；草稿只能绑定当前用户所属线程。
- [ ] 旧 path-only 历史只在可证明归属时登记，旧调用不因新增字段而失败。
- [ ] SQLite 新建/升级/重复迁移/当前 watermark 修复、PostgreSQL 等价结构与外键均测试。

验证：`uv run pytest tests/unit/files/test_file_identity.py tests/unit/db/test_db_pool.py tests/integration/test_upload_api.py tests/integration/test_chat_files_api.py -q`。

完成条件：上传结果可稳定绑定线程；不能越权；不丢原件；旧上传合同仍可用。

### T02：结构化读取、位置和覆盖范围

修改 `infra/knowledge/parse.py`，新增 `infra/files/parse.py`；保留原 `parse_document` 返回字符串接口。

- [ ] 创建 `tests/unit/files/test_parse_segments.py`，样例包括 UTF-8/GB18030、PDF 文本/扫描混合页、DOCX 表格/修订文本、XLSX 多 Sheet/空缓存、CSV 引号换行、PPTX 文本。
- [ ] 新增带 locator 的片段提取入口；旧知识库接口以兼容方式消费结构化结果，保持现有文本顺序和特例行为。
- [ ] 对页、单元格、条目、字符进行遍历过程中的限制；不能先展开所有内容再截断。
- [ ] 为 PDF 空文本页报告 page 状态；编码失败、加密、损坏、超限分别返回领域结果。
- [ ] 归一化 coverage：提取总范围、失败范围、未知总量、partial 原因，与后续模型使用范围分离。
- [ ] 明确单次预算与版本累计预算；支持指定后续范围追加。同 revision 固定 parse_version，已提交片段不可改写，ordinal 仅追加；并发追加事务串行分配，重叠 locator 去重。
- [ ] 解析自带文本不在浏览器主线程运行；仅预览所需的数据送往 UI。

验证：`uv run pytest tests/unit/files/test_parse_segments.py tests/unit/knowledge/test_parse.py -q`。

完成条件：每条引用位置可由夹具原件验证；旧知识库解析测试通过；超限不伪装全文。

### T03：受控任务、OCR 和资源限制

新增 `infra/files/tasks.py`、`worker.py`，按服务生命周期接入 `infra/server.py`；复用 `knowledge/ocr.py` 的底层能力。

- [ ] 创建 `tests/unit/files/test_tasks.py`、`test_worker_limits.py`；用可控阻塞子进程验证硬超时及终止等待。
- [ ] 接受任务前完成幂等和容量事务；worker 使用无 shell 的结构化参数，最小环境，不继承服务密钥。
- [ ] 通过 BackendWorkspace 获取临时输入；子进程仅处理本次受限副本，输出有界 JSON/文件；异常退出清理临时数据。
- [ ] 实现每实例/每用户并发、有限排队、租约、generation CAS、取消和过期任务恢复。
- [ ] 实现 retry 端点的 expected_generation 条件重试；重复旧代次返回当前状态，不能重复入队；旧 worker 即使晚返回也不能提交。修改规格必须创建新操作而非复用重试。
- [ ] OCR 逐页启用；依赖缺失不自动安装；无图拒答/空白/失败不能成为可信原文。
- [ ] 超时、取消、删除和退出都回收子进程与句柄；Windows 和 Linux 分别验证。

验证：`uv run pytest tests/unit/files/test_tasks.py tests/unit/files/test_worker_limits.py -q`。

完成条件：超时后实际进程退出，服务仍可响应；旧任务不能覆盖新状态；OCR 缺失能清晰降级。

### T04：文件领域服务和 HTTP 读接口

新增 `infra/files/service.py`、`api/routers/files.py`，注册 app/tags 和 i18n。

- [ ] 在 `tests/integration/test_chat_files_api.py` 扩展 files/read/segments/search/tasks/capabilities 及分页范围用例。
- [ ] 实现设计表列出的读取、检索、任务查询、取消与文件列表端点；路由仅校验 HTTP、调用领域服务和映射错误。
- [ ] 每次取正文/任务结果都重新检查用户/Agent/线程；capabilities 反映实际依赖和模型配置。
- [ ] 统一错误码并同步后端 errors 与前端 apiErrors；读文件响应不缓存到公共缓存。
- [ ] 新文件通过旧 preview/download 入口访问时执行同等授权，不能存在路径绕过。
- [ ] 检查 `/api/docs` 的请求字段、错误响应、鉴权说明和 response_model。

验证：`uv run pytest tests/integration/test_chat_files_api.py tests/unit/i18n -q`。

完成条件：核心格式可在 API 上完成上传 → 解析 → 取片段；越权和超限明确拒绝。

### T05：上传状态、附件卡片和 Home/Chat 预览统一

新增 `ChatAttachmentList.tsx`、`FileReadStatus.tsx`、`useFileTask.ts`、API files 模块；修改 Home/Chat、上传 Hook、消息附件类型和历史适配。

- [ ] 扩展 `useChatAttachments.test.tsx`：一项失败不吞成功结果、并发最多 3、移除中的完成回调不重新加回附件、切 Agent 后不串文件。
- [ ] 上传独立条目状态和有界队列；已有 500 文件收集上限与本次 10 文件解读上限分别处理。
- [ ] 复用 MessageFileCard/图片渲染及 FilePanelContent；Home 接入统一预览上下文，用户历史气泡显示附件。
- [ ] `ChatAttachment`、本地乐观消息、WS 回包、历史序列化同时保留 file_id/revision_id；不能只改上传响应。
- [ ] 使用有限轮询获取读取状态，窗口隐藏/任务结束停止，返回前台重新同步。
- [ ] 补充键盘、移动端全屏面板、重试和纯附件消息测试。

验证（dashboard 目录）：`npm run test -- src/pages/Chat/hooks/useChatAttachments.test.tsx src/pages/Chat/components/ChatAttachmentList.test.tsx src/pages/Home/home-workbench.test.tsx`；`npx tsc -b`。

完成条件：Home/Chat 都能看到原件和真实读取状态；刷新历史不丢附件；批次失败可恢复。

### T06：模型读取工具和上下文策略

新增 `infra/files/tools.py`，接入 Agent manager 与 harness_request；保留 binary_read_guard。

- [ ] 创建 `tests/unit/files/test_file_tools.py`、`test_file_context.py`，使用捕获请求的 fake 模型检查真实 payload。
- [ ] 注册 `read_chat_file`、`search_chat_file`；可信 runtime 注入 user/agent/thread，模型参数不得覆盖身份。
- [ ] 根据模型能力发送图片/文本；不支持视觉或超过直接图片数量时明确状态，按授权分批处理。
- [ ] 构建文件索引、选定片段、coverage 和附件信任边界；限制 token/字符并预留输出预算。
- [ ] 长文件总结采用有上限的分段任务；记录已处理块，超出预算返回部分结果，不能声称完整处理。
- [ ] 现有 Ask/Plan/Craft 与 HITL 规则保持一致：允许只读文件理解不意味着开放 shell/写入/发送。

验证：`uv run pytest tests/unit/files/test_file_tools.py tests/unit/files/test_file_context.py tests/unit/agents/test_binary_read_guard.py tests/unit/gateway/test_attachment_hints.py -q`。

完成条件：fixture 正文实际进入模型输入；文件恶意指令未成为高优先级指令；超限范围可见。

### T07：来源定位、多轮追问和多文件比较

新增前端 `parseFileCitations.ts`、`FileCitation.tsx`；扩展预览器定位参数、context、消息 metadata 与后台 citation resolver。

- [ ] 创建 `tests/unit/files/test_citations.py`、`parseFileCitations.test.ts`、`FileCitation.test.tsx`。
- [ ] PDF 定位页；XLSX 定位 Sheet/范围；TXT 定位行；DOCX 定位提取段落；PPTX 定位幻灯片。预览器暂不支持的位置退回原文片段，不生成假页码。
- [ ] 引用严格校验 file/revision/ordinal，展示真实文件名和版本，不接受任意 URL/路径。
- [ ] 历史恢复相同引用；文件删掉后显示已删除，版本切换不重定向原引用。
- [ ] 测试部分读取后追加、OCR 补充及解析器升级：旧 ordinal 不改写；已存在正文的修正/重新分块创建新 revision；达到累计预算只拒绝追加，不清掉旧引用。
- [ ] 追问从当前线程文件集合解析；有同名/歧义先澄清；比较结果每项列出各自来源。
- [ ] 表格汇总提供受限确定性操作和范围证据，无任意 eval，不把空缓存当零。

验证：上述后端/前端新增测试 + `tests/unit/api/test_chat_serialize.py`；真实双文件样例人工核对引用和数值。

完成条件：用户可从结论回到对应原文；继续追问无需重复上传；文件/版本不会混淆。

### T08：版本事务、冲突和编辑合同

新增 `infra/files/edits.py`、前端 FileVersionSelector；扩展 revision API。

- [ ] 创建 `tests/unit/files/test_revisions.py`、`tests/integration/test_chat_file_edits_api.py`。
- [ ] base_revision 和当前版本条件更新；两次并发保存只有一个成功，另一方不得覆盖已提交版本，并保留草稿。
- [ ] 区分入队前 HTTP 409 与已接受任务提交时 failed/VERSION_CONFLICT；两种状态都保留草稿，客户端不能把 202 当保存完成。
- [ ] 候选副本先写入和校验，成功后原子更新 DB 指针；旧原件/引用保持不变。
- [ ] 原上传和工具工作文件登记时形成独立版本快照；通用 workspace 写接口禁止直接改注册版本路径，摘要失配时拒绝把新字节冒充旧版本。
- [ ] 编辑操作采用格式对应的受限结构，校验位置/大小/对象类型；禁止客户端传最终宿主路径。
- [ ] 同幂等键重复请求返回相同任务/结果，不产生重复版本。

验证：`uv run pytest tests/unit/files/test_revisions.py tests/integration/test_chat_file_edits_api.py -q`。

完成条件：冲突不会丢数据；编辑失败不改变当前版本；可下载历史版本。

### T09：文本、DOCX、XLSX/CSV 在线编辑

新增前端 FileEditor；复用 Monaco、表格展示、`doc_edit.py` 和 openpyxl。

- [ ] 创建 `tests/unit/files/test_document_edits.py`、前端 `FileEditor.test.tsx`。
- [ ] 文本提供草稿、保存、取消和切换提示；新版本重新触发解析，旧解析结果不复用到新内容。
- [ ] DOCX 段落/表格修改优先保留其他对象；使用简化 Markdown 模式前显示格式损失并另存，不覆盖原件。
- [ ] XLSX/CSV 提供单元格/范围编辑和类型校验，明确公式与缓存区别；隐藏 Sheet 策略由界面和读取范围共同显示。
- [ ] CSV 安全文本导出和原样导出区分；JSON/代码/HTML 只编辑文本，不执行。
- [ ] 旧 workspace 编辑入口与新文件版本合同统一：注册文件不得被旧路径写入静默绕过版本保护。

验证：新增测试、`tests/unit/utils/test_doc_edit.py`、`tests/integration/test_workspace_api.py`，前端 tsc。

完成条件：用户可在面板保存有效新版本；复杂 DOCX 不静默丢失对象；旧编辑功能保持可用。

### T10：图片、PDF、PPTX 基础在线编辑

复用 Pillow、pypdf、python-pptx 和已有预览器，扩展受限 edits。

- [ ] 创建 `tests/unit/files/test_media_edits.py`，含图像尺寸边界、PDF 页范围、PPTX 错误形状定位和原件不变断言。
- [ ] 图片裁剪/旋转/基础标注，验证真实像素范围，输出副本。
- [ ] PDF 批注与页面操作、PPTX 选定形状文本编辑；新版本可重新打开，操作结果与请求一致。
- [ ] PDF 正文改写走新建重排版文件；UI 明确该差异。PPTX 复杂文本样式变化在保存前说明。
- [ ] 前端使用实际服务器 capabilities 展示编辑按钮，不支持的动作不伪装可用。

验证：`uv run pytest tests/unit/files/test_media_edits.py -q`；图片/PDF/PPTX 前端动作测试；人工查看修改后的实际页面。

完成条件：所有格式矩阵承诺的基础动作可用，原件和旧版本保持完整。

### T11：对话生成及成品登记

复用现有办公 Skills、线程 artifacts，新增统一校验和登记逻辑。

- [ ] 创建 `tests/unit/files/test_artifact_registration.py`、`tests/integration/test_chat_file_generation.py`。
- [ ] 生成规格明确目标格式/源引用/输出结构；现有工具按当前模式和权限执行。
- [ ] 生成 DOCX/XLSX/PPTX/TXT/Markdown，检查真实格式、必要内容和非空，再写入文件/版本/线程记录。
- [ ] 工具声称成功但未写文件、写了空文件、后缀伪装、越界路径时拒绝登记；通用产物扫描不能自动信任模型给出的路径。
- [ ] 成品卡片在实时对话和历史均可预览/下载；取消和重试不产生不受控重复文件。
- [ ] 对话式修改使用明确 source revision，复用 T08 编辑合同，不能偷偷覆盖源文件。
- [ ] 适配现有 Team peer→room 的路径镜像：仅在可信委派关系和两侧权限成立时复制到 host 工作区并登记独立 file/revision；旧 artifacts 保持兼容。测试 host/member 同 owner 成功、跨 owner/未授权拒绝、重试不重复登记，不能跨线程原样挂成员 file_id。

验证：上述测试 + `tests/unit/agents/test_thread_artifacts.py`；合成中文报告/多 Sheet 账表/演示文稿真实生成并重开。

完成条件：用户得到有效成品，不以代码块或模拟下载链接代替。

### T12：PDF 和跨格式导出

新增 `infra/files/exports.py`；复用 Chromium 打印、文档库和既有下载路径。

- [ ] 创建 `tests/unit/files/test_exports.py`、`tests/integration/test_chat_file_export_api.py`。
- [ ] 实现 Markdown/受控 HTML/表格内容 → PDF、Markdown → DOCX、CSV ↔ XLSX 等格式矩阵承诺路径。
- [ ] Chromium 浏览器初始化、退出、超时回收；使用本地受信任字体，拦截外部网络和不可信脚本。
- [ ] 原版式 Office → PDF 先探测实际转换器；可用时使用无 shell 固定命令和受限临时目录，不可用时明确提供重排版模式或不支持。
- [ ] 验证中文字体、分页、长表溢出、页数和核心内容；导出结果创建独立 file_id 和首版并记录来源，不能覆盖源文件或移动其活动版本指针。
- [ ] 下载失败、登录过期、取消和重复导出都有可恢复状态。

验证：上述测试；真实查看 PDF 页图和 Office 原件；对比源字段、表头及数量，不能只断言文件存在。

完成条件：每条已启用导出路径产物真实可用；能力缺失时没有虚假成功。

### T13：生命周期、删除和中断恢复

完善 files service/tasks、线程删除关联和历史读取。

- [ ] 创建 `tests/unit/files/test_lifecycle.py`，覆盖删除/完成竞态、撤权、草稿过期、孤儿文件、重启租约过期。
- [ ] 文件逻辑删除立即阻断所有新旧读取/预览入口，再异步清理；旧引用保留可读的失效提示。
- [ ] 每个版本路径仅属于一个文件，不跨线程复用；来源引用不授权、也不递归触发删除其他文件。
- [ ] 24 小时未绑定草稿清理；失败清理有有限重试和脱敏诊断，不无限积压。
- [ ] 重启恢复只读任务与付费生成任务区别处理；页面重开按 task_id 恢复，不重复发起写入。

验证：`uv run pytest tests/unit/files/test_lifecycle.py tests/unit/files/test_tasks.py tests/integration/test_chat_files_api.py -q`。

完成条件：历史、删除和恢复行为一致；后台完成回调不能复活文件。

### T14：对抗性与完整闭环验收

- [ ] 构建 `tests/support/file_fixtures.py`：合成中英文 PDF、扫描/混合页、表格、DOCX 图片/表格、PPTX、损坏和超限夹具；不下载来源不明测试文档。
- [ ] 为 T00–T13 的真实行为补齐有意义测试；安全测试同时覆盖新 API、旧路径访问和 Agent 工具，不只测 owner 字段。
- [ ] 检查模型发送 payload，确认图片/文本/范围确实传入，且提示注入未提升权限。
- [ ] 在 Linux/Windows 运行进程退出、路径、临时文件、Unicode/长文件名、版本并发和 DB 迁移测试。
- [ ] 运行下方完整门禁，在干净可控工作区生成前端产物，检查无无关改动。
- [ ] 按第 5 节逐步做真实浏览器验收，保存合成样例、操作记录和脱敏结果。

完成条件：AC01–AC10 全部有证据；环境缺失和失败必须明确记载，不能用单测代替实际功能通过。

### T15：运行文档、部署和回滚演练

- [ ] 完成 `docs/chat-files.md`，在现有 README 链接入口，说明格式差异、读取范围、编辑保护和任务恢复。
- [ ] 记录实际新增依赖/配置；没有新增时明确复用现有项目，不生成空配置或平行 Docker 项目。
- [ ] 部署前备份 DB/工作区、验证迁移、安装授权 OCR/Chromium/字体，并设置容器/服务内存及临时目录配额。
- [ ] 在测试实例执行数据迁移、上传读取、生成编辑导出、重启恢复、回滚应用版本；验证旧应用对新增 schema 是否兼容。
- [ ] 确认不兼容迁移的回滚需恢复备份，不能直接降级源码；演练期间产生的新文件也需备份/保留。
- [ ] 更新 memory，区分已上线能力、验证结果和遗留限制；经用户批准后再执行目标环境发布。

完成条件：另一名工程师按文档可启动、测试、部署及恢复；无默认口令、真实密钥或私有测试文件进入仓库。

## 4. 可复制的验证命令

### 当前已存在的回归入口

下列命令可用于 T00；执行结果需实际记录，本方案阶段没有宣称通过。

```powershell
Set-Location D:\WorkSpace\octop-src
git status --short
uv run pytest tests/unit/api/test_attachments.py tests/unit/api/test_upload_limit.py tests/unit/gateway/test_attachment_hints.py tests/unit/gateway/test_attachment_path_resolution.py tests/unit/agents/test_binary_read_guard.py tests/unit/knowledge/test_parse.py tests/unit/utils/test_doc_edit.py tests/integration/test_upload_api.py -q
Push-Location dashboard
npm run test -- src/pages/Chat/hooks/useChatAttachments.test.tsx src/pages/Chat/utils/chatAttachments.test.ts src/pages/Home/home-workbench.test.tsx src/components/DocumentPreviewCore.docxSanitize.test.ts
npx tsc -b
Pop-Location
```

### 完整实施后的门禁

下列新增目录/文件必须先由对应任务创建。

```powershell
uv run pytest tests/unit/files tests/integration/test_chat_files_api.py tests/integration/test_chat_file_edits_api.py tests/integration/test_chat_file_generation.py tests/integration/test_chat_file_export_api.py -q
uv run pytest tests/unit/i18n -q
Push-Location dashboard
npm run test -- src/pages/Chat src/pages/Home src/components/DocumentPreviewCore.docxSanitize.test.ts src/components/DocumentPreviewCore.pdfSkeleton.test.tsx src/components/PdfDocumentPreview.windowed.test.tsx
npx tsc -b
npm run lint
Pop-Location
make all
make build-frontend
git diff --check
```

`make all` 包含全仓格式写入；当前混有其他任务的工作区不适合未经检查直接运行。测试通过后只在变更、失败或未解决风险需要时扩大/重跑。

运行预览：

```powershell
uv run octop run --host 127.0.0.1 --port 8200
```

8200 若已有实例，使用该实例或另选未占用端口；不要终止未知服务。访问 `/home`、`/chat`、`/api/docs`。Chromium/OCR 安装只在需要的测试/部署环境执行，不能在用户上传期间安装。

## 5. 真实用户验收脚本

1. 在 `/home` 粘贴含中文表格的截图，问“解释这张图”；查看图片放大及读取状态，确认回答来自图中实际内容。
2. 上传 5 页 PDF（其中 1 页扫描、1 页空白），问总结；确认混合页处理和 coverage；点击引用到准确页，不能把空白当 OCR 成功。
3. 上传含表格、图片和页眉的 DOCX，问指定条款；查看段落出处；编辑段落另存，原版可下载，未支持对象处理有明确提示。
4. 上传两份多 Sheet XLSX，一份包含没有缓存的公式；要求比较金额差异，确认 Sheet/范围、缺失值和确定性运算结果。
5. 在同一线程问“把第二份的异常行整理成 Word 和 Excel”；获取真实文件、预览、下载，用对应库/应用重开。
6. 在线修改 XLSX 单元格、PPTX 文本、图片裁剪、PDF 页顺序；检查版本和原件；两个窗口同时保存应出现冲突而非覆盖。
7. 导出带中文长表的 PDF，检查字体、分页、完整列；转换器不可用时显示明确的能力说明。
8. 刷新/重登/切线程，恢复附件、引用、成品；对旧引用打开正确旧版本。
9. 用另一用户尝试 file_id/revision/task/旧路径访问；删除文件后再点击引用；均不能读到正文。
10. 上传含恶意指令、损坏结构和超限压缩包；取消处理中任务、重启服务；确认没有执行文件指令、没有僵尸进程、没有假完成或重复成品。

验收记录应包含浏览器操作、服务端任务 ID、模型输入的脱敏结构、引用原文和实际成品检查结果，不能只有界面截图。

## 6. 需求追踪与完成定义

| 验收编号 | 实现任务 | 主要证据 |
|---|---|---|
| AC01 | T01/T05/T13 | 上传、纯附件、历史恢复及预览测试 |
| AC02 | T02/T03/T04/T06 | 每格式提取、模型输入合同、OCR 状态 |
| AC03 | T02/T03/T05/T06 | partial/failed/needs_ocr 与上下文范围 |
| AC04 | T07/T08/T13 | 原件 locator、版本引用、删除失效 |
| AC05 | T01/T06/T07 | 线程集合、身份校验、比较来源 |
| AC06 | T11/T12 | 成品重开、内容和格式校验 |
| AC07 | T08/T09/T10 | 版本并发、Office/文本编辑及旧版下载 |
| AC08 | T10/T12 | 图片/PDF 实际页面和导出副本 |
| AC09 | T03/T08/T12/T13 | 中断、幂等、取消、冲突和能力缺失 |
| AC10 | T14/T15 | 全套门禁、真实闭环、部署回滚记录 |

总体完成要求：全部 AC 有对应成功证据，未通过项明确列出；真实功能链路通过；README/运行/测试/部署文档完整；用户已有数据不受损；没有把注册成功、上传成功或模拟工具结果误报为实际完成。

## 7. 实施进度（2026-10-17）

本节记录代码状态，不能替代前文任务验收。当前只交付了可工作的文件读取首切片；总体目标和 AC01–AC10 均未完成。

| 任务 | 状态 | 已有实现 / 未通过的完成条件 |
|---|---|---|
| T00 | 部分完成 | 核对了迁移基线 023、当前未提交工作区及上传权限入口；缺完整基线报告、shared Agent 全路径审计和运行时 capabilities 核查。 |
| T01 | 部分完成 | migration 024 双方言、文件/revision/segment/task repo、上传登记与旧响应兼容、发送时绑定并校验 owner/thread；缺完整 PG 执行验证、补偿失败红队用例、历史 path-only 安全登记及全生命周期授权审计。 |
| T02 | 部分完成 | 有 TXT/Markdown/代码、CSV/TSV、PDF 文本、DOCX、XLSX/XLSM、PPTX 的结构化片段与 locator，遍历预算和 ZIP 防护；缺 OCR/扫描页状态合同、编码与损坏分类完整覆盖、按范围追加/重叠去重与旧知识库兼容验证。 |
| T03 | 部分完成 | 隔离子进程、无 shell、超时 kill+wait、输入/输出/并发上限和取消后槽位不提前释放；缺持久任务状态机、排队/租约/retry/cancel API、重启恢复、OCR、多用户并发策略和 Linux 验证。 |
| T04 | 部分完成 | 有 owner/thread/revision 校验的单次 `/files/{file_id}/read` 端点，读回片段，错误/i18n/OpenAPI tag 已接入；缺 segments/search/tasks/capabilities/分页/重试/取消 API、跨旧 preview/download 的授权审计和 `/api/docs` 人工抽查。 |
| T05 | 部分完成 | Chat 上传结果和历史附件保留 file/revision ID 与 read status，消息卡可显示读取状态；缺 Home 共用附件 UI、统一预览接线、上传进度与异步任务轮询。 |
| T06 | 部分完成 | 文件文本作为明确的 untrusted data 加入本轮模型输入，保留 locator 与引用 token，并限制总上下文字符；缺模型工具按需读取/搜索/范围分页、多文件比较与完整模型安全红队评估。 |
| T07–T15 | 未开始 | 引用跳转、附件生命周期、在线编辑、版本冲突、Office 生成、导出、重启/删除恢复、全套验收、运行/部署手册与发布门禁均未交付。 |

### 本切片已验证

- Windows 定向后端组合：`47 passed, 1 skipped`（files 单元、chat file binding、DB pool、上传/read API）；有 2 个既有 `ldap3`/`pyasn1` 弃用警告。
- 本功能涉及的 Python 文件：Ruff check 通过，Ruff format check 显示 21 个文件已格式化。
- Dashboard 附件上传/历史解析/消息卡测试应以最近一轮完整命令结果为准；`npx tsc -b` 仍待确认完成。
- i18n 套件此前有 1 个 `stream.py` 中文既有改动相关失败（本功能未修改该模块）；需后续基于干净基线复核。
- `make all` 未运行：其 `format-all` 会写入工作区内其他任务的大量修改；不能在未隔离的情况下执行写格式门禁。未执行真实浏览器/LLM、PostgreSQL、Linux、OCR 或部署验收。

### 对话功能深度回归（2026-10-17）

- Dashboard `src/pages/Chat` + `src/pages/Home` 全集：串行 1 worker `91 files / 562 tests passed`；2 workers 重跑同样 `91 files / 562 tests passed`。
- 对应后端对话组合：Chat API/history/HITL/serialize、files、附件/上传、Agent composer/artifacts、gateway 图片/流式工具/版本化历史、history projection、Chat WebSocket、上传和语音 WebSocket：`284 passed, 2 skipped`。
- Fake-harness 用户旅程 `tests/integration/test_e2e_golden_path.py`：`2 passed`，含认证、用户/Agent 创建、WebSocket token/done、线程标题和专家到聊天路径。
- 首次默认并行前端全集曾报 6 个失败，集中在 `TrajectoryInspector.test.tsx` 与 `useChat.history.test.ts`；两个文件隔离重跑 `15/15`，随后串行和 2-worker 全集均通过。记录为并发/资源敏感的非确定性测试风险，尚未稳定复现；没有据此改测试或生产代码。
- 仓库没有已配置的前端 Playwright/Cypress E2E runner；上述黄金路径通过 HTTP/WebSocket 测试客户端和 fake harness，不是实际浏览器，也未连真实模型。
- 本结果不关闭 AC10：真实 `/home` 与 `/chat` 浏览器闭环、OCR、真实模型、Linux/PostgreSQL、权限矩阵及生成/编辑/导出 AC 仍需单独验收。全仓 `pytest -m "not live"` 也未通过（此前运行慢被中断；失败由既有测试与当前工作树不一致导致，详见 `memory.md`）。

### 安全边界与当前失败模式

| 失败/攻击场景 | 当前防护 | 剩余验证或处置 |
|---|---|---|
| 恶意 Office ZIP 炸弹或路径条目 | ZIP 条目数、解压大小/比率、路径检查；子进程时间限制 | 对所有 Office 格式补生成式/差分样本，验证 Windows 进程树及磁盘配额。 |
| 超限 XLSX 通过多 Sheet 绕过总预算 | 跨 Sheet 累加 cell 预算；触发时返回受限 coverage | 加入极端 sheet 数/稀疏范围/公式缓存样例并测峰值内存。 |
| 伪造 file_id 与其他路径或跨线程读取 | 上传登记稳定 ID；发送和 read API 均验证 owner、agent、thread、revision、workspace path | 预览、下载、旧路径历史、shared Agent 和删除后的逐端点审计未完成。 |
| 客户端断开造成解析槽位被提前释放 | worker future shield，实际完成后再释放并发槽位 | 无持久任务，服务退出时任务不恢复；加入队列租约与恢复后再满足计划合同。 |
| 文件内提示注入污染模型指令 | 文件正文单独包装为 untrusted attachment context | 这不是模型级沙箱；仍需按工具权限做攻击性评估，特别是文件要求调用工具/外传秘密的情形。 |

### 下一步执行顺序

1. 完成 T02/T03：扫描 PDF 的显式 OCR/未支持状态、遍历预算测试、任务持久化与可恢复取消；验证 Windows 和 Linux 行为。
2. 完成 T04/T06：分段/搜索/任务 API 与模型按需读取，覆盖分页、幂等、代次竞争及越权拒绝。
3. 完成 T05/T07：Home/Chat 共用预览和来源点击，验证刷新/重登/切线程恢复。
4. 按 T08–T13 落地安全编辑、不可变版本、Office 成品、PDF 导出和恢复语义。
5. 做 T14/T15 全量门禁、真实浏览器/模型闭环、文档和部署验收；逐条关闭 AC01–AC10。

## 8. 本轮文档交付验证

2026-10-17 已完成源码静态核查、独立文档审查与修订后复审。复审结论：方案内部合同可供用户评审，不等于技术方案已获用户批准或功能已实现。

已验证：本组文档的本地 Markdown 链接、代码围栏、占位和空白检查，T00–T15 任务完整性，AC01–AC10 追踪映射，以及 14 个现有测试文件入口的存在性。

未执行：Pytest/Vitest、make all、真实模型/浏览器闭环、数据库迁移、Office 转换和部署。原因是本轮只编写方案，业务代码没有修改；当前工作区存在其他任务修改，不能用会写入全仓格式的门禁制造无关变更。实施时仍必须完成对应质量门禁。
