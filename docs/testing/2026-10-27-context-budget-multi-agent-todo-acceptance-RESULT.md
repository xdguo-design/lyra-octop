# Octop 上下文策略 P1 与多 Agent Todo 测试验收 · 执行结果

> 对应方案：`docs/testing/2026-10-27-context-budget-multi-agent-todo-acceptance.md`（V1.0）
> 测试日期：2026-10-27 21:45–23:10（本地时间）
> 测试人：ZCode（自动化代理执行 + 人工复核）
> 被测提交：`dev` @ **e4c7b622eb28784c530f9ed77abc4c2e610f6b13**
> 测试环境：Windows 10.0.26300 / 本地开发实例 `http://127.0.0.1:8200`（SQLite）/ Python 3.12 venv / Node 22 vitest
> 模型：Zhipu Coding Plan `glm-5.3-flash`（主用）；`free/deepseek-v4-flash`（不可用，见 ENV-1）
> 测试数据：专用临时 Agent——Todo测试A=`GA4EBC`、Todo测试B=`68VZJA`、Todo测试团队=`SBRNM3`（`kind=team`，member_ids=[A,B]）
> 证据目录：`docs/testing/evidence-2026-10-27/`（13 张截图）+ 各 Agent 线程轨迹（API 可复查）
>
> **总体结论：部分通过。** 上下文 P1 门禁全绿；单 Agent Todo 端到端通过；多 Agent 团队端到端不通过（委派路由正确，但成员后台执行零落地且主持人虚报完成）。存在 2 项 P1 缺陷。

## 一、自动化门禁（CTX）

| 用例 | 结果 | 实测证据 |
|---|---|---|
| CTX-01 模型窗口与输出预留 | **PASS** | `test_budget_prefers_model_window_and_reserves_output_and_margin`：64k 窗口、60k 上限、预留 4000+1000 → 59000 / model_profile / 非估算 |
| CTX-02 Agent 配置上限优先 | **PASS** | `test_budget_uses_lower_configured_cap`：128k 模型 + 20k 配置 → 20000 |
| CTX-03 窗口未知走 fallback | **PASS** | `test_budget_marks_fallback_as_estimated`：fallback 24000−2000−500=21500、`is_estimated=True`、`source=configured_fallback` |
| CTX-04 非法窗口（布尔） | **PASS** | `test_invalid_model_window_uses_fallback_and_boolean_is_not_a_number`：`True` 被忽略、回退 16000、标记估算 |
| CTX-05 来源与 token 合计 | **PASS** | `test_context_packet_requires_provenance_and_counts_tokens`：120+80=200，provenance 字段齐全 |
| CTX-06 缺 scope/reason | **PASS** | `test_context_packet_rejects_missing_scope_and_reason`：逐字段报错 |
| CTX-07 负 token/超量条目 | **PASS** | `test_context_packet_rejects_negative_tokens_and_unbounded_item_count` |
| CTX-08 非结构化输入 | **PASS** | `test_context_packet_rejects_untyped_items`：dict 被拒，不崩溃 |
| CTX-09 三命令静态门禁 | **PASS** | `pytest tests/unit/agents/test_context_budget.py` → **8 passed**；`ruff check` → All checks passed；`mypy context_budget.py` → Success: no issues |
| CTX-10 影子模式统计 | **N/A** | 尚未接入运行时（`context_budget.py` 为纯函数，无调用方），与方案预期一致 |

前端门禁：`vitest TodoProgressPanel.test.tsx + todoSync.test.ts` → **10 passed (6+4)**；`npx tsc -b` → exit 0；`npm run build` → 成功（290 precache entries）。
偏差说明：环境已有 `node_modules` 且 lockfile 未变，跳过 `npm ci` 直接复用，其余按方案执行。

## 二、单 Agent Todo（TODO）

会话：A=`GA4EBC`，线程 `thr_01M5YTE9B781TQPX4Q6Y3Q8GMC`。

