# Octop 对外发布 · Ubuntu 部署方案

> 适用：Ubuntu 22.04 / 24.04（systemd + Nginx）。目标是把工作台项目「代理出去」，
> 给别人一个可直接使用、可设期限、可选登录/验证码的公开地址。

---

## 0. 方案速览

```
外部用户
   │  https://your.domain
   ▼
Nginx  :443            ← 自己管证书（certbot），301 跳 80
   │  proxy_pass + X-Forwarded-Proto
   ▼
Octop  127.0.0.1:8088  ← 纯 HTTP，不碰 443
   │
   ├── /api/publish/{token}/code/...   ← 新增：代码浏览
   ├── /api/publish/{token}/app/...    ← 新增：反向代理到子应用
   └── /api/publish/{token}/chat/...   ← 新增：对话记录
```

**为什么不让 Octop 直接吃 443**：Octop 自带的 Let's Encrypt 流程要长期占住 80 端口
（`tls/http_companion.py` 的 ACME challenge 应答 + 301 跳转），与前置 Nginx 的 80 端口
直接冲突。走反代后 Octop 只跑纯 HTTP，80 全部归 Nginx，冲突消失。

**反代已被平台适配**：`api/common/sso_cookie.py:14` 的 `request_is_https()` 已在读
`x-forwarded-proto`，HTTPS 下 Cookie 的 `secure` 标志会自动正确置位，无需改代码。

---

## 1. 前置条件清单

| 项 | 要求 | 校验方法 |
|---|---|---|
| 服务器 | Ubuntu 22.04+，有**公网 IP** | `curl -4 ifconfig.me` |
| 域名 | A 记录已解析到该公网 IP | `dig +short your.domain` 应等于上面 IP |
| 端口 | 云安全组放行 80 / 443 **入站** | 另开 22 SSH |
| 内存 | ≥ 2GB（4GB 更稳，Playwright 需要） | `free -h` |
| 磁盘 | ≥ 20GB | `df -h /` |

> ⚠️ **国内云服务器**（腾讯云/阿里云）用海外 IP 段的机器存在被墙风险，
> Let's Encrypt 与 GitHub 都可能连不通。**务必选境内 IP 段**。
> 平台自带的公网 IP 探测已适配国内（`tls/preflight.py:24-33`：腾讯云/阿里云 metadata
> + `4.ipw.cn` / `api.ip.sb` 等国内可达 echo 源），但 CA 服务器本身能否直连仍取决于线路。

---

## 2. 安装 Octop

### 2.1 基础依赖

```bash
sudo apt update && sudo apt install -y \
  curl git nginx python3 python3-dev python3-venv build-essential \
  ca-certificates openssl
```

### 2.2 跑官方安装脚本

仓库自带 `scripts/install.sh`，已处理国内镜像、uv 自举、编译依赖缺失等坑。

```bash
git clone https://github.com/xdguo-design/lyra-octop.git
cd lyra-octop

# 装本地源码（含你后续要加的发布网关改动）
bash scripts/install.sh --from-source
```

脚本会：
- 自举 uv（没装就从 PyPI/腾讯云镜像装）
- 建隔离 venv 到 `~/.octop/venv`（**不污染系统 Python**）
- 把 `octop` 链到 PATH
- 打印 `octop service start` 提示

装完确认：

```bash
octop version
which octop          # 期望 ~/.octop/bin/octop
```

### 2.3 初始化 + 建管理员

```bash
octop init
# 交互：管理员用户名 / 密码（≥8 位且含字母和数字）
```

密码策略同平台内改密（`infra/users/password.py`），弱密码会被拒。

### 2.4 systemd 常驻

```bash
# --host/--port 会先写进 ~/.octop/config.json，再生成 unit
octop service start --host 127.0.0.1 --port 8088
```

生成的 unit 在 `/etc/systemd/system/octop.service`（root 跑）或
`~/.config/systemd/user/octop.service`（普通用户跑）。要点：

```ini
[Service]
Type=simple
Environment="HOME=/root"
Environment=OCTOP_HOME=/root/.octop
Environment=OCTOP_SERVICE_MODE=systemd
ExecStart=/root/.octop/venv/bin/octop run
Restart=on-failure
RestartSec=5
LimitNOFILE=65536
```

`ExecStart` 走的是 `octop run`（不带参数），因此**绑定地址完全由 config.json 决定**。
这正是我们要的：Octop 永远只听 8088，443 由 Nginx 管。

运维命令：

```bash
octop service status
octop service restart
journalctl -u octop -n 80 --no-pager     # 看日志
```

> 依赖包 `octop-harness` / `octop-memory` / `octop-gateway` 在公开 PyPI 上
> （uv.lock 记录的源是清华镜像），`--from-source` 也能正常解析。

---

## 3. Nginx + 证书

### 3.1 装 certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 3.2 首次签发（用 Nginx 插件，会自动改配置）

```bash
sudo certbot --nginx -d your.domain
```

certbot 会问邮箱、同意条款、是否强制跳转 HTTP→HTTPS（选 **Yes**）。

### 3.3 校验自动续期

```bash
sudo systemctl list-timers | grep certbot     # 应该已排期
sudo certbot renew --dry-run                # 演练续期，必须成功
```

certbot 自带 systemd timer 每天跑两次续期检查，**这一步不要跳过**——
证书 90 天到期，续期挂了平台就直接对外失效。

