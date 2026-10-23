# 创作项目一键启动实施计划

> **给代理执行者：** 本计划由当前会话按 TDD 顺序执行，任务使用 `- [ ]` 勾选跟踪；不提交代码。

**目标：** 管理员可从创作卡片和 Home 启动受信任的 `data-upload-product` 本地服务并嵌入预览。

**非目标（Out of Scope）：** 自动克隆仓库、执行未配置仓库脚本、任意项目启动配置 UI、HTTPS/LAN/远程访问、Octop 重启后自动恢复项目进程。

**架构要点：** Octop 使用受管理的本机子进程启动固定 GitHub 仓库映射，路径限制在独立的 `workbench_launch_root` 下，避免扩大工作台代码浏览根目录；命令由服务端配置提供。启动 API 需要管理员身份和当前账号对创作条目的所有权。服务绑定 loopback，Home 只在 localhost/127.0.0.1 HTTP 访问时使用同主机 iframe。项目缩略图仅访问固定前后端 origins。

**技术栈/运行方式：** Python 3.12、FastAPI、asyncio subprocess、React/TypeScript、Node HTTP、Go；后端 `uv run pytest`，Dashboard `cd dashboard && npx tsc -b`、`npm test -- --run`，整体验收 `make all`。

**关联设计文档：** `docs/specs/2026-10-16-creation-project-one-click-launch-design.md`

---

## 文件变更清单

- 新建：
  - `src/octop/infra/workbench/project_service.py`：受限启动 profile 和本机进程生命周期管理。
  - `tests/unit/workbench/test_project_service.py`：路径安全、幂等启动、健康检查失败与关闭清理。
- 修改：
  - `src/octop/infra/server.py`：初始化及关闭项目服务管理器。
  - `src/octop/api/routers/creations.py`：管理员状态/启动/停止 API，校验当前账号条目归属和精确仓库 URL。
  - `src/octop/infra/creations.py`：固定 origins 的本机首屏缩略图捕获。
  - `tests/integration/test_creations_api.py`：API 授权、匹配、状态与启动行为。
  - `dashboard/src/api/modules/creations.ts`：启动服务响应类型和请求函数。
  - `dashboard/src/pages/Creations/index.tsx`、`index.test.tsx`：仓库卡片启动/打开状态与入口。
  - `dashboard/src/pages/Home/index.tsx`、`home-workbench.test.tsx`：缩略图读取、启动后同主机嵌入及访问协议限制。
  - `D:\WorkSpace\data-upload-product\doc\prototype\server.js`：用受控环境变量配置 loopback 主机、端口和 API 地址注入；不得覆盖其他现存修改。
  - `D:\WorkSpace\data-upload-product\doc\prototype\server.test.js`：Node 内置测试验证绑定及 API 地址注入。
  - `docs/specs/2026-10-16-creation-project-one-click-launch-design.md`：若实现发现行为差异，先回改规格再实现。
- 测试：
  - `tests/unit/workbench/test_project_service.py`
  - `tests/integration/test_creations_api.py`
  - `dashboard/src/pages/Creations/index.test.tsx`
  - `dashboard/src/pages/Home/home-workbench.test.tsx`
  - `D:\WorkSpace\data-upload-product\doc\prototype\server.test.js`

## 任务列表

### 任务 1：项目服务进程管理

**涉及文件：** `src/octop/infra/workbench/project_service.py`、`tests/unit/workbench/test_project_service.py`、`src/octop/infra/server.py`

- [ ] **步骤 1：RED 测路径限制和未知仓库拒绝**
  - 编写两个行为测试：profile 只匹配 `https://github.com/xdguo-design/data-upload-product`；仓库相对路径越出 root 或经 symlink 逃逸时启动拒绝且不创建子进程。
- [ ] **步骤 2：运行并确认失败**
  - 运行：`uv run pytest tests/unit/workbench/test_project_service.py -q`
  - 预期：测试因 `ProjectServiceManager` 尚不存在而失败。
- [ ] **步骤 3：GREEN 实现 profile 校验**
  - 建立一个固定 profile：相对目录 `data-upload-product`；后端命令 `go run ./cmd/server`，cwd `backend`，`ADDR` 使用已分配 loopback 端口；前端命令 `node doc/prototype/server.js`，cwd 项目根，环境绑定 loopback 并注入后端 URL。
  - profile 的仓库 URL 与端口/程序/argv 均为服务端常量；只从 `OctopConfig.workbench_code_root` 解析真实项目目录，拒绝不存在目录、路径越界和 symlink 越界。
- [ ] **步骤 4：GREEN 测异步启动和清理**
  - 增加假子进程/本机健康端点行为测试：启动两进程、健康检查后返回 UI URL；重复并发启动共享实例；停止与 `close()` 终止两个进程；任一健康检查超时则清理所有已启动子进程。
- [ ] **步骤 5：运行单元测试**
  - 运行：`uv run pytest tests/unit/workbench/test_project_service.py -q`
  - 预期：路径与进程生命周期行为全部通过。
- [ ] **步骤 6：接入 OctopServer**
  - `start()` 完成配置绑定后创建 manager；`stop()` 在其他服务关闭前 await manager.close()；每次启动分配两个端口并通过 `ADDR`、`CORS_ORIGINS`、`HOST`、`PORT`、`BACKEND_URL` 环境变量连接 Go/Node 服务。
- [ ] **步骤 7：重跑单元测试**
  - 运行：`uv run pytest tests/unit/workbench/test_project_service.py -q`
  - 预期：仍全部通过，server lifecycle 不引入全局进程残留。

### 任务 2：Creations 启动 API 和缩略图