| 用例 | 结果 | 实测结果与证据 |
|---|---|---|
| TODO-01 自动生成清单 | **PASS** | 消息发出后 Agent 调用 `write_todos`（轨迹 seq19：4 项全部 pending），页面渲染「任务进度 已完成 0/4」面板 +「已调用 1 次工具」摘要。截图 `todo01-panel-card.png`。注：首轮因环境问题失败两次（见 ENV-1/ENV-2），重试后通过 |
| TODO-02 页面编辑后回传 | **PASS** | 编辑草稿（第2项改名+置进行中、追加「检查异常场景」、回归验证上移）→「同步给 Agent」→ 发出的消息携带完整最新顺序与状态（截图+DOM 文本均取证）；Agent 经 HITL 澄清后以 `write_todos` 重建 5 项清单（轨迹 seq27），新面板 0/5 与草稿完全一致，无重复无丢失。截图 `todo02-draft.png`、`todo02-final-panel.png` |
| TODO-03 取消编辑 | **PASS** | 草稿修改第 1 项后点「取消」，重新打开编辑器显示仍为 Agent 原始内容「检查 API」，草稿未保留。截图 `todo03-cancel-reopen.png` |
| TODO-04 执行期编辑与同步限制 | **部分通过（组件级）** | 组件机制存在且被单测覆盖（`TodoProgressPanel.tsx:307,311-312,329-331`；单测 `prevents syncing while the Agent is still working` 断言按钮禁用+「Agent 执行中」+提示文案）；isAgentBusy 由 `MessageList.tsx:190` 的 `ctx.isStreaming` 驱动。实机限制：**流式期间页面主线程完全冻结（见 DEF-1），无法在浏览器内实时点开/断言**；旁证：草稿编辑器跨整个执行轮次保持打开且可编辑 |
| TODO-05 过期草稿冲突 | **组件级通过，实机未触发** | 组件机制存在（`TodoProgressPanel.tsx:126-140` 编辑期间 items 签名变化 → 禁用同步 + 提示「任务清单在编辑期间已更新…」；单测 `blocks syncing a draft after the Agent updates the task list` 在通过集合内）。实机复现路径（HITL 暂停期开编辑器→提交→Agent 同轮 write_todos）因 Agent 恢复后再次 model_call_failed 未走完。按方案要求不填「手动通过」，保留单测证据 |

## 三、多 Agent 团队（TEAM）

会话：Host=`SBRNM3` 线程 `thr_01M5YWMZ88WMYMEN0ZPM9V064D`；成员 A=`GA4EBC`、B=`68VZJA`。

| 用例 | 结果 | 实测结果与证据 |
|---|---|---|
| TEAM-01 成员清单归属展示 | **FAIL（端到端）** | 主持人 3 轮 `ask_agent` 均正确定向到成员（轨迹 seq9/11、18/20、27/29，args 中 expert=Todo测试A/B，result 返回正确 agent_id 且 `status=queued`），**但成员侧零落地**：A 线程在委派窗口（22:42）内 0 个新事件、无「接口联调/自测」write_todos；B 名下 0 个线程；派生 peer 线程（`…~GA4EBC`/`…~68VZJA`）均 404。Host 线程 UI 中成员 Todo 面板数=0。而主持人最终回复宣称「两份清单都已建好且互不合并」——**无任何工具证据支撑，属于虚报完成**（触发方案「不放行」红线）。截图 `team01-expanded-trajectory.png` |
| TEAM-02 A 清单定向回传 A | **组件级通过** | 路由逻辑 `todoSync.ts:31-39`（团队房间+成员清单 → 目标=[owner]）+ 同步 prompt 明确要求经 ask_agent 定向交还成员（`todoSync.ts:49-54`）；单测 `keeps the owning Agent when syncing a member task list` 断言 `onSyncTodos(items, "frontend-agent")`。端到端未走通（同 TEAM-01 根因） |
| TEAM-03 A 修改不覆盖 B | **组件级通过** | 同步 prompt 明确「只更新该成员自己的任务；不得覆盖…其他成员的清单」（`todoSync.ts:53`）。端到端因成员清单未落地未能执行 |
| TEAM-04 普通对话目标选择不回归 | **PASS** | 非团队房间 `todoSyncTargetAgents` 返回 `undefined`（保留用户既有选择，`todoSync.ts:34`）；TODO-02 即在普通会话完成同步全流程，未出现目标被清空 |
| TEAM-05 未知成员/退群编辑 | **BLOCKED** | 依赖成员清单存在；未执行 |
| TEAM-06 切换会话与刷新 | **BLOCKED** | 同上；旁证：TODO 系列多次切换/刷新/重进线程，A 的清单状态均正确恢复（轨迹 seq19→66 与面板一致） |
| TEAM-07 阻塞和失败 | **FAIL（反面实锤）** | 本轮实际发生：成员后台任务失败（或未执行）时，Host 汇报为「已完成」。页面将该总结渲染为普通成功叙事，无任何失败/证据标记——正是方案禁止的「仅凭模型总结认定成功」。与 DEF-2 同根 |
| TEAM-08 团队共享任务调度 | **N/A** | 未实现（方案已注明） |

## 四、安全与隔离（SEC）

| 用例 | 归类 | 说明 |
|---|---|---|
| SEC-01 | **未执行** | 本地实例仅 admin 单用户，未构造 U2；后续需接口级隔离回归 |
| SEC-02～04 | **N/A** | 对应 P2/P4 结构化上下文/插件能力尚未开发（方案已归类） |
| SEC-05 | 未执行 | 后台原始 payload 泄露需单独 API 校验，本轮未覆盖 |

## 五、缺陷与环境问题清单

