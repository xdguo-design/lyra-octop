# P0 三类问题线下验收报告（2026-10-23）

- 验收人：AI 协作会话
- 验收对象：`codex/octop-p0-continuation` 分支修复（沙箱 `lyra-octop-p0-continuation`）
- 实际执行基线：本机 `dev` @ `47e295c`（修复未合入 dev，bug 应在；合入后用同一套用例对照）
- 验收单：`sandbox:/workspace/scratch/520f353b901a/lyra-octop-p0-continuation/docs/testing/dev-p0-manual-acceptance.md`（沙箱路径本机不可达，以用户消息中的验收要点为准）

## 0. 分支拉取结果（ blocker 说明）

`codex/octop-p0-continuation` **不在本仓库远端**（`git ls-remote origin` 只有 `dev`、`main`、`pull/1`），也不在本机其他克隆目录。修复代码仅存在于 codex 沙箱工作区，本机无法直接拉取。因此本次验收在 **dev 基线**上执行：bug 相关用例应当失败（复现证据），非 bug 用例应当通过（防回归证据）。分支可访问后，用同一批用例重跑即可逐条对照。

## 1. 工作台代码浏览权限

| # | 验收点 | 结论 | 证据 |
|---|--------|------|------|
| 1.1 | 普通用户不能因为项目名叫"星球"就访问代码目录 | **dev 上 bug 复现（失败）** | `WorkbenchRepo.create_project` 第 88 行 `int(name == "星球")`：任何用户建"星球"项目即 `code_enabled=1`，`/code`、`/code/file` 返回 200 |
| 1.2 | 普通用户启用代码浏览应被拒绝 | **dev 上无控制面（失败）** | 后端不存在任何启用端点；唯一"启用"路径就是命名（见 1.1）。探测 POST/PUT/PATCH `/code`、`/code-enabled` 均 404/405，等于普通用户可自行开通 |
| 1.3 | 管理员启用后只能读取配置根目录内文件，不能越界 | **通过（防回归）** | 根边界、`..`/绝对路径/盘符拒绝、`.env`/`data` 等拒绝名单、符号链接逃逸拒绝、1MiB 上限、UTF-8 校验均在 `code_browser.py` 落实，新增用例全过 |
| 1.4 | 旧项目导入后默认关闭 | **dev 上 bug 复现（失败）** | `import_legacy_projects` 第 139 行同样 `int(legacy["name"] == "星球")`，导入即开通 |

补充发现（同源风险）：`import_github_project` 走同一个 `create_project`，GitHub 仓库名恰为"星球"时同样会自动开通；`update_project` 改名不触碰 `code_enabled`，已开通项目改掉名字后依然保持开通（状态残留）。

修复方向建议（供分支对照）：去掉两处名称魔法值，`code_enabled` 只能由管理员显式动作置 1；改名不改变开关；导入/GitHub 导入一律默认 0。

## 2. 聊天附件清理

| # | 验收点 | 结论 | 证据 |
|---|--------|------|------|
| 2.1 | 手动移除后附件状态正确 | **通过** | `removeAttachment(index)` 精确移除目标项、其余保留；`uploading` 标志正确（新增用例） |
| 2.2 | 发送后附件状态正确 | **通过** | `submitMessage` → `resetComposerAfterSubmit` → `clearAttachments()`；清空输入区/切换会话同样清空 |
| 2.3 | 切换 Agent 后附件状态正确 | **通过** | `useChatAttachments` 按 `agentId` 清空 `items`；在途上传完成回调有 `agentIdRef` 守卫，旧 Agent 的迟到结果不会落入新 Agent（新增用例覆盖） |
| 2.4 | 已绑定到会话的文件不能被误删 | **通过（现状是无删除面）** | dev 上不存在任何聊天文件删除端点（DELETE `/agents/{aid}/files/{fid}` 返回 405）；`bind_thread` 一次性（`thread_id IS NULL` 条件），绑定后不可改绑、读取强校验 thread |
| 2.5 | 其他用户不能删除你的草稿文件 | **通过（现状是无删除面）** | 跨用户读元数据已 404；删除面不存在。用例以 `in (403,404,405)` + 行存活断言编写，分支新增删除端点后同样成立（跨用户应 403） |

提示（供分支对照）：修复若新增"草稿删除"端点，必须同时满足——仅本人、仅 `thread_id IS NULL` 草稿、绑定文件拒绝删除；本报告的 `test_attachment_deletion_surface_is_owner_draft_only` 已按此断言，分支合入后直接可跑。

## 3. 对话历史分页

