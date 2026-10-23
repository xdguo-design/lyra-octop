# 语音服务配置弹窗注册链接设计

## 目标

用户点击语音服务卡片的“配置”后，可以从弹窗直接进入对应服务商的官方注册/开通入口。所有需要填写凭证的语音服务都应提供入口。

## 现状与范围

语音设置页通过服务商 `kind` 渲染配置抽屉。当前需要凭证并有配置抽屉的服务商是腾讯云、豆包、OpenAI 和 Xiaomi MiMo；MiMo 的 STT 与 TTS 共用服务商入口。Browser Native 与 Edge TTS 不需要账号或凭证，也没有同类配置抽屉，因此不增加注册链接。

## 方案

在配置抽屉现有服务说明下方、凭证表单上方放置一条“注册/开通官方服务 ↗”链接。链接按服务商静态映射，点击后在新标签页打开，并设置 `rel="noopener noreferrer"`：

| 服务商 | 官方注册/开通入口 |
| --- | --- |
| 豆包（火山引擎） | `https://signin.volcengine.com/auth/signup` |
| 腾讯云 | `https://cloud.tencent.com/register` |
| OpenAI | `https://platform.openai.com/` |
| Xiaomi MiMo | `https://platform.xiaomimimo.com/` |

不同厂商的 STT/TTS 卡片复用相同服务商链接。入口文案通过 Dashboard 现有中英文 i18n 管理。注册链接不包含密钥、用户身份或查询参数。

这些地址来自服务商官方注册说明或官方 API 平台入口：[火山引擎账号注册](https://docs.volcengine.com/docs/account_related/Accountregistrationprocess?lang=zh)、[腾讯云账号注册](https://cloud.tencent.com/document/product/378/17985)、[OpenAI API Platform](https://platform.openai.com/)、[小米 MiMo 开放平台](https://mimo.mi.com/docs/zh-CN/quick-start/faq/others)。

## 备选方案

1. **每个服务商一个官方注册/开通入口（推荐）**：满足当前需求，抽屉占用和维护成本最低。
2. 每家显示注册入口及 API Key 操作文档两个链接：指引更完整，但比用户要求多出内容，且增加链接维护成本。

## 数据流与安全

链接只在前端配置抽屉中展示，不新增后端字段/API，也不改变凭证创建、更新、探测或服务启用逻辑。外链在新标签打开；使用 `noopener noreferrer` 隔离新页面，不透传当前站点信息。API Key 仍只提交到 Octop 后端，不进入链接或浏览器地址栏。

## 验收与验证

- 腾讯云、豆包、OpenAI、MiMo 的每个配置抽屉均显示一个对应的官方入口。
- 同一 MiMo 入口适用于 STT 与 TTS；豆包入口适用于 STT 与 TTS。
- 点击链接打开对应新标签，不关闭或重置配置抽屉中的表单。
- 前端测试断言各服务商链接的 `href`、`target`、`rel`，并确认链接可通过键盘聚焦。
- Browser Native 与 Edge TTS 仍保持现有无凭证流程。
- 中英文界面均显示可理解的链接文案。
- 运行语音设置相关前端测试和 Dashboard TypeScript 检查。

## 失败场景与防护

- 服务商改版导致入口迁移：链接集中在单一映射并用官方文档来源核对；若失效可局部更新 URL。
- 外链页面被利用尝试访问原窗口：新标签链接带 `noopener noreferrer`。
- 配置抽屉同时展示多个 capability 卡片导致重复条目：链接按 `kind` 映射，内容只在共享配置抽屉渲染一次。