| 编号 | 级别 | 描述 | 复现/证据 |
|---|---|---|---|
| DEF-1 | **P1（性能）** | 长流式响应期间聊天页主线程完全冻结：Playwright 截图/JS evaluate 连续超时（60s+），持续约 2.5–5 分钟，流结束后自行恢复；同一会话复现 3 次。期间用户实际无法操作（含打开 Todo 编辑器） | 22:15、22:19、22:24 三轮长输出期间浏览器自动化全部超时；`todo04-recovered.png` 为恢复后状态 |
| DEF-2 | **P1（正确性/虚报完成）** | `ask_agent` 后台成员任务静默失败且无处查看状态：inbox 为进程内存队列（`octop_harness/teams/inbox.py` `self._messages: dict`，无持久化、无状态查询端点）；任务失败/未执行时 Host 无从得知并对外宣称完成。触发方案「不放行」红线 | Host 轨迹 seq27/29 返回 `queued` 后，成员侧零事件、零线程、派生线程 404 |
| DEF-3 | P2（待确认） | 消息级「模型芯片」（当勾）在 Agent 默认模型切换后仍残留并按芯片模型执行，易造成「以为换了模型实际没换」的混淆 | 22:02 起输入框持续显示 `glm-5.3-flash` 芯片而 agent 默认已为 deepseek |
| ENV-1 | 环境问题 | `free` provider 指向本地代理 `127.0.0.1:8766`，该进程**未运行**（端口无监听）→ deepseek-v4-flash 全部「连接模型服务超时」。非产品缺陷 | `Get-NetTCPConnection -LocalPort 8766` 无监听；HTTP 000 |
| ENV-2 | 环境问题 | Zhipu `open.bigmodel.cn` 间歇性连接超时（测试窗口内约半数轮次首次调用失败，重试可恢复）；单轮内多次 model_call_failed 直接终止轮次 | 多张错误卡片截图；network 探测时通时不通 |
| OBS-1 | 观察 | 新建 Agent 默认挂载 Agent Mail / Vercel MCP；Vercel MCP 加载失败会直接中断首轮对话（「无法加载 MCP 工具： vercel」），需手动摘除芯片或清空 mcp_servers | 首轮错误卡片 |
| OBS-2 | 观察 | **无独立 Todo 页面**：路由表（`dashboard/src/routes/index.tsx`）无 `/todos` 类路由，Todo 清单仅以聊天内嵌「任务进度」卡片存在。与当前验收方案范围一致，如需独立页面属新需求 | 路由表核查 |

## 六、放行判定（对照方案 §9）

- **上下文 P1 门禁（CTX-01~09 全过 + ruff/mypy 通过 + 未破坏现有对话）：✅ 达到。** 建议 `context_budget.py` 进入影子模式接入（CTX-10）后再评运行时价值。
- **单 Agent Todo 门禁（TODO-01~05 可执行用例 + 真实工具轨迹端到端样本）：✅ 基本达到**（TODO-01/02/03 端到端通过且带真实 write_todos 轨迹；TODO-04/05 组件级通过，实机验证受 DEF-1 阻碍——须先修 DEF-1 复测）。
- **团队定向同步门禁（TEAM-01~04 可执行用例通过 + 端到端样本）：❌ 未达到。** 委派路由与组件级定向正确，但端到端成员执行链路断裂（DEF-2），且出现虚报完成叙事。**修复 DEF-2（后台任务可观测/失败回传）并复测 TEAM-01/02/03 前不应放行团队部分。**
- 未放行红线核对：跨账号读取未发现（未测 SEC-01）；丢失未完成任务未发现；**虚报完成：发生（DEF-2/TEAM-01/TEAM-07）**。

## 七、验收结论（对照方案 §10）

- P0 通过率：CTX 9/9；TODO 3 端到端 PASS + 2 组件级 PASS；TEAM 1/4（TEAM-04），TEAM-01/07 FAIL，TEAM-02/03 组件级通过端到端未走通
- 未解决 P0/P1 缺陷：DEF-1（流式冻结）、DEF-2（后台任务静默失败 + 虚报完成）
- 结论：**□ 可验收当前阶段 ☑ 修复后复测（团队部分） □ 阻塞**——上下文 P1 与单 Agent Todo 可进入下一阶段；多 Agent 团队待 DEF-2 修复后复测 TEAM-01/02/03/07
- 下一步建议：
  1. 修复 DEF-1（定位流式渲染的性能热点，怀疑长 markdown 全量重渲染）；
  2. 修复 DEF-2：后台 peer 任务持久化或至少提供状态查询；任务失败必须回传 Host 并如实呈现，禁止静默；
  3. 复测前启动 `free` provider 本地代理（127.0.0.1:8766）或为测试 Agent 固定稳定模型，规避 ENV-1/2 干扰；
  4. TEAM-05/06/SEC-01 在多用户测试实例补测；
  5. 测试数据清理：删除临时 Agent `GA4EBC`/`68VZJA`/`SBRNM3`（含其线程证据需保留至复测完成）。
