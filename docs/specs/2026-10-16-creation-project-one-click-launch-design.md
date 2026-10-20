# 从创作卡片一键启动并嵌入本地项目

## 问题拆解

### 目标

在「创作」和 Home 的应用入口启动受 Octop 管理的 Web 项目，并在工作台内容区嵌入预览。每个项目有稳定的本机访问地址和对应的本机目录；项目目录统一位于 Octop 数据根目录下。

项目访问采用按项目隔离的 `.localhost` 子域名，例如 `http://<project-id>.localhost:8200/`；磁盘目录为 `<Octop 数据根目录>/projects/<project-id>/`。两个位置使用同一个服务端生成的 DNS 安全项目 ID。项目 URL 使用 Octop 的监听端口，由 Octop 按 Host 将请求代理到该项目受管理的 loopback 服务。

这次只涵盖可运行的本地 Web 项目。Home 左侧用于整理聊天的工作台项目分组、普通 GitHub 外链和普通平台链接不变。

### 硬约束与假设

- 浏览器访问 Octop 的基址是 `http://localhost:<port>` 或 `http://127.0.0.1:<port>`。首版不支持 HTTPS、LAN 地址、任意主机名或远程浏览器；这些环境不能安全、可靠地使用 `.localhost` loopback 映射。
- 浏览器访问项目使用 `http://<project-id>.localhost:<Octop 端口>/`。RFC 6761 将 `localhost.` 及其子域名定义为 loopback 特殊用途名称；实际 OS / 浏览器解析行为仍须在目标平台验证。
- Octop 已将 JWT 保存在 `localStorage` 的 `auth_token` 项中。同源项目脚本可以读取 Octop 登录状态并调用 Octop API，因此项目和控制台必须属于不同 origin。只增加 `/projects/<id>` 路径不能建立浏览器安全边界。
- 项目源文件统一位于 `<Octop 数据根目录>/projects/<project-id>/`。项目 ID 由服务端生成并限制为 DNS 安全字符；请求不能提供任意磁盘路径。已存在或非空目录不得被覆盖。现有外部源码要显式导入或复制到对应目录，不得自动移动、删除或覆盖用户目录。
- 可运行项目以 Creations 的 `creation_items` 记录为准：仅 `kind=service` 且 URL 匹配服务端受信任 profile 的条目可运行。复用服务端生成的 `item_id` 作为项目 ID；目录名与 Host label 均使用其小写形式。创建 / 导入匹配条目时建立空目录。工作台聊天分组与 GitHub 元数据项目不作为运行项目，不新增第二套项目 ID 表。
- 现有 `workbench_launch_root` 与 profile `relative_path` 只作为旧源码导入来源；运行时只从 Octop 管理的项目目录读取代码。升级不自动复制、启动、移动或覆盖外部目录；管理员显式导入时复制到空目标，源目录保留，目标有文件则中止。
- 管理员显式登记受信任项目和固定启动 profile，表示同意该项目代码以 Octop 服务账户权限运行。HTTP 请求、创作条目显示名、仓库地址和项目仓库内容都不能改写启动程序、参数、工作目录、监听地址或健康检查配置。
- 项目进程只监听 loopback，并且不继承 Octop JWT、数据库密码或其它服务秘密。子进程仍与 Octop 服务账户拥有相同的操作系统权限；管理员信任配置是运行前提。
- Octop 正常关闭时终止受管子进程；重启后不自动恢复项目进程。不改动数据库、密钥或既有源码作为隐式迁移。

### 失败模式清单

