# 模型提供商名称搜索实施计划

> **给代理执行者：** 按下方勾选顺序在当前工作分支实现；保留工作区已有改动，不提交代码。

**目标：** 在模型配置页的预置提供商区域按品牌或站点名称筛选当前云端/本地服务商。

**架构要点：** 使用当前页 React state 和已加载的预置数据，不新增 API 或持久化。单项和分组站点都支持名称匹配；云端搜索也能命中默认折叠的提供商。

**技术栈：** React、TypeScript、Ant Design、i18next；验证使用 `cd dashboard && npm run build`。

**关联设计文档：** `docs/specs/2026-10-15-model-provider-search-design.md`

---

## 文件与职责

- 修改 `dashboard/src/pages/Settings/Models/index.tsx`：搜索状态、预置数据筛选及搜索框布局。
- 修改 `dashboard/src/pages/Settings/Models/index.module.less`：标题与搜索框的响应式布局。
- 修改 `dashboard/src/locales/zh.json`、`dashboard/src/locales/en.json`：搜索 placeholder 和无匹配文案。
- 不修改服务商 API、数据库、已保存配置或自定义提供商列表。

### 任务 1：筛选预置提供商数据

**涉及文件：** `dashboard/src/pages/Settings/Models/index.tsx`

- [ ] **步骤 1：增加本地搜索状态和名称匹配。**

  规范化查询（trim + 小写），匹配服务商展示名、vendor 名、品牌组名、预置名称及站点/变体显示名。品牌组名匹配时保留整组；否则只显示匹配站点。搜索有值时将云端 featured 与 collapsed 数据合并筛选，以允许命中折叠区；无搜索时沿用现有折叠状态。

- [ ] **步骤 2：在预置提供商标题旁显示搜索框。**

  使用 Ant Design `Input`，添加搜索图标和本地化 placeholder；输入只筛选当前云端/本地 tab。无结果时显示本地化的搜索无匹配状态。清空输入后恢复原有云端“更多模型提供商”折叠行为。活动模型池、自定义提供商、配置 API 均不受影响。

### 任务 2：添加双语界面文案

**涉及文件：** `dashboard/src/locales/zh.json`、`dashboard/src/locales/en.json`

- [ ] **步骤 1：为搜索框和匹配为空的状态增加相同键。**

  两个 locale 使用一致 key，例如 `models.searchPresetProviders` 与 `models.noMatchingProviders`。中文使用“搜索服务商或站点”和“没有匹配的服务商”；英文使用对应自然表达。

### 任务 3：构建检查

- [ ] **步骤 1：运行 `cd dashboard && npm run build`。**

  预期：`tsc -b` 和 Vite production build 完成，输出 `✓ built`；现有 chunk size / mixed import 警告不视为本次构建失败。

- [ ] **步骤 2：运行 `uv run pytest tests/unit/i18n -q`。**

  预期：后端和 dashboard 的语言键一致性检查通过。

> 本次执行遵守会话开发指令，不新增或运行测试。构建检查会执行 TypeScript 项目检查，并验证最终前端打包。
