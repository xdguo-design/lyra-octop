# 创作页本地项目内嵌预览

## 目标与范围

管理员从创作页打开已配置的 `data-upload-product` 项目时，在 Octop 当前窗口内显示本地运行中的应用，并提供顶部“← 创作”和项目名称栏。卡片标题、项目缩略图及“打开预览”按钮采用同一预览行为。GitHub URL 仍是源码地址，由独立的源码链接打开；非管理员仍按现有方式打开 GitHub 仓库。其他普通外链行为不变。

## 实现选择

复用当前 `creationsApi.startProject()`、已运行状态和创作页现有全屏 iframe overlay。项目未运行时点击卡片入口先调用启动 API，成功取得项目本地 URL 后打开 overlay；已运行时直接打开 overlay。“打开预览”也打开相同 overlay。启动失败时保留现有本地化错误反馈，不打开空 iframe。

GitHub 页面本身不用于 iframe，因为浏览器对 GitHub 的 frame 安全策略不保证允许嵌入；预览使用项目启动接口返回的 `url` 原值（当前为 loopback URL），不拼造或转换地址。仍不把 Octop JWT 或 token 注入 iframe。

## 边界与失败处理

- 只改变精确匹配受信任 `data-upload-product` profile 的 service 卡片；其他 service、applet、外链及内置 app 保持现有行为。
- 启动权限继续由既有 API 的管理员和条目所有权校验控制，不新增启动能力或后端代理。
- 卡片主体快速重复点击时不得并发重复启动；复用现有 starting 状态禁用预览入口。
- 页面无法载入时保留 overlay 返回入口；用户仍可通过卡片 GitHub 地址查看源码。
- 关闭/返回只隐藏预览，不停止项目进程；显式“停止预览”操作继续管理进程生命周期。

## 验收

- 停止状态下打开匹配卡片：启动一次，成功后出现项目 iframe 和“← 创作 / 数据转换平台”顶栏，不调用 `window.open`。
- 运行状态下从卡片主体或“打开预览”打开：直接使用已有项目 URL 显示同一 overlay。
- 点击“← 创作”或关闭按钮回到卡片列表；项目仍运行。
- 启动失败时显示现有失败提示，不创建 iframe。
- 匹配仅基于已存在的仓库 URL 校验；普通 GitHub 仓库仍按原样打开源码外链。
- 定向 Creations Vitest、ESLint、Prettier、`npx tsc -b` 和 Dashboard 生产构建通过。
