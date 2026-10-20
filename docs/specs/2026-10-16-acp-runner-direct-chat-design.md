# ACP Runner 作为直接聊天目标：设计规格

## 核心目标

用户可以在工作台的 Agent 选择器中选择已启用的 ZCode、OpenCode、Kilo Code 或自定义 ACP Runner。选择后，消息直接发给 Runner 并在同一聊天界面显示回复；Octop 普通 Agent 的模型不代理或改写这次请求。

## 当前行为

- 工作台 Agent 选择器只显示运行中的 Octop Agent；测试明确要求 ACP Runner 不出现在选择器里。
- ACP Runner 由账号级配置管理；每个 Octop Agent 需要单独启用 `acp_runner` 工具，之后由模型在对话中决定是否委派。
- `acp_runner` 支持创建、续接、查询、回应权限请求和关闭 ACP 会话；Octop 聊天线程和 Runner 目标当前没有直接绑定关系。
- Runner 命令运行在 Octop 服务所在主机；ACP 协议通过 stdio 通信。

## 设计选择

1. **独立的 ACP 直聊目标（采用）**：工作台选择器列出 Octop Agent 和 ACP Runner 两类目标。选中 Runner 后直接走 ACP 客户端，不经过 Octop LLM。当前聊天的 Octop Agent 仍是工作区所有者和启动目录来源；工作区不是 Runner 的文件访问边界。线程目标记为指定 Runner，每个 Runner/线程组合续接独立 ACP session；消息记录仍由 Octop 保存。
2. **完整 Octop Agent 包装（不采用）**：为每个 Runner 创建具有身份、记忆、工具及生命周期的 Agent。此方案引入与 Runner 模型、Agent 模型和记忆三者的边界问题，超出“直接选择并交给 Runner”的目标。
3. **保留 `acp_runner` 委派工具（不采用）**：最小改动，但仍需要 Octop Agent 和模型代为判断调用，不能满足用户要直接选择 Runner 的要求。

## 用户交互

- Agent 选择器新增“ACP Runner”分组，仅向有权限管理 ACP Runner 的管理员展示其账号配置中 `enabled=true` 的 Runner；关闭或删除的 Runner 不可选。
- 选中 Runner 后，聊天标题/选择器明确显示 Runner 名称。模型选择器隐藏或禁用，因为请求由 Runner 自己的模型处理。
- 新聊天和续聊都直接请求该 Runner。相同 Octop 工作区 Agent 下，Runner 目标与普通 Octop Agent 目标的聊天记录隔离；切换目标不会把普通 Agent 回复追加进 ACP 对话，反之亦然。
- 每个 ACP 目标线程续接自己的 ACP session；线程标题、用户消息、Runner 回复和 ACP 权限状态在 Octop 聊天历史中可见。
- 首版限定本机可映射目录的工作区。选择 Runner 后使用当前聊天 Agent 的本机工作区目录作为进程启动 cwd；远程或无法映射成本机目录的工作区不显示/禁用 ACP 目标，并给出原因。此 cwd 只是启动位置，不是文件访问隔离边界。

## 数据流与边界

1. 前端加载当前用户的全局 Runner 配置，只把启用项作为选择器目标；目标类型和 Runner ID 随发送请求显式传递。
2. 后端要求用户具有 ACP 管理权限，并从该用户的 ACP 配置重新校验目标 Runner 存在且 enabled；忽略客户端传入的任意命令、环境变量或工作目录。
3. 后端验证聊天工作区 Agent 的归属和本机工作区路径，使用服务端 Runner 命令配置启动/续接 ACP session。Session 与用户、Runner、工作区 Agent、Octop thread 绑定。cwd 取自服务端解析，不代表对子进程实施了目录沙箱。
4. ACP 文本更新按聊天流事件发送给 Dashboard 并写入 Octop thread history；关闭连接、取消任务和请求超时都清理或结束相应 ACP 操作。
5. 尊重 Runner 配置中的 `trusted` 与 ACP 协议语义；如果 ACP 发出 `permission_required`，沿用显式权限选择流程，不自动点击允许。普通 Agent 的模型选择、工具、记忆和 prompt 不应用到 Runner 直聊。

## 安全与失败处理

- **跨用户/伪造目标**：仅 ACP 管理员可以使用 direct Runner 目标；Runner 名称必须来自当前认证用户的 enabled 列表；工作区 Agent 必须通过现有 owner 检查；客户端不能覆盖 Runner command/env/cwd。
- **未授权执行**：保留 ACP permission request 与显式用户决定；关闭 Runner 后拒绝新会话；取消和断开时终止当前调用。
- **主机权限（明确接受的信任模型）**：Runner 由管理员配置和启用，按 Octop 服务操作系统账号运行。Agent workspace 仅作为 cwd，不能阻止 Runner 使用绝对路径、父目录或子进程访问服务账号有权限读取的其他主机文件。首版不承诺 OS/容器沙箱；部署者必须把可用 Runner 视为管理员信任的主机进程，不应向不受信任的租户开放此功能。若需要租户级文件隔离，必须另行实施真实 OS/容器隔离后再开放。
- **路径注入**：只接受服务器从 Agent workspace resolver 得到的 cwd；拒绝浏览器提供的裸路径和不支持的远程后端。这只控制启动目录，不形成访问隔离。
- **Runner 崩溃或断线**：在当前 thread 显示失败状态，保留已经收到的消息；不把错误伪装成 Runner 回复。Session 失效时允许用户重开新 session。
- **服务重启**：聊天消息历史保留；若底层 ACP 进程/session 无法恢复，则显式提示 session 已断开，并从该线程新开 ACP session，不丢失既有记录。

## 范围与非目标

- 包含：Agent 选择器中的 ACP 目标、目标感知的线程/历史隔离、直接 ACP 发送与流式回复、用户权限请求处理、当前 Agent 的本机工作区绑定。
- 不包含：把 Runner 建成完整 Octop Agent；远程工作区桥接；自动批准 ACP 权限；替代现有“Octop Agent 调用 `acp_runner`”的委派能力；默认启用 Runner；绕过账号级 Runner enable 状态。

## 验收标准

- 启用 Runner 后，它可在工作台 Agent 选择器的 ACP Runner 分组中被选中；未启用 Runner 不出现。
- 选中 ZCode/OpenCode/Kilo 后，文本直接到对应 Runner，响应直接显示，不经 Octop Agent 模型生成。
- 相同 runner 的同一 thread 可续接 ACP 会话；不同 runner、不同 thread 与普通 Agent thread 相互隔离。
- ACP permission request 阻塞操作直到用户选择；取消/断线不遗留活跃子进程或错误的“完成”状态。
- Runner 以当前聊天 Agent 的本机工作区作为启动 cwd；后端拒绝非本机工作区及伪造 Runner ID。安全说明明确 Runner 仍具有服务账号范围内的主机文件访问能力。
- 服务重启或 Runner 异常时历史记录可读，并明确提示需要重新连接/开始 session。
- 普通 Octop Agent 对话、ACP 委派工具、HITL 及原有 Agent 选择均保持可用。

## 主要限制

- Runner 是外部进程，回复质量、模型、账号和服务可用性由 Runner 自身负责。
- 本机工作区限制首版可支持的存储后端；远程 workspace 需要后续设计安全的文件同步/桥接机制。cwd 不是沙箱；若要对非管理员用户开放，必须先补 OS/容器级隔离。
- 若 ACP session 在进程重启后无法恢复，聊天记录保留但 Runner 的内部对话状态会重置。
