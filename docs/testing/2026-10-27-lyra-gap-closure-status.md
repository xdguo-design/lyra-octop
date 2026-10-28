# LYRA Gap Closure 本地验证状态（2026-10-27）

本记录只汇总当前工作区可复核的代码与测试结果。模拟契约不表示真实业务系统验收；未实现项不会标为 PASS。

## 当前状态

| 范围 | 状态 | 证据 / 限制 |
|---|---|---|
| G0 权限矩阵与 Run 身份 | PASS（SQLite / 本地） | Run 仅绑定 owner Thread 内已持久化的人类消息；启动和执行期重新校验 owner、Agent、Thread、message ID/role。跨用户访问、配置漂移 fail-closed 与审批恢复授权有回归。PostgreSQL 未验证。 |
| G1 持久 Run / Step / Event、Team、Project Context、HITL | PARTIAL | 保存消息执行、Project/KB/File revision 复验、ProjectContext 跨项目隔离、HITL Run/Step 关联、Team 父子 Run、取消、lease heartbeat 与过期收敛已落地。Team 派工正文使用独立 Fernet key 加密持久；启动先接管并恢复仅限过期且 Run/Step 均为 queued 的任务，父 Run 仍需有效；运行中和 cancel-requested 不自动重放，按 unknown_external_effect 等既有规则收敛。Run 终态会把未回报的 requested Effect 收敛为 unknown，避免留成可被误读的处理中状态或重放。Run/Project UI 只读展示 Artifacts、固定错误码、审批 Chat 入口与 owner-scoped Effect 状态。多进程实机、批准后崩溃恢复、旧 AgentVersion graph 和真实 Harness Effect handler 未完成。 |
| G2 SourceSpan / 文本 Artifact | PARTIAL | PDF/DOCX/PPTX/XLSX/文本定位与解析状态；TXT/MD/CSV CAS revisions 与生成型 DOCX Markdown↔文档 revision 编辑已实现。专用 revision 下载、legacy workspace exact-path 读取及解析读取统一复用 `FileService` 的归属和 byte-size/SHA256 校验；owner 拒绝、完整性失败和旧入口授权集成回归通过。项目 Artifact API 将 Run 关联 revision 按稳定 revision ID 去重，Chat/Run/Project 复用同一认证下载 URL；跨 Run 重复关联仅展示一次。文本冲突有上限的逐行差异与用户手动合并；超 20 万字符或 100 万 DP 单元退回手动查看。仍缺覆盖任意 Chat/Project 文件的通用 Artifact 仓储和统一预览入口，通用 Office 成品链、PDF 标注转换、OCR 未完成。 |
| G3 mock capability contract | PASS（mock）/ BLOCKED（真实联调） | owner-scoped 注册、scope、到期/撤权/停用及 Effect 仓储契约通过本地测试。用户确认没有隔离 EHR、Provider 凭据或目标写入环境；外部写入幂等、超时查询、业务回滚不报 PASS。 |
| G4 Research / Analysis / Media | BLOCKED（复合能力及 Provider 验收） | Search、STT、图像/视频 Provider 配置及 adapter 有 mock contract，相关定向集合 40 passed。Deep Research 来源交叉核验、受限分析 worker、Run/Artifact 串联与真实音视频覆盖未实现/验收。 |
| G5 治理与受控进化 | PARTIAL | AgentVersion 已加密、哈希校验、内容去重并固定到 Run；配置漂移执行 fail-closed。EvaluationSuite、RoutineVersion、模型策略、记忆治理和发布回滚流程尚未实现。 |

## 回归结果

