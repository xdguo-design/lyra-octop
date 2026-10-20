# 入院登记 Demo 加入创作页

## 目标

让用户能从 Octop 的“创作”页面发现并打开现有住院登记 Demo。

## 约束

- 使用现有 `/admission-demo` SPA 路由及认证/权限行为。
- “创作”页继续只展示平台、应用/小程序、网站/服务和代码仓库，不展示 Agent。
- 不新增 API、数据库记录或 iframe 嵌套。
- 中英文名称与说明使用现有 dashboard locale。

## 方案

将 Demo 添加到 `BUILT_IN_CREATIONS` 内置作品目录，并把内置卡片分类类型扩展为可使用现有 `applet` 分类值。卡片带有平台内 `route`，点击时导航至 `/admission-demo`；其他内置 app 保持现有页内打开行为。复用已有搜索、分类、收藏与归档能力。

不采用用户手动登记一个网址的方式，因为该 Demo 已有稳定的平台内路由，手动 URL 会引入环境配置和 URL 失效问题。也不嵌入 iframe，以免重复渲染平台外壳并干扰语音权限/布局。

## 数据流与行为

创作页加载内置作品列表 → 通过现有分类/关键词筛选展示“住院登记 Demo” → 点击卡片缩略区域或主要打开按钮 → `navigate('/admission-demo')` → 由现有路由显示 Demo。

## 验收与防护

- 创作页出现本地化 Demo 卡片；`applet` 分类及关键词搜索均可筛到。
- 点击入口跳转至 `/admission-demo`，不创建 iframe，不调用外部窗口。
- 其余内置 app（包括星球乐园）的既有打开行为保持不变。
- 定向 Vitest、Dashboard TypeScript 检查和 `git diff --check` 通过。

## 已知边界

Demo 是否可打开仍由平台现有认证和路由保护决定；本改动只提供发现入口，不改变权限或 Demo 本身的模拟数据边界。
