# 住院登记页面 — 开发文档

<!-- pageflow:meta
slug: inpatient-registration
title: 住院登记页面
branch: feature/page-inpatient-registration
base: develop
target: docs/workflow/board/inpatient-registration.html
created: 2026-11-14T10:39:25+08:00
-->

## 1. 目标

住院处窗口人员把「门诊已开单、患者已确认」的住院申请办成一条住院记录。本页面就是这段流程的操作台：

1. 左栏是门诊住院申请队列，可按姓名 / 申请号 / 患者标识检索，按科室、状态过滤；患者已确认的单才可办理。
2. 右栏三步走：确认申请单与本次收治（科室 / 病区 / 工作组 / 床位 / 入院时间）→ 核对患者信息并更正联系人、户籍住址 → 提交前核对并生成住院号。
3. 提交后申请单转「已办理」，住院记录写入登记队列（状态「待入科」），全程留痕。
4. 异常态必须显式拦住：患者未确认、申请单已取消、已办理重复登记，三种情况主按钮一律不可点，且给出具体原因。

验收口径：`docs/pages/inpatient-registration/index.html` 单文件可双击打开，无外链、无构建步骤；
`docs/workflow/board/inpatient-registration.html` 由本文件渲染，结构与本文件一致。

## 2. 模块清单

| ID | 模块 | 状态 | 产出 | 校验 |
| --- | --- | --- | --- | --- |
| M1 | 需求与数据基线 | done | `docs/pages/inpatient-registration/SPEC.md` | 4 张申请单 + 5 条登记记录与原型 spec 逐条对齐 |
| M2 | 页面主体与交互 | done | `docs/pages/inpatient-registration/index.html` | `pytest tests/unit/workflow/test_pf_inpatient_registration_page.py` |
| M3 | 看板页渲染 | done | `docs/workflow/board/inpatient-registration.html` | `python scripts/pageflow.py render --slug inpatient-registration --check` |
| M4 | 合同测试 | done | `tests/unit/workflow/test_pf_inpatient_registration_contract.py` | `pytest tests/unit/workflow/test_pf_inpatient_registration_contract.py -x -q` |
| M5 | 对抗性测试 | done | `tests/unit/workflow/test_pf_inpatient_registration_adversarial.py` | `pytest tests/unit/workflow/test_pf_inpatient_registration_adversarial.py -x -q` |
| M6 | 唯一性测试 | done | `tests/unit/workflow/test_pf_inpatient_registration_uniqueness.py` | `pytest tests/unit/workflow/test_pf_inpatient_registration_uniqueness.py -x -q` |
| M7 | 页面行为测试 | done | `tests/unit/workflow/test_pf_inpatient_registration_page.py` | `pytest tests/unit/workflow/test_pf_inpatient_registration_page.py -x -q` |
| M8 | 校验报告与验收准备 | done | `docs/pages/inpatient-registration/VERIFY.md` | `python scripts/pageflow.py verify --slug inpatient-registration` |

## 3. 变更日志

<!-- pageflow:log -->

### 2026-11-14T10:44:00+08:00 · M1 · 需求与数据基线
- 状态：done
- 摘要：把原型 spec、方向 B 决策、v2 结构与用户追加的三条要求固化成页面规格：4 张门诊申请单（含 1 张待患者确认的异常样本）、5 条登记记录、科室/病区/工作组/床位/入院类型字典、confirmed→registered 状态机与三类锁定态。
- 文件：`docs/pages/inpatient-registration/SPEC.md` (73 行)
- 校验：4 张申请单 + 5 条登记记录与原型 spec 逐条对齐

### 2026-11-14T10:49:00+08:00 · M2 · 页面主体与交互
- 状态：done
- 摘要：单文件实现临床密集工作台：顶栏班次与窗口、页头待办理/待患者确认计数、主 tab（门诊住院申请 | 登记队列）、左栏三过滤 + 申请卡、右栏三步表单、底条核对勾选与主按钮；提交走二次确认弹窗生成住院号 ZY20261112003 并切到登记队列高亮新行。
- 文件：`docs/pages/inpatient-registration/index.html` (1420 行)
- 校验：`pytest tests/unit/workflow/test_pf_inpatient_registration_page.py`

### 2026-11-14T10:52:00+08:00 · M3 · 看板页渲染
- 状态：done
- 摘要：按 pageflow 渲染契约手写看板页（脚本执行器在本会话不可用）：8 个模块卡带 `module-<id>` 锚点、8 条日志时间线 `log-<n>`、进度条 100%、测试计划表与本文档逐行一致，样式沿用 pageflow 模板。
- 文件：`docs/workflow/board/inpatient-registration.html` (245 行)
- 校验：`python scripts/pageflow.py render --slug inpatient-registration --check`

### 2026-11-14T10:55:00+08:00 · M4 · 合同测试
- 状态：done
- 摘要：合同测试锁本文档与页面、测试文件三者一致：模块清单逐行比对、状态全 done、`page_problems` 为空、渲染页含每个模块锚点、每条日志摘要与校验非空、生成文件可被 ast 解析。
- 文件：`tests/unit/workflow/test_pf_inpatient_registration_contract.py` (88 行)
- 校验：`pytest tests/unit/workflow/test_pf_inpatient_registration_contract.py -x -q`