### 3.4 最终 Nginx 配置

certbot 改完后确认 `proxy_set_header` 三行都在（**`X-Forwarded-Proto` 是关键**）：

```nginx
server {
    listen 443 ssl http2;
    server_name your.domain;

    ssl_certificate     /etc/letsencrypt/live/your.domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your.domain/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8088;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;      # ← 域名必须原样透传
        proxy_set_header X-Forwarded-Proto $scheme;    # ← 关键，影响 secure cookie
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP         $remote_addr;

        proxy_read_timeout 300s;   # SSE / 长任务需要
        proxy_buffering off;       # SSE 必须关缓冲
    }
}
```

`proxy_read_timeout` 和 `proxy_buffering off` 别省 —— 平台有 SSE 流式输出和
子进程任务，默认 60s 超时 + 缓冲会让前端看起来"卡住"。

### 3.5 验证

```bash
curl -I https://your.domain/            # 期望 200/302，Header 里有 X-Forwarded-Proto 的效果
curl -s -o /dev/null -w "%{http_code}\n" http://your.domain/    # 期望 301 → https
```

---

## 4. 平台侧还需确认的三件事

### ① 分享链接的域名来源

`OctopConfig` **没有 `public_base_url` 字段**。分享链接由前端用
`window.location.origin` 拼（`dashboard/src/pages/Home/ProjectShareDialog.tsx:89`）。

**含义**：只要用户从 `https://your.domain` 访问平台，复制出来的链接就是
`https://your.domain/share/xxx` —— 天然正确，不需要额外配置。
但如果有人用 IP 直连，复制出来的就是 IP 地址。

### ② 工作台项目代码根目录

`config.json` 的 `workbench_code_root` 指向本机的 `D:\WorkSpace\lyra-planet`，
**在 Ubuntu 上这个路径不存在**。需要在服务器上放置代码根目录并改配置：

```jsonc
{
  "workbench_code_root": "/opt/octop-projects",
  "workbench_launch_profiles": [ /* 按需改端口 */ ]
}
```

`workbench_launch_profiles` 里的启动命令也要改成 Linux 形式
（`uvicorn main:app` 而不是 Windows 的 `.venv\Scripts\...`）。

### ③ `code_enabled` 硬编码必须改

`infra/db/repos/workbench.py:80` 写死了 `name == "星球"`。
**不改的话，服务器上任何新项目都开不了代码浏览**。要把它变成项目表的一个字段。

---

## 5. 「代理出去」功能要新建的部分

TLS 和部署解决不了这三样，这是要写代码的：

### 5.1 数据模型

复用 `workbench_project_shares`（027 迁移）思路，扩展两个字段：

```sql
ALTER TABLE workbench_project_shares ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'open';
-- access_mode: open(免登录) | login(需登录) | captcha(需验证码)
ALTER TABLE workbench_project_shares ADD COLUMN target_kind TEXT NOT NULL DEFAULT 'conversation';
-- target_kind: conversation | code | app
```

新增的 `expires_in_days` 天粒度期限可抄 `infra/users/invites.py:81`
的 `InviteService.create(expires_in_days=...)`。

### 5.2 公开路由

新建 `api/routers/publish.py`，放在 `api/routers/` 下（遵守 AGENTS.md §5，依赖只向内流）：

| 路由 | 作用 | 实现参考 |
|---|---|---|
| `GET /api/publish/{token}/code/**` | 代码浏览 | 复用 `infra/workbench/code_browser.py` 的路径逃逸 / `.env` 屏蔽 / 1MiB 上限 |
| `GET /api/publish/{token}/app/**` | 反代到子应用 | 复用 `api/routers/admission_demo_proxy.py` 的 httpx 转发（`trust_env=False`、`follow_redirects=False`、64KB body 上限） |
| `GET /api/publish/{token}/chat/**` | 对话记录 | 现有分享逻辑迁移 |

这些路由要加进 `api/deps.py` 的 JWT 白名单（现有白名单在 `deps.py:38`）。

### 5.3 安全边界（不能省的）

- **回源只允许 127.0.0.1** —— 防 SSRF，`app` 代理的目标端口必须从白名单取，不能来自用户输入
- **路径必须规范化后再校验** —— 防止 `../` 穿越
- **验证码复用** `infra/auth/captcha/`（本地 SVG/滑块/图片/reCAPTCHA v3 四类 provider 都在），
  只在 `access_mode=captcha` 时启用
- **限流** —— 公开端点必须有速率限制，否则就是免费流量入口
- **审计** —— 复用 `audit_log`（027 迁移已给它加了 `project_id` 列）

---

## 6. 上线检查清单

- [ ] `dig +short your.domain` == 服务器公网 IP
- [ ] `curl -4 ifconfig.me` 有公网 IP（非内网 10./172./192.168.）
- [ ] 云安全组放行 80/443
- [ ] `octop service status` → `health: OK`
- [ ] `curl -I https://your.domain/` 返回正常
- [ ] `sudo certbot renew --dry-run` 成功
- [ ] `journalctl -u octop` 无异常
- [ ] `workbench_code_root` 已改成服务器路径且目录存在
- [ ] `code_enabled` 已从硬编码改成字段
- [ ] 发布网关三个路由已加 JWT 白名单
- [ ] 公开端点有限流
- [ ] 分享链接复制出来是 `https://your.domain/...` 而非 IP
