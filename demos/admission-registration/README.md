# 入院登记 · 原型与接口演示

2026-10-19 / v1.0 / 技术基线：**Vue 2 + Element UI**。

本目录交付 Vue 2 + Element UI 入院流程演示。身份、申请单、地区和提交为演示数据，不接真实医院。办理会话、结构化事实和轮次由 Octop SQLite/PostgreSQL 保存，最多20轮；独立 Demo FastAPI 后端负责 AI 会话上下文、地址拆分、字段校验和轮次门禁。Octop 只提供 Admission Agent、Skill、模型以及登录态和语音服务。页面实现以 [03 页面原型](docs/03-prototype.md) 为准。

入院登记 Agent 固定关闭深度推理，单次最多迭代 3 次、输入 6000 tokens、输出 512 tokens，temperature 为 0.2；Agent 初始化时会把这些参数同步到已有的专用 Agent。Agent 迭代限制单次模型调用；患者整段登记流程最多20轮仍由 Demo 后端会话计数限制。

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
| [后端](backend/)                                   | Python 3.12 FastAPI，字段验证、身份/地区/登记 mock、AI 会话编排与模型安全代理      |
| [原始参考图](reference/source.png)                 | 用户提供的流程画布，保留原始分辨率                                               |

## 当前流程基线

**项目核心约束（2026-10-21）：整个入院登记只有一个长页面。身份核验、申请单、登记信息、核对和结果按流程向下追加，前序步骤保留为脱敏只读记录；AI 提问、患者回答、字段确认和结果也按发生顺序连续追加。业务阶段状态用于权限和校验，不代表独立页面。只有完成、明确退出、超时清理或重新核验身份时才清理当前流程记录。此约束覆盖下述旧文档中的“切页/独立页”表述。**

自动语音播报由独立喇叭开关控制，默认关闭。开启后新 AI 回复与追问依次播放；关闭会停止当前播放并清空待播内容。每条 AI 回复旁的喇叭只播放该条，不改变自动播报开关。回看历史不会自动重播。

底栏参考自助机原型，采用返回、首页圆按钮和患者信息胶囊；姓名、手机号来自当前办理资料并脱敏，未核验时显示“未核验身份”。“退出登录”沿用本 Demo 的退出办理确认，不注销外层 Octop 账号。语音保留按住说话、松开发送、上滑取消；实际开始录音后显示蓝色扩散光圈及真实音量波形，取消区显示红色。对比、验证和限制见 [17 原型样式对齐](docs/17-reference-style-alignment.md)。

手动修改与语音回填展示参考自助机主流程图：表单按现有两组字段使用浅蓝标题、白色字段区，核对及语音摘要使用左标签右内容的表格行。职业六个标准选项按两行排列；核对页保留原编辑、保存和最终提交逻辑，不按参考图新增“确认填入”操作。

- 流程为首页 → 身份核验 → 本人入院申请单（含科室、计划入院时间）→ 两页表单 → 独立核对 → 结果。没有有效申请单不能办理。
- 手动页参考浅蓝自助机界面，保留两组完整14字段；AI 页使用页面内的机器人、左右聊天气泡和底部语音/文字输入，切换手动填写时保留已录入资料和对话。
- 页面宽度适配视口（桌面最大620px），高度随内容自然增长，不固定宽高比或限制一屏高度。表单、聊天记录和核对摘要均在整页中连续展开，通过浏览器整页滚动查看；语音/输入栏滚动时贴底，新增回复滚动到最新内容。
- 进入患者信息填写时，先按字段配置说明档案带入、必填和选填信息。AI 对话跨两组表单连续收集资料，只追问缺失必填项，选填可补充或明确跳过，统一进入核对页；手动填写仍按两页推进。录音时只用麦克风真实音量产生波形，并区分静音和有声。
- 患者回答不完整时，在当前对话末尾显示补充卡片：按字段配置列出未填项、显示必填资料进度，并对当前缺失字段追问。婚姻、职业和关系使用已有标准选项；选填资料仍可跳过。补充后实时移除已填项并更新问题，首轮完整说明、待确认冲突和最终核对保持原流程。
- 表单首次一次性询问患者可填写信息；后续按未填写的必填项继续追问，每次可回答多项。AI 上下文按结构化资料、压缩历史、最近5轮、本轮回答的顺序构造；独立 Demo 后端按办理会话记录轮次，第20轮后拒绝新的对话操作，患者仍可直接修改表单并核对。已确认值冲突要先经用户点击或明确语音确认。
- AI、身份核验、地区和提交都由演示/平台接口提供；不能据此声称真实医院完成登记。录音不持久化。

## 阅读与评审

建议按01→02→03→04→05→07阅读。用P01–P05定位页面，用F01–F14定位字段，用R01–R10定位需求。PRD负责“做什么”，文档原型负责“页面如何表现”，开发文档负责“按什么边界与合同实现”，接口交接清单列出路径、参数、响应与错误处理。

## 本地启动

需要 Python 3.12、Node.js 20+、npm，以及本机已启动并登录的 Octop 平台（默认 `http://127.0.0.1:8200`）。独立 FastAPI AI 服务默认监听 `127.0.0.1:8765`；Vite 将 `/admission-registration-api` 转发到该服务，将 `/api/admission-registration`、`/api/admission-demo` 和 `/api/voice` 转发到 Octop。Octop API 仅用于读取已认证会话和调用 Agent/Skill/模型。

```powershell
cd demos/admission-registration/backend
python -m pip install -e ".[dev]"
python -m uvicorn admission_registration.main:app --host 127.0.0.1 --port 8765

cd demos/admission-registration/frontend
npm ci
npm run dev
```

完整联调需要从已登录的 Octop 页面打开原型，以便前端读取 Octop 登录 token。Octop 内嵌 `/creations` 页面已提供同源转发：`/admission-registration-api/v1/ai/candidates` 和 `/admission-registration-api/v1/sessions/{id}/turns` 转发到独立 FastAPI 服务的 `/api/admission-registration/v1/` 对应接口，其余 `/api/*` 仍由 Octop 提供。仅启动 Octop 不会自动启动独立 Demo 后端。

Octop 和 Vite 的代理目标默认都是 `http://127.0.0.1:8765`；部署到不同主机或容器时，在启动 Octop 的进程环境中设置 `ADMISSION_API_ORIGIN` 为独立服务的可信内部地址，并重启 Octop。Vite 使用同名环境变量；`OCTOP_API_BASE_URL` 指定 Demo 后端访问的 Octop 地址。代理保留登录鉴权、后端错误状态和续期 token，不跟随重定向；请求体上限64 KiB，连接超时3秒，响应超时40秒。前端依赖固定在 `package-lock.json`。

修复内嵌入口后可在仓库根目录验证（后端无需运行，测试使用模拟传输）：

```powershell
uv run --no-sync pytest tests/integration/test_admission_demo_proxy.py -q
```

若仍显示“本轮对话未能保存”，检查独立服务是否监听8765。代理连接失败返回502、响应超时返回504；若返回405，说明运行中的 Octop 尚未加载同源转发修复，需重启。重启后重新模拟刷卡以获取有效身份核验 token。

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