| # | 验收点 | 结论 | 证据 |
|---|--------|------|------|
| 3.1 | 后端分页不回退/不乱序/不重复 | **通过** | `thread_messages.page()` 取 `limit+1` 降序后反转，`has_more` 精确；新增 API 级用例走完全部偏移页：无重复 id、无跨页重叠、页内升序、`offset` 回显正确；分享历史端点同套路过 |
| 3.2 | 游标与"加载更多"状态正确 | **通过** | `loadMoreHistory` 带 `nextOffset`+`nextCursor` 请求、`prependHistoryMessages` 按 id 去重、在途守卫拒绝第二次并发加载；投影路径忽略游离 cursor 不破坏偏移分页；limit 上限钳制 200 |
| 3.3 | 加载更早消息时刷新/切换会话不乱 | **通过** | 切换会话后在途旧页只落入旧会话 store，新会话页与游标不被污染（新增用例）；`loadGenRef` 世代守卫丢弃过期初始加载，不覆盖新会话；`refreshHistory` 只替换与最新页重叠的窗口，已翻入的旧页与游标保持不动 |

## 4. 后端全量测试（遥测拦截失败标记归因）

`pytest tests -n 6 -rf`：**19 failed / 4735 passed / 234 skipped**（30 分钟）。归因：

- **3 个已知 Windows 环境项**（CI ubuntu 不受影响）：`onnx` / `browser` / `workbench project_service` 的符号链接权限用例。
- **16 个 `-n 6` 并行抢占假失败**：邮件注册簇 14 个（`test_user_manager`×4、`test_email`×2、`test_registration`×5、`test_auth_register`×3）+ `test_projects_can_nest_under_a_parent_project` + `test_file_read_returns_every_parsed_segment` + `test_process_exit_after_commit_keeps_last_fragment`。**全部隔离复跑通过**（45+3 全绿）。
- 结论：该失败标记**不对应三类 P0 问题中的任何一个**；最可能就是并行跑批制造的注册/用户簇假失败（与 10-21 实测"并发 104 vs 单独 50"同类）。判定回归请用隔离/单文件跑，不要用 `-n auto` 全量。

## 5. 新增测试文件（4 个，全部可复跑）

| 文件 | 覆盖 | dev 基线结果 |
|------|------|-------------|
| `tests/unit/db/test_workbench_code_enabled_policy.py` | 问题 1 repo 层（命名不开通/导入默认关/改名不开通/门控语义） | 2 失败（bug 复现）+ 2 通过 |
| `tests/integration/test_p0_acceptance.py` | 问题 1 API 层 + 问题 2 附件生命周期 + 问题 3 历史/分享分页 | 2 失败（bug 复现）+ 5 通过 |
| `dashboard/src/pages/Chat/hooks/useChatAttachments.cleanup.test.tsx` | 问题 2 前端六态（身份字段/手动移除/清空/恢复/切 Agent 守卫/重试） | 6/6 通过 |
| `dashboard/src/pages/Chat/hooks/useChat.history.paging.test.ts` | 问题 3 前端（翻页游标/切换会话隔离/过期加载丢弃/刷新重叠窗口/并发守卫） | 5/5 通过 |

门禁自检：新后端文件 `ruff 0.15.20 check + format --check` 全过；新前端文件 eslint 无告警；`npm run build`（tsc 全量 + vite）通过，构建产物与仓库一致。

复跑命令：

```bash
# 后端
.venv/Scripts/python.exe -m pytest tests/unit/db/test_workbench_code_enabled_policy.py tests/integration/test_p0_acceptance.py -q
# 前端（useChat 模块图较重，用例已设 25s 超时；勿与后端全量并发跑）
cd dashboard && node_modules/.bin/vitest run src/pages/Chat/hooks/useChatAttachments.cleanup.test.tsx src/pages/Chat/hooks/useChat.history.paging.test.ts
```

## 6. 遗留与风险

1. `codex/octop-p0-continuation` 分支本机不可达——合入 dev 后需重跑本报告第 5 节全部用例；预期合入后 1.1/1.2/1.4 三个失败转绿，其余保持绿。
2. 前端既有文件间污染（既有问题，非本次引入）：`chatStore.history.test.ts` 与 `useChat.history.test.ts` 同批跑时后者 5/5 超时假失败（`useChat` 首次渲染 ~4-5s 顶着 5s 默认超时）；单独跑 5/5 过。建议给该文件加显式超时或拆分，与 10-22 交接文档 §4.3 同类。
3. 验收单原文在沙箱，本报告以用户消息验收要点为准；若验收单还有未在消息中列出的条目（如具体 UI 点击步骤），分支可达后需补人工走查。
