# 入院登记智能语音对话跨页保持实施计划

> **给执行者：** 按步骤勾选，在本会话逐步执行；保持 RED → GREEN 节奏。当前工作区有其他未提交改动，实施时只编辑本计划列出的相关文件，不提交。

**目标：** 首页麦克风启动入院办理后保持智能语音对话框跨页显示，并允许从身份核验页对话框触发现有模拟刷卡流程。

**非目标（Out of Scope）：** 不改变首页文字入口、不改身份认证或申请单 API、不绕过身份核验、不增加数据持久化、接口、Dashboard 核心功能。

**架构要点：** App 记录当前办理流程是否由首页麦克风入口发起，只有该流程在 `begin()` 中保持对话框可见。`ConversationDialog` 增加身份核验页专用提示及按钮，该按钮只发出事件，由 App 调用既有 `verifyIdentity()`。关闭对话框、重置或到达结果页时清除跨页保持状态。

**技术栈/运行方式：** Vue 2 + Element UI + Vitest。测试命令使用 `npm test -- tests/app-flow.test.js`、`npm test -- tests/full-workflow.test.js`；类型检查 `npm run typecheck`；生产构建 `npm run build`，工作目录均为 `demos/admission-registration/frontend/`。

**关联设计文档：** `demos/admission-registration/docs/specs/2026-10-20-voice-conversation-persistence-design.md`

---

## 文件变更清单

- 修改：`demos/admission-registration/frontend/src/App.vue`（记录语音办理来源、决定跨页显示、用同一身份提示驱动 TTS 与弹窗、连接 `verifyIdentity()`、清理关闭/结果/重置状态）。
- 修改：`demos/admission-registration/frontend/src/components/ConversationDialog.vue`（身份页提示、模拟刷卡按钮和核验中禁用态）。
- 测试：`demos/admission-registration/frontend/tests/app-flow.test.js`（身份页对话框控件和关闭入口）。
- 测试：`demos/admission-registration/frontend/tests/full-workflow.test.js`（语音/文字入口差异、调用核验门禁、跨页和重复点击）。

## 任务列表

### 任务 1：先锁定语音与文字入口的区别及身份页按钮门禁

**涉及文件：**
- 修改：`demos/admission-registration/frontend/tests/full-workflow.test.js`

- [x] **步骤 1：添加首页麦克风启动的完整身份页用例**

在 `complete admission workflow` 中新增测试，使用已有 `mountApp()`、`startHomeRecording()`、`toggleHomeRecording()`、`settle()` 和 `recorder` 辅助设施：

```js
it("keeps the home voice conversation open for identity verification", async () => {
  const wrapper = mountApp();
  api.platform.mockResolvedValueOnce({ active: true });
  api.upload.mockResolvedValueOnce({ text: "我要办理入院登记" });
  api.intent.mockResolvedValueOnce({
    intent: "begin_admission",
    reply: "请先完成身份核验。",
  });

  await startHomeRecording(wrapper);
  await toggleHomeRecording(wrapper);
  await recorder.options.onComplete(new Blob(["voice"]), false);
  await settle(wrapper);

  expect(wrapper.vm.page).toBe("identity");
  expect(wrapper.vm.conversationVisible).toBe(true);
  const dialog = wrapper.findComponent({ name: "ConversationDialog" });
  expect(dialog.text()).toContain(
    "请将证件放置到读卡区，然后点击“模拟刷卡”。",
  );

  api.verify.mockResolvedValueOnce({
    identityToken: "identity-demo-token",
    fields: validFields(),
  });
  api.applications.mockResolvedValueOnce({ items: [application()] });
  await dialog.find(".conversation-dialog__verify-identity").trigger("click");
  await settle(wrapper);

  expect(api.verify).toHaveBeenCalledOnce();
  expect(wrapper.vm.page).toBe("applications");
  expect(wrapper.vm.conversationVisible).toBe(true);
  wrapper.destroy();
});
```

- [x] **步骤 2：运行新用例并确认 RED**

运行：`npm test -- tests/full-workflow.test.js -t "keeps the home voice conversation open for identity verification"`

预期：失败，当前 `begin()` 会将 `conversationVisible` 置为 `false`，且 `ConversationDialog` 尚无 `.conversation-dialog__verify-identity` 控件。

- [x] **步骤 3：增加手动入口与用户收起的回归断言**

