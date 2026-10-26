# 入院登记页面感知语音处理实施计划

> **给代理执行者：** 使用 `- [ ]` 跟踪步骤；本计划在当前 `dev` 工作区执行。工作区已有大量无关未提交文件，不运行会格式化全仓库的 `make all`。

**目标：** 将首页语音语义路由到入院身份核验动作，非当前功能显示“未能识别”，并保持表单候选与身份核验安全边界。

**非目标（Out of Scope）：** 实现挂号、报告打印、报告解读的医院业务；添加独立 Agent/模型配置；让 AI 绕过模拟刷卡或提交确认。

**架构要点：** Octop 增加受当前登录用户保护的首页意图 API，复用当前活动模型并只返回固定意图枚举。Vue 首页所有 ASR 转写均调用该 API，由 AI 按整句语义判断；快捷按钮走同一页面动作分发器。表单仍调用已有的有身份令牌保护的字段候选 API。否定、模型超时、无效意图和非入院语义均显示“未能识别”。

**技术栈/运行方式：** Python 3.12、FastAPI、pytest；Vue 2、Vitest。后端使用 `uv run pytest`，前端在 `demos/admission-registration/frontend` 使用 `npm test -- --run` 与 `npm run build`。

**关联设计文档：** `docs/specs/2026-10-19-admission-registration-page-aware-voice-design.md`

---

## 文件变更清单

- 修改：
  - `src/octop/infra/admission_demo.py`（增加固定首页语义分类与输出白名单）
  - `src/octop/api/routers/admission_demo.py`（增加认证的意图路由及严格输入/输出模型）
  - `tests/unit/test_admission_demo.py`（覆盖动作分类、无效模型结果和服务失败）
  - `tests/integration/test_admission_demo_api.py`（覆盖认证、长度边界、响应合同和模型不可用）
  - `demos/admission-registration/frontend/src/api/platform.js`（封装同源意图接口调用）
  - `demos/admission-registration/frontend/src/logic/voiceFlow.js`（ASR 后按录音页面分发并丢弃过期结果）
  - `demos/admission-registration/frontend/src/App.vue`（统一快捷按钮与语音动作，隐藏首页账号栏）
  - `demos/admission-registration/frontend/src/components/ConversationCard.vue`（让快捷项发送各自意图）
  - `demos/admission-registration/frontend/src/components/BottomBar.vue`（只在办理/结果阶段显示账号栏）
  - `demos/admission-registration/frontend/tests/full-workflow.test.js`（覆盖同义表达、未知输入、按钮动作、重置竞态）
  - `demos/admission-registration/docs/03-prototype.md`（更新首页快捷按钮和语音规则）
  - `memory.md`（记录最终产品行为决策）

## 任务列表

### 任务 1：增加首页语义 API

**涉及文件：** `src/octop/infra/admission_demo.py`、`src/octop/api/routers/admission_demo.py`、`tests/unit/test_admission_demo.py`、`tests/integration/test_admission_demo_api.py`

- [x] 编写并通过单元测试：固定意图白名单，未知、额外字段、畸形 JSON 与模型不可用安全处理。
- [x] 增加固定系统提示词、JSON 解析、枚举过滤及受认证的 `POST /api/admission-demo/intent`。
- [x] 集成测试覆盖认证、输入边界、额外字段和模型故障。
- [x] 定向 pytest：22 passed。

### 任务 2：首页按钮与语音共用动作路由

**涉及文件：** `demos/admission-registration/frontend/src/api/platform.js`、`demos/admission-registration/frontend/src/logic/voiceFlow.js`、`demos/admission-registration/frontend/src/App.vue`、`demos/admission-registration/frontend/src/components/ConversationCard.vue`、`demos/admission-registration/frontend/tests/full-workflow.test.js`

- [x] 覆盖 ASR 同义语、非当前意图、快捷按钮及重置后迟到响应。
- [x] 首页意图 API 调用、页面捕获和过期响应防护；表单继续使用原字段提取。
- [x] 四个快捷项共用分发器；只有入院项进入身份核验。
- [x] 定向前端测试通过。

### 任务 3：修正首页账号栏并同步规格

**涉及文件：** `demos/admission-registration/frontend/src/components/BottomBar.vue`、`demos/admission-registration/frontend/tests/full-workflow.test.js`、`demos/admission-registration/docs/03-prototype.md`、`memory.md`

- [x] 覆盖首页/身份页隐藏用户栏、表单和结果页保留用户栏。
- [x] 将 `showUserBar` 限定为 `form` 和 `result`，同步原型文档与 `memory.md`。
- [x] 定向前端测试通过。

### 任务 4：构建与目标范围验证

- [x] 后端定向 pytest：22 passed。
- [x] 前端全量 Vitest：53 passed；typecheck、Prettier 和生产构建通过。
- [x] Ruff、Ruff format check、`git diff --check` 通过；静态 HTML 指向最新构建资源。
- [ ] 服务重启后在内嵌浏览器手工验证语音闭环；当前服务仍运行旧 Python 进程，停止进程命令被执行策略拦截。

## 质量门控

- [x] 首页入口 API 要求 Octop 登录态；请求不接受模型名、Agent ID、动作名或跳转地址。
- [x] AI 结果仅允许 `begin_admission`/`unsupported`/`unknown`；首页意图不能调用身份核验或提交 API。
- [x] 异步响应校验录音 generation 与当前 page。
- [x] 未运行全仓格式化；未提交、未推送。
