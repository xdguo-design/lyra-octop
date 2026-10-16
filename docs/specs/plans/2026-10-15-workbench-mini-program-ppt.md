# 工作台小程序与 PPT 创作入口实施计划

> **给代理执行者：** 按任务顺序在当前会话逐步执行，使用 `- [ ]` 跟踪；不提交代码。

**目标：** 在工作台首页增加小程序和 PPT 创作入口，用户选择任务后把对应引导描述提交给当前专家的 AI 助手。

**架构要点：** 复用 `WorkbenchHome` 卡片和 `onSubmitTask` 回调；使用现有 Ant Design `Modal` 展示任务选择器。文案与完整任务提示词放进中英文 `workbench.home` 资源，不新增 API、路由或数据表。

**技术栈：** React 18、TypeScript、Less、Vitest；验证命令为 `cd dashboard && npx vitest run src/pages/Control/RemoteBrowser/WorkbenchHome.test.tsx` 和 `cd dashboard && npx tsc -b`。

**关联设计文档：** `docs/specs/2026-10-15-workbench-mini-program-ppt-design.md`

---

## 文件职责

- 修改 `dashboard/src/pages/Control/RemoteBrowser/WorkbenchHome.tsx`：两张创作卡、类型选择状态、任务模板选项以及提交回调。
- 修改 `dashboard/src/pages/Control/RemoteBrowser/WorkbenchHome.module.less`：创作卡缩略预览与任务选项布局。
- 修改 `dashboard/src/pages/Control/RemoteBrowser/WorkbenchHome.test.tsx`：选择器打开、选择后提交、取消不提交等交互验证。
- 修改 `dashboard/src/locales/zh.json` 和 `dashboard/src/locales/en.json`：卡片、任务模板、对话框及任务提示词。

### 任务 1：添加创作选择流程测试

**涉及文件：** `dashboard/src/pages/Control/RemoteBrowser/WorkbenchHome.test.tsx`

- [x] **步骤 1：测试两个入口和对应任务选择**

覆盖小程序卡打开对应选择器、PPT 卡打开对应选择器、选择任务后 `onSubmitTask` 只调用一次并收到非空提示词；关闭选择器不提交。

- [x] **步骤 2：运行目标测试确认失败**

运行：`cd dashboard && npx vitest run src/pages/Control/RemoteBrowser/WorkbenchHome.test.tsx`

预期：新增用例失败，提示对应入口或任务选项不存在；现有工作台交互用例保持通过。

### 任务 2：实现卡片、任务选择器和本地化

**涉及文件：** `WorkbenchHome.tsx`、`WorkbenchHome.module.less`、`dashboard/src/locales/{zh,en}.json`

- [x] **步骤 1：新增 `miniProgram | presentation | null` 选择状态**

工作台卡片保留星球乐园和工作流，将不可点击的「更多工作台」占位卡替换为小程序和 PPT 两张卡。点击卡片只打开对应选择器。

- [x] **步骤 2：提供固定的任务模板**

小程序包含商城、预约/报名、互动游戏；PPT 包含产品介绍、工作汇报、方案提案。每项显示标题和简短说明，点击后先关闭选择器，再调用 `onSubmitTask` 传入资源文件中的完整提示词。

- [x] **步骤 3：用现有 `Modal` 实现可关闭选择器**

通过标题说明当前创作类型；取消、遮罩或 Escape 关闭时清除选择状态但不提交。任务按钮只在点击时提交一次。

- [x] **步骤 4：补齐中英文资源及响应式样式**

所有新增可见字符串和任务提示词使用 `workbench.home` 中英文资源；任务选项在窄屏下纵向排列并保持可点击区域清晰。

### 任务 3：运行交互与类型验证

**涉及文件：** 无新增文件。

- [x] **步骤 1：运行工作台首页测试**

运行：`cd dashboard && npx vitest run src/pages/Control/RemoteBrowser/WorkbenchHome.test.tsx`

预期：所有旧用例和创作选择用例通过。

- [x] **步骤 2：运行 TypeScript 项目检查**

运行：`cd dashboard && npx tsc -b`

预期：退出码为 `0`，无 TypeScript 错误。

- [x] **步骤 3：检查最终差异范围**

运行：`git diff --check; git status --short`

预期：无空白错误；本任务只新增本计划文档并修改文件职责中列出的前端文件，其他既有工作区改动保持原样。

额外运行：`cd dashboard && npm run build`。结果：成功生成前端静态资源；Vite 输出了项目既有的动态/静态混合导入及大 chunk 警告。
