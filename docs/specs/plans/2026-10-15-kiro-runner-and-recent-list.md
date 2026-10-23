# Kiro Runner 与最近对话列表实施计划

> **给代理执行者：** 按任务顺序在当前工作区实施；保留已有用户改动，不提交。

**目标：** 添加默认关闭的 Kiro ACP Runner，并将工作台「任务」区改为按最近活动倒序显示的「最近」列表。

**架构要点：** Runner 默认值继续由 `ACPSettingsStore` 与 harness 配置合并，API 保护内置 Runner 不被删除；工作台只在已有线程列表上做筛选后排序，不修改服务端线程查询。

**技术栈：** Python 3.12、FastAPI、React、TypeScript、i18next；验证使用 `cd dashboard && npx tsc -b`。本轮不运行测试套件。

**关联设计文档：** `docs/specs/2026-10-15-kiro-runner-and-recent-list.md`

---

## 计划文件与职责

- 修改 `src/octop/infra/agents/settings/acp.py`：定义 Kiro 默认 `kiro-cli acp` 启动项。
- 修改 `src/octop/api/routers/acp.py`：禁止删除内置 Kiro Runner。
- 修改 `dashboard/src/pages/Agent/ACP/constants.ts`：Runner 排序、名称和简介键，沿用通用图标。
- 修改 `dashboard/src/locales/zh.json`、`dashboard/src/locales/en.json`：补 Kiro 文案并把工作台任务区标题改为「最近 / Recent」。
- 修改 `dashboard/src/pages/Home/index.tsx`：过滤后以 `last_active || created_at` 倒序排列对话，时间相同时以 `thread_id` 倒序。
- 检查 `tests/unit/agents/test_acp_settings.py`：相关默认值断言当前是否足够；不新增测试文件或执行测试。

## 任务 1：注册 Kiro 内置 Runner

- [x] 在 ACP 服务端默认表添加 `kiro_cli`，命令为 `kiro-cli`、参数为 `acp`、`trusted=false`、解析模式 `update_detail`；省略 `enabled` 以沿用默认关闭。
- [x] 在 API `_BUILTIN_RUNNERS` 中加入 `kiro_cli`，与现有内置项保持一致。
- [x] 在前端内置顺序、label key、intro key 中加入 `kiro_cli`；不引入图标素材，使用通用 Runner 图标。
- [x] 在中英文 `acp` 命名空间增加 `Kiro CLI` 标签和安装/登录后运行 `kiro-cli acp` 的说明。
- [x] 对照 `tests/unit/agents/test_acp_settings.py` 现有断言，确认实现值符合用户批准规格；按本轮约束不运行测试。

## 任务 2：重命名并排序最近对话

- [x] 将工作台 `workbench.home.projects.tasks` 中英文值改为 `最近` / `Recent`。
- [x] 在 `dashboard/src/pages/Home/index.tsx` 对 `visibleThreads` 先执行现有归档/项目/文件夹过滤，再复制并按 `last_active > 0 ? last_active : created_at` 降序排序；相同时间用 `thread_id` 降序稳定打破平局。
- [x] 对 `archivedThreads` 用同一时间规则排序，保持其独立归档展示区域。
- [x] 检查项目/文件夹筛选、归档折叠行为和 composer 最近对话菜单不被改动。

## 验证

- [x] 静态核对 ACP 默认参数、关闭/不信任状态、内置删除保护及中英文键名。
- [x] 运行 `cd dashboard && npx tsc -b`；预期命令退出码为 0。
- [x] 不运行测试套件，不提交或推送。
