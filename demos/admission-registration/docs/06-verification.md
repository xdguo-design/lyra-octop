# 06 · 文档与原型验证记录

日期：2026-10-19。交付范围：截图分解、PRD、页面原型、Vue 2 + Element UI 实现、Python 3.12 FastAPI 服务、共享字段合同与验收矩阵。

## 已完成的文档核对

- 对原图的首页、身份认证、入院登记、分页、语音、输入控件、字段表、对话约束进行了分区整理。
- P01–P05共5页；F01–F14共14字段；R01–R10共10项需求，逐项连接到页面与验收要求。
- 截图左右字段差异采用用户确认的并集；两页表单分别展示 F01–F08、F09–F14，末页直接确认提交；患者身份字段只读。
- 平台接口已对照当前源码核对：voice active/STT/TTS、admission-demo extract；医院mock方法由独立 API 实现。
- 现有AI结果只允许明确映射的联系电话、详细地址、紧急联系人姓名和关系；忽略只读证件、语义不明确的contact_name及紧急联系人电话。
- 设计审查发现的空闲计时覆盖、无档案状态操作、STT响应表格及“结果待确认”子状态均已纳入文档：弹出控件刷新活动，无档案仅人工/返回，STT明确nullable confidence，未知结果先查询不重提。
- Vue 2 页面位于 `frontend/`，FastAPI 服务位于 `backend/`；旧 React 入院 Demo 未修改。
- 前后端共同读取 `contracts/admission-fields.schema.json`，地区数据共用 `contracts/regions.mock.json`。后端另校验有效地区父子路径、身份只读快照和幂等键请求载荷。
- AI 每次只处理当前转写，不保存历史或转写；仅代理固定 Octop `/api/admission-demo/extract`，并校验白名单、候选原文、手机号唯一性、歧义和字段格式。页面只回填空值，冲突候选需患者确认。

## 验证方式

在 Python 3.12 环境执行 `python -m pytest`：14 passed；Ruff check/format 通过。前端 `npm test`：6 passed；`npm run typecheck`、`npm run format:check` 和生产构建通过。身份核验示意图仅以旁边缩略提示呈现，按需打开大图；独立“开始模拟核验”按钮触发 mock，相关流程测试通过。Vite 构建提示 Element UI bundle gzip 约326 KB。mock 身份失败、未知提交查询、过期身份及未登录 AI 拒绝有 API 测试覆盖；同一 mock 患者上次成功/结果未知时，新幂等键不能重提。

## 未执行与限制

本轮手工在 Vite 浏览器检查了身份核验页：读卡缩略提示位于核验文案旁，点击后在弹窗展示大图，独立按钮保留模拟核验操作。未做完整真实浏览器旅程、平台登录态/ASR/TTS/AI在线联调、麦克风硬件、医院业务或生产部署。AI、语音需 Octop 登录态；本地 Vite 与 Octop 不同端口时不能共享 localStorage token，应通过同源代理部署。Vue2 已 EOL；身份和幂等 mock 状态仅驻留进程内存，重启即清除。本交付仅为原型，不用于真实住院登记。

## 2026-10-19 补充：缺陷修复后的回归

针对 `09-gap-analysis.md` 的确认问题完成修复后回归：后端 pytest 19/19、前端 vitest 41/41（新增键盘 anchor 回归用例）、ruff、vue-tsc、prettier 全过。Playwright + Edge 真鼠标点击补上了此前缺失的"完整真实浏览器旅程"：P01→P05 全流程跑通并出 `SIM-` 回执；数字键盘真实点击可打开、可输入 11 位、点面板外关闭；三级级联可选到 广东省/佛山市/禅城区；首页/表单页底栏显示用户条、身份页不显示；语音播报失败改为内联提示、不再有全局 toast 遮挡头部。仍未覆盖：平台 ASR/TTS/AI 在线联调（需 Octop 登录态）、真实麦克风、生产部署。
