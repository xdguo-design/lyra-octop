# Codex Cloud：LYRA dev 工作台云端验收

> 适用于 Codex Cloud 的独立云端环境。**不是** Vercel/Render 网站部署，也不是离线模拟页。
> 已确认前端 GitHub Actions 构建、Home 单元测试与页面集成测试通过。CI 不能代替真实浏览器验收。

## 仓库和变更边界

- GitHub 仓库：`xdguo-design/lyra-octop`
- 基线：`dev`；已有 Draft PR #1（`dev -> main`），不得直接合并 `main`。
- 先阅读根目录 `AGENTS.md`，再检查 `dashboard/src/pages/Home/index.tsx`、
  `home-workbench.css`、`workbench-model.ts` 和 `home-workbench.test.tsx`。
- UI 信息架构：左侧导航/会话、中间主 Agent 对话、右侧 Team 可用性及内置平台入口。
- 星球乐园是**已经开发好的独立工作台**，不是 Agent；LYRA 只展示真实页面容器，不能伪造星球乐园的功能。
- 改动只提交到 `dev`，不推新 feature 分支，保留 Draft PR #1。

## 建议的 Codex Cloud 环境

1. 在 Codex Cloud 里连接此 GitHub 仓库，选择 `dev`，创建/发布独立环境。
2. 环境安装 Python 3.12+、Node 22、uv；在仓库根执行 `make install`，再执行 `cd dashboard && npm ci`。
3. 使用两个终端启动：
   - 后端：`make dev-backend`（依赖实际配置和授权，缺失时报告阻塞，不伪造 API）
   - 前端：`make dev-frontend`（Vite 默认绑定 `0.0.0.0:5173`）
4. 暴露 Cloud 环境的 HTTP 5173 端口，使用 Codex 云端浏览器访问；如需后端，确保 Vite 的 `/api` 代理连接到本环境 8088。
5. 不在公开日志、截图、源码或测试构建里泄露 JWT、Key 或私人任务数据。实际星球乐园 URL 和身份认证信息如果缺失，应明确报告“无法联调”。

## 验收顺序（必须截真实页面图）

1. 先执行 `cd dashboard && npm run build && npm run test -- src/pages/Home`；记录通过数和日志。
2. 打开 Vite 真实页面，检查 1536×1024、1280×800、390×844 三种视口；保存三张截图。
3. 在有真实后端的情况下完成登录：检查左侧会话切换、新建聊天、主 Agent Team 下拉、首次发送、流式回复及停止；**不得把静态演示数据说成真实 Agent 调度**。
4. 检查工作台仅投影用户与主 Agent 聊天，工具轨迹、成员消息不混入主聊天。HITL 授权必须通过高级对话处理。
5. 切换“内置平台 / 星球乐园”：容器应最大化、返回时恢复 LYRA 会话；检查 iframe 与新窗口打开。**不得在 LYRA 自行重写星球乐园的首页**。
6. 真实星球乐园服务未提供时，明确标注“平台服务不可达/无法验收”，只能证明最大化容器行为；HTTP/HTTPS、登录与 frame-ancestors 约束需真实平台再测。
7. 控制台检查：无 React 报错、无横向滚动、无不应有的 401/403、无 token 泄漏。后端不可用时不将正常的连接失败误判为通过。
8. 记录发现的问题，先最小化修复，再重新运行构建、单测和页面测试。完成后给出 **PASS/FAIL/BLOCKED** 表及截图路径、对应提交 SHA。

## 验收限制

Codex 云端环境是隔离工作区，无法自动访问用户 NAS、真实 LYRA API、星球乐园后端或本机登录状态。需要联调时，通过合适的 Cloud 环境网络/密钥设置配置访问；不要要求用户直接把长期密钥贴进对话。

## 汇报格式

- Dev SHA：
- 构建和单测：
- 3 个视口截图：
- 主 Agent 真实聊天与 Team 分发：PASS / FAIL / BLOCKED
- 星球乐园真实平台：PASS / FAIL / BLOCKED
- 修复清单和剩余风险：
- `main` 未合并的确认：
