# 工作台项目、代码浏览与 Agent 身份实施计划

> **给代理执行者：** 在当前 `dev` 工作区按任务顺序执行，逐步勾选；保留现有未提交改动，不创建提交。

**目标：** 提供账号同步的工作台项目/文件夹和任务归属、星球只读代码浏览，以及可命名和配置头像的主 Agent 与 ACP 协作成员展示。

**架构要点：** 复用当前未发布的数据库迁移 `022` 和 CreationRepo/API 的 owner-scoped 模式。代码文件根目录仅由服务端配置指定，文件 API 只读并强制路径边界。前端复用已有 Agent 头像与图标组件，不增加依赖。

**技术栈：** Python 3.12、FastAPI、SQLite/PostgreSQL、React/TypeScript、Vite；验证使用 `uv run pytest`、`cd dashboard && npx tsc -b`、`make build-frontend`。

**关联设计文档：** `docs/specs/2026-10-15-workbench-projects-and-agent-identity-design.md`

---

## 文件职责清单

- 修改 `src/octop/infra/db/migrations/022_creations.sql` 与 `.pg.sql`：将未发布迁移扩展为项目、文件夹、线程归属结构。
- 新建 `src/octop/infra/db/repos/workbench.py`：账号级项目、文件夹和任务归属 SQL。
- 修改 `src/octop/infra/db/services.py`：注入 WorkbenchRepo。
- 新建 `src/octop/infra/workbench/` 服务模块：校验项目归属和代码根目录只读访问。
- 新建 `src/octop/api/routers/workbench.py`：项目/文件夹/任务归属与代码树 API。
- 修改 `src/octop/api/app.py`：注册工作台路由。
- 修改 `src/octop/config.py` 与 `.env.example`：显式配置星球代码根目录。
- 新建 `dashboard/src/api/modules/workbench.ts`：工作台 API 类型与调用。
- 修改 `dashboard/src/pages/Home/index.tsx`、`home-workbench.css`：账号项目层级、文件夹、项目任务创建/归属、代码浏览入口、Agent/ACP 头像展示。
- 修改团队编辑表单及相关头像 API 调用：主 Agent 名称和头像可编辑。
- 修改 `tests/unit/db/test_db_pool.py` 迁移水位断言及相关 API/Repo/文件边界测试。
- 按 API 变更要求更新 `src/octop/api/openapi_meta.py` 的标签描述（仅当新增标签）。

## 任务 1：账号级工作台持久化

- [x] 扩展未发布 `022` SQLite/PostgreSQL 迁移，增加工作台项目、文件夹及线程归属表/约束；文件夹删除时线程归属回到项目根，项目删除时线程归属清空。
- [x] 新建 WorkbenchRepo 并通过 RepoBundle/SharedServices 注入，所有 SQL 条件包含 `owner_user_id`。
- [x] 在 `tests/unit/db/test_db_pool.py` 更新版本断言到 22，新增 Repo 测试覆盖跨账号隔离、文件夹删除保留线程、项目删除清空归属。
- [x] 运行 `tests/unit/db/test_db_pool.py` 和新增 WorkbenchRepo 单测（使用项目 `.venv` Python；当前 shell 没有 `uv`）。

## 任务 2：项目 API 与代码只读 API

- [x] 增加 Pydantic 请求/响应模型与 `workbench` 路由：项目/文件夹 CRUD、线程归属更新、目录列举和文本文件读取。
- [x] API 使用当前用户和 WorkbenchRepo；线程必须属于当前用户。
- [x] 配置 `OCTOP_WORKBENCH_CODE_ROOT`，只绑定服务端根目录；路径解析后检查根路径包含关系，拒绝符号链接越界、隐藏项、凭证/运行数据目录、二进制和超过 1 MiB 的文本文件。
- [x] 注册路由并给每个端点添加 summary、类型化响应。
- [x] 增加 API/服务测试覆盖 owner 隔离、`..`、符号链接越界、秘密文件、二进制、超大文件和正常文本读取。
- [x] 运行新增测试及数据库迁移/Repo 测试。

## 任务 3：工作台项目/文件夹交互

- [x] 新建 dashboard workbench API 模块并接入项目、文件夹和线程归属调用。
- [x] 替换 `Home/index.tsx` 中项目 `localStorage` 状态为账号 API；保留“全部任务 → 项目列表 → 当前任务列表”结构与既有会话本体。
- [x] 项目行使用可选图标；项目内支持新建/重命名/删除文件夹，文件夹行展示对应对话。
- [x] 增加项目内“新建任务”，创建会话后写入项目/文件夹归属；输入框“+”增加项目/文件夹选择，可对当前会话更新归属。
- [x] 文件夹或项目删除只解除会话归属，不触发 thread delete；API 失败时提示错误并保留服务端数据。
- [x] 更新 sidebar CSS；增加/更新 `home-workbench.test.tsx` 覆盖首页对话、项目任务归属、ACP 展示和导航。
- [x] 运行首页前端用例与 TypeScript 检查。

## 任务 4：代码浏览和 Agent/ACP 身份

- [x] 项目详情增加“代码”只读入口，树视图列目录，文本预览通过 workbench API 读取；目录或文件权限/大小错误显示提示。
- [x] 主 Agent 团队编辑表单允许名称和头像上传，保存到已有 Team `icon_url` 字段。
- [x] Agent 选择器显示 Agent 头像；主 Agent 协作成员区域显示团队成员头像及已启用 ACP runner 名称，ACP 不进入 agentOptions。
- [x] 补充前端测试覆盖 ACP 展示及 ACP 不是聊天目标。
- [x] 运行 TypeScript 检查与相关前端测试。

## 任务 5：收尾验证与构建

- [x] 执行数据库、workbench、creation API 与文件边界相关测试（使用项目 `.venv` Python）。
- [x] 执行 `cd dashboard && npx tsc -b`。
- [x] 执行等效前端生产构建 `cd dashboard && npm run build`（`make` 在当前 Windows shell 不可用）；构建写入 Vite 配置的 dashboard 构建目录。
- [x] 检查 `git diff --check` 与 `git status --short`；保留了既有未提交改动。
- [x] 配置代码根目录并重启当前 Octop 服务，确认首页、健康接口和受保护的 workbench 路由可达。
