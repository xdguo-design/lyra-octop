# Octop PPT 制作工作台实施计划

用户要求在当前 Octop 项目内实现制作工作台，独立 HTML 原型不能满足要求。授权范围沿用已确认的专用页面、大纲、逐页修改、预览与 PPTX 下载；不再停在原型。当前分支 dev，不提交、不推送。

## 事实、选择与失败模式

- React/Ant Design 页面进入现有认证路由，创作列表添加内部入口 `/ppt-studio`；复用 AgentContext 和现有专家绑定的模型。
- 演示稿是账号和专家共同限定的 JSON 文档。选择现有 settings KV 做原子持久化，避免为首版引入新表/迁移；存储前校验 schema 和 revision。
- 备选是重建专用 Agent 加聊天工作流，但会增加 Agent 配额、技能挂载和聊天状态的耦合。选择平台任务驱动模型规划与逐页 SVG 创作，复用固定版本 ppt-master 原生导出器；不提供模型执行任意 shell 的接口。
- 工作区成果通过 HarnessAgent.workspace 写入；上游脚本只在独立临时目录处理经过校验的 SVG。
- 失败场景：越权读取由用户和专家双边界拒绝；重复或过期提交由 revision 与任务门禁拒绝；模型/进程中断保留已完成页面并可重试；恶意 SVG 在预览和导出前拒绝脚本、外链、实体及非支持元素；模型和导出任务有并发、大小和时间限制。

## API 契约

前缀 `/api/agents/{agent_id}/presentations`，全部要求专家所有者权限。

- GET `/runtime`：返回固定版本导出器是否就绪。
- GET/POST `/`：列出当前用户作品或创建持久化空稿。
- GET/PUT `/{deck_id}`：读取或按 revision 保存作品；修改内容只使对应页面 SVG 失效。
- POST `/{deck_id}/jobs`：按 revision 启动 outline/generate/revise/export。生成任务逐页保存；前端轮询作品状态。revise 必须指定 page_id 和修改指令。
- GET `/{deck_id}/download`：鉴权后下载当前可用的真实 PPTX。

Deck 字段：deck_id、agent_id、owner_user_id、title、brief、audience、style、slides、revision、status、error、export_path、updated_at。Slide 字段：slide_id、title、body、notes、svg。状态 idle/outline/generating/revising/exporting/failed；运行时任务在服务重启后标为失败并保留已完成结果。

## 执行步骤与验证

- [x] 后端核心：实现并验证持久化、CAS、输入安全、逐页生成、失败恢复、固定版本 PPT Master 适配和安装命令；`tests/unit/presentations` 27 项通过。
- [x] HTTP：薄路由调用核心，注册 OpenAPI；覆盖未登录、跨账号、读取保存、任务校验与下载；`tests/integration/test_presentations_api.py` 3 项通过。
- [x] Dashboard：正式 React 页面和 typed API 已接入创作入口、当前专家、作品选择、新建、大纲、SVG 页预览、内容保存、AI 单页修改、进度恢复与 PPTX 下载；中英文文案齐全。
- [~] 集成：PPT 页面/API 6 项前端用例、TypeScript、Ruff、mypy、i18n 测试通过；`npm run build` 成功。尚未进行浏览器手工走查；完整 `make all` 未运行，避免其全仓格式化改写其他未提交改动。
- [x] 文档与运行：固定上游版本已安装于本机 Octop 数据目录，真实导出产生并验证 16,840 字节 PPTX；使用步骤和部署说明见 `docs/ppt-studio.md`。真实模型生成和远端部署未执行。

## 文件职责

- `src/octop/infra/presentations/`：输入模型、持久化与任务、SVG 安全校验、固定版本 PPT Master 适配。
- `scripts/install_ppt_master.py`：可重复执行的固定上游安装命令。
- `src/octop/api/routers/presentations.py`：认证与 HTTP 映射。
- `dashboard/src/api/modules/presentations.ts`：类型化 API。
- `dashboard/src/pages/PresentationStudio/`：正式页面、样式、行为测试。
- 原有 app.py、openapi_meta.py、settings repo、创作入口、路由与本地化仅作必要增量，不覆盖其他未提交工作。

实现后依次进行规格符合性与代码质量审查。原型仅保留作设计参考，不能替代正式实现。
