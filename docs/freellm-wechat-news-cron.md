# FreeLLM 微信公众号 AI 日报：Octop 平台定时任务

给 `freellm.top` 每日 AI 日报接入 Octop 定时触发与结果送达。管线主体在 freellm 仓库的
`.github/workflows/wechat-news.yml`，Octop 只负责「到点触发 + 把结果说给你听」。

## 架构

```
Octop cron 08:00 (Asia/Shanghai)          GitHub Actions (freellm)                 Vercel
  agent: freellm-news-bot        dispatch  wechat-news.yml                  push
  ├─ 触发 wechat-news.yml  ───────────────► 采集微信公众号近 3 天 RSS
  ├─ 轮询 run 结论               ◄───────── 相关性评分 → LLM 写文章
  └─ 中文日报送达 IM                       渲染 /news/ → 门禁 → 提交分支   ──────► main 自动部署
                                            ▲
                                            └── 12:00 schedule 兜底（幂等）
```

- 触发时间：Octop `0 0 * * *`（UTC）= 08:00 北京时间。`CronCreateSpec` 目前没有 timezone 字段，触发串一律按 UTC 写。
- 兜底：workflow 自带 `schedule: 0 4 * * *` = 12:00 北京时间，同一天重复跑会因为
  `data/news/<日期>.json` 已存在而直接跳过。
- 提交目标：默认就是「这次运行所在的分支」（Octop 指定 `ref=dev` 就落在 dev，schedule 在默认分支就落在 main）。
- 没有平台定时任务时，只靠 GitHub 的 12:00 schedule 也能完整跑通；平台侧的价值是 08:00 更早触发 + 主动送达日报。

## 前置条件

1. freellm 仓库的 workflow 已合入目标分支（`dev` 或 `main`）。
2. 仓库 Secrets 里已有 `SILICONFLOW_API_KEY`（写文章用；换模型改 workflow 的 `NEWS_LLM_*`）。
3. 一个 GitHub PAT：fine-grained token，仓库只选 `xdguo-design/freellm`，权限
   `Contents: read` + `Actions: read/write`（要读 run 结论并 dispatch workflow）。

## Step 1：加一个能调 GitHub API 的连接器

Octop 的 agent 工具全部来自连接器（没有内置 shell / 网页工具），所以先给它一个能发 HTTPS 请求的能力。
任何满足下面这个 REST 调用的连接器都可以（官方 GitHub MCP、通用 HTTP MCP、自建小 MCP）：

```http
POST https://api.github.com/repos/xdguo-design/freellm/actions/workflows/wechat-news.yml/dispatches
Authorization: Bearer <GITHUB_PAT>
Accept: application/vnd.github+json
Content-Type: application/json

{"ref": "dev"}
```

需要的读取能力：

```http
GET https://api.github.com/repos/xdguo-design/freellm/actions/workflows/wechat-news.yml/runs?branch=dev&per_page=1
GET https://api.github.com/repos/xdguo-design/freellm/actions/runs/{run_id}/jobs
```

配置入口：Octop → 连接器 → 自定义 MCP（`custom-mcp`）→ 填 MCP server 启动命令与环境变量，
把 PAT 放进该连接器的凭据（不要写进 agent 的 prompt）。

> 用官方 GitHub MCP server 时，先用它的工具列表确认是否有 workflow dispatch 能力；
> 没有的话改用通用 HTTP MCP，直接打上面的 REST 接口。

## Step 2：建专用 agent

Octop → Agent → 新建（如 `freellm-news-bot`），绑定 Step 1 的连接器，模型选便宜且中文稳定的即可。
这个 agent 只做编排与写日报，不需要文件或代码工具。

## Step 3：建 cron 任务

```bash
octop cron create \
  --agent freellm-news-bot \
  --trigger "0 0 * * *" \
  --fresh-thread \
  --task-type agent \
  --prompt "<下面任务书全文>"
```

也可以用平台 UI / `cronjob_create` 工具建同样的任务（trigger 串保持一致）。

### 任务书（完整粘贴）

> 你是 FreeLLM（freellm.top）的 AI 新闻日报机器人。每个工作日执行一次下面的流程，并用中文把结果报告给我。
>
> 1. 用 GitHub 连接器对仓库 `xdguo-design/freellm` 的 `dev` 分支触发工作流 `wechat-news.yml`：
>    `POST /repos/xdguo-design/freellm/actions/workflows/wechat-news.yml/dispatches`，body `{"ref":"dev"}`。
> 2. 轮询该 run 直到结束（最多等 30 分钟，超时按失败处理）。用
>    `GET /repos/xdguo-design/freellm/actions/workflows/wechat-news.yml/runs?branch=dev&per_page=1`
>    找到刚触发的 run，再看 `GET /repos/xdguo-design/freellm/actions/runs/{id}/jobs` 的步骤结论。
> 3. 总结下面这些事实（不要编造，没发生就写「未发生」）：
>    - 今天扫了几个公众号源、成功几个、失败几个；
>    - 近 3 天命中几条、阈值拦掉几条；
>    - 是否生成了文章；文章标题与条目数；文章链接 `https://freellm.top/news/<日期>/`；
>    - 门禁结果（news 单测、生成页面 --check、news 页 audit、sitemap 解析）；
>    - 提交到哪个分支、commit 是否推送成功。
> 4. 用不超过 300 字的中文日报回复：先给结论（发文 / 未发文及原因），再列命中新闻标题 + 一句话 + 来源公众号，
>    最后给文章链接与门禁结论。未发文时写清原因（无命中 / 命中不足 3 条 / LLM 校验失败 / 门禁失败，附关键错误）。
> 5. 任何一步失败都要明确指出失败点，不要静默跳过，不要伪造成功。

## Step 4：验证

```bash
octop cron list --agent freellm-news-bot          # 看到 0 0 * * * 即创建成功
octop cron run_now <cron_id>                      # 立即跑一次，观察日报是否送达
```

同时在 GitHub 上确认 run 出现并成功；文章出现后 `https://freellm.top/news/` 可见（若提交在 dev，
则要等 dev→main 发版后才对外可见）。

## 运维说明

- **手动补跑**：`octop cron run_now <cron_id>`，或直接给 workflow 点 `Run workflow`（`target_branch` 留空即当前分支）。
- **只看不跑**：GitHub run 的 summary 里有人工可读的结果（标题、条目数、门禁状态）。
- **想全自动发版**：把 Octop 的 dispatch `ref` 改成 `main`，并让 GitHub schedule 作为兜底 ——
  两边都落在 main 后，08:00 那次会先建好当天的 `data/news/<日期>.json`，12:00 兜底会因幂等直接跳过。
  注意：直接推 main 要求 main 上没有必须走 PR 的保护规则（现有 `daily-log.yml` 就是直接推 main 的先例）。
- **失败排查顺序**：GitHub run → 「Score」步骤的 accepted 数量 → 「Generate」步骤的校验报错 →
  确认 `SILICONFLOW_API_KEY` 未过期 → 确认 wechat2rss.xlab.app 可达。

## 关联

- freellm 实施计划：`freellm/docs/specs/plans/2026-10-21-wechat-ai-news-daily-automation.md`
- 工作流：`freellm/.github/workflows/wechat-news.yml`
- 源注册表：`freellm/data/wechat-news-sources.json`（10 个 AI 公众号）
- 阈值与提示词：`freellm/data/wechat-news-config.json`
