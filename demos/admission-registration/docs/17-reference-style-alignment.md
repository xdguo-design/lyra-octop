# 自助机原型样式对齐（2026-10-21）

## 1. 问题拆解（第一性原理）

目标是对齐用户提供的自动机交互图及底栏局部图，改善当前页的字号、按钮尺寸和录音反馈。原有自然长页、阶段门禁、脱敏、倒计时及语音接口继续使用。假设本轮只调整语音展示，保持已有按住手势；参考图中的固定姓名、电话不作为业务数据。

实际差异：原底栏只有倒计时和退出；620px 页面快捷问题字号12px、时间8px偏小；首页底栏负边距挤入语音区；录音使用深色遮罩与蓝色横条。

## 2. 方案对比与选型

| 路径 | 代价 | 结论 |
| --- | --- | --- |
| 调整现有 Vue 组件、CSS 渐变与关键帧，复用真实音量回调 | 不增加依赖、不改变语音协议 | 采用，足以复现圆形麦克风、光圈及波形 |
| 引入动画库或新建一套录音组件 | 增加依赖和状态同步，仍要接入现有录音器 | 当前无必要 |

## 3. 对抗性测试设计

- 窄屏挤压：319px检查横向溢出和底栏是否换行；显式使用单行 flex，身份信息允许省略，倒计时数字和操作保留。
- 未核验或敏感信息泄露：没有患者时不显示原型固定资料；有资料时只渲染脱敏姓名、电话，组件测试断言原手机号不存在。
- 提交中误操作：底栏全部操作随提交禁用；首页及退出沿用已有确认机制，不直接清空资料。
- 静音、取消与授权等待：波形高度由真实音量驱动；实际录音开始才显示光圈，上滑取消变红，松手后收起。现有手势测试验证发送、取消、误触和清理。
- 减少动态效果偏好：`prefers-reduced-motion` 停止扩散动画。未新增录音循环或音频资源。

## 4. 完整代码与配置

- `frontend/src/components/BottomBar.vue`：返回、首页及用户胶囊，复用脱敏工具。
- `frontend/src/components/VoiceHoldOverlay.vue`、`VoiceWaveform.vue`：光圈、麦克风、音量波形及取消配色。
- `frontend/src/components/VoiceStage.vue`：提示与实际按住手势一致。
- `frontend/src/App.vue`：绑定当前患者、原导航事件及实际录音状态。
- `frontend/src/style.css`：按钮尺寸、字体、底栏布局与录音动效。
- `frontend/tests/bottom-bar.test.js`、`voice-stage.test.js`、`voice-hold.test.js`：身份展示、禁用、手势和反馈回归。

复用现有 README、package.json、锁文件、Vite/Vitest/TypeScript 配置、环境变量及忽略规则。本轮没有新增服务、依赖、环境变量或部署单元，因此不新增 Docker/CI 配置。

## 5. 运行与验证步骤

在仓库根目录执行：

```powershell
cd demos/admission-registration/frontend
npm test -- --reporter=dot --maxWorkers=2
npm run typecheck
npx prettier --check src/components/BottomBar.vue src/components/VoiceHoldOverlay.vue src/components/VoiceWaveform.vue src/style.css tests/bottom-bar.test.js tests/voice-hold.test.js --single-quote --no-semi --trailing-comma es5 --print-width 100
npm run build:dashboard
```

嵌入构建更新平台静态产物。重新打开创作页内的登记应用以加载新资源；无需修改平台后端。独立本地开发沿用 README 中的 `npm run dev`。

浏览器覆盖319px窄屏及620px内容宽度；录音视觉用临时组件预览及合成音量检查，不采集或上传真实音频。临时预览页验收后移除。截图保存在 `e2e/artifacts/reference-*-20261021.png`。

验证结果：11个测试文件、195项前端回归通过；最后调整波形外观后，底栏与语音相关23项复跑通过。Vue类型检查、涉及文件Prettier检查及嵌入构建通过。319px视口的文档宽315px、快捷按钮高42px、底栏圆按钮30px；620px视口文档宽616px、底栏高40px，无横向溢出。浏览器实测进入办理后点首页显示退出确认，取消确认仍保留当前阶段。

## 6. 已知限制与后续改进

本轮不将按住录音改成原型中的点击开关，也不注销外层平台账号。截图用于样式验收，不代表真实麦克风、云端 ASR 或医院接口验收。未执行全仓 `make all`，避免其格式化步骤改写大量其他任务的预存修改。

## 补充参考：手动修改及语音回填布局

用户补充自助机主流程图，并确认参考第5栏的展示布局，保留现有操作逻辑。仅使用参考图的分组、标题、控件排列与结果表格，不替换现有14字段，也不增加“确认填入”步骤或新的业务弹窗。

复用现有 `AdmissionForm`、`ReviewPanel`、`ConversationDialog` 的字段及编辑入口，以 CSS 调整浅蓝标题栏、白色内容区和双列字段行；不另建表单或语音结果状态。手动表单控件高34px、主操作高42px；婚姻四项一行，职业六项两行。核对页编辑按钮添加隐藏于辅助技术的装饰图标，保留原按钮可访问名称。“AI 解析”及其它已确认标题继续使用原文案。

验证重点为窄屏职业选项溢出、长字段名/地址换行、编辑模式下的控件宽度，以及展示样式是否影响字段值与提交流程。沿用上节测试命令；195项回归最终复跑通过，类型、涉及文件格式检查和嵌入构建通过。第一次回归195项用例均过，但环境销毁后出现一次 Element UI `restoreBodyStyle` 延迟回调访问已销毁 `document` 的异常；同命令复跑正常，未修改业务或依赖来掩盖异常。

临时组件预览使用合成资料，319px与620px均无横向溢出，14字段及两组分区完整，原编辑入口可打开控件。截图为 `e2e/artifacts/reference-manual-{319,620}-20261021.png`、`reference-edit-319-20261021.png`、`reference-voice-result-319-20261021.png`。临时预览页验收后移除；未重做真实麦克风或云端识别测试。