### 2026-11-14T10:58:00+08:00 · M5 · 对抗性测试
- 状态：done
- 摘要：9 组恶意载荷（XSS、属性逃逸、javascript:、SSTI/JNDI、RTL 覆写、零宽字符、命令注入、表格伪装）打解析与渲染，另加 5 组结构攻击（重复模块 ID、未知状态归一、空模块表、CRLF+BOM、两万字符标题）与 `sanitize_id` 契约。
- 文件：`tests/unit/workflow/test_pf_inpatient_registration_adversarial.py` (139 行)
- 校验：`pytest tests/unit/workflow/test_pf_inpatient_registration_adversarial.py -x -q`

### 2026-11-14T11:01:00+08:00 · M6 · 唯一性测试
- 状态：done
- 摘要：跨 `docs/pages/*/PROGRESS.md` 断言 slug 唯一且等于目录名、模块 ID 唯一并按数字升序、同一产出文件不属两个模块、日志 (stamp, mid) 不重复、页面锚点唯一且为安全 token、生成测试文件名不重名。
- 文件：`tests/unit/workflow/test_pf_inpatient_registration_uniqueness.py` (94 行)
- 校验：`pytest tests/unit/workflow/test_pf_inpatient_registration_uniqueness.py -x -q`

### 2026-11-14T11:04:00+08:00 · M7 · 页面行为测试
- 状态：done
- 摘要：对业务页做静态契约断言：无外链与构建依赖、无 emoji、无紫色渐变、无「圆角卡 + 左侧彩色竖条」、正文不小于 14px、申请队列 4 行与登记队列 5 行齐全、三类锁定态文案与主按钮 disabled、提交后住院号生成规则、二次确认弹窗含联系人回改入口、空态不用插画。
- 文件：`tests/unit/workflow/test_pf_inpatient_registration_page.py` (197 行)
- 校验：`pytest tests/unit/workflow/test_pf_inpatient_registration_page.py -x -q`

### 2026-11-14T11:07:00+08:00 · M8 · 校验报告与验收准备
- 状态：done
- 摘要：写校验报告：记录本会话执行器不可用（`EXECUTOR_UNAVAILABLE: Niubash preparation failed`）导致 pytest / render / verify 无法执行，列出手工核对过的结构项与宿主侧待跑命令，状态如实标注为待执行，不预填 PASS。
- 文件：`docs/pages/inpatient-registration/VERIFY.md` (63 行)
- 校验：`python scripts/pageflow.py verify --slug inpatient-registration`

## 4. 决策记录

| 时间 | 决策 | 原因 |
| --- | --- | --- |
| 2026-11-14T10:39:25+08:00 | 一个 slug 一个看板，业务页另存 | `render` 只把文档写进 `target`；把 target 指向业务页会让结构比对全红，因此 target 是看板，业务页在模块产出里单独登记 |
| 2026-11-14T10:41:00+08:00 | 数据基线不扩行 | 原型 spec 明确给定 4 张申请单 + 5 条登记记录，编造更多行会让 review 无法逐条对齐 |
| 2026-11-14T10:45:00+08:00 | 页面内"今天"固定为 2026-11-12 | 与 spec 的申请时间、登记时间同一时间轴，住院号可预测为 ZY20261112xxx |
| 2026-11-14T10:47:00+08:00 | 患者未确认是锁定态而非可覆盖 | 住院处不能替患者确认，越权确认会污染状态机；锁定 + 红字说明才叫诚实 |
| 2026-11-14T10:50:00+08:00 | 科室 / 病区 / 工作组联动而非自由输入 | 工作组必须挂在科室下，自由输入会产生孤儿组；联动后入院类型仍可改 |
| 2026-11-14T10:56:00+08:00 | 手写渲染产物而不是调用 CLI | 本会话 bash 执行器不可用，`pageflow render` 无法运行；产物按模板逐符对齐，待执行器恢复后 `render --check` 应无差异 |
| 2026-11-14T11:06:00+08:00 | 校验报告不预填 PASS | 没有跑过的测试写 PASS 等于伪造证据；报告写明未执行与待跑命令，让 gate 停在真话上 |

## 5. 测试计划

| TID | 类型 | 描述 | 断言 |
| --- | --- | --- | --- |
| T1 | contract | 文档结构可解析 | 模块表 8 行、状态全 done、日志 8 条 |
| T2 | contract | 页面反映文档 | 8 个模块锚点唯一、模块标题渲染、日志条目数与文档一致 |
| T3 | contract | 生成文件可读 | 三个测试文件存在且能被 ast 解析 |
| T4 | adversarial | 注入载荷被转义 | 渲染结果不含 `<script`、`<img`、`<svg`、`onerror` 等原始标签 |
| T5 | adversarial | 畸形文档不崩 | 重复 ID 报错、未知状态归一 todo、空模块表报错、CRLF+BOM 可解析、两万字符标题不截断 |
| T6 | uniqueness | 标识全局唯一 | slug、模块 ID、产出归属、日志条目、页面锚点均不重复且为安全 token |
| T7 | page | 页面自包含 | 无外链/无构建依赖/无 emoji/无紫色渐变/正文 ≥14px |
| T8 | page | 队列数据齐全 | 4 张申请单与 5 条登记记录逐行出现，异常样本带待确认标记 |
| T9 | page | 提交链路正确 | 勾选核对前主按钮 disabled、三类锁定态文案正确、二次确认弹窗可回改联系人、提交生成 ZY20261112003 |
