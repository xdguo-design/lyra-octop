# LYRA P0 工具可靠性、统一市场与 FreeLLM Skill 双向同步（2026-10-16）

状态：**审计与实施契约已立项；非功能完成声明**。实施分支：dev；不直接改 main。

## 已有实现与发现
- `qq_mail.py` 通过 IMAP/SMTP 搜索、读取与发送，`agently_cli.py` 暴露 agently_send 等工具并有写操作双阶段确认。Agent 说“没有 SMTP/任何网络工具”不能代表仓库实际功能。
- `useChatSend.ts` 在 ask/plan 模式故意清空连接器列表，需在 UI 告知用户“当前模式禁止执行”，不能让模型凭空声称未实现。
- `AgentManager.prepare_chat_mcp` 动态加载所选工具，记录 missing 但当前仍需验证缺失状态能否透传给 Agent 与用户。
- `freellm_catalog.py` 已通过固定 https://freellm.top/data/skills.json 读取已核验目录、预览 SKILL.md；`skill_packages.py` 已提供手动导入与导出预览。它不是自动双向同步。
- `SkillHubTab.tsx`、`SkillPackagesTab.tsx` 使用 Drawer；统一市场应以整页列表 + 页内详情替代右侧抽屉。

## P0：工具调用可靠性合同
1. 服务端每轮生成可审计的能力快照，至少包括：tool_id/provider/instance_id、registered、enabled、credential_status、selected、mode_policy、loaded、last_probe、failure_reason。
2. 将能力快照中的非敏感工具状态传递给 Agent，禁止模型凭猜测说“没有联网/没有邮件/GitHub 工具”。不能假定已授权或已发送。
3. 禁止只依赖模型选择外部副作用；发送邮件、GitHub 写操作必须显示目标、摘要并走明确批准；read-only 不应被同等阻断。
4. 工具调用结果区分 success / needs_setup / needs_auth / restricted_mode / forbidden / unavailable / timeout / failed / requires_approval，真实成功证据含 provider、action、目标标识及相关请求 ID（不得包含令牌）。
5. 模式受限时显示显式操作建议，不自动将 ask/plan 切为 execute；缺失授权引导到连接器页，避免向聊天索取凭据。

## P0 验证矩阵
| 场景 | 正向 | 反向 | 验收 |
|---|---|---|---|
| Gmail / SMTP | read/send 模拟与受控集成 | 未授权、连接拒绝、错误主机 | 真实成功有发送回执，失败不声称已发 |
| Agent Mail | 探针、发件预览、审批 | token 过期、拒绝审批、Cron 禁写 | 未批准零写入 |
| GitHub | 读仓库/分支/文件、比较提交 | 404、403、速率限制、失效连接 | 返回真实分支和 SHA，不虚构拉取本地 |
| GitHub 写入 | diff→批准→提交→读回验证 | 目标分支变更、冲突、权限不足 | 严禁越过批准与分支保护 |
| MCP / 浏览器 | 已选工具成功调用 | 未选、未安装、断线、模式限制 | 错误与建议状态正确 |
| 并发/重试 | 只读幂等重试 | 写入超时、重复提交 | 写操作不得静默重发 |

## 统一市场 UI 验收
- 顶部一级标签：**角色 / 技能 / 插件与连接器**，与用户参考图 2 一样占用完整内容区域，不用右侧抽屉作为技能导航。
- 全局搜索、已安装筛选、分类、来源筛选（官方/SkillHub/FreeLLM/本地）、排序、精选、分页，4 列响应式卡片；窄屏降列。
- 卡片显示来源、作者、名称、用途、版本、安装状态；禁止虚构下载量、评分或验证标签。详情为同页面扩展/路由，保留安装目标与权限提示。
- 统一市场是整合入口，不删除 Agent 专属 Skill 配置、包权限或现有原子操作；安装后刷新已安装状态。

## FreeLLM 双向 Skill 同步合同
- FreeLLM → LYRA：只同步公开已核验目录和源文档；内容哈希 + upstream ID + 来源 + 版本 + 最近核验日期，先预览、再明确安装；原文为不可信输入，不执行脚本。
- LYRA → FreeLLM：只同步用户明确选择公开发布的 Skill；先生成提交草稿/审核工单，人工确认后提交至 FreeLLM 的受审入口。**不向公开站点同步私有 Skill/连接器凭据**。
- 双向状态：local_only / remote_only / unchanged / update_available / conflict / pending_review / sync_failed；用稳定来源 ID 防环路；冲突不自动覆盖。区分目录同步和内容安装。
- FreeLLM 静态目录为发布方，LYRA 不能假设 freellm.top 有可写 API；写回需确认 GitHub PR/审核路径，明确审查权和 token 授权边界。
- 保留签名/哈希溯源、来源许可、撤回机制、速率限制、审计记录。

## 交付门禁
1. 工具问题必须先补真实故障复现和测试，再修正；通过 `make all` + 相关 E2E 后才能报完成。
2. 双向同步须同时在 LYRA 和 FreeLLM 的 dev 完成 API/发布链路验证，不能把“可导出预览”称为已同步。
3. UI 从现有组件迁移，保证原有 SkillHub 安装、技能包和 Agent 绑定测试通过。
4. 每项提交附 commit SHA、测试命令与结果、未完成项；无真实实例授权不得宣称真实发信/GitHub 写入测试通过。
