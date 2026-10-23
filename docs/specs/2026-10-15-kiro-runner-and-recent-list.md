# Kiro Runner 与工作台最近对话列表设计

## 目标

1. 在 ACP 设置中加入 Amazon Kiro CLI 内置 Runner。
2. 将工作台侧栏「任务」标题改为「最近」，并按对话时间从新到旧排列。

## 已确认

- Runner 为 Kiro CLI；其官方 ACP 启动命令是 `kiro-cli acp`。
- Kiro Runner 按已确认方案作为内置项提供，默认关闭、`trusted=false`，沿用 `update_detail` 解析模式。
- 工作台侧栏最近列表时间以 `last_active` 为准；空对话（`last_active=0`）回退 `created_at`。同一时间按 `thread_id` 倒序稳定排列。
- 最近列表继续尊重现有项目、文件夹筛选；主列表和展开后的归档列表分别按同一时间规则倒序，列表排序不修改服务端线程数据。

## 方案与取舍

### Kiro Runner

1. **推荐：注册为内置 Runner。** 在服务端补充默认运行配置和内置防删除名册；ACP 页面补充顺序、名称和中英文介绍，使用现有通用 Runner 图标；更新默认配置断言。现有用户配置会在缺少该键时通过默认合并自动获得该 Runner。
2. 仅在前端增加展示卡并要求用户手动录入命令。虽然服务端改动少，但会出现没有默认配置的空卡，重复已有内置 Runner 的使用方式，故不选。

### 最近列表

1. **推荐：在工作台现有过滤结果上按线程时间排序。** 改动局限于工作台视图，不改 API，也不影响其他聊天列表的置顶/排序语义。
2. 改后端线程列表 API 的排序。服务端已经有时间排序，但它还优先置顶项；变更会影响其它调用方，超出此处 UI 请求范围，故不选。

## 涉及位置

- `src/octop/infra/agents/settings/acp.py`：Kiro 默认命令和参数。
- `src/octop/api/routers/acp.py`：将 `kiro_cli` 纳入内置项保护。
- `tests/unit/agents/test_acp_settings.py`：验证默认配置与安全状态。
- `dashboard/src/pages/Agent/ACP/constants.ts`、`dashboard/src/locales/{zh,en}.json`：卡片排序、标签、简介；使用现有通用图标。
- `dashboard/src/pages/Home/index.tsx`、`dashboard/src/locales/{zh,en}.json`：最近列表标题和时间排序。

## 失败场景与验证设计

- Kiro CLI 未安装或未登录：默认关闭，用户启用前可先在本机安装并登录；Octop 不会自动启动它。
- 已保存的用户 Runner 配置不包含新键：默认合并仍展示 Kiro；已有同名用户配置继续优先，避免覆盖其配置。
- 新建空对话没有活动时间：使用 `created_at` 排序，不沉到已活跃对话之后。
- 多条对话时间相同：以 `thread_id` 作确定性次序，避免刷新后列表跳动。
- 项目、文件夹和归档筛选：先按现有规则筛选，再在各自结果内按时间倒序排列。
- 验证计划：检查 ACP 默认值和双语键；检查工作台活动/空对话排序、并列时间和筛选不变；运行前端类型检查。按本次会话的运行约束，不执行测试套件。

## 不包含

- 不接入 Amazon Q Developer；用户已选择 Kiro CLI。
- 不下载或新增品牌图片；沿用现有通用 Runner 图标。
- 不改变服务端线程 API、数据库、聊天历史数据或现有聊天页排序。
- 不改变 Runner 的认证、权限机制；Kiro 首次启用仍由用户负责安装、登录并审阅其 CLI 权限。
