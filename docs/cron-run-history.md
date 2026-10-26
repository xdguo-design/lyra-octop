# Cron 运行历史与取消

Cron 的每次执行都会写入 `cron_runs`，包含运行 ID、触发方式、状态、起止时间和有限长度的错误摘要。删除 Cron 定义不会删除历史记录。历史查询仍受当前 Agent 所有权和原运行用户过滤。

## API

- `POST /api/agents/{agent_id}/cron/{cron_id}/run-now` 返回 `202` 和 `{ "run_id", "status": "running" }`。接受请求只代表已创建后台运行，不代表任务成功。
- `GET /api/agents/{agent_id}/cron/{cron_id}/runs?limit=20&offset=0` 返回最近运行；limit 上限为 100。
- `POST /api/agents/{agent_id}/cron/{cron_id}/runs/{run_id}/cancel` 请求取消当前进程内仍在运行的任务。

终态包括 `ok`、`error`、`cancelled` 和 `interrupted`。每个服务实例每分钟续租一次数据库心跳。服务启动时，只将心跳超过五分钟未更新的实例留下的运行标为 `interrupted`；健康的其他实例不会被误判。中断任务不会自动重放，避免重复触发外部动作。

## 取消语义

取消通过 asyncio task cancellation 传递到当前进程中的执行协程。取消是尽力而为：它不能撤回已发出的消息、已完成的写入或 Provider 已接受的请求；也不构成事务回滚。若请求落在另一服务实例，当前实例不能取消那个实例中的执行，API 会返回 `cancelled: false`。如果事件循环阻塞超过五分钟，健康实例也可能被误判为中断；部署监控应告警进程或事件循环停滞。任务作者仍需为有副作用的操作使用审批和幂等键。

## 离线验证

```bash
PYTHONPATH=src uv run --no-sync pytest \
  tests/unit/db/test_db_pool.py \
  tests/unit/db/test_repo_cron.py \
  tests/unit/cron/test_cron_job.py \
  tests/unit/cron/test_cron_manager.py \
  tests/unit/cron/test_cron_tools.py \
  tests/unit/cli/test_cron_run_now.py \
  tests/integration/test_cron_api.py \
  tests/integration/test_cron_shared_agent.py -q
```

PostgreSQL migration 以 `030_cron_run_history.pg.sql` 创建同构表和索引；真实 PostgreSQL 行为仍需在启用 `OCTOP_TEST_DATABASE_URL` 的测试环境验证。