| 失败场景 | 防护 |
|---|---|
| 项目脚本读取 Octop `localStorage` JWT 或同源调用管理 API | 项目使用独立的 `<id>.localhost` origin；项目无法读取控制台存储。CORS 只限制响应读取，不作为请求访问控制；Octop 敏感 API 仍要求 Bearer token 和所有权检查。不能用路径前缀代替 origin 隔离。 |
| 攻击者伪造 Host、注入项目 ID 或穿越项目目录 | 只接受格式有效且已登记的项目 Host；用服务端项目 ID 查 profile；目录 resolve 后必须仍在 projects 根目录内，拒绝路径穿越和符号链接逃逸。 |
| 未经授权触发主机代码执行或改写命令 | 启动 / 停止只允许管理员和条目所有者；profile 来自服务端配置；使用固定 executable 与 argv，不经过 shell。 |
| 项目脚本读取 Octop 的服务端环境秘密或暴露到局域网 | 构造白名单子进程环境；项目只绑定 `127.0.0.1`；不把 Octop 凭证传入子进程。项目进程本身仍具有服务账户的本机文件权限，管理员必须信任它。 |
| 两个项目争抢端口、并发启动重复进程或服务早退 | 按项目 ID 串行化启动；独立分配 loopback 端口；启动健康检查成功后才返回可访问状态；失败时清理进程树并提供有界日志。 |
| 浏览器或 OS 不把 `<id>.localhost` 解析到 loopback | iframe 加载设有限时；超时或加载错误时展示明确错误并保留源码链接，不静默改用同源路径。服务端健康检查只验证本机 upstream，不声称验证浏览器 DNS。目标 Windows / macOS / Linux 浏览器需验证。 |
| 目录初始化覆盖已有数据，或 Octop 退出留下子进程 | 只允许创建不存在或空的专属项目目录；不做隐式递归删除；关闭时终止受管进程树。 |
| 项目请求被反向代理成 Octop 控制台资源或访问任意内部服务 | Host 必须精确匹配登记项目；路径规范化后仅代理到该项目的固定 loopback origins；不开放通用 URL 转发端点。 |

## 方案比较与选型

1. **同源路径反向代理**：`http://127.0.0.1:8200/projects/<id>/`。实现直观，但路径不是浏览器安全边界；项目脚本与 Octop 共享 localStorage 和 origin 级权限。拒绝作为运行任意项目代码的默认方式。
2. **每个项目独立 loopback 端口**：例如 `http://127.0.0.1:8201/`。origin 隔离可靠，实现也较简单，但项目地址不在 Octop 的监听地址下，且项目服务端口暴露在地址栏。
3. **Octop 端口上的每项目 `.localhost` 子域名**：例如 `http://<id>.localhost:8200/`。复用 Octop 本机端口和进程生命周期，同时通过 hostname 形成独立 origin；Octop 能依 Host 路由到每个项目。**采用此方案。** 需要 Host 路由、目标平台解析验证与严格 CORS / Host 检查。

项目源代码使用 Octop 数据根目录下的 `projects/<project-id>/`。相比沿用任意外部目录，这能让每个项目的网页地址与 Octop 管理的源码目录一一对应，并允许 Octop 备份/管理项目文件；创建前检查目标目录，遇到冲突停止，不覆盖文件。升级保留旧 `workbench_launch_root` 配置和源文件，但旧目录不再被直接执行；管理员显式导入时只复制到空目标，之后不自动同步。

## 交互与数据流

