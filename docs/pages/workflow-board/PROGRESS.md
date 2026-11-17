# 页面开发工作流看板 — 开发文档

<!-- pageflow:meta
slug: workflow-board
title: 页面开发工作流看板
branch: feature/page-workflow-board
base: develop
target: docs/workflow/board/index.html
created: 2026-11-14T10:36:00+08:00
-->

## 1. 目标

把「开发一个页面」这件事变成可追溯的流水线：进度写进本文件，页面由本文件渲染，测试由本文件生成，
全部通过后合并分支。看板页 `docs/workflow/board/index.html` 就是这条流水线的可视化产物——
任何人打开它，看到的是某个页面当前完成到哪一步、每一步改了什么、校验跑没跑过。

验收口径：

1. `pageflow status --slug workflow-board` 显示 5/5 模块完成。
2. `pageflow render --slug workflow-board --check` 无差异。
3. `pageflow verify --slug workflow-board` 输出 PASS，并在同目录写 `VERIFY.md`。
4. 三条测试按类型分工：合同（文档↔页面↔文件）、对抗性（注入与畸形输入）、唯一性（标识不重复）。

## 2. 模块清单

| ID | 模块 | 状态 | 产出 | 校验 |
| --- | --- | --- | --- | --- |
| M1 | 文档模型与解析 | done | `scripts/pageflow.py` | `pageflow status --slug workflow-board` |
| M2 | 进度追加协议 | done | `docs/workflow/README.md` | `pageflow log --help` |
| M3 | 看板页面渲染 | done | `docs/workflow/board/index.html` | `pageflow render --slug workflow-board --check` |
| M4 | 测试生成器 | done | `tests/unit/workflow/test_pf_workflow_board_contract.py` | `pageflow gen-tests --slug workflow-board` |
| M5 | 对抗性与唯一性套件 | done | `tests/unit/workflow/test_pf_workflow_board_adversarial.py`<br>`tests/unit/workflow/test_pf_workflow_board_uniqueness.py` | `pageflow verify --slug workflow-board` |

## 3. 变更日志

<!-- pageflow:log -->

### 2026-11-14T10:41:12+08:00 · M1 · 文档模型与解析
- 状态：done
- 摘要：实现 meta/章节/表格/日志四段解析，模块状态机限定为 todo/wip/done/blocked，未知状态归一为 todo。
- 文件：`scripts/pageflow.py` (43 行, sha256:5d1f0c2a)、`docs/pages/workflow-board/PROGRESS.md` (6 行, sha256:9b7a3e10)
- 校验：`pageflow status --slug workflow-board`

### 2026-11-14T10:46:58+08:00 · M2 · 进度追加协议
- 状态：done
- 摘要：每个模块完成即追加一条「时间 · 模块 · 标题 + 状态/摘要/文件/校验」记录，插入点是变更日志块的末尾，保证时间正序；可同时回写模块清单的产出列。
- 文件：`docs/workflow/README.md` (212 行, sha256:1c4e88b7)
- 校验：`pageflow log --help`

### 2026-11-14T10:53:20+08:00 · M3 · 看板页面渲染
- 状态：done
- 摘要：文档渲染成单文件看板页，模块卡片带锚点 `module-<id>`、日志时间线带 `log-<n>`、进度条按完成率计算；所有文档文本统一 HTML 转义。
- 文件：`docs/workflow/board/index.html` (286 行, sha256:7f2b90d4)
- 校验：`pageflow render --slug workflow-board --check`

### 2026-11-14T11:02:05+08:00 · M3 · 修正渲染断言
- 状态：done
- 摘要：把「页面与文档一致」从字节比对改成结构比对（锚点、标题、条目数），允许人工微调样式而不误报。
- 文件：`scripts/pageflow.py` (48 行, sha256:31ad6c5e)
- 校验：`pageflow render --slug workflow-board --check`

### 2026-11-14T11:09:47+08:00 · M4 · 测试生成器
- 状态：done
- 摘要：整体完成后由文档生成合同测试，模块清单逐行变成参数化用例，产出文件存在性与文档登记一致。
- 文件：`tests/unit/workflow/test_pf_workflow_board_contract.py` (96 行, sha256:c0d54a19)
- 校验：`pageflow gen-tests --slug workflow-board`

### 2026-11-14T11:16:33+08:00 · M5 · 对抗性与唯一性套件
- 状态：done
- 摘要：对抗性套件用 9 组恶意载荷 + 5 组结构攻击打解析与渲染（XSS、属性逃逸、javascript:、模板注入、RTL/零宽、超长、命令注入、表格伪装、重复 ID/未知状态/空表/CRLF+BOM）；唯一性套件约束 slug、模块 ID、产出归属、日志条目、页面锚点。
- 文件：`tests/unit/workflow/test_pf_workflow_board_adversarial.py` (118 行, sha256:5e83bb41)、`tests/unit/workflow/test_pf_workflow_board_uniqueness.py` (104 行, sha256:a7c1f0d9)
- 校验：`pageflow verify --slug workflow-board`

## 4. 决策记录

| 时间 | 决策 | 原因 |
| --- | --- | --- |
| 2026-11-14T10:36:00+08:00 | 文档是唯一事实来源 | 页面与测试都由文档派生，改需求先改文档，避免三处漂移 |
| 2026-11-14T10:52:00+08:00 | 页面一致性做结构比对 | 字节比对会被 prettier 式微调和时间戳打断，结构比对只锁语义 |
| 2026-11-14T11:08:00+08:00 | 测试文件生成而不是手写 | 模块清单变化时用例自动跟随，review 只盯文档 |
| 2026-11-14T11:15:00+08:00 | 唯一性单独成套 | 锚点/ID/路径重复不会报错但会静默串味，必须显式断言 |

## 5. 测试计划

| TID | 类型 | 描述 | 断言 |
| --- | --- | --- | --- |
| T1 | contract | 文档结构可解析 | 模块表 5 行、状态全 done、日志 6 条 |
| T2 | contract | 页面反映文档 | 每个模块有唯一锚点、标题被渲染、条目数一致 |
| T3 | contract | 产出文件存在 | 模块清单登记的每个路径在仓库内存在 |
| T4 | adversarial | 注入载荷被转义 | 渲染结果不含 `<script`、`onerror=`、`javascript:` |
| T5 | adversarial | 畸形文档不崩 | 重复 ID 报错、未知状态归一、空表报错、CRLF+BOM 可解析 |
| T6 | uniqueness | 标识全局唯一 | slug、模块 ID、产出归属、日志条目、页面锚点均不重复 |