**涉及文件：** `src/octop/api/routers/creations.py`、`src/octop/infra/creations.py`、`tests/integration/test_creations_api.py`

- [ ] **步骤 1：RED 验证 API 权限与条目匹配**
  - 编写 API 测试：非管理员返回 403；其他用户条目返回 404；普通服务 URL/伪造 GitHub URL返回 404；规范仓库地址返回启动状态。
- [ ] **步骤 2：运行并确认失败**
  - 运行：`uv run pytest tests/integration/test_creations_api.py -q`
  - 预期：新 launch endpoint 返回 404。
- [ ] **步骤 3：GREEN 增加薄 HTTP 适配器**
  - 在 Creations router 增加 `GET/POST/DELETE /creations/items/{item_id}/launch`；使用 `require_admin()`、当前用户条目列表和规范化 GitHub URL 精确匹配；请求体不接受命令或路径。
  - 状态只返回 `stopped|starting|running|failed`、服务 URL 和经长度限制的日志摘要。
- [ ] **步骤 4：RED/GREEN 缩略图受限捕获**
  - 覆盖截图页面只访问固定前后端 origins、其他 origin 被 abort、截图失败不影响服务启动、认证 thumbnail URL 仍按 owner/item 隔离；不修改通用公网截图 SSRF proxy。
- [ ] **步骤 5：运行集成测试**
  - 运行：`uv run pytest tests/integration/test_creations_api.py -q`
  - 预期：权限、仓库匹配、启动状态和 thumbnail 行为全部通过。

### 任务 3：目标项目服务支持可控监听

**涉及文件：** `D:\WorkSpace\data-upload-product\doc\prototype\server.js`、`D:\WorkSpace\data-upload-product\doc\prototype\server.test.js`

- [ ] **步骤 1：RED 为 Node launcher 写测试**
  - 使用 Node 内置 `node:test` 启动 server.js 子进程，指定空闲测试端口、`HOST=127.0.0.1` 与 `BACKEND_URL=http://127.0.0.1:1/api/v1`；读取首页并确认注入值在 `api.js` 执行前出现；确认 127.0.0.1 可连接、非配置端口不可连接。
- [ ] **步骤 2：运行并确认失败**
  - 运行：`node --test doc/prototype/server.test.js`
  - 预期：因当前 server.js 固定绑定 8090 且没有 API base 注入而失败。
- [ ] **步骤 3：GREEN 修改单个 launcher 文件**
  - server 监听 `process.env.HOST || '127.0.0.1'` 与解析后的 `process.env.PORT || 8090`；对 HTML 响应在 `</head>` 前注入 JSON 安全转义后的 `window.__API_BASE__`，默认 API base 保持当前 `http://localhost:8080/api/v1`。
- [ ] **步骤 4：运行目标项目测试**
  - 运行：`node --test doc/prototype/server.test.js`
  - 预期：主机、端口、注入顺序测试通过；仅修改目标文件和新增测试文件，其他未提交改动保持原状。

### 任务 4：Dashboard 两个入口

**涉及文件：** `dashboard/src/api/modules/creations.ts`、`dashboard/src/pages/Creations/index.tsx`、`dashboard/src/pages/Creations/index.test.tsx`、`dashboard/src/pages/Home/index.tsx`、`dashboard/src/pages/Home/home-workbench.test.tsx`

- [ ] **步骤 1：RED 为卡片操作和 Home 入口增加行为测试**
  - Creations：匹配仓库出现启动/运行状态操作，未知 GitHub repo 仍打开源码；启动后打开运行 URL，非管理员不显示启动控件。
  - Home：匹配条目启动成功后 iframe 使用返回 URL；`thumbnail_url` 显示在条目图；HTTPS 或非 loopback 页面不会请求 start API 或创建 HTTP iframe。
- [ ] **步骤 2：运行并确认失败**
  - 运行：`cd dashboard && npm test -- --run src/pages/Creations/index.test.tsx src/pages/Home/home-workbench.test.tsx`
  - 预期：新增行为因缺少 API 函数和按钮而失败。
- [ ] **步骤 3：GREEN 实现最小 API 与交互**
  - 创建/复用 `creationsApi.launchStatus/start/stop`；Creations 卡片显示启动/打开/停止；Home 通过同一个 API 启动，并使用已有 `resolvePrivatePlatformUrl` 验证 scheme/hostname 后加载 iframe。
  - `platformEntries` 的用户项目使用 API 返回的 `thumbnail_url`。
- [ ] **步骤 4：运行前端验证**
  - 运行：`cd dashboard && npm test -- --run src/pages/Creations/index.test.tsx src/pages/Home/home-workbench.test.tsx; npx tsc -b`
  - 预期：两个目标文件测试和 TypeScript 构建通过。

### 任务 5：整体验收

- [ ] 运行：`uv run pytest tests/unit/workbench tests/integration/test_creations_api.py -q`
  - 预期：进程管理和路由集成验证通过。
- [ ] 运行：`node --test doc/prototype/server.test.js`（工作目录 `D:\WorkSpace\data-upload-product`）
  - 预期：launcher 测试通过。
- [ ] 运行：`make all`
  - 预期：Ruff、mypy、backend tests、dashboard formatting/typecheck/build 全部通过。
- [ ] 运行本机 E2E：在浏览器 `http://127.0.0.1:8200/creations` 点击启动，等待后端与前端 health checks，确认 Home 可嵌入应用、卡片缩略图可读、停止后端口不再响应。
  - 预期：成功路径可见真实应用首屏；Octop shutdown 后 Go/Node 子进程均退出。
