# 对话文件审查问题修复计划

> **执行方式：** 当前会话按任务顺序实施；每项先补失败测试，再做最小修改并运行对应验证。不要提交或清理工作区中其他任务的改动。

**目标：** 修复初审确认的 5 项问题，使全量测试可收集、文件读取不静默漏段或误报扫描 PDF 已完成，并让重复读取和创建页响应契约稳定。

**架构要点：** 保持现有 `FileService`、`ChatFileRepo`、上传 API 和测试框架；在解析返回中如实表达 OCR 缺失；同一 revision 的解析结果通过数据库事务只提交一次。无需新增服务或依赖。

**技术栈：** Python 3.12、FastAPI、SQLite/PostgreSQL、React/TypeScript、pytest、Vitest。Windows 使用 `\.venv\Scripts\python.exe -m pytest`；前端使用 `npm run test -- ...` 与 `npx tsc -b`。

**关联设计文档：** `docs/specs/2026-10-17-chatgpt-file-experience-design.md`、`docs/specs/2026-10-17-chatgpt-file-experience-requirements.md`。

---

## 当前进度（2026-10-17）

- [x] 初审及主要问题定位：5 项。
- [x] 定向基线：文件相关后端 `47 passed, 1 skipped`；Chat/Home 前端 `28 passed`；TypeScript 通过。
- [x] 发现完整后端 pytest 收集失败的重复模块名，以及创建页测试响应字段未同步。
- [x] 编码与定向回归修复：5/5；定向后端 `55 passed, 1 skipped`，前端相关用例 `29 passed`，TypeScript 通过。
- [x] 全量非 live 后端回归已完整收集；运行约 4% 后因 Windows 执行耗时超过 10 分钟而中断。缓存候选失败逐项复现后确认 9 个当前失败，见下方最终验证记录。
- [x] ChatGPT / Grok Bot 能力改进路线单独记录在 `docs/specs/plans/2026-10-17-chatgpt-grokbot-improvement-roadmap.md`；它不属于五项缺陷修复的完成条件。

## 修改文件清单

| 路径 | 职责 |
|---|---|
| `tests/unit/files/__init__.py` | 建立 pytest 包边界，避免同名测试模块冲突。 |
| `src/octop/infra/files/parse.py` | 区分可提取文本、纯空白页与含图像但无文本的 PDF 页。 |
| `src/octop/infra/files/service.py` | 返回完整受限解析范围，并对已解析 revision 返回稳定结果。 |
| `src/octop/infra/db/repos/chat_files.py` | 同 revision 的解析结果原子提交一次，保持同一事务内幂等。 |
| `src/octop/api/routers/creations.py` | 不改 API 行为；其新增 `card_meta` 由测试契约覆盖。 |
| `tests/unit/files/test_parse.py` | 增加空白页/扫描页状态回归。 |
| `tests/unit/files/test_service.py` | 增加超过 200 段读取及重复读取/竞争回归。 |
| `tests/unit/files/test_file_identity.py` | 覆盖相同 revision 的重复解析提交。 |
| `tests/integration/test_creations_api.py` | 更新用户隔离断言，包含空的 `card_meta`。 |

前端如新增可见的 `needs_ocr` 状态，才修改 `dashboard/src/pages/Chat/hooks/sseHelpers.ts`、`dashboard/src/pages/Chat/components/MessageFileCard.tsx` 和 en/zh locale；该改动必须有对应组件/i18n 测试。

## 任务 1：修复测试收集冲突

**涉及文件：** 新建 `tests/unit/files/__init__.py`。

- [x] 新建空包标记，让 `tests.unit.files.test_parse` / `test_service` 成为限定模块名。
- [x] pytest 全量执行已越过收集阶段，未再出现 `import file mismatch`。
- [x] 完整测试进程仍在执行；现有非收集失败会待最终 traceback 归因。

## 任务 2：确保完整文件解析段可取回