- 在「创作」和 Home 应用入口选择已登记项目时，前端向 Octop 查询状态或提交启动请求。服务端验证管理员身份、创作条目所有权、项目 ID 和受信任 profile。
- 该记录是现有 `creation_items` 中 `kind=service` 且 URL 精确匹配受信任仓库 profile 的条目；复用其 `item_id`（当前由 `new_short_id()` 生成的 Crockford 字符可作小写 DNS label），不引入第二套项目表或跨表身份映射。每个条目独立对应 `projects/<item_id.lower()>/` 目录和运行实例，即使两个条目使用同一 GitHub URL 也不共享运行状态。普通 service / platform 项目不会因此自动执行代码。
- 服务端从 `<Octop 数据根目录>/projects/<project-id>/` 解析项目目录；规范化路径及真实路径必须都在固定 projects 根目录内。目录创建必须是原子且不可覆盖已有非空目录。
- 旧配置中的 `workbench_launch_root` 与 profile `relative_path` 在升级后只供管理员显式导入旧源码使用，不再作为运行时 cwd。导入复制到 `projects/<id>/`，源目录保留；不自动删除外部目录或重写用户源码。无项目目录或目录为空时启动失败并提示先导入代码。profile 仍按 GitHub URL 匹配固定命令与健康检查，但运行状态、目录和端口由 `item_id` 隔离。
- 管理员在项目入口使用“导入本地源码”操作触发导入；请求只提交项目 ID，不提交源路径。服务端从匹配 profile 的旧配置 root + 相对路径读取来源，目标必须为空，复制完成后仍保留来源。路径逃逸、符号链接或已有目标内容均使导入失败且不删除任何内容。
- 本地项目绑定的创作条目 URL / kind 不可原地改成另一项目 profile；需要更换源仓库时创建新的项目条目与 ID，旧目录和源码保留。条目删除前先停止对应运行实例，再删除记录 / 缩略图，不递归删除目录。
- profile 使用固定 executable 与参数数组，依序启动前端与后端服务。每个内部服务分配 loopback 端口，只绑定 `127.0.0.1`；健康检查通过后才报告运行中。并发请求复用同一个运行实例。
- Octop HTTP 入口只接受其绑定端口上的主机名：控制台的配置地址和精确登记的 `<id>.localhost`。项目 Host 下将 `/api/v1/*` 转发到该项目固定的后端 loopback origin，其余页面请求转发到固定前端 origin；前端只使用相对 `/api/v1` URL，不直接拼接后端端口。上游 `CORS_ORIGINS` 只配置该项目精确 origin。拒绝未登记 Host、用户信息、端口变体和未知项目；不信任 `Forwarded` / `X-Forwarded-Host` 来选择项目。profile 按 repo URL 提供固定启动模板，不作为多个条目的运行实例共享键。
- Octop API 的 CORS allowlist 不包含项目 origin。CORS 只限制浏览器脚本读取跨域响应，不能阻止请求到达；未认证端点不得有状态变更副作用，敏感操作仍由服务端 Bearer 验证和所有权检查保护。项目页面在不同 origin 下无法读取控制台 `localStorage`；项目进程不接收 Octop JWT 或服务端秘密。
- 前端嵌入 URL 使用同一个项目子域名。服务端只允许项目 profile 中定义的内部 upstream；响应不允许把跳转改写到未登记主机。停止后项目 URL 返回明确的不可用页面；重新启动时复用同一个项目 Host。
- 项目启动成功后使用受限的专用截图流程生成首屏缩略图。截图允许访问的 origin 仅来自该项目 profile，限制请求数、超时和总传输量；不得放宽通用公网截图器的 loopback / 私网 SSRF 保护。截图失败不影响项目启动。
- 保留创作条目的 GitHub 地址作为“查看源码”链接；GitHub URL 不是运行地址、Host 路由或健康检查目标。
- Octop 关闭时停止所有受管进程；重启后状态为停止，不自动执行项目代码。

## 受影响入口

- 项目身份与目录生命周期：`creation_items.item_id` 是匹配 profile 的可运行项目 ID；创建时建空目录，显式导入后才能启动。删除条目先停止对应运行实例，再删除记录和缩略图；不自动递归删除源码目录。源码清理必须是独立、明确的数据删除动作。
- 配置与路径：增加项目根目录解析（固定为 Octop 数据根目录下的 `projects/`）；旧 `workbench_launch_root` 与 profile `relative_path` 仅供显式导入。Octop 的全局 `workbench_code_root` 仍只服务代码浏览，不扩大其读写范围。
- 后端领域：项目目录生命周期、profile 校验、项目 ID / Host 映射、进程管理和项目 upstream 请求转发均放在 `infra/`。Router 只做身份、所有权和请求校验，不实现进程或代理业务规则。
- API：启动、状态、停止 API 使用服务器保存的项目 ID，不接受用户控制的路径或 upstream。需要处理 Host allowlist、流式响应、超时、连接断开和受限的跳转响应。
- Dashboard：Creations 卡片与 Home 平台入口使用 `http://<id>.localhost:<port>/`；启动/运行/失败/停止状态共用同一 API。不能把它当作 Octop 同源 iframe；iframe 有限时未加载时显示不支持环境提示。管理员可从项目入口触发受限的旧源码导入。
- 当前 `data-upload-product` profile：代码必须被显式放入其专属 Octop 项目目录后才可启动；外部 `D:\WorkSpace\data-upload-product` 不自动移动或覆盖。项目的 Go / Node 服务需要继续读取管理器分配的 loopback 端口与 backend URL。
- 测试：项目 ID/Host 校验、Host 欺骗、CORS 隔离、目录穿越与 symlink 逃逸、目录冲突、启动竞态、服务失败清理、不同操作系统上的 `.localhost` 解析和浏览器嵌入行为。