在已有 `sends manual home input through the same intent classifier` 测试中，在页面切换后断言 `conversationVisible` 为 `false`。另加一条语音流程核验待处理时关闭弹窗的测试：身份页仍保持，核验 AbortSignal 被标记为 aborted，迟到的成功响应不得转到申请单页。

- [x] **步骤 4：确认 RED 仅来自待实现行为**

运行：`npm test -- tests/full-workflow.test.js -t "keeps the home voice conversation open for identity verification|sends manual home input through the same intent classifier"`

预期：现状下语音用例失败；手动用例原有断言继续通过，新增断言能证明文字入口不持久在线。

### 任务 2：实现语音来源保持及身份页模拟刷卡控件

**涉及文件：**
- 修改：`demos/admission-registration/frontend/src/App.vue`
- 修改：`demos/admission-registration/frontend/src/components/ConversationDialog.vue`
- 修改：`demos/admission-registration/frontend/tests/app-flow.test.js`
- 修改：`demos/admission-registration/frontend/tests/full-workflow.test.js`

- [x] **步骤 1：在 `ConversationDialog` 添加身份核验提示和按钮**

增加 `identity`、`identityPrompt`、`verifying` props。身份页显示指定提示，并渲染带 class `.conversation-dialog__verify-identity` 的按钮；按钮处于 `verifying` 时禁用，只 `$emit('verify-identity')`，不修改身份 token 或页面状态。给按钮加 `aria-label="模拟刷卡"`，可见文本使用“模拟刷卡”。对身份页的首条消息禁用默认首页问候语，避免遮住或替代核验提示。

- [x] **步骤 2：在 App 记录本次办理由麦克风入口启动**

新增 `voiceConversationOrigin: false` 状态。只在 `page === 'home'` 时由 `openHomeVoiceInput()` 置为 `true`；只在 `page === 'home'` 时由 `openManualInput()` 清为 `false`，`handleShortcut()` 始终清为 `false`。`begin()` 将 `conversationVisible` 设为 `voiceConversationOrigin`，不再无条件关闭。新增 `closeConversation()`：若核验正在进行则增加 `generation` 并 abort `identityRequest`，然后清除来源状态并收起弹窗；将 `@close` 绑定到此方法。重置和进入结果页时也清除来源状态。

- [x] **步骤 3：把身份核验页状态传给现有对话框并复用核验方法**

在 `App.vue` 的 `ConversationDialog` 上绑定 `:identity="page === 'identity'"`、身份提示、`:verifying="verifying"` 和 `@verify-identity="verifyIdentity"`。身份提示原文为：`请将证件放置到读卡区，然后点击“模拟刷卡”。`；进入身份页时 TTS 播报同一句话，读卡卡片上的重播控件也复用此提示。不改 `verifyIdentity()` 的请求或成功/失败页面转移逻辑。

- [x] **步骤 4：为控件和状态清理补齐断言**

在 `full-workflow.test.js` 验证：身份页按钮调用真实 `verifyIdentity()` 并只调用一次；等待时按钮 disabled；成功后进入申请单页且弹窗仍开；关闭按钮中止未完成核验、迟到响应被丢弃；手动入口仍收起；`reset()` 清除来源标记。

- [x] **步骤 5：运行定向测试确认 GREEN**

运行：

```powershell
npm test -- tests/app-flow.test.js
npm test -- tests/full-workflow.test.js -t "keeps the home voice conversation open for identity verification|sends manual home input through the same intent classifier|discards a late home intent after the user resets the session"
```

预期：两个命令都以退出码 0 完成；手动入口收起、身份页按钮调用原认证 API，关闭弹窗或重置后过期请求均不能推进流程。

- [x] **步骤 6：运行 Demo 前端质量门禁**

运行：

```powershell
npm test
npm run typecheck
npm run format:check
npm run build:dashboard
```

结果：全套 Vitest 135 项通过、Vue TypeScript 检查通过、嵌入式 Vite production build 成功。`npm run format:check` 报告 35 个源/测试/配置文件有格式差异；其中包含大量本任务前已存在的未提交文件，因此未运行全目录格式写入。

## 质量门控

- [x] 源码改动限于本计划列出的前端源/测试文件；嵌入资源只通过 `npm run build:dashboard` 更新；未覆盖其他已有改动。
- [x] `git diff --check` 通过；检查了 `git status --short`，未暂存或提交。
- [x] 人工核对：仅首页麦克风入口建立语音来源状态；核验按钮只调用 `verifyIdentity()`；异步响应由 generation 校验保护。
