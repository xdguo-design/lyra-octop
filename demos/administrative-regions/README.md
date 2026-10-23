# Octop 行政区划服务

独立运行的地区数据插件服务，代码和数据更新逻辑位于本目录，不需要修改 Octop 核心。它提供公开只读地区树、带令牌保护的管理页面和 MCP Streamable HTTP 接口，并每周一 03:00（`REGIONS_TIMEZONE`）同步民政部国家地名信息库公开接口。

## 启动

```powershell
cd demos/administrative-regions
Copy-Item backend/.env.example .env
```

在 `.env` 中为 `ADMIN_TOKEN` 设置至少 32 个随机字符，然后启动：

```powershell
docker compose up --build -d
```

打开 `http://localhost:8210/`，填入管理令牌并点击“立即同步”。全新安装不会自动下载数据；首次成功同步后，服务会保留最后一份有效缓存，失败时不会覆盖缓存。

本机开发运行：

```powershell
cd demos/administrative-regions/backend
uv sync --extra test
$env:ADMIN_TOKEN = "replace-with-a-random-secret-of-at-least-32-chars"
$env:REGIONS_DATA_DIR = "./data"
uv run uvicorn administrative_regions.main:app --reload --port 8210
```

## 接口

- `GET /api/regions`：只读三级树，返回 `{items:[{code,label,children?}]}`；供 Demo 表单读取。
- `GET /api/status`：同步时间、缓存状态及最近错误；需要 `Authorization: Bearer <ADMIN_TOKEN>`。
- `POST /api/sync`：手动同步；需要管理令牌。
- `POST /mcp`：MCP Streamable HTTP JSON-RPC；需要管理令牌。提供 `regions_list`、`regions_resolve`、`regions_status`、`regions_sync`。`regions_resolve` 唯一匹配时返回地区路径；同名歧义时返回最多 10 条候选路径及总数，Agent 应让用户确认，候选过多时请用户补充省市。
- `GET /health`：健康检查。

MCP 客户端将服务地址设为 `http://<host>:8210/mcp`，并在请求中传入 `Authorization: Bearer <ADMIN_TOKEN>`。Octop 可通过现有 MCP 连接器添加此地址；平台无需新增地区专用代码。

Demo 前端可将 `VITE_REGIONS_API_URL` 设为 `http://<host>:8210/api/regions`；独立 Demo 后端可将 `REGIONS_SERVICE_URL` 设为同一只读接口。浏览器访问跨域时，将前端来源加入 `REGIONS_ALLOWED_ORIGINS`。

## 验证与部署

```powershell
cd demos/administrative-regions/backend
uv run pytest
```

容器部署：从 `demos/administrative-regions` 执行 `docker compose up --build -d`。生产环境应通过 HTTPS 反向代理暴露服务，并将令牌仅配置在服务端及 MCP 客户端；`GET /api/regions` 只读公开，不返回同步状态或管理信息。

## 数据来源和限制

服务读取民政部国家地名信息库公开接口，将 12 位来源编码映射为前 6 位 GB/T 2260 编码。该上游接口没有稳定公开的开发者 SLA，格式改变或网络中断时会记录错误并沿用最后有效缓存。同步频率固定为每周一次；可从页面手动同步。缓存保存在 Docker volume `regions-data`。

真实失败场景及防护：

1. 上游返回截断/错误树：校验层拒绝该响应，不写入缓存。
2. 同步期间进程退出：先写同目录临时文件再原子替换，旧缓存保留。
3. 未授权用户触发管理/MCP 操作：路由检查 bearer token；令牌未配置或短于 32 字符时服务拒绝启动。
