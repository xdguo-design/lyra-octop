# LYRA 权限边界与回归矩阵

本文区分已存在的权限合同、对应测试和仍缺失的执行期授权，不代表所有测试已在本次运行。

| 对象 | 允许访问 | 拒绝/撤权边界 | 现有回归证据 | 本次补齐 |
|---|---|---|---|---|
| User | 登录用户访问自身数据；管理员按路由权限执行管理操作 | 普通用户不得跨用户读取 Agent、频道、Cron 或文件 | `tests/integration/test_boundary_authz.py`、`test_channels_api.py`、`test_cron_api.py` | Run 查询按 owner 隔离，异用户统一 404 |
| Agent | Owner 完整管理；显式共享 Agent 只开放允许的只读/会话能力 | 共享 Agent 不授予配置、workspace、skill 管理；取消共享后立即隐藏 | `tests/integration/test_agents_shared.py`、`test_agents_list_scope.py` | Run 创建重新校验 `require_agent_row` |
| Project | 项目 owner 管理；带有效 token 的匿名只读分享 | 分享 token 不暴露哈希；仅授权线程可读；撤销/过期立即 404 | `tests/integration/test_workbench_api.py::test_project_share_is_anonymous_read_only_and_revocable` | Run 创建只接收 owner 项目；项目上下文更新按 revision CAS |
| File/Revision | 上传者在匹配 Agent+Thread 下读指定不可变 revision | 错误 user、agent、thread、file 或 revision 返回不可区分的 404；正文不从 Run API返回；owned download 与精确文本读取均校验所有权且逐次验 SHA256；Run Artifact 也要求其绑定 Run 和文件完全同 owner/Agent/Thread | `tests/integration/test_chat_files_api.py::test_read_surface_hides_other_users_files`、`test_text_artifact_revision_uses_cas_and_keeps_stale_revision`、`tests/integration/test_runs_api.py::test_run_artifacts_are_revision_pinned_and_owner_scoped`；`ThreadTextArtifactDialog.test.tsx` | Run 文件快照限制最多 50 个 revision，并逐项重验 owner/Agent/Thread；Artifact 通过复合外键绑定文件和 revision，持久化 thread_id 供执行器复核 |
| Thread | Thread owner 在关联 Agent 下读写历史；共享 Agent 的对话仍按用户拆分 | 不得通过 thread_id 绑定他人历史/WS 会话/HITL 恢复 | `tests/integration/test_agents_shared.py::test_shared_agent_threads_are_private`、`tests/integration/test_chat_ws.py::test_ws_subscribe_rejects_another_users_thread`、`tests/unit/api/test_chat_hitl_resume.py::test_resume_route_requires_owned_thread_and_pending_record` | 项目 Run 详情按 Run owner 隔离 |
| App registration / capability | 用户只管理自己的 mock app；授权限定到自有 Agent，read/write scope 分开 | 跨用户查阅/授权 404；未知 scope、已过期或已撤销授权拒绝；停用 app 后即时拒绝 | `tests/unit/db/test_app_registry_repo.py`、`tests/integration/test_apps_api.py`、`tests/unit/db/test_run_effects_repo.py` | Mock app contract 与 owner-scoped effect ledger PASS；Harness executor/真实 EHR/Provider adapter 和 live side-effect reconciliation **BLOCKED** |
| Tool/Runtime identity | 现有 Chat/HITL 服务端从认证用户、Agent、Thread 上下文恢复身份；Run 输入只能引用已保存的用户消息 | 模型生成的参数不能覆盖 user/agent/thread；共享关系撤销后执行期重新授权；缺失或歧义 pending 不得恢复工具；持久审批 CAS 只有一个恢复胜者；风险写工具的审批不能被线程 allow-all 跳过 | `tests/unit/api/test_chat_hitl_resume.py`、`tests/unit/api/test_chat_hitl_resume_validation.py`、`tests/unit/gateway/test_hitl_channel.py`、`tests/unit/agents/test_hitl_session_policy.py`、`tests/integration/test_runs_api.py::test_run_start_requires_owned_persisted_user_message`、`test_run_fails_closed_when_agent_version_changes_before_execution` | **部分完成**；Run start/worker 重验 owner、Agent share、Thread、message ID/role 和来源权限，HITL pending 带 run/step；AgentVersion drift fail closed 且不调用 Harness。但仍使用 AgentManager 当前图、旧版本 graph 未实现；RunEffect ledger 未接入实际 Harness tool handler，真实工具调用计数、scope-to-effect 绑定和 Provider 结果仍未验收 |

## 数据库与环境

- SQLite：Run/Workbench/File 的 owner 约束在本地集成与仓储测试覆盖；Run 并发状态 CAS 与事件上限已在 SQLite 测试。原权限矩阵集合 `test_boundary_authz.py`、`test_agents_shared.py`、`test_agents_list_scope.py`、`test_chat_ws.py`、`test_workbench_api.py`、`test_chat_files_api.py` 曾共 66 passed；File API/解析/DB/i18n 集合 158 passed、1 skipped，含 shared-agent owned-download 拒绝和 hash mismatch 拒绝；HITL durable/Team/Run/Files/Workbench 联合集合 298 passed、2 skipped。
- PostgreSQL：本任务执行环境未配置目标数据库，因此迁移对照和并发竞争保持 **未验证**。
- 最终本地非 live 后端回归：`python -m pytest -n 4 -m "not live" -q` 为 **4,916 passed、211 skipped、0 failed**。Dashboard 全量 Vitest 限并发复跑 `npm run test -- --run --maxWorkers=4` 为 **1,486 passed、0 failed**；LYRA Run/Project Context/Project Runs 页面定向测试另为 5 passed。PostgreSQL 与 Provider 仍未验证。

## 验收规则

- ID 不可猜测即授权；每个请求仍需按当前认证主体和资源所有权重验。
- 外部分享只授予明确的只读数据面；撤销必须影响后续请求。
- Run 中保存的 file revision 只供追溯，不能作为绕过执行期权限检查的 capability。
- 工具/执行器身份路径在实际接入前保持未完成，不能由本矩阵推断为已安全。
