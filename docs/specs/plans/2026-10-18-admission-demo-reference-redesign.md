# 住院登记 Demo 参考图首屏改造实施计划

> **给代理执行者：** 在本会话内按任务完成实现与验证；每项使用 `- [ ]` 勾选跟踪。

**目标：** 将 Admission Demo 首屏改为用户参考图所示的五步医院自助终端，同时保留身份模拟、短信备用、AI 登记、语音及提交流程。

**架构要点：** 只改 Dashboard Admission Demo 路由、其样式、该路由测试和中英文 locale；复用现有 state handlers、语音 hook 和 API。识别设备、二维码与人脸都明确为 UI 演示，不增加真实核验能力或依赖。

**技术栈：** React 18、TypeScript、Ant Design、lucide-react、CSS；验证使用 `npx vitest run src/pages/AdmissionDemo`、`npx eslint src/pages/AdmissionDemo/index.tsx`、`npx tsc -b`、`npm run build`。

**关联设计文档：** `docs/specs/2026-10-18-admission-demo-reference-redesign.md`

**命令工作目录：** 以下 `npx` 与 `npm` 命令均从仓库的 `dashboard/` 目录运行。

---

## 文件与职责

- 修改：`dashboard/src/pages/AdmissionDemo/index.tsx` — 五步状态映射、首屏识别卡、短信备用入口、语音入口。
- 修改：`dashboard/src/pages/AdmissionDemo/index.css` — 参考图布局与终端风格。
- 修改：`dashboard/src/pages/AdmissionDemo/index.test.tsx` — 覆盖识别方式选择、模拟核验、短信 fallback 和五步流程。
- 修改：`dashboard/src/locales/zh.json` 与 `dashboard/src/locales/en.json` — 新增界面 copy，并保持 key 对齐。
- 新增：`dashboard/public/admission-demo/nurse-hero.png` — 无文字、无医院标识的护士欢迎区视觉素材。

### 任务 1：锁定身份入口与五步映射行为

涉及 `dashboard/src/pages/AdmissionDemo/index.test.tsx` 与 `index.tsx`。

- [ ] 先调整测试：首屏显示四种方式；选择卡片只改变选中项；模拟识别继续后才出现虚构患者信息；“不扫码也可办理”进入短信验证；短信错误码不泄露患者资料；首屏点击语音主入口调用 `speak` 播报身份识别指引，进入 `details` 后点击同一入口调用原语音 hook 的 `toggle`；每张识别卡的 `aria-pressed` 状态随选择更新。
- [ ] 运行 `npx vitest run src/pages/AdmissionDemo/index.test.tsx`，确认新增测试因缺少控件或行为而失败。
- [ ] 在 `index.tsx` 增加识别方式选择和短信备用视图状态；复用现有 `verifyIdentity`、`sendSms`、`verifySms`，不重复编写校验。
- [ ] 将步骤状态映射到 5 项并更新测试断言；运行 `npx vitest run src/pages/AdmissionDemo/index.test.tsx`，预期全部通过。

### 任务 2：搭建参考图首屏

涉及 `dashboard/src/pages/AdmissionDemo/index.tsx`、`index.css`、`dashboard/public/admission-demo/nurse-hero.png` 和中英文 locale。

- [ ] 增加护士无字透明插画资源，并以 `<img alt="">` 作为装饰内容；欢迎文案保持真实 DOM 文本。
- [ ] 将身份核验内容替换为四张可键盘操作的识别方式卡、模拟读卡区与显式演示警示；读卡 CTA 调用原 `verifyIdentity`。
- [ ] 右侧二维码区提供可点击短信入口；患者卡在核验前只显示占位提示，核验后复用当前虚构数据。
- [ ] 将底栏语音入口重排为参考图样式：`details` 阶段录音，其他阶段使用 TTS 朗读阶段指引；人工帮助按钮只提示当前为演示、不接通真实人员。
- [ ] 四种识别卡使用按钮语义和 `aria-pressed` 表示选中状态；卡片组可通过键盘切换。
- [ ] 将流程视觉改为五步名称；中英文 locale 键完全一致。
- [ ] 运行 `npx vitest run src/pages/AdmissionDemo`，预期所有定向测试通过。

### 任务 3：检查像素布局和交付构建

- [ ] 在浏览器 `http://127.0.0.1:5173/admission-demo` 检查 1110×764 和 1536×1024 两个尺寸；按设计文档所列 1536×1024 容器坐标核对各大区位置，差异不超过 8 px，确认欢迎区、四卡、右侧栏和底栏未重叠。
- [ ] 运行 `npx prettier --write src/pages/AdmissionDemo/index.tsx src/pages/AdmissionDemo/index.css src/pages/AdmissionDemo/index.test.tsx src/locales/en.json src/locales/zh.json`。
- [ ] 运行 `npx eslint src/pages/AdmissionDemo/index.tsx`、`npx tsc -b`、`npx vitest run src/pages/AdmissionDemo` 和 `npm run build`，记录退出码。
- [ ] 运行 `git diff --check`，确认本次文件无空白错误；不要提交或改动其他用户工作。