## 对抗性验证设计

- **边界输入**：空 ID、超长 ID、大小写混淆、下划线、点号、前后连字符、Unicode、尾随点、用户信息、错误端口、未登记 Host；均不得选择其他项目或进入项目代理。
- **路径攻击**：`../`、盘符路径、UNC 路径、符号链接指向 projects 根外、已存在的非空目标目录；不得读取、覆盖或删除根目录外的数据。
- **Origin 攻击**：项目页面尝试读取 Octop `localStorage`、携带或窃取 Octop token、向 Octop API 发跨域请求、伪造 `Origin` / `Host` / `Forwarded`；项目 origin 不得获得 Octop token。跨域请求可能抵达服务端，敏感 Octop API 必须由 Bearer 验证和所有权检查拒绝，未认证端点不得产生状态变更。
- **并发与资源耗尽**：重复启动、并发启动/停止、健康检查一直失败、子进程提前退出、超大日志、项目持续输出；项目不得重复运行，日志与等待均有上限，失败时清理进程树。
- **代理滥用**：编码斜杠、反斜杠、绝对 URL、跨项目路径、重定向到公网/局域网、超大响应和 WebSocket 升级；不得变成 SSRF 或通用代理。首版只支持 profile 声明的 HTTP upstream；WebSocket 支持另行验收，不隐式开放。
- **跨平台解析**：在 Windows、macOS、Linux 使用目标浏览器访问 `<id>.localhost`，确认解析到 loopback、Octop Host 路由正确及 iframe 载入；解析不支持时失败关闭并显示说明。

## 验收与验证

- 每个项目有服务端生成的稳定 DNS 安全 ID；项目目录准确为 `<Octop 数据根目录>/projects/<id>/`，访问 URL 准确为 `http://<id>.localhost:<Octop 端口>/`。
- 目录冲突时创建失败且已有文件不变；目录穿越或符号链接逃逸被拒绝。
- 两个项目并行运行时 Host 正确路由到各自前后端；启动同一个项目的重复请求复用一个进程组；停止、失败和 Octop 关闭清理状态及进程。
- 未授权用户、非所有者、未登记项目、伪造 Host、恶意请求体均不能启动服务、选择目录或更换 upstream。
- 从项目 origin 无法读取 Octop localStorage 或获取 Octop token；对 Octop API 发起的跨域请求即使送达，也不能绕过 Bearer 验证和所有权检查。Octop origin 仍能正常访问自身 API。
- `localhost:<port>` 与 `127.0.0.1:<port>` 打开 Octop 时对应的 `<id>.localhost:<port>` 可以嵌入；HTTPS、LAN、远程设备和不支持子域名映射的环境会明确禁用启动预览，不回退到同源路径。
- 创建匹配 profile 的 Creations service item 会以其 `item_id` 建立对应本机目录；显式导入只复制到空目录并保留源目录；删除记录先停止进程再删除条目与缩略图，目录保留，不递归删除项目源码。
- 普通 GitHub 外链、普通平台服务和工作台聊天项目分组行为保持原样。

## 已知限制

- `.localhost` 解析在 RFC 中定义为 loopback 特殊用途，但具体浏览器 / OS 行为必须在目标平台实测；若不支持则该环境无法内嵌预览。
- 首版仅支持本机 HTTP 与受信任项目 profile；不支持 HTTPS、LAN / 远程访问、任意启动脚本 UI 或 Octop 重启后的自动恢复。
- 项目代码运行在 Octop 服务账户权限下。环境变量过滤和独立浏览器 origin 可降低秘密泄露风险，但不能把有意启动的恶意代码限制在 OS 文件权限之外。
- `.localhost` 子域名共享 localhost 的 site 关系，但不是同一个 origin。认证不得依赖 Domain=localhost 的共享 Cookie；项目 origin 不加入 Octop CORS allowlist。
- 外部现有源码目录不会自动移动、覆盖、同步或被删除；首版由管理员显式复制到 Octop 管理目录，后续 Git 同步不在范围内。
