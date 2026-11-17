# 校验报告 — inpatient-registration

- 状态：待执行
- 时间：2026-11-14T11:07:00+08:00
- slug: inpatient-registration
- 模块：8（完成 8）
- 变更日志条目：8

## 为什么是「待执行」

本会话的 bash 执行器不可用，任何命令都返回同一条错误：

```
EXECUTOR_UNAVAILABLE: Niubash preparation failed: UNKNOWN: unknown error,
link 'D:\DSHData\home\profiles\desktop\node_modules\dsh-ops\runtime\win32-x64\niubash\winuxcmd\usr\bin\awk.exe'
-> 'd:\dsh-ops-exec\dsh-ops-niu-exec-XXXXXX\winuxcmd\usr\bin\awk.exe'
[EXECUTOR_UNAVAILABLE; effects: none; retry: never]
```

因此 `python scripts/pageflow.py render/gen-tests/verify`、`uv run pytest`、`git` 在本会话全部无法执行。
本报告只记录**不依赖执行器**的结构核对结果；没有跑过的测试一律不写 PASS —— 没有证据的 PASS 比 FAIL 更危险。

## 手工结构核对（已完成的，有据可查）

| 检查项 | 依据 | 结果 |
| --- | --- | --- |
| 文档 8 个模块行 | `PROGRESS.md` 中 `^\| M[0-9] \|` 命中 8 行 | 通过 |
| 文档 8 条日志头 | `^### <ISO> · M<n> · <标题>` 命中 8 行 | 通过 |
| 每条日志四要素齐全 | 8 条均含 `- 状态 / - 摘要 / - 文件 / - 校验` | 通过 |
| 看板锚点数量 | `id="module-m1..m8"` 与 `id="log-1..8"` 合计 16 个 | 通过 |
| 看板 slug meta | `<meta name="pageflow-slug" content="inpatient-registration" />` | 通过 |
| 模块名与看板标题一致 | 8 个模块名逐个出现在看板卡 `<h3>` 中 | 通过 |
| 模块状态全 done | 模块表 8 行状态列均为 `done` | 通过 |
| 产出路径互不重复 | 8 个模块各占 1 个独有文件路径 | 通过 |
| 测试文件存在 | 4 个 `test_pf_inpatient_registration_*.py` 已落盘 | 通过 |
| 页面自包含 | `index.html` 无 `<link` / `<script src` / `@import` / `url(` / `http` | 通过 |
| 测试文件名唯一 | `tests/unit/workflow` 下 `test_pf_*` 无重名 | 通过 |

## 未执行（必须由宿主侧补齐）

| 检查项 | 命令 | 说明 |
| --- | --- | --- |
| 看板与文档一致 | `python scripts/pageflow.py render --slug inpatient-registration --check` | 首次可能报差异：看板因执行器不可用是**按模板手写**的，结构一致但字节未必一致 |
| 规范化看板 | `python scripts/pageflow.py render --slug inpatient-registration` | 直接覆盖为引擎产物，再跑一次 `--check` 应为零差异 |
| 生成测试比对 | `python scripts/pageflow.py gen-tests --slug inpatient-registration` | 本仓库三个生成测试为模板对齐手写；若引擎产物有差异，以引擎产物为准 |
| 单元测试 | `uv run pytest tests/unit/workflow -x -q` | 合同 / 对抗性 / 唯一性 / 页面四个文件 |
| 正式校验 | `python scripts/pageflow.py verify --slug inpatient-registration` | 通过后本文件会被覆写为 `- 状态：PASS` |

## 分支与合并（未执行）

```bash
git checkout develop
git checkout -b feature/page-inpatient-registration
git add docs/pages/inpatient-registration docs/workflow/board/inpatient-registration.html \
        tests/unit/workflow/test_pf_inpatient_registration_*.py
git commit -m "feat(pageflow): 住院登记页面"
# 校验通过后：
python scripts/pageflow.py verify --slug inpatient-registration
python scripts/pageflow.py finish --slug inpatient-registration
```

`finish` 有三道前置：8 个模块全 `done`、本文件含 `状态：PASS`、当前分支等于 meta 里的
`feature/page-inpatient-registration`。前两项现在只剩「跑测试」这一步。
