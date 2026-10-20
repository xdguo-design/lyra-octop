# 入院登记 · 原型与接口演示

2026-10-19 / v1.0 / 技术基线：**Vue 2 + Element UI**。

本目录交付 Vue 2 + Element UI 入院流程演示。身份、申请单、地区和提交为演示数据，不接真实医院。当前办理会话、结构化事实和双向轮次链由 Octop SQLite/PostgreSQL 保存，最长24小时；每次成功重新认证会清除当前用户该演示患者的旧办理会话并开始新会话。登录态和AI/ASR/TTS由 Octop 提供。页面实现以 [03 页面原型](docs/03-prototype.md) 为准。

## 文档入口

| 文件                                               | 内容                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| [01 截图分解与取舍](docs/01-reference-analysis.md) | 原始画布分区、冲突、用户确认、方案比较和失败模式                                 |
| [02 产品需求 PRD](docs/02-prd.md)                  | 目标、范围、5个页面、14个字段、10项需求与业务规则                                |
| [03 页面文档原型](docs/03-prototype.md)            | 逐页线框、布局、字段、控件、按钮、状态与异常交互                                 |
| [04 标准开发文档](docs/04-development.md)          | Vue2/ElementUI组件职责、状态机、mock合同、平台接口、AI映射、语音、安全及实施顺序 |
| [05 验收与对齐矩阵](docs/05-acceptance.md)         | 需求→页面→字段→开发章节→验收步骤，对抗性测试计划                                 |
| [06 文档审查记录](docs/06-verification.md)         | 文档一致性、源码接口核对、交付边界与未验证项                                     |
| [07 接口交接清单](docs/07-handoff-api.md)          | mock 与平台语音/AI接口、参数、响应、状态码和联调命令                             |
| [13 AI 对话改造方案](docs/13-ai-dialogue-refactor-and-test-plan.md) | 对话边界、改造路径与测试矩阵 |
| [14 AI 对话测试报告](docs/14-ai-dialogue-test-report.md) | 本轮改动、自动检查、浏览器实测结果与已知限制 |
| [15 浏览器端自动化测试报告](docs/15-browser-e2e-test-report.md) | 23 条浏览器 E2E 用例、复跑命令与未覆盖项 |
| [16 AI 能力测试报告](docs/16-ai-e2e-test-report.md) | 30 条 AI 用例（意图/抽取/确认/对话）、3 处模型偏差、1 处追问语瑕疵已修 |
| [共享字段合同](contracts/admission-fields.schema.json) | 前后端共同读取的14字段 JSON Schema                               |
| [前端](frontend/)                                  | Vue 2.7 + Element UI 2 原型页面与平台语音客户端                                    |
| [后端](backend/)                                   | Python 3.12 FastAPI，字段验证、身份/地区/登记 mock、平台 AI 安全代理               |
| [原始参考图](reference/source.png)                 | 用户提供的流程画布，保留原始分辨率                                               |

## 当前流程基线

- 流程为首页 → 身份核验 → 本人入院申请单（含科室、计划入院时间）→ 两页表单 → 独立核对 → 结果。没有有效申请单不能办理。
- 首页、申请单、表单、对话面板和独立核对分别呈现；底部语音栏按新参考图显示。录音时只用麦克风真实音量产生波形，并区分静音和有声。
- 表单对话使用当前 Octop 活动模型 Qwen。会话存储格式化事实、申请单摘要、最近交互和双链轮次，受6000 token上下文预算约束；已确认值冲突要先经用户点击或明确语音确认。
- AI、身份核验、地区和提交都由演示/平台接口提供；不能据此声称真实医院完成登记。录音不持久化。

## 阅读与评审

建议按01→02→03→04→05→07阅读。用P01–P05定位页面，用F01–F14定位字段，用R01–R10定位需求。PRD负责“做什么”，文档原型负责“页面如何表现”，开发文档负责“按什么边界与合同实现”，接口交接清单列出路径、参数、响应与错误处理。

## 本地启动

需要 Python 3.12、Node.js 20+、npm，以及本机已启动并登录的 Octop 平台（默认 `http://127.0.0.1:8200`）。当前前端 Vite 将 `/api/admission-registration`、`/api/admission-demo` 和 `/api/voice` 代理到 Octop。旧版独立 FastAPI mock 可单独运行做兼容合同测试，不是新流程的会话后端。

```powershell
cd demos/admission-registration/frontend
npm ci
npm run dev
```

在浏览器里打开 Vite 地址可检查页面外观；由于 `5173` 与 `8200` 是不同 origin，它不能访问 Octop 的登录 token，业务 API 会返回未登录。完整浏览器联调请将生产构建挂载到 Octop 同源 `/admission-registration/` 并在平台登录后打开。生产中 `/api/admission-registration/*` 必须进入 Octop，而不是独立 demo backend。前端依赖固定在 `package-lock.json`；旧版 Python mock 依赖见 `backend/pyproject.toml`。

## 检查

```powershell
cd demos/admission-registration/backend
python -m pytest
cd ..\frontend
npm test
npm run typecheck
npm run format:check
npm run build
cd ..\backend
python -m ruff check src tests
python -m ruff format --check src tests
```

浏览器端 E2E（需 Octop 已在 `127.0.0.1:8200` 运行，用例见 [15 报告](docs/15-browser-e2e-test-report.md)）：

```powershell
.venv\Scripts\python.exe demos\admission-registration\e2e\browser_e2e.py
```

AI 能力测试（真实活动模型，耗时约 2 分钟，用例见 [16 报告](docs/16-ai-e2e-test-report.md)）：

```powershell
.venv\Scripts\python.exe demos\admission-registration\e2e\ai_e2e.py
.venv\Scripts\python.exe demos\admission-registration\e2e\ai_e2e.py --skip-ui
```

Vue2已结束社区维护，按既有原型基线保留；区域字典和医院业务均为有限演示数据。身份核验临时 token 仍为进程内状态；成功重新核验会撤销该患者旧 token 并清除其旧办理会话。AI能力需要 Octop 登录 token；独立前端开发服务器不提供登录替代方案。
