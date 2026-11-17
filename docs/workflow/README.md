# 页面开发工作流（pageflow）

一条从「要开发一个页面」到「合并进 `develop` 并删掉分支」的固定流水线。核心约定只有一句：
**文档是唯一事实来源，页面和测试都由文档派生。**

```
start ──► log ──► log ──► … ──► gen-tests ──► verify ──► finish
  │        │                            │          │        │
 建分支   追加进度                    生成测试   跑对抗+唯一  合并+删分支
 +文档     (每个模块一次)                        性并写报告
```

引擎是单文件脚本 [`scripts/pageflow.py`](../scripts/pageflow.py)，只用标准库；`git` / `uv` / `pytest` 通过子进程调用。

## 1. 产物布局

| 路径 | 作用 |
| --- | --- |
| `docs/pages/<slug>/PROGRESS.md` | 开发文档：目标、模块清单、变更日志、决策、测试计划 |
| `docs/pages/<slug>/VERIFY.md` | `pageflow verify` 写出的校验报告（PASS/FAIL + 明细） |
| `docs/workflow/board/<slug>.html` | 由文档渲染的看板页面（示例：[workflow-board](board/index.html)） |
| `tests/unit/workflow/test_pf_<slug>_contract.py` | 合同测试：文档 ↔ 页面 ↔ 产出文件一致 |
| `tests/unit/workflow/test_pf_<slug>_adversarial.py` | 对抗性测试：注入与畸形输入 |
| `tests/unit/workflow/test_pf_<slug>_uniqueness.py` | 唯一性测试：标识不重复 |

`<slug>` 用 kebab-case，必须与目录名、`meta.slug` 三者一致（唯一性测试会断言）。

## 2. 文档契约

`PROGRESS.md` 有五段结构和一段机器可读元信息，解析器按标题关键字定位，不依赖顺序。

```markdown
# <标题> — 开发文档

<!-- pageflow:meta
slug: workflow-board          # kebab-case，等于目录名
title: 页面开发工作流看板
branch: feature/page-workflow-board
base: develop                 # finish 合并回哪里
target: docs/workflow/board/index.html   # 页面产物路径
created: 2026-11-14T10:36:00+08:00
-->

## 1. 目标            验收口径，3~4 条可执行的判定
## 2. 模块清单         | ID | 模块 | 状态 | 产出 | 校验 |
## 3. 变更日志         <!-- pageflow:log --> 之后由 log 命令追加
## 4. 决策记录         | 时间 | 决策 | 原因 |
## 5. 测试计划         | TID | 类型 | 描述 | 断言 |
```

约束：

- 模块状态只允许 `todo` / `wip` / `done` / `blocked`，其它值一律归一成 `todo`（不静默通过）。
- 模块 ID 必须唯一且按序号递增（`M1`、`M2`…）；重复 ID 会让 `validate_doc` 直接报错。
- 一个产出文件只能挂在一个模块名下——同一条路径出现在两个模块会触发唯一性失败。
- 变更日志条目格式固定：`### <ISO 时间> · <模块 ID> · <标题>`，后跟 `- 状态/摘要/文件/校验` 四行。

## 3. 命令手册

```bash
# 1) 开一条工作流：建分支 + 生成文档骨架（会提交一次 docs 提交）
uv run python scripts/pageflow.py start --slug workflow-board --title "页面开发工作流看板" \
    --target docs/workflow/board/workflow-board.html

# 2) 每完成一个模块就追加一条进度（可同时把模块状态改成 done）
uv run python scripts/pageflow.py log --slug workflow-board --module M1 \
    --title "文档模型与解析" --status done --artifacts '`scripts/pageflow.py`' \
    --summary "实现 meta/章节/表格/日志四段解析" \
    --files '`scripts/pageflow.py` (43 行)' --verify "pageflow status --slug workflow-board"

# 3) 渲染看板页；--check 只做一致性检查、不写文件
uv run python scripts/pageflow.py render --slug workflow-board

# 4) 全部模块 done 之后，用文档生成三个测试文件
uv run python scripts/pageflow.py gen-tests --slug workflow-board

# 5) 跑生成的测试 + 页面一致性，写 VERIFY.md
uv run python scripts/pageflow.py verify --slug workflow-board

# 6) 闸门全绿后合并并删除分支（--gate 可附加 make all 等命令）
uv run python scripts/pageflow.py finish --slug workflow-board --gate "make all"

# 辅助
uv run python scripts/pageflow.py status --slug workflow-board
uv run python scripts/pageflow.py list
```

`finish` 的前置条件（任一不满足就停，不做半吊子合并）：

1. 模块清单全部 `done`；
2. `VERIFY.md` 存在且首段是 `状态：PASS`；
3. 当前分支与文档登记的 `branch` 一致；
4. `--gate` 里给的命令全部返回 0（例如 `make all`：format + lint + typecheck + test）。

满足后：把合并记录追加进文档 → 提交剩余改动 → `git checkout <base>` → `git merge --no-ff` → `git branch -d`。

## 4. 三道闸门在测什么

| 闸门 | 文件 | 打的是什么 |
| --- | --- | --- |
| 合同 | `_contract.py` | 文档能解析、模块全 done、页面锚点/标题/条目数与文档一致、登记的产出文件真实存在、生成的测试本身是合法 Python |
| 对抗性 | `_adversarial.py` | 恶意文本不会变成标记；畸形文档不会打崩解析器 |
| 唯一性 | `_uniqueness.py` | 同名空间里没有第二个同名东西 |

### 4.1 对抗性矩阵（当前 9 组载荷 + 5 组结构攻击）

