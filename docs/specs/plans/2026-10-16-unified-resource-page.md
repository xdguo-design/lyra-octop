# `/connectors` 统一资源页实施计划

> **给代理执行者：** 按本会话逐项执行并在批次节点同步。任务使用 `- [ ]` 跟踪；不提交代码。

**目标：** 将 `/connectors` 替换为专家、技能、连接器统一搜索列表，保留原有管理动作，并让已安装/导入/启用的资源优先显示。

**架构要点：** 前端在现有 Connectors 页面装配三个资源目录，使用纯函数归一化、搜索和排序。后端新增一个受 `skill_packages` 权限保护的只读端点，一次返回当前用户可见技能包中的 slug 集合，避免前端逐包请求。连接器授权和资源变更仍走已有 API。

**技术栈：** React 18、TypeScript、Ant Design、FastAPI、pytest。使用 `uv run pytest`，前端使用仓库 Vitest 配置和 `cd dashboard && npx tsc -b`。

**关联设计文档：** `docs/specs/2026-10-16-unified-resource-page-design.md`

---

## 文件清单

- 修改 `src/octop/api/routers/skill_packages.py`：添加当前用户可见技能 slug 聚合端点。
- 修改 `dashboard/src/api/modules/skillPackages.ts`：添加端点的 typed client 方法。
- 新建 `dashboard/src/pages/Agent/Connectors/resourceCatalog.ts`：混合资源类型、搜索、类型筛选、稳定启用优先排序。
- 新建 `dashboard/src/pages/Agent/Connectors/resourceCatalog.test.ts`：覆盖同 ID、搜索、筛选、状态优先和稳定性。
- 修改 `dashboard/src/pages/Agent/Connectors/index.tsx`：以统一资源市场替换三个 connector tabs，并保留配置 drawer、实例管理、自定义 MCP、专家创建、技能预览导入动作。
- 修改 `dashboard/src/pages/Agent/Connectors/index.module.less`：统一列表的工具栏、筛选和卡片布局。
- 修改 `dashboard/src/locales/zh.json`、`dashboard/src/locales/en.json`：补充所需的统一列表文案。
- 修改 `tests/integration/test_skill_packages_api.py`：聚合端点仅返回可访问包 slug 且不返回内容的测试。

## 任务 1：技能 slug 聚合 API

- [x] **步骤 1：补失败测试**：在技能包 API 集成测试中验证 slug 去重、无正文泄露，以及未认证/无权限请求被拒绝。
- [x] **步骤 2：运行测试确认失败**：先运行新增用例，端点缺失时得到 404。
- [x] **步骤 3：实现端点**：`GET /api/skill-packages/installed-slugs`，使用 `require_permission("skill_packages")`，遍历 `repo.list_all()` 并调用 `store.list_skill_summaries(package_id)`，只收集 `slug` 到去重集合并返回排序后的字符串数组。
- [x] **步骤 4：运行测试确认通过**：`uv run pytest tests/integration/test_skill_packages_api.py -q`。

## 任务 2：混合目录排序和过滤

- [x] **步骤 1：先写 `resourceCatalog.test.ts`**：覆盖跨类别搜索、类型筛选和 enabled 优先的稳定排序。
- [x] **步骤 2：运行指定 Vitest 测试确认失败**：缺少实现时先确认测试失败。
- [x] **步骤 3：实现 `resourceCatalog.ts`**：导出 `ResourceKind`、`UnifiedResource`、`filterAndSortResources(resources, query, kind)`；搜索 name/description/category，先筛选，再按 enabled 降序，稳定保留输入序号。
- [x] **步骤 4：运行指定 Vitest 测试确认通过**：`cd dashboard && npx vitest run src/pages/Agent/Connectors/resourceCatalog.test.ts`。

## 任务 3：替换页面并保留资源动作

- [x] **步骤 1：为页面交互写测试**：通过 `UnifiedResourceBrowser.test.tsx` 和 `resourceCatalog.test.ts` 覆盖统一搜索、类型筛选、资源分组及排序。
- [x] **步骤 2：运行页面测试确认失败**：组件文件落地前先确认新测试失败。
- [x] **步骤 3：替换页面装配**：并行加载资源目录；专家、技能、连接器状态依设计计算；卡片动作分别保留打开连接器管理、自定义 MCP、专家和技能导入流程。
- [x] **步骤 4：保留现有 OAuth 回调和 connector 配置生命周期**：保留 OAuth 回调、配置 drawer、实例启停和删除逻辑。
- [x] **步骤 5：统一样式和中英文文案**：页面展示统一搜索、可选类别筛选及混合资源列表；插件不纳入列表。
- [x] **步骤 6：运行页面测试和 TypeScript 检查**：`cd dashboard && npx vitest run src/pages/Agent/Connectors && .\node_modules\.bin\tsc.cmd -b`。

## 任务 4：完整回归

- [x] **步骤 1：运行后端聚合 API 测试**：`uv run pytest tests/integration/test_skill_packages_api.py -q`（19 passed）。
- [x] **步骤 2：运行前端相关测试和构建**：Connector 测试 22 passed，TypeScript 检查通过，`npm run build` 成功。
- [ ] **步骤 3：运行项目 ship bar**：Windows 环境无 `make` 命令，未运行 `make all`；未提交或推送。

## 安全与性能断言

- 聚合 API 必须有 `skill_packages` 权限依赖，只返回 slug；禁止返回 `SKILL.md` 内容、credentials 或包文件路径。
- 前端不把任何 credential 字段放入 UnifiedResource，也不通过搜索索引保存 token。
- 技能状态由单次聚合请求获取，不按 package 数量启动并发请求。
- 当一类资源 API 失败时，该类显示可重试错误，其他类结果仍可搜索。