- 后端全量非 live（ChatFile exact-path、tree/glob/grep、ZIP 导出与 merge/replace 导入隔离后）：4,958 passed、211 skipped、0 failed，1,080.10 秒。命令：.venv/Scripts/python.exe -m pytest -n 4 -p no:testmon -m "not live" -q。
- Dashboard 全量 Vitest：283 files / 1,504 tests passed，0 failures/timeouts，835.53 秒；命令：npm run test -- --run --maxWorkers=1。
- Ruff check + format check：src/tests，1,290 files passed。
- mypy strict：625 source files，无错误。
- Dashboard TSC、ESLint quiet、触及 TS/TSX/locale 文件 Prettier、生产构建通过；Vite 有既有 chunk/dynamic-import 警告。
- Chat 文本行差异与冲突 UI 定向 Vitest 5 passed。RunExecutor 项目上下文隔离单测 4 passed。JSDOM 对 Ant Design 伪元素 getComputedStyle 有未实现警告，不影响测试。
- 内嵌 Admission Registration 静态入口修正后，dashboard serve 集成测试 6 passed。
- 其他专项证据：G0 权限矩阵 126 passed；Team/Run 联合集合 105 passed；Run Artifact API/仓储/迁移集合 51 passed、1 skipped；Search/Media/Voice mock contract 40 passed；PPT Studio 服务 25 passed。
- Run Artifact 稳定身份回归：`tests/integration/test_runs_api.py::test_run_artifacts_are_revision_pinned_and_owner_scoped` 1 passed；验证 `artifact_id == revision_id` 且同一 revision 跨 Run 保持同一 ID。
- Chat File DOCX 编辑回归：`tests/integration/test_chat_files_api.py` 17 passed，含 DOCX 创建、不可变 revision 编辑、下载后 python-docx 重开，以及上传 DOCX 不进入快速编辑器；`ThreadTextArtifactDialog` Vitest 3 passed，`npx tsc -b` 与 touched TSX Prettier 通过。
- FileService 共享授权/完整性回归：`tests/unit/files/test_service.py` 11 passed；`tests/integration/test_chat_files_api.py` 17 passed（含 legacy workspace exact-path 跨用户拒绝、soft-delete 与 SHA256 篡改拒绝）；触及 Python 文件 Ruff、格式检查和 strict mypy 通过。
- Run Effect 终态对账回归：`tests/unit/db/test_run_effects_repo.py tests/unit/test_run_executor.py` 5 passed；`tests/integration/test_runs_api.py` 17 passed。请求中 Effect 在 Run 成功终态后幂等转为 `unknown`，不自动执行或伪报结果；相关 Ruff、格式检查和 strict mypy 通过。
- Project Artifact 汇总回归：`tests/integration/test_runs_api.py::test_run_artifacts_are_revision_pinned_and_owner_scoped` 1 passed；同一 revision 关联多个 Run 时项目视图只出现一次，下载 URL 与 Run 共用；修改关联 Thread 后两处列表均隐藏文件元数据。Project Runs UI 3 passed、Dashboard `npx tsc -b` 退出码 0、相关 Prettier 及 backend Ruff/mypy 通过；i18n 80 passed。

## 未验证与本机门禁

- PostgreSQL migrations/并发实机、Provider/EHR 联调、真实业务写入幂等与超时对账、浏览器 E2E、进程中断/回滚演练均未验证；G3/G4 外部验收保持 BLOCKED。当前环境没有 `OCTOP_TEST_POSTGRES_URL`、运行中的 PostgreSQL 服务或 Docker。
- Team Inbox queued payload 已独立 Fernet 加密持久化并在 lease fencing 后恢复；Team/Repo/migration 定向集合 111 passed、1 skipped。Run 取消会向活动 Harness inbox 发送 cancel，父子取消与 enqueue/cancel 竞态有回归覆盖。Effect ledger 尚未接入真实 Harness 工具 handler；批准后崩溃恢复、旧 AgentVersion graph、通用 Office Artifact、Deep Research/受限分析与 G5 治理能力仍未完成。
- ChatFile 通用 workspace 访问隔离本轮定向回归：`tests/integration/test_chat_files_api.py tests/integration/test_workspace_api.py tests/unit/backup/test_workspace_archive.py`，48 passed；覆盖 exact-path owner/hash、soft-delete、tree/glob/grep/archive 跨用户隔离。随后完整后端非 live **4,950 passed、211 skipped、0 failed**；Ruff check/format（1,290 files）与 strict mypy（625 source files）通过。
- 随后补齐 ZIP merge/replace 导入与 ChatFile revision 的不可变保护：导入跳过冲突路径并报告 warning，replace 清理保留受保护文件及祖先目录。扩展后的定向回归 50 passed；i18n 子集 80 passed；最终完整后端非 live 4,958 passed、211 skipped、0 failed。第一次全量曾遇到 locale parity 单例失败，孤立/分组重跑与最终全量均通过，未改 locale 内容。
- Dashboard 全仓 Prettier 曾报告 72 个工作区文件未格式化；它们涉及其他未提交改动。本任务只检查触及文件，没有批量改写工作区。
- 本机未安装 make，因此 make all / make precommit 尚未执行。工作区有大量与 LYRA 无关的预存修改和未跟踪文件；尚未暂存或提交，后续必须按任务文件清单精确暂存。

详细任务清单见 [LYRA gap closure 计划](../specs/plans/2026-10-26-lyra-gap-closure.md)；权限边界和测试映射见 [LYRA 权限矩阵](2026-10-26-lyra-permission-matrix.md)。