| 攻击面 | 载荷 / 手法 | 期望 |
| --- | --- | --- |
| 标签注入 | `<script>alert('xss')</script>` | 转义成 `&lt;script&gt;`，不产生脚本节点 |
| 属性逃逸 | `"><img src=x onerror=alert(1)>` | 引号被转义，无法闭合属性 |
| 容器逃逸 | `</textarea><svg/onload=alert(1)>` | 原始 `<svg` 不出现 |
| 协议注入 | `javascript:alert(document.cookie)` | 只作为文本出现，不进入 `href` |
| 模板/表达式注入 | `{{7*7}}`、`${jndi:ldap://…}` | 原样文本，不做二次渲染 |
| 双向文本覆盖 | `U+202E` RTL override | 按文本渲染，不改写页面方向 |
| 零宽字符 | `U+200B` / `U+200D` | 正常解析，不破坏表格列 |
| 命令注入串 | `` `rm -rf /`; $(id) \| cat `` | 只进 HTML，不进任何子进程 |
| 表格伪装 | `\| 伪装 \| 表格 \| 行 \|` | 解析器有界，模块表仍只有一行 |
| 超长文本 | 20000 字符标题 | 正常渲染，不截断不崩溃 |
| 重复 ID | 两条 `M1` | `validate_doc` 报 `PageflowError` |
| 未知状态 | `pwned` | 归一为 `todo`，不通过 |
| 空模块表 | 删掉表格 | `PageflowError` |
| 换行/编码 | CRLF + BOM | 正常解析 |

### 4.2 唯一性矩阵

| 命名空间 | 断言 |
| --- | --- |
| slug | 跨 `docs/pages/*` 不重复，且等于目录名与 `meta.slug` |
| 模块 ID | 单文档内不重复，且按序号递增 |
| 产出文件 | 一个路径只归属一个模块 |
| 变更日志 | `(时间, 模块)` 组合不重复 |
| 页面锚点 | `id="…"` 无重复，且全部匹配 `^[a-z0-9][a-z0-9-]*$` |
| 测试文件名 | `tests/unit/workflow/test_pf_*.py` 不重名 |

## 5. 页面与文档的一致性怎么判定

**结构一致，而不是字节一致。** `render --check` / `page_problems()` 校验：slug meta、每个模块的
`id="module-<id>"` 锚点、模块标题文本、锚点数量、日志条目数量。样式允许人工微调（改字号、换配色）
而不会误报；但改了模块或日志就必须重新 `render`，否则条目数对不上。

## 6. 失败与回滚

| 情况 | 处理 |
| --- | --- |
| 测试红了 | 改代码或改文档 → `gen-tests` 重新生成 → `verify`；不要手改生成文件 |
| 需求变了 | 改 `PROGRESS.md` 的模块表/测试计划，再 `render`；测试重新生成 |
| 想放弃 | 切回基线分支，`git branch -D feature/page-<slug>`；`docs/pages/<slug>/` 可以留着当决策记录 |
| 中途要换人 | 文档里已经写清进度，接手者从 `status` 和最后一条日志继续 |

## 7. 与仓库既有规则的关系

- 页面/测试仍受 `make all`（format-all + lint + typecheck + test）约束，`finish` 用 `--gate "make all"` 挂上去即可。
- 生成的测试放在 `tests/unit/workflow/`，走 `uv run pytest`，不新增依赖。
- 分支从 `develop` 切出、合回 `develop`，符合 `AGENTS.md` 的分支约定；不推送远端，除非显式要求。

## 8. 一次跑通：从零到合并

下面是完整的可复制命令序列（POSIX shell；PowerShell 把行尾 `\` 换掉、每行单独执行）。

```bash
# 0) 前置钩子，只在克隆后做一次
make install-hooks

# 1) 起分支 + 生成文档骨架（内部执行 git checkout -b feature/page-<slug> <base>）
uv run python scripts/pageflow.py start --slug my-page --title "我的页面" \
  --target docs/pages/my-page/index.html

# 2) 每完成一个模块就追加一条记录（这就是「进度 + 修改内容」的落库动作）
uv run python scripts/pageflow.py log --slug my-page --module M1 --title "页面骨架" \
  --summary "三段式布局 + 状态栏" --files "docs/pages/my-page/index.html" \
  --verify "pageflow render --check" --status done \
  --artifacts "docs/pages/my-page/index.html"

# 3) 渲染页面，并随时验证页面与文档是否一致
uv run python scripts/pageflow.py render --slug my-page
uv run python scripts/pageflow.py render --slug my-page --check

# 4) 全部模块 done 后，用文档生成测试（未完成会直接报错拒绝）
uv run python scripts/pageflow.py gen-tests --slug my-page

# 5) 跑生成的测试，写校验报告 VERIFY.md
uv run python scripts/pageflow.py verify --slug my-page

# 6) 通过后合并回基线并删除分支（--gate 可挂任意闸门，建议 make all）
uv run python scripts/pageflow.py finish --slug my-page --dry-run
uv run python scripts/pageflow.py finish --slug my-page --gate "make all"
```

`finish` 的前置条件全部是硬检查：模块全 `done`、`VERIFY.md` 首段为 `- 状态：PASS`、当前分支等于文档登记的
`branch`。任何一条不满足就中止，不会产生半合并状态。

### 8.1 已有示例的复现

仓库里 `docs/pages/workflow-board/` 是一份已完成的示例（5 模块全 done、6 条日志、3 个测试文件、
看板页 `docs/workflow/board/index.html`）。复现校验：

```bash
uv run python scripts/pageflow.py status --slug workflow-board
uv run python scripts/pageflow.py render --slug workflow-board --check
uv run pytest tests/unit/workflow -q
```

对同 slug 重跑 `start` 会被拒绝（目录已存在），确认要覆盖才加 `--force`。
