# 入院登记表单对话跟进修复实施计划

> **给代理执行者：** 本计划由当前会话按顺序执行；每个行为先补失败测试，再改最少代码。任务使用 `- [ ]` 跟踪。

**目标：** 让必填完成后的表单对话支持自由补充/跳过，可靠推进分页，并识别省名省略但唯一的籍贯地区。

**架构要点：** 前端复用现有对话抽取和分页动作。Octop 与 Demo 后端分别维护地区解析器，因此两处均覆盖唯一地区路径补全；歧义路径不猜。

**技术栈：** Vue 2 + Vitest；Python + pytest。验证使用 `cd demos/admission-registration/frontend && npm test -- --run tests/full-workflow.test.js`、`uv run pytest tests/unit/test_admission_registration_demo.py -q`、Demo 后端目标 pytest、`cd dashboard && npx tsc -b`（如未触及 dashboard 则跳过）和 Vite build。

**关联设计文档：** `demos/admission-registration/docs/specs/2026-10-20-form-chat-follow-up-design.md`

---

## 文件与职责

- `demos/admission-registration/frontend/src/App.vue`：本页补充问题、口述跳过分发、推进结果反馈。
- `demos/admission-registration/frontend/tests/full-workflow.test.js`：补充回合、地区候选应用、翻页与失败状态回归。
- `src/octop/infra/admission_registration_demo.py`：线上 Demo 地区树唯一路径解析。
- `tests/unit/test_admission_registration_demo.py`：线上 Demo 原句与歧义地区测试。
- `demos/admission-registration/backend/src/admission_registration/ai.py`：独立 Demo 后端同步解析行为。
- `demos/admission-registration/backend/tests/test_ai_api.py`：独立 Demo 后端原句回归。
- `memory.md`：记录确认后的持久交互决策。

## 执行步骤

### 1. 补地区解析失败用例并验证 RED

- [x] 在两套 Python 测试中加入原句“我的籍贯沈阳市沈河区”，期望 `nativeRegion == ["210000", "210100", "210103"]`；增加一个在地区树中不唯一的市/区称呼，期望不返回候选。
- [x] 分别运行两个目标 pytest，确认原句用例先因无法补全省份失败，再于实现后通过。

### 2. 实现地区唯一路径恢复并验证 GREEN

- [x] 在两处地区解析器的省级解析失败路径中只接受唯一的完整地区树路径；不唯一时返回 `None`。候选继续通过现有字段验证。
- [x] 重跑上述两个目标 pytest 文件，确认通过。

### 3. 补表单补充询问与分页反馈用例并验证 RED

- [x] 用未填写第一页选填字段的有效表单，断言补充提示、籍贯回填后再次询问、补齐后显示继续确认；第二页同样覆盖单位名称/地址。
- [x] 断言“跳过”推进、“暂不继续”留在当前页；分页校验失败与保存失败都不报成功；最后一页只进入核对。
- [x] 运行前端针对性 Vitest，新增交互用例按旧实现预期失败。

### 4. 实现最小前端行为并验证 GREEN

- [x] 让 `nextConversationQuestion` 根据当前页空的非必填可写字段询问补充；自由输入继续走 `applyAi`，补齐后回到既有继续确认。
- [x] 将“跳过”加入明确推进口语；保留“暂不继续”原地停留。
- [x] 将页校验抽为推进前检查；校验失败不写入成功回合，保存失败不推进，成功提示仅在保存并推进后显示。
- [x] 重跑前端目标测试并通过。

### 5. 全面回归与记忆更新

- [x] 前端全套 Vitest（128 passed）、前端 typecheck、Vite build、Octop 定向地区测试（17 passed）、独立 Demo 后端测试（23 passed）、两处 Ruff lint/format 与 `git diff --check` 均通过。
- [x] 更新 `memory.md` 记录已确认交互；检查工作区，保留用户原有及执行期间新增的未提交修改。
- [ ] 仓库 `make all` 未运行：当前终端无 `uv`/`make`/`mypy`，因此未运行 Octop 全量 mypy 与完整测试套件；已用可用的 Python pytest 和 Ruff 验证相关模块。
