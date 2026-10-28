# Lyra Octop 功能清单

Lyra Octop 是可自托管的多用户 AI 助手平台，包含 FastAPI 服务、Web 控制台和 CLI。具体可用能力由版本、模型 Provider、环境依赖和管理员配置决定。

## 产品功能

| 模块         | 当前能力                                              | 条件或边界                                                 |
| ------------ | ----------------------------------------------------- | ---------------------------------------------------------- |
| 服务与部署   | 安装脚本、Python 环境、Docker、系统服务、配置向导     | PostgreSQL、TLS 等功能需按部署配置启用                     |
| 账号与安全   | 多用户、角色/所有权校验、登录认证、审计、安全设置     | 管理权限高于普通用户；私有资源按所有权隔离                 |
| 模型与供应商 | 配置云端及本地模型、模型列表和连接测试                | 真实请求依赖有效凭据、网络、配额及 Provider 能力           |
| 对话         | 多 Agent 聊天、会话历史、附件上传与查看、搜索来源展示 | 文件解析状态区分未读/处理中/成功/部分/需 OCR/不支持/失败，并提供页、单元格、段落等来源位置；已提供线程内 TXT/MD/CSV 与生成型 DOCX 创建、CAS 修订和受保护下载 API，完整统一 Artifact 与成品导出仍未交付 |
| Agent        | 专家 Agent、人格设置、指令、模型选择、运行管理        | Agent 工具会受到配置的权限和审批规则约束                   |
| 知识         | 知识库和文档管理、已有解析和检索能力                  | OCR 及完整的文件版本/来源/编辑/导出流程尚未整体交付        |
| 扩展         | Skills、插件、MCP Connector、连接器管理；mock App registration 与按 Agent 授予 read/write capability | 外部应用只验证了模拟契约；EHR/Provider 实际读写、审批关联、幂等对账和发布证据尚未完成 |
| 团队与审批   | Agent Teams、HITL、任务协作及审批机制                 | Team inbox 派工会记录 owner-scoped Run/Step；RunExecutor 内派工可关联父 Run 并查询子状态，但父级终态汇总和 Inbox 恢复未完成；HITL 待办加密持久化、owner 校验及决定审计已接入；Run 副作用台账尚未接入真实执行器/Provider |
| 消息通道     | 飞书、钉钉、企业微信、Telegram、Discord 等通道接入    | 各通道需单独配置 Bot 凭据和回调/网络条件                   |
| 自动化       | Cron 创建、调度、立即运行、运行历史和同进程取消       | 取消不能撤回外部副作用；跨服务实例取消还未实现             |
| 工作台       | 项目、资源、代码浏览权限控制与预览；项目指令 CAS、Run 记录与执行 | Run 可引用已保存的 Chat 用户消息、排队并执行；Provider 写操作与 RunEffect ledger 尚未端到端连接 |
| 创作与演示   | 创作资源、Admission 演示、语音入口及媒体生成配置      | 真正生成/识别依赖已配置且可用的模型或语音 Provider         |
| 远程操作     | ACP、浏览器自动化、远程桌面相关功能                   | 需要安装浏览器/系统组件并明确授予运行权限                  |
| 管理和运维   | 用户、模型、系统、安全设置，CLI，日志/审计，数据备份  | 备份恢复需使用兼容的数据库引擎与应用版本                   |

## 当前版本更新能力

- 对话历史分页、刷新和切换会话时减少旧请求覆盖新内容的竞态。
- 工作台项目代码浏览使用显式权限状态，并对越权路径和用户操作做服务端校验。
- 聊天附件草稿的删除与绑定状态更明确，避免误删已发送附件或留下迟到上传结果。
- 搜索来源从工具结果整理并在历史恢复，不从模型正文猜链接。
- 文件写保护、缓存内容校验、STT 上传大小限制和 Cron 一次性任务重启防重复。
- 附件解析状态和来源位置持久化；解析 worker 有时间、输入/输出和 Office 压缩包边界，过期解析 lease 可重新读取。
- Cron 运行历史持久化；任务详情可查看运行状态，并在当前进程取消运行。
- Workbench 项目指令带 revision CAS；Run API 可创建、查询、查看步骤/事件、排队执行、关联同一 owner/Agent/Thread 的不可变文件 revision 作为 Artifact，并记录取消请求，事件 payload 仅输出状态/固定错误码等 allowlist 字段。Run 页面可查看/下载关联 Artifact。Run 执行时重新校验保存消息、项目、知识库和文件 revision；项目菜单显示上下文来源和文件哈希。用户输入必须引用 Thread 中已保存的用户消息，原始 prompt 不复制到 Run 行。Agent 配置在 Run 创建后漂移时执行器失败关闭；旧 AgentVersion graph 执行仍未实现。取消等待审批的 Run 会同时结束 Run/Step 并过期关联审批；Team Run 会向 Inbox 发取消信号，若该 Inbox 已不在进程内则将其记为 `interrupted`。Artifact 目前建立 Run→Chat file revision 关联，尚非跨 Project/Run/Chat 的通用仓储。
- Team `job_id` 派工映射到 owner-scoped Run/Step，先授权并持久化再入队；RunExecutor 发起的派工会关联并继承父 Run 的 Project/Thread，可从 owner-scoped children API 和 Home Run 详情查看。Team inbox Run 仍不由普通 Chat Run worker 消费；父级终态汇总和重启后的 Inbox 恢复未实现。
- HITL 待办写入 `hitl_approvals`，工具参数 Fernet 加密；决定和审计在同一事务内提交，终态清空密文。Run 创建的审批关联原 Run/Step，Dashboard 恢复同一 checkpoint 后更新原状态；RunEffectRepo 尚未从真实 Harness 工具调用写入，provider 副作用仍需联调。
- 工具运行前按风险分类：内置写工具、插件工具、未知 MCP 和环境变量读取默认需要人工审批；线程级“本会话允许全部”不能跳过这些审批。明确只读工具保持现有审批策略。
- 聊天线程支持创建 TXT/MD/CSV 和生成型 DOCX（Markdown 转换）并追加不可变修订；DOCX 快速编辑限生成来源，上传文件仍走隔离解析。并发编辑按 `base_revision_id` CAS，冲突草稿作为分支 revision 保留并返回 409；界面展示逐行差异并允许用户手动编辑合并后显式保存。该入口不覆盖 Project 文件区。
- Admission 会话过期数据定期清理。

每项已完成代码对应的测试、限制和需要人工验证的条件见 [线下测试指南](testing/offline-test-guide.md) 和 [本次更新日志](release-notes-2026-10.md)。

## 尚未完成的路线图能力

以下项目不能按“全部功能已完成”处理：

- 扫描件 OCR、文件片段位置与可信引用、基于版本的在线编辑/冲突处理、Office 成品登记和导出闭环。
- 音频附件自动转写、视频帧提取与视觉理解。
- Cron 跨进程/跨实例取消、跨重启完整任务恢复，以及受限 handoff 的完整验收。
- Team 任务树和人工外部副作用对账；Run 取消/关停期间的外部调用结果仍可能不确定，租约过期会记为 interrupted 且不自动重放。G3/G4 真实 Provider 联调因无隔离环境保持 BLOCKED。
- Projects 式上下文和可查看、编辑、暂停、版本化、可测试的 routines 产品闭环。
- 真实 Provider、PostgreSQL、完整浏览器 E2E 和所有目标平台的发布验收。

路线图状态以 [ChatGPT/Grok 对话能力改进路线图](specs/plans/2026-10-17-chatgpt-grokbot-improvement-roadmap.md) 为准；本清单不把路线图计划等同于已交付功能。