**涉及文件：** `src/octop/infra/files/service.py`、`src/octop/infra/db/repos/chat_files.py`、`tests/unit/files/test_service.py`。

- [x] 先新增一个超过 200 行的 UTF-8 文本文件用例，断言首次和第二次读取都返回 250 段，末段定位为第 250 行，且覆盖仍为完整。
- [x] 运行目标测试，确认旧实现失败于返回段数。
- [x] 让文件读取使用与 parser 相同的硬上限取回所有已解析段（当前 parser 上限 2,000），复用已有 `limit` 参数，不新增分页 API。
- [x] 重跑该测试及 `tests/unit/files`，确认两次返回段数、顺序、locator 一致；纳入 `55 passed, 1 skipped` 定向回归。

## 任务 3：扫描 PDF 不得冒充完整读取

**涉及文件：** `src/octop/infra/files/parse.py`、`src/octop/infra/files/service.py`、`tests/unit/files/test_parse.py`、必要时 Chat 附件状态和 locale。

- [x] 新增测试：空白 PDF 页仍是已处理空页；扫描页标记待 OCR；文本页保留原定位。
- [x] 运行解析器目标测试，确认旧实现把扫描页错误显示为 complete。
- [x] 解析器显式返回 OCR 缺失范围；服务端持久化非完整状态；UI 显示中英文提示。
- [x] 文件单测纳入 `55 passed, 1 skipped` 定向回归；对应 Vitest 通过且 `npx tsc -b` 通过。

## 任务 4：同一 revision 并发解析只提交一次

**涉及文件：** `src/octop/infra/db/repos/chat_files.py`、`src/octop/infra/files/service.py`、`tests/unit/files/test_file_identity.py`、`tests/unit/files/test_service.py`。

- [x] 增加 repo 测试：重复提交相同 revision 不增加段数或改变原结果。
- [x] 增加 service 并发测试：两个请求读取未解析 revision，数据库只保存一份，两个调用返回相同结果。
- [x] 运行对应测试并确认先失败。
- [x] 在事务内对 `parse_version IS NULL` 做条件提交；失败者读取已经提交的结果。
- [x] 定向文件与 DB 回归通过，验证段数与 ordinal 幂等。

## 任务 5：同步创建页响应测试契约

**涉及文件：** `tests/integration/test_creations_api.py`。

- [x] 将另一用户空列表期望更新为包含 `"card_meta": {}`；保留其他空值断言。
- [x] 运行 `tests/integration/test_creations_api.py`。
- [x] 集成测试组通过，其他用户仍看不到创建者数据。

## 最终验证与完成标准

- [x] `\.venv\Scripts\python.exe -m pytest -m "not live" -q`：全量测试成功收集；完整运行超过 10 分钟仍仅到 4%，中断后对缓存候选逐项复现，结果 `9 failed, 12 passed, 49 skipped`。失败均在本轮改动文件之外：4 个旧迁移 SQL 测试在 Windows 使用系统默认 GBK 读取 UTF-8 SQL 失败；3 个 DB 测试仍断言 schema `21` 而当前迁移版本为 `24`；captcha 集成测试未包含当前提供方列表中的 `image`；i18n stream 测试仍断言旧的“存储根目录”文案，但当前已改为附件/工作区恢复指引。不能据此宣称全量测试通过。
- [x] 前端 MessageFileCard Vitest 和相关 Chat/Home Vitest 通过（29 tests）；`npx tsc -b` 通过。
- [x] `git diff --check` 通过；工作区包含其他任务的未提交改动，未对其格式化或清理。
- [x] 更新本计划与 `memory.md` 的实际结果；不提交、不推送、不部署。

## 不在本修复批次内

- OCR 引擎安装、后台持久任务/重启恢复、分段搜索及引用跳转、在线编辑/版本冲突、Office 生成/导出。
- ChatGPT 与 Grok Bot 的完整产品能力矩阵、语音/联网研究/跨 Agent 协作的浏览器验收。
- PostgreSQL、Linux 和真实模型端到端测试。
