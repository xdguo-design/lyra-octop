# 本地项目预览

Octop 可由管理员配置本机项目，在「创作」和 Home 应用入口中启动、内嵌预览及停止。项目代码以 Octop 服务账户权限运行，因此只有管理员能操作，且保存 GitHub 地址本身不会启动项目。

## 配置

将项目放在 `workbench_launch_root` 目录下，并在 Octop 的 `config.json` 配置受信任仓库 profile。每个 profile 绑定精确的 HTTPS GitHub 仓库地址、根目录下的相对路径、固定 backend/frontend 命令和健康检查路径。命令由服务端配置提供；HTTP 请求不能覆盖路径或参数。启动根目录与工作台代码浏览根目录独立，且项目进程仅继承运行所需的操作系统路径变量，不会继承 Octop 访问令牌等服务环境变量。

本地 `data-upload-product` 配置示例：

```json
{
  "workbench_launch_root": "D:/WorkSpace",
  "workbench_launch_profiles": [
    {
      "repository_url": "https://github.com/xdguo-design/data-upload-product",
      "relative_path": "data-upload-product",
      "backend": {
        "command": "go",
        "args": ["run", "./cmd/server"],
        "cwd": "backend",
        "port_env": "ADDR",
        "bind_host_env": null,
        "health_path": "/api/v1/health"
      },
      "frontend": {
        "command": "node",
        "args": ["doc/prototype/server.js"],
        "cwd": ".",
        "port_env": "PORT",
        "bind_host_env": "HOST",
        "health_path": "/"
      }
    }
  ]
}
```

保存配置后重启 Octop。Octop 在启动时验证 profile 格式；每次项目启动时再次解析真实路径，拒绝指向 `workbench_launch_root` 外的目录。`ADDR`、`PORT`、`HOST`、`CORS_ORIGINS` 和 `BACKEND_URL` 由启动管理器动态设置，监听范围限定为 `127.0.0.1`。

## 使用限制

- 启动与停止需要管理员账号，并且管理员账号必须拥有对应创作条目。
- 页面必须通过 `http://localhost:<port>` 或 `http://127.0.0.1:<port>` 打开。HTTPS、局域网地址、其他主机名和远程浏览器暂不支持内嵌。
- Octop 正常关闭时会终止项目进程树；Octop 再次启动后项目保持停止。
- 日志仅保留最多 8 KiB 的脱敏启动摘要；浏览器截图只允许访问该 profile 产生的 loopback 前后端 origin。

## 开发验证

```powershell
$env:PYTHONPATH = 'src'
.\.venv\Scripts\python.exe -m pytest tests/unit/workbench/test_project_service.py tests/unit/test_creation_thumbnails.py tests/integration/test_creations_api.py -q
```

目标项目静态站点启动参数测试：

```powershell
node --test D:\WorkSpace\data-upload-product\doc\prototype\server.test.js
```
