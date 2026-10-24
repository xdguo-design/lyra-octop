# 智能入院登记 Agent 调用效率审核与优化记录

日期：2026-10-23  
基准分支：`dev`  
实施分支：`codex/admission-agent-efficiency`

## 1. 目标与范围

降低智能入院登记首次自然语言抽取的 Agent/模型调用次数，同时保持现有字段白名单、页面隔离、原话证据校验、行政区划校验、枚举校验和歧义追问行为。

本轮检查覆盖：

- `src/octop/api/routers/admission_demo.py`：平台抽取 API 契约；
- `src/octop/infra/admission_demo.py`：Agent/Skill 调用与输出过滤；
- `demos/admission-registration/backend/src/admission_registration/main.py`：登记后端代理；
- 对应平台单元/集成测试及 Demo 后端测试。

## 2. 已确认的调用开销

首次回答（`page=0`）原先由登记后端并发发出两个平台请求，分别使用 `page=1`、`page=2`。因此这不是串行等待，但确实会触发两次独立的 Agent/模型推理，重复传输同一份整理后的登记上下文。

平台的 `_extract_skill_output` 已支持 `page=0`，允许两页全部字段；患者信息 Skill 也明确规定 `page: 0` 可输出两页字段。旧 API 请求模型却只接受 `page=1` 或 `page=2`，导致已有能力无法被首次抽取使用。

## 3. 本轮修改

1. 平台抽取 API 接受 `page=0`；原有 `page=1`、`page=2` 语义保持不变。
2. 首次抽取将原来的两个页面请求合并为一个 `page=0` 请求；单页请求仍然只抽取指定页面。
3. 增加/调整测试，覆盖：
   - `page=0` 可同时返回两页字段；
   - 平台 API 接受 `page=0`，并继续支持 `page=2`；
   - 首次回答只向平台抽取 API 发出一次请求；
   - 结果仍经过既有字段白名单和候选校验。

## 4. 预期收益与边界

- **可直接核对的收益：** 首次抽取阶段的 Agent API 请求数由 2 降为 1，即该阶段请求数量减少 50%。
- **尚未测量：** 端到端延迟、P50/P95、实际输入/输出 Token、模型供应商账单成本。
- **不能据此推断：** 首次抽取延迟必然减少 50%；单次请求的输出长度和模型生成耗时可能变化。

安全边界不变：模型只提供候选值，后端仍校验候选；不能据模型输出执行身份核验、资格判断或提交登记。患者原话中的旧字段值仍不能自动作为本轮新增字段。

## 5. 建议验证命令

在仓库根目录：

```bash
uv run pytest tests/unit/test_admission_demo.py -q
uv run pytest tests/integration/test_admission_demo_api.py -q
```

在 `demos/admission-registration/backend` 目录：

```bash
python -m pytest tests/test_ai_api.py -q
```

活动模型端到端验证（需本机 Octop 服务、有效登录会话和合成演示资料）：

```powershell
.venv\Scripts\python.exe demos\admission-registration\e2e\ai_e2e.py --skip-ui
```

请在同一活动模型、同一组合成输入上对比变更前后的 Agent 请求次数、`agent_ms`、`model_ms`、`model_calls`、输入/输出 Token 和成功率。不要使用真实患者信息作为性能测试输入。

## 6. 后续审计项（本轮未改）

1. 每轮调用都会执行 Agent provision 检查及工具禁用同步；需测量 `prepare_ms`，再决定是否引入有失效策略的短时缓存。
2. 每轮都会读取 Skill 文件并重新构造请求；可评估缓存不可变的 Skill 文本，但应确认开发环境是否要求运行时热更新。
3. 每轮会读取会话与地区数据，并创建新的 HTTP 客户端；应测量连接建立与地区请求开销，再评估连接池及短 TTL 地区缓存。
4. 地址 MCP 加载失败会重试一次 Agent 请求；需分别统计 MCP 加载失败率与重试耗时，避免盲目禁用地址校验。
5. 现有模型计时日志应与登记接口总耗时、错误码及每轮调用次数关联，形成可复现的性能基线。

## 7. 当前验证状态

本次代码变更已加入针对性自动化测试，但尚未在本机运行完整测试套件，也尚未取得真实活动模型的优化前后性能数据。合并前必须以 CI 和本机合成数据端到端结果为准。
