# 入院登记原型接入创作平台实施计划

> **给代理执行者：** 本计划在当前会话内逐项执行并勾选；不提交、不推送。

**目标：** 将 Vue 入院登记原型随 Octop 同源发布，在创作页提供内嵌入口，并安全提供其 mock API。

**架构要点：** 先按现有方式构建 Dashboard，再构建 Vue 静态文件到 Dashboard 公共资源，避免 Dashboard 构建清空子应用产物。Octop API 路由调用内存领域服务，所有请求要求登录，身份与模拟提交以用户 ID 隔离。

**技术栈：** Python 3.12、FastAPI、pytest；React/Vite、Vue 2、Vitest。运行后端测试使用 `.\.venv\Scripts\python.exe -m pytest`，Dashboard 使用 `npm test`、`npx tsc -b`、`npm run build`；Demo Vue 使用 `npm test`、`npm run typecheck`、`npm run build`。

**关联设计文档：** `docs/specs/2026-10-19-admission-registration-creations-design.md`

---

## 文件与职责

- `src/octop/infra/admission_registration_demo.py`：字段合同、地区、用户隔离的内存模拟状态和 AI 候选过滤。
- `src/octop/api/routers/admission_registration.py`：认证 API 契约和领域调用。
- `src/octop/api/routers/admission_demo.py`：复用抽取逻辑，不更改已有端点行为。
- `src/octop/api/app.py`：注册新的 API 路由。
- `src/octop/infra/admission_registration_*.json`：wheel 内字段及地区合同副本。
- `demos/admission-registration/frontend/vite.config.js`、`package.json`：开发代理保留，生产构建 base/output 指向 Dashboard 公共资源。
- `dashboard/src/pages/Creations/builtInCreations.ts`、`index.test.tsx`、`dashboard/src/locales/{zh,en}.json`：卡片元数据、预览行为回归和双语文案。
- `Makefile`：在 Dashboard 构建后生成 Vue 前端静态资源。
- `tests/unit/`、`tests/integration/`：领域隔离、API 权限和接口行为。

## 执行步骤

### 任务 1：实现模拟状态按用户隔离

- [x] 为 `DemoStore` 添加 user ID 归属；身份、幂等提交及 patient key 均按用户限定。
- [x] 测试：A 用户创建 token 后，B 用户不能读取身份、提交或读取结果；同一用户的重复幂等请求仍保持原行为。
- [x] 运行后端目标测试：9 passed。

### 任务 2：接入认证 API 与模型抽取

- [x] 将 Demo 合同数据打包到 Octop `infra`，新增 thin API router，并要求所有端点 `current_user`。
- [x] 提取现有 `/api/admission-demo/extract` 的内部模型调用逻辑，使新 API 复用同一模型，不经 HTTP 回调 Octop 自己。
- [x] 测试未认证拒绝、字段合同校验、用户隔离、当前模型使用与候选过滤。
- [x] 运行目标测试：9 passed。

### 任务 3：添加创作卡片和预览行为

- [x] 添加“智能入院登记”内置卡片，使用已有 app 预览 overlay，URL 指向同源静态 `index.html`。
- [x] 用户指出缺少首页图后，从原型首页设计稿生成 16:9 封面并加入卡片；回归测试断言封面 URL。
- [x] 为中英文完善标题/描述文案；增加卡片可见、iframe URL、返回和关闭测试。
- [x] 新卡片封面/预览测试通过；TypeScript 检查和前端生产构建通过。整份 Creations 测试另有 1 项失败：既有断言依赖缺失的“门诊电子病历模板工作台”，其余 11 项通过。

### 任务 4：把 Vue 产物接入 Dashboard 发布

- [x] 配置生产构建 `/admission-registration/` base 并输出至 `src/octop/dashboard/admission-registration`；开发模式仍使用现有 `5173` 与 proxy。
- [x] 修改 `build-frontend`，先构建 Dashboard，再构建 admission-registration，以免 Dashboard 清理阶段删除 Vue 产物。
- [x] Vue `npm test` 6 passed、`npm run typecheck`、`npm run format:check`、`npm run build:dashboard` 均通过；Dashboard `npx tsc -b` 与 `npm run build` 通过。HTTP 入口与 JS 资源返回 200，wheel 配置包含 infra JSON。

### 任务 5：收尾验证

- [x] 目标后端测试通过，新增 Vue app preview/封面测试通过；本功能 `git diff --check` 通过。未运行会格式化全仓既有未提交内容的 `make all`。
- [x] 浏览器回归：创作卡打开同源预览；欢迎页渲染，点击“可以说帮我入院登记”进入身份核验页，顶栏“创作”返回列表。
- [x] 平台 `http://127.0.0.1:8200/admission-registration/index.html` 和打包 JS 返回 200；未认证 API 返回 401，证明路由已挂载且认证生效。当前浏览器还显示“语音识别暂不可用”，不影响页面加载与身份页入口；麦克风/ASR 未实测。
- [x] 在本文记录验证结果；没有触碰非本功能文件的既有更改。
