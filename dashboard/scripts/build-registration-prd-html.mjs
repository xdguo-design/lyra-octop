import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const prdRoot = path.join(
  dashboardRoot,
  "src/pages/EhrWorkbench/registration-prd",
);
const outputPath = path.join(prdRoot, "挂号PRD.html");

const chapters = [
  ["index", "文档导航", "00-文档索引.md"],
  ["requirements", "产品需求与功能基线", "01-产品需求与功能基线.md"],
  ["interactions", "页面与交互规格", "02-页面与交互规格.md"],
  ["data", "领域数据与接口实现规格", "03-领域数据与接口实现规格.md"],
  ["rules", "业务规则与流程控制", "04-业务规则与流程控制.md"],
  ["acceptance", "技术集成与验收测试", "05-技术集成与验收测试.md"],
  ["issues", "需求决策与跟踪 Issues", "RegistrationIssues.md"],
];

const demoPages = [
  { id: "P01", title: "窗口挂号 / 号源", defaultAction: "E-01" },
  { id: "P02", title: "收费交接", defaultAction: "E-21" },
  { id: "P03", title: "预约取号", defaultAction: "E-23" },
  { id: "P04", title: "挂号分诊", defaultAction: "E-27" },
  { id: "P05", title: "建卡档案", defaultAction: "E-35" },
];

const targetStatusByAction = {
  "E-03": "跨收费域动作；遵循收费 PRD 契约",
  "E-21": "Q-01 双提交路径待关闭",
  "E-24": "Q-03 取消预约落库待关闭",
  "E-25": "Q-02 预约取号提交链待关闭",
  "E-A02": "Q-05 跨包锁时机待核",
  "E-A03": "003 补充项；默认不触发，待业务确认",
};

const methodDetailsByAction = {
  "E-01": [
    "在 P01 选科室、医生、号别和急诊条件后查询。",
    "020 通过 GET patad/amb/schedule/list/regist 查询；AmbSchedulingRegMapper.listForRegist 读取 AMB_SCHEDULING_REG，关联 AMB_TIME_DESCRIBE 与号类/价目字典，返回排班、号额、剩余数和可见时段。科室候选列表本身的来源尚未从证据确认。",
    "只刷新页面号表，不占号。",
    "E-15 选择号源；E-14 提交挂号。",
  ],
  "E-02": [
    "点击清空或按 Delete。",
    "清除当前查询条件和号源选择态，按默认条件重新读排班。",
    "目标版本只清空选择态；不改服务端号额。",
    "回到 P01 默认查询状态。",
  ],
  "E-03": [
    "有挂号上下文时按 F1（003）/F3（020）进入收费工作台。",
    "读取当前患者、挂号和收费上下文。",
    "打开门诊收费模块，不创建收费记录。",
    "收费后按收费包契约回到挂号流程。",
  ],
  "E-04": [
    "读卡设备就绪后点击身份证读卡。",
    "设备读取证件号，再以证件号查询患者主索引。",
    "仅回填候选患者；多命中需人工选择。",
    "患者确认后进入 E-14 前置校验。",
  ],
  "E-05": [
    "扫码枪就绪后点击电子凭证读卡。",
    "读取电子凭证并调用医保/凭证适配器解析身份。",
    "将解析出的患者身份回填患者区。",
    "回填后按 E-08/E-14 继续核验。",
  ],
  "E-06": [
    "选择职工医保费别 07 后点击刷脸。",
    "通过医保设备读取身份并调用刷脸识别适配器。",
    "识别成功回填患者；费别不符时阻断。",
    "身份核对后按 E-14 继续。",
  ],
  "E-07": [
    "先选费别，再点击读医保卡。",
    "按费别调用对应医保卡/工伤读卡适配器。",
    "回填医保卡身份；不直接创建挂号。",
    "患者身份确认后进入 E-14。",
  ],
  "E-08": [
    "在卡号/证件框输入值并回车。",
    "按卡类型、卡号查询 ACTIVE 患者主索引；多命中返回候选。",
    "单命中回填患者资料，多命中要求人工选中。",
    "唯一患者确定后可以选号并提交。",
  ],
  "E-09": [
    "点击高级查询并填写患者/日期条件。",
    "默认近 1 个月查询历史挂号和患者记录。",
    "在历史列表显示结果，不自动覆盖当前患者。",
    "选中一条记录后回填或打开对应挂号详情。",
  ],
  "E-10": [
    "P01 点击建卡，进入 P05。",
    "带入当前已识别患者和证件信息。",
    "只打开建卡表单，不新建档案。",
    "P05 完成查重后才允许 E-35 保存。",
  ],
  "E-11": [
    "点击三无人员；仅在 Patad_IsNoMessageUp=0 时开放。",
    "读取三无开关和当前建档表单。",
    "生成免卡号临时档案标记（withoutType=1），并记录生成时间。",
    "完成必填项后按 P05 建卡规则提交。",
  ],
  "E-12": [
    "已定位患者后按 F5 修改资料。",
    "带患者主索引和当前查询条件打开患者域编辑页。",
    "保存后更新患者资料并回填 P01；chargeLock=1 时拒绝修改。",
    "返回 P01，继续选号/挂号。",
  ],
  "E-13": [
    "健康卡开关开启时点击绑定或读取健康卡。",
    "读取健康卡号并查询绑定阶段/患者关联。",
    "建立患者与健康卡绑定关系；失败显示原因。",
    "绑定成功回到患者区，可继续挂号。",
  ],
  "E-14": [
    "确认患者、选择号源后点击挂号或双击号表。",
    "校验必填、资格、重复挂号、临床限制和号源；按费别选择挂号命令分支。",
    "通过后进入 P02；此步本身不表示已收费成功。",
    "先执行 E-A01/E-A06/E-A07 等前置，再由 E-21 确认事务。",
  ],
  "E-15": [
    "在 P01 号表选中或取消号源行。",
    "读取所选排班和剩余号额用于展示选择状态。",
    "目标版本只维护前端选择态；003 旧实现曾对剩余数做 ±1 更新，不继承该并发风险。",
    "选择完成后由 E-14 再次服务端校验号额。",
  ],
  "E-16": [
    "在已挂表行内点击退号。",
    "读取挂号状态、收费、诊断/医嘱和电子票据入账情况；按 BR-11/BR-13 校验。",
    "未收费路径置 BACK_REGIST 并释放号额/坑位；已收费转退费和医保反结算包。",
    "成功刷新已挂表；E-A03 推送默认关闭。",
  ],
  "E-17": [
    "点击查询已挂或我的挂号。",
    "按患者、发票、时间、科室等条件查询已挂记录。",
    "刷新 P01 已挂列表和 020 关键状态列。",
    "行内可继续 E-16/E-18/E-19/E-20。",
  ],
  "E-18": [
    "已挂号记录点击补打指引单。",
    "读取挂号及就诊流水信息组装打印内容。",
    "调用打印适配器输出指引单，不修改挂号状态。",
    "打印成功提示完成；失败保留可重试提示/留痕。",
  ],
  "E-19": [
    "已收费记录点击原号重打。",
    "读取原挂号/收费票据信息及重打资格。",
    "调用发票重打接口并记录操作留痕。",
    "返回已挂列表；留痕失败须提示，不可静默当成功。",
  ],
  "E-20": [
    "有中药处方的挂号记录点击代煎。",
    "读取处方与挂号关联信息并校验处方资格。",
    "向药房域登记代煎请求；本包不维护药房执行状态。",
    "显示跨域受理结果并保留挂号上下文。",
  ],
  "E-21": [
    "P02 发票和支付方式校验通过后点击确认收款。",
    "提交患者、号源、费别、支付条目、发票信息及 visitCode。",
    "执行窗口挂号事务：占号、写挂号/序号/分诊、收费结算和票据；失败按 BR-10 整体回滚。",
    "成功返回 P01 刷新已挂区并打印；Q-01 提交路径未关闭前只作目标流程说明。",
  ],
  "E-22": [
    "打开 P02 时自动预检查，或查看发票状态。",
    "按操作员和号别读取当前票据号及可用余量。",
    "余量不足时阻断确认收款；不写收费数据。",
    "校验通过才启用 E-21。",
  ],
  "E-23": [
    "P03 选择患者、号源并点击预约。",
    "校验必填、证件、号源可用性和重复预约。",
    "目标接口创建预约记录并返回预约状态。",
    "刷新已预约列表；可执行 E-24，待决状态需按 Q 项标注。",
  ],
  "E-24": [
    "P03 已预约行点击取消。",
    "读取预约记录及可取消状态。",
    "目标是持久化取消预约；020 现有空实现，Q-03 关闭前原型只改本地状态。",
    "刷新预约列表并展示取消结果，不能把本地模拟当成落库成功。",
  ],
  "E-25": [
    "选择预约记录后点击取号。",
    "目标链读取预约、患者、排班和可用号额。",
    "目标是创建 NO_CLINIC 挂号并进入结算；Q-02 未关闭，当前原型禁用此成功操作。",
    "链路确认后才进入收费/挂号事务并刷新预约与已挂列表。",
  ],
  "E-26": [
    "管理岗在排班树选择记录后执行批量管理。",
    "读取排班、预约清单和逐条操作状态。",
    "按选中项批量取消/导出；逐条返回结果，部分失败不得整体伪报成功。",
    "刷新管理列表并展示成功、失败明细。",
  ],
  "E-27": [
    "分诊台选定站点和号别后对挂号记录执行分诊。",
    "读取分诊台权限、号别、挂号状态和可用坑位。",
    "创建分诊队列记录；按配置占用坑位。",
    "刷新队列，失败时提示缺少分诊台/号别或权限。",
  ],
  "E-28": [
    "对已分诊记录点击取消分诊。",
    "读取队列状态、挂号和坑位占用。",
    "取消队列记录并释放 REG_TAKE_FLAG 坑位。",
    "刷新队列并恢复可分诊状态。",
  ],
  "E-29": [
    "对已挂号患者点击报到。",
    "读取挂号及分诊记录并校验当前状态。",
    "更新签到/报到状态。",
    "刷新患者队列状态并显示已报到。",
  ],
  "E-30": [
    "有排班权限时在号表操作列开诊或停诊。",
    "读取排班当前状态及已挂患者数量。",
    "更新排班开停诊状态；停诊时校验已挂患者处置。",
    "刷新号表状态并展示阻断/成功反馈。",
  ],
  "E-31": [
    "分诊台输入加号数量并保存。",
    "读取排班号额、权限和本次增加数量。",
    "调用现场加号接口增加可用号额。",
    "刷新号表余量并展示新号额。",
  ],
  "E-32": [
    "对已就诊队列记录点击复诊。",
    "读取原就诊/分诊记录和当前排班队列。",
    "生成新的队列序号/复诊队列记录。",
    "刷新队列并显示新序号。",
  ],
  "E-33": [
    "对队列记录执行插队/顺序调整。",
    "读取队列当前顺序、目标位置及操作权限。",
    "更新队列顺序；需按队列规则保证序号一致。",
    "刷新队列并反馈新顺序。",
  ],
  "E-34": [
    "点击分诊队列刷新。",
    "按 stationCode 查询号表及分诊队列。",
    "只刷新列表，不改队列状态。",
    "更新 P04 号表/队列视图。",
  ],
  "E-35": [
    "P05 填写必填资料、查重无匹配后保存。",
    "先读患者主索引查重，再按院区卡号规则取可用卡号。",
    "创建患者卡和关联档案；重复候选时阻止保存。",
    "成功回填 P01 患者区；失败保留表单并显示原因。",
  ],
  "E-36": [
    "对可注销的患者卡点击退卡。",
    "读取卡状态、关联患者和是否存在不可退限制。",
    "将卡置注销状态并保留操作记录。",
    "刷新卡列表/患者信息；已注销卡不可重复退卡。",
  ],
  "E-A01": [
    "E-14 分流后由系统自动获取 visitCode。",
    "按 lockUser 查询全院就诊流水号及锁定状态。",
    "锁定并将流水号写入挂号 VO；获取失败阻断挂号。",
    "流水号随 E-21 事务关联挂号记录。",
  ],
  "E-A02": [
    "收费事务开始/结束时由收费域自动加锁/解锁。",
    "按 visitCode 查询挂号记录及 CHARGE_LOCK 状态。",
    "更新 chargeLock，阻止并发患者资料修改；Q-05 锁时机待确认。",
    "事务结束释放锁；解锁失败进入查询/人工复核流程。",
  ],
  "E-A03": [
    "仅在业务确认并启用集成开关后，于退号成功后触发。",
    "读取退号记录及集成平台所需挂号引用。",
    "异步发送 JH0105；失败留痕补偿，不回滚退号。",
    "默认不调用，003 补充行为仍待业务确认。",
  ],
  "E-A04": [
    "窗口挂号事务内根据排班自动计算。",
    "读取排班、已有挂号序号、诊间间隔及当前时钟。",
    "生成 REGIST_NO/SEE_DATE 并写挂号记录；Q-20 字典/规则待确认。",
    "随 E-21 事务成功返回；唯一约束冲突应回滚。",
  ],
  "E-A05": [
    "启用坑位控制时，在挂号/分诊事务内自动执行。",
    "按排班、号别和看诊时刻查询最小可用坑位。",
    "条件更新坑位 REG_TAKE_FLAG=1；占用行数为 0 按规格拒绝。",
    "P04 刷新坑位状态；取消分诊/退号时释放。",
  ],
  "E-A06": [
    "E-14 费别分流时，对符合条件的医保患者自动触发。",
    "读取患者医保身份、费别和登记上下文。",
    "调用医保登记弹窗 busiType=01；医保写入归医保包。",
    "成功后回挂号流程；医保失败阻断，不伪报成功。",
  ],
  "E-A07": [
    "进入 P02 时按减免参数自动计算。",
    "读取患者身份、贫困/优抚标记、挂号费和减免参数。",
    "计算减免金额并映射支付方式；现金可置 0，金额由服务端复核。",
    "显示应收/减免明细，再由 E-21 确认；参数缺失按 BR-15 阻断。",
  ],
};

const legacyNames = new Map([
  ["00-文档索引.md", "index"],
  ["01-产品需求与功能基线.md", "requirements"],
  ["02-页面与交互规格.md", "interactions"],
  ["03-领域数据与接口实现规格.md", "data"],
  ["04-业务规则与流程控制.md", "rules"],
  ["05-技术集成与验收测试.md", "acceptance"],
  ["RegistrationIssues.md", "issues"],
]);

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function pageActionMap(markdown) {
  const mappingSection =
    markdown.split("## 动态原型与页面动作映射约定")[1]?.split("\n## ")[0] ?? "";
  const mappingRows = mappingSection
    .split(/\r?\n/)
    .filter((line) => /^\|\s*P0[1-5]/.test(line));
  const map = new Map();
  for (const line of mappingRows) {
    const [page, actionList] = splitMarkdownRow(line);
    const pageId = page.slice(0, 3);
    const tokens = actionList.match(/E-(?:A)?\d{2}(?:～E-(?:A)?\d{2})?/g) ?? [];
    for (const token of tokens) {
      const range = token.match(/^(E-(?:A)?\d{2})～(E-(?:A)?\d{2})$/);
      if (!range) {
        map.set(token, pageId);
        continue;
      }
      const start = range[1].match(/^E-(A)?(\d{2})$/);
      const end = range[2].match(/^E-(A)?(\d{2})$/);
      if (!start || !end || start[1] !== end[1]) continue;
      for (
        let number = Number(start[2]);
        number <= Number(end[2]);
        number += 1
      ) {
        const prefix = start[1] ? "E-A" : "E-";
        map.set(`${prefix}${String(number).padStart(2, "0")}`, pageId);
      }
    }
  }
  return map;
}

function parseActionRows(markdown) {
  const pageByAction = pageActionMap(markdown);
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\|\s*E-(?:A)?\d{2}\s*\|/.test(line))
    .map((line) => {
      const [
        id,
        title,
        trigger,
        precondition,
        legacyAction,
        success,
        failure,
        control,
      ] = splitMarkdownRow(line);
      return {
        id,
        title,
        trigger,
        precondition,
        legacyAction,
        success,
        failure,
        control,
        pageId: pageByAction.get(id) ?? "P01",
        targetStatus:
          targetStatusByAction[id] ?? "沿用 020 目标基线；参数/决议见 PRD 04",
        method: methodDetailsByAction[id],
      };
    });
}

function renderMarkdown(markdown) {
  return renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm] },
      markdown,
    ),
  );
}

function mapInternalLinks(html) {
  return html.replace(/href="([^\"]+\.md)"/g, (match, target) => {
    const chapterId = legacyNames.get(path.basename(target));
    return chapterId ? `href="#${chapterId}"` : match;
  });
}

const navigation = [
  '<a href="#prototype">动态交互原型</a>',
  ...chapters.map(([id, title]) => `<a href="#${id}">${title}</a>`),
].join("\n");
const interactionsMarkdown = await readFile(
  path.join(prdRoot, "02-页面与交互规格.md"),
  "utf8",
);
const demoActions = parseActionRows(interactionsMarkdown);
if (
  demoActions.length !== 43 ||
  demoActions.some((action) => !action.pageId || !action.method)
) {
  throw new Error(`Expected 43 mapped actions, received ${demoActions.length}`);
}
const actionData = JSON.stringify(demoActions).replaceAll("<", "\\u003c");
const demoPageTabs = demoPages
  .map(
    ({ id, title }) =>
      `<button type="button" class="demo-page-tab" data-page="${id}" aria-pressed="${
        id === "P01"
      }">${id} ${title}</button>`,
  )
  .join("\n");
const demoPageScreens = demoPages
  .map(
    ({ id, title }) => `<div class="demo-screen" data-screen="${id}" ${
      id === "P01" ? "" : "hidden"
    }>
      <header class="mock-window-header"><strong>潼南医院 · 门诊业务系统</strong><span>操作员：挂号窗口　<span class="connection-dot"></span>本地原型</span></header>
      <div class="mock-window-title"><h3>${id} ${title}</h3><span data-page-status>待操作</span></div>
      <div class="mock-flow ${
        id === "P01" || id === "P02" ? "workbench-flow" : ""
      }" data-flow="${id}"></div>
    </div>`,
  )
  .join("\n");
const prototype = `<section class="chapter prototype" id="prototype">
  <header class="chapter-heading"><span>交互原型 · 本地模拟</span></header>
  <h2>挂号业务动态原型</h2>
  <p>主工作台按门诊收费调用分析页的真实结构实现：左侧组件目录、中间调用图与文字树、右侧 003/020 源码和方法证据；可切换调用图、完整调用解说、方法逐层解读及可操作页面画布。点击画布控件后，分析台同步定位对应 PRD 动作；没有代码证据的动作明确显示 UNKNOWN。工作台中的页面数据只在浏览器本地模拟，不调用 HIS 写接口。</p>
  <iframe class="call-analysis-frame" src="./workbench/call-analysis.html" title="门诊挂号登记调用分析工作台" loading="eager"></iframe>
  <details class="all-actions-demo"><summary>展开 PRD 全部 43 个动作的本地流程演示</summary>
  <div class="demo-tabs" role="tablist" aria-label="挂号原型页面">${demoPageTabs}</div>
  <div class="analysis-view-tabs" role="tablist" aria-label="工作台视图">
    <button type="button" data-view="canvas" aria-pressed="true">页面画布</button>
    <button type="button" data-view="graph" aria-pressed="false">调用图视图</button>
  </div>
  <nav class="analysis-mode-tabs" role="tablist" aria-label="调用分析内容">
    <button type="button" data-mode="graph" aria-pressed="true">调用图</button>
    <button type="button" data-mode="full" aria-pressed="false">完整调用解说</button>
    <button type="button" data-mode="guide" aria-pressed="false">方法逐层解读</button>
  </nav>
  <div class="demo-layout">
    <aside class="action-directory"><header class="inspector-header"><strong>动作 / 事件目录</strong><span id="inspector-page">动作所属页面：P01</span></header><label class="sr-only" for="action-select">选择动作或查看方法</label><select id="action-select" aria-label="选择动作或查看方法"></select><div id="action-tree" class="action-tree" aria-label="动作方法树"></div></aside>
    <div class="workbench-center"><div id="canvas-workspace" class="demo-canvas">${demoPageScreens}</div><section id="graph-workspace" class="graph-workspace" hidden><header><strong id="graph-title">当前调用链</strong><span>由选中动作的 PRD 方法数据动态生成</span></header><div id="call-graph" class="call-graph" aria-live="polite"></div></section></div>
    <aside class="action-panel">
      <header class="inspector-header"><strong id="method-detail-title">业务方法详解</strong><span id="evidence-status">证据状态</span></header>
      <div class="analysis-mode-content" data-mode-content="graph"><h3>当前事件与方法</h3><div id="action-detail" class="action-detail" aria-live="polite"></div><h3>方法步骤</h3><div id="method-detail" class="action-detail" aria-live="polite"></div></div>
      <div class="analysis-mode-content" data-mode-content="full" hidden><h3>完整调用解说</h3><div id="full-explanation" class="action-detail" aria-live="polite"></div></div>
      <div class="analysis-mode-content" data-mode-content="guide" hidden><h3>方法逐层解读</h3><div id="method-guide" class="method-guide" aria-live="polite"></div><div id="guide-detail" class="action-detail"></div></div>
      <nav class="method-links" aria-label="方法规格引用"><a href="#interactions">02 页面动作定义</a><a href="#data">03 数据、接口与事务步骤</a><a href="#rules">04 状态、规则与参数</a><a href="#acceptance">05 流程与验收</a></nav>
    </aside>
  </div>
  <p class="demo-disclaimer">待确认动作和 003 补充行为会明确标记；原型可操作不代表真实功能已实现或验收。</p>
  </details>
</section>`;
const articles = await Promise.all(
  chapters.map(async ([id, title, filename]) => {
    const markdown = await readFile(path.join(prdRoot, filename), "utf8");
    return `<section class="chapter" id="${id}" data-title="${title}">
      <header class="chapter-heading"><span>PRD · ${title}</span></header>
      <article>${mapInternalLinks(renderMarkdown(markdown))}</article>
    </section>`;
  }),
);

const demoRuntime = `
    const actions = __ACTION_DATA__;
    const demoPages = __PAGES__;
    const state = { pageId:'P01', actionId:'E-01', methodIndex:0, view:'canvas', mode:'graph', patient:false, patientName:'', patientInput:'TN000028', schedule:false, scheduleQueried:false, selectedSchedule:'', dept:'内科', doctor:'全部医生', regClass:'普通号', visitDate:'2026-11-04', feeType:'自费', registration:'prepare', invoiceChecked:false, paymentMethod:'', appointment:'idle', appointmentDate:'', appointmentDept:'内科', triage:'waiting', station:'内科一诊区', triageClass:'普通号', card:'idle', cardName:'', cardId:'', cardSex:'女', cardPhone:'', notice:'' };
    const actionSelect = document.querySelector('#action-select');
    const actionDetail = document.querySelector('#action-detail');
    const methodDetail = document.querySelector('#method-detail');
    const escapeHtml=value=>String(value||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    function setAction(id) { state.actionId=id; state.methodIndex=0; actionSelect.value=id; renderAction(); }
    function appendRows(target,rows) { target.replaceChildren(); for (const [label,value] of rows) { const row=document.createElement('div'); const heading=document.createElement('strong'); heading.textContent=label; const content=document.createElement('span'); content.textContent=value||'—'; row.append(heading,content); target.append(row); } }
    function renderAnalysisModes() {
      document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===state.view)));
      document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===state.mode)));
      document.querySelector('#canvas-workspace').hidden=state.view!=='canvas';
      document.querySelector('#graph-workspace').hidden=state.view!=='graph';
      document.querySelectorAll('[data-mode-content]').forEach(panel=>panel.hidden=panel.dataset.modeContent!==state.mode);
    }
    function renderActionTree(action) {
      const tree=document.querySelector('#action-tree'); tree.replaceChildren();
      for(const page of demoPages){const group=document.createElement('section');group.className='tree-page';const heading=document.createElement('strong');heading.textContent=page.id+' '+page.title;group.append(heading);for(const item of actions.filter(row=>row.pageId===page.id)){const button=document.createElement('button');button.type='button';button.dataset.treeAction=item.id;button.setAttribute('aria-current',String(item.id===action.id));button.textContent=item.id+' · '+item.title;group.append(button);}tree.append(group);}
    }
    function renderMethods(action) {
      const labels=['怎么使用','查询/读取数据','数据操作/副作用','后续流程'];
      const renderTree=target=>{target.replaceChildren();action.method.forEach((value,index)=>{const button=document.createElement('button');button.type='button';button.dataset.methodIndex=String(index);button.setAttribute('aria-current',String(index===state.methodIndex));button.textContent=(index+1)+'. '+labels[index];target.append(button);});};
      renderTree(document.querySelector('#method-guide'));
      methodDetail.replaceChildren();action.method.forEach((value,index)=>{const row=document.createElement('button');row.type='button';row.className='method-step-row';row.dataset.methodIndex=String(index);row.setAttribute('aria-current',String(index===state.methodIndex));const heading=document.createElement('strong');heading.textContent=labels[index];const content=document.createElement('span');content.textContent=value;row.append(heading,content);methodDetail.append(row);});
      const activeLabel=labels[state.methodIndex];
      appendRows(document.querySelector('#guide-detail'),[['选中方法层级',activeLabel],['方法说明',action.method[state.methodIndex]],['业务动作',action.id+' · '+action.title],['前置条件',action.precondition],['下一步',action.method[3]]]);
      const nodes=[['事件触发',action.trigger],['前置校验',action.precondition],['读取/调用',action.method[1]],['业务操作',action.method[2]],['结果与后续',action.method[3]]];
      document.querySelector('#call-graph').innerHTML=nodes.map((node,index)=>'<div class="call-node"><span>'+(index+1)+'</span><strong>'+escapeHtml(node[0])+'</strong><p>'+escapeHtml(node[1])+'</p></div>').join('<i class="graph-arrow" aria-hidden="true">↓</i>');
      document.querySelector('#graph-title').textContent=action.id+' '+action.title+' · 调用链';
    }
    function renderAction() {
      const action=actions.find(item=>item.id===state.actionId);
      if (!action) return;
      document.querySelector('#method-detail-title').textContent='业务方法详解 · '+action.id+' '+action.title;
      document.querySelector('#inspector-page').textContent='动作所属页面：'+action.pageId+' · 当前原型页：'+state.pageId;
      document.querySelector('#evidence-status').textContent=action.targetStatus;
      appendRows(actionDetail,[['当前动作',action.id+' · '+action.title],['触发事件',action.trigger],['前置条件',action.precondition],['旧系统调用 / 实现证据',action.legacyAction],['成功结果',action.success],['失败反馈',action.failure],['权限/开关',action.control],['证据与决议状态',action.targetStatus]]);
      appendRows(document.querySelector('#full-explanation'),[['使用入口与触发',action.trigger],['前置条件与校验',action.precondition],['1. 调用/使用',action.method[0]],['2. 查询/读取数据',action.method[1]],['3. 数据操作/副作用',action.method[2]],['4. 后续流程',action.method[3]],['成功分支',action.success],['失败/异常分支',action.failure],['旧系统证据',action.legacyAction],['证据状态',action.targetStatus]]);
      renderActionTree(action); renderMethods(action); renderAnalysisModes();
    }
    function renderFlow() {
      const target=document.querySelector('[data-flow="'+state.pageId+'"]');
      const esc=value=>String(value||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
      const button=(label,action,disabled=false)=>{const actionId=label.split(' ')[0];const hasActionId=/^E-(A[0-9]{2}|[0-9]{2})$/.test(actionId);return '<button type="button" data-demo-action="'+action+'"'+(hasActionId?' data-action-id="'+actionId+'"':'')+(disabled?' disabled':'')+'>'+label+'</button>';};
      const input=(label,key,value,placeholder)=>'<label class="form-field">'+label+'<input data-field="'+key+'" value="'+esc(value)+'" placeholder="'+(placeholder||'')+'"></label>';
      const select=(label,key,options,value)=>'<label class="form-field">'+label+'<select data-field="'+key+'">'+options.map(item=>'<option'+(item===value?' selected':'')+'>'+item+'</option>').join('')+'</select></label>';
      const actions=content=>'<div class="mock-actions">'+content+'</div>';
      const notice=state.notice?'<p class="inline-notice" role="status">'+esc(state.notice)+'</p>':'';
      if(state.pageId==='P01') {
        target.innerHTML='<section class="mock-section"><h4>号源查询</h4><div class="form-grid">'+select('科室','dept',['内科','儿科','外科'],state.dept)+select('医生','doctor',['全部医生','张医生','李医生'],state.doctor)+select('号别','regClass',['普通号','专家号','急诊号'],state.regClass)+select('就诊日期','visitDate',['2026-11-04','2026-11-05','2026-11-06'],state.visitDate)+'</div>'+actions(button('E-01 查询号源','query-schedule')+button('E-02 清空条件','clear-schedule'))+'<div class="table-scroll"><table class="mock-table"><thead><tr><th>选择</th><th>时段</th><th>科室 / 医生</th><th>号别</th><th>费用</th><th>剩余</th></tr></thead><tbody><tr data-schedule="S-1001" tabindex="0"><td><input type="radio" name="schedule-row" '+(state.selectedSchedule==='S-1001'?'checked':'')+'></td><td>08:00–08:30</td><td>'+esc(state.dept)+' / 张医生</td><td>'+esc(state.regClass)+'</td><td>¥20.00</td><td>12</td></tr><tr data-schedule="S-1002" tabindex="0"><td><input type="radio" name="schedule-row" '+(state.selectedSchedule==='S-1002'?'checked':'')+'></td><td>08:30–09:00</td><td>'+esc(state.dept)+' / 李医生</td><td>专家号</td><td>¥30.00</td><td>4</td></tr></tbody></table></div><p class="subtle">'+(state.scheduleQueried?'模拟号表已刷新；点击行选择号源。':'先查询号源，再点击一行选择。')+'</p></section><section class="mock-section"><h4>患者识别</h4><div class="form-grid">'+input('卡号 / 证件号','patientInput',state.patientInput,'请输入卡号或证件号')+select('费别','feeType',['自费','职工医保','工伤'],state.feeType)+'</div>'+actions(button('E-08 回车查患者','lookup-patient')+button('E-04 模拟身份证读卡','lookup-patient'))+'<p class="patient-result">'+(state.patient?'已识别：'+esc(state.patientName)+'　·　演示患者　·　ACTIVE':'尚未识别患者')+'</p></section><section class="mock-section"><h4>挂号确认</h4><p>患者：'+(state.patient?esc(state.patientName):'未选择')+'　号源：'+(state.schedule?esc(state.selectedSchedule):'未选择')+'</p>'+actions(button('E-14 提交挂号','submit',!state.patient||!state.schedule||state.registration!=='prepare')+button('E-10 建卡','open-patient')+button('重置本地演示','reset'))+'<p class="subtle">E-14 通过前置校验后进入 P02；提交前不会写入真实挂号。</p></section>'+(state.registration==='complete'?'<section class="mock-section success-panel"><h4>已挂记录 · 本地模拟</h4><div class="table-scroll"><table class="mock-table"><thead><tr><th>患者</th><th>科室</th><th>流水号</th><th>状态</th></tr></thead><tbody><tr><td>'+esc(state.patientName)+'</td><td>'+esc(state.dept)+'</td><td>DEMO-0001</td><td>NO_CLINIC</td></tr></tbody></table></div></section>':'')+notice;
      } else if(state.pageId==='P02') {
        const active=state.registration==='payment'||state.registration==='complete';
        target.innerHTML='<section class="mock-section"><h4>挂号结算信息</h4><div class="form-grid"><label class="form-field">患者<input readonly value="'+(state.patient?esc(state.patientName):'未从 P01 选择')+'"></label><label class="form-field">号源<input readonly value="'+(state.schedule?esc(state.selectedSchedule):'未从 P01 选择')+'"></label>'+select('支付方式','paymentMethod',['','现金','银行卡','医保账户'],state.paymentMethod)+'</div><div class="charge-summary"><div><span>挂号费</span><strong>¥20.00</strong></div><div><span>减免</span><strong>¥0.00</strong></div><div><span>应收</span><strong>¥20.00</strong></div></div>'+actions(button('E-22 检查发票余量','check-invoice',!active)+button('E-21 确认收款','confirm',!active||!state.invoiceChecked||!state.paymentMethod||state.registration==='complete')+button('返回 P01','go-register'))+'<p class="flow-state">'+(state.registration==='complete'?'本地模拟收款成功；未产生真实挂号/收费':!active?'需从 P01 完成 E-14 后才可结算':state.invoiceChecked?'发票校验通过；选择支付方式后可确认':'等待发票预检查')+'</p></section>'+notice;
      } else if(state.pageId==='P03') {
        const appointmentRows=state.appointment==='idle'?'':'<tr><td>DEMO-APT-001</td><td>'+esc(state.patientInput)+'</td><td>内科</td><td>'+esc(state.appointmentDate||'2026-11-04')+'</td><td>'+(state.appointment==='booked'?'已预约':'已取消')+'</td><td>'+button('E-24 取消预约','cancel-booking',state.appointment!=='booked')+'</td></tr>';
        target.innerHTML='<section class="mock-section"><h4>预约登记</h4><div class="form-grid">'+input('患者卡号','patientInput',state.patientInput,'请输入卡号')+select('预约科室','appointmentDept',['内科','儿科','外科'],state.appointmentDept)+'<label class="form-field">预约日期<input type="date" data-field="appointmentDate" value="'+esc(state.appointmentDate)+'"></label></div>'+actions(button('E-23 模拟预约','book')+button('E-26 批量管理（演示）','manage-appointments'))+'<div class="table-scroll"><table class="mock-table"><thead><tr><th>预约号</th><th>患者卡号</th><th>科室</th><th>日期</th><th>状态</th><th>操作</th></tr></thead><tbody>'+appointmentRows+'</tbody></table></div><h4>预约取号</h4><p>取号链路待 Q-02 确认。该动作当前禁用，不能模拟成功。</p>'+actions(button('E-25 预约取号（Q-02 待决）','take',true))+'</section>'+notice;
      } else if(state.pageId==='P04') {
        target.innerHTML='<section class="mock-section"><h4>分诊台</h4><div class="form-grid">'+select('分诊台','station',['内科一诊区','内科二诊区'],state.station)+select('号别','triageClass',['普通号','专家号'],state.triageClass)+'</div>'+actions(button('E-34 刷新队列','refresh-triage'))+'<div class="table-scroll"><table class="mock-table"><thead><tr><th>选择</th><th>序号</th><th>患者</th><th>号别</th><th>状态</th><th>坑位</th></tr></thead><tbody><tr><td><input type="radio" name="triage-row" checked></td><td>001</td><td>陈小禾（演示）</td><td>'+esc(state.triageClass)+'</td><td>'+ (state.triage==='waiting'?'待分诊':state.triage==='triaged'?'已分诊':'已报到') +'</td><td>'+esc(state.station)+'</td></tr></tbody></table></div>'+actions(button('E-27 分诊','triage',state.triage!=='waiting')+button('E-28 取消分诊','cancel-triage',state.triage==='waiting')+button('E-29 报到','sign-in',state.triage!=='triaged')+button('E-31 加现场号','add-walkin')+button('E-30 开诊 / 停诊','toggle-schedule'))+'<p class="subtle">队列、坑位和操作结果仅在当前页面模拟。</p></section>'+notice;
      } else {
        target.innerHTML='<section class="mock-section"><h4>患者建卡</h4><div class="form-grid">'+input('姓名','cardName',state.cardName,'请输入姓名')+input('身份证号','cardId',state.cardId,'请输入证件号')+select('性别','cardSex',['女','男'],state.cardSex)+input('联系电话','cardPhone',state.cardPhone,'请输入联系电话')+'</div>'+actions(button('模拟查到重复档案','duplicate')+button('模拟无匹配档案','not-found'))+'<p class="flow-state">'+(state.card==='duplicate'?'发现相似档案：陈小禾（演示），请复用已有档案。':state.card==='not-found'?'未找到重复档案，可以保存新卡。':state.card==='created'?'新卡已在本地模拟保存。':'请先查重，再决定是否建卡。')+'</p>'+actions(button('E-35 保存新卡','create-card',state.card!=='not-found')+button('E-36 退卡注销','return-card',state.card!=='created'))+'</section>'+notice;
      }
      if(state.pageId==='P01'){
        const source=document.createElement('details');source.className='field-source-card';
        const summary=document.createElement('summary');summary.textContent='科室「'+state.dept+'」：原型内置模拟项；真实下拉数据源待核实。展开查看查询链';source.append(summary);
        for(const [title,content] of [
          ['本原型的数据','选项“内科 / 儿科 / 外科”由 HTML 原型内置，不是实时查询结果；切换科室只更新本地演示状态。'],
          ['020 潼南已确认的查询链','触发 E-01 后，科室筛选值以 orgCode 等条件进入 GET patad/amb/schedule/list/regist。AmbSchedulingRegMapper.listForRegist 查询 AMB_SCHEDULING_REG，并关联 AMB_TIME_DESCRIBE、号类字典及 SERVICE_PRICE_LIST × SERVICE_CLINIC_PRICE 价目数据。'],
          ['尚未确认的数据源','现有证据未定位“科室下拉候选”本身的字典/权限列表接口或表，也未确认“科室名称 → orgCode”的映射；此项为 UNKNOWN，不能把演示选项当成真实院区配置。'],
          ['目标 V2 契约','PRD 草案为 GET /v2/schedules?orgCode&doctorCode&regClass&date（PROPOSED，尚未接入）。'],
        ]){const paragraph=document.createElement('p');const heading=document.createElement('strong');heading.textContent=title+'：';const value=document.createElement('span');value.textContent=content;paragraph.append(heading,value);source.append(paragraph);}
        target.querySelector('.mock-section .form-grid')?.after(source);
      }
      if(state.pageId==='P01'||state.pageId==='P02'){const zones=['zone-a','zone-b','zone-c','zone-d'];target.querySelectorAll('.mock-section').forEach((section,index)=>{section.classList.add('workbench-zone',zones[index]||'');const heading=section.querySelector('h4');if(heading)heading.textContent=String.fromCharCode(65+index)+' · '+heading.textContent;});}
      document.querySelector('[data-screen="'+state.pageId+'"] [data-page-status]').textContent=state.pageId==='P02'&&state.registration==='prepare'?'等待 P01 提交':state.notice||'本地模拟';
    }
    function renderPage() {
      document.querySelectorAll('.demo-page-tab').forEach(tab=>tab.setAttribute('aria-pressed',String(tab.dataset.page===state.pageId)));
      document.querySelectorAll('.demo-screen').forEach(screen=>{screen.hidden=screen.dataset.screen!==state.pageId;});
      actionSelect.replaceChildren();
      for(const page of demoPages){const group=document.createElement('optgroup');group.label=page.id+' '+page.title;for(const action of actions.filter(item=>item.pageId===page.id)){const option=document.createElement('option');option.value=action.id;option.textContent=action.id+' · '+action.title;group.append(option);}actionSelect.append(group);}
      actionSelect.value=state.actionId; renderAction(); renderFlow();
    }
    document.querySelector('.demo-tabs').addEventListener('click',event=>{const tab=event.target.closest('[data-page]');if(!tab)return;state.pageId=tab.dataset.page;state.actionId=demoPages.find(page=>page.id===state.pageId).defaultAction;renderPage();});
    document.querySelector('.analysis-view-tabs').addEventListener('click',event=>{const tab=event.target.closest('[data-view]');if(!tab)return;state.view=tab.dataset.view;renderAnalysisModes();});
    document.querySelector('.analysis-mode-tabs').addEventListener('click',event=>{const tab=event.target.closest('[data-mode]');if(!tab)return;state.mode=tab.dataset.mode;renderAnalysisModes();});
    document.querySelector('#action-tree').addEventListener('click',event=>{const item=event.target.closest('[data-tree-action]');if(item)setAction(item.dataset.treeAction);});
    document.querySelector('#method-guide').addEventListener('click',event=>{const item=event.target.closest('[data-method-index]');if(!item)return;state.methodIndex=Number(item.dataset.methodIndex);renderAction();});
    methodDetail.addEventListener('click',event=>{const item=event.target.closest('[data-method-index]');if(!item)return;state.methodIndex=Number(item.dataset.methodIndex);renderAction();});
    document.querySelector('.demo-canvas').addEventListener('input',event=>{const field=event.target.dataset.field;if(field)state[field]=event.target.value;});
    document.querySelector('.demo-canvas').addEventListener('change',event=>{const field=event.target.dataset.field;if(field){state[field]=event.target.value;if(state.pageId==='P01'&&['dept','doctor','regClass','visitDate'].includes(field))setAction('E-01');renderFlow();}});
    document.querySelector('.demo-canvas').addEventListener('click',event=>{
      const schedule=event.target.closest('[data-schedule]');
      if(schedule){state.selectedSchedule=schedule.dataset.schedule;state.schedule=true;state.actionId='E-15';state.notice='已选择号源 '+state.selectedSchedule+'。';renderPage();return;}
      const control=event.target.closest('[data-demo-action]');if(!control||control.disabled)return;
      if(control.dataset.actionId)state.actionId=control.dataset.actionId;
      const action=control.dataset.demoAction;
      if(action==='query-schedule'){state.scheduleQueried=true;state.actionId='E-01';state.notice='号源列表已按当前筛选条件刷新。';}
      if(action==='clear-schedule'){state.scheduleQueried=false;state.schedule=false;state.selectedSchedule='';state.notice='查询条件和选号状态已清空。';}
      if(action==='lookup-patient'){if(!state.patientInput.trim()){state.notice='请输入卡号或证件号后再查询。';}else{state.patient=true;state.patientName='陈小禾';state.notice='患者匹配成功：陈小禾（演示数据）。';state.actionId=control.dataset.actionId||'E-08';}}
      if(action==='submit'){if(state.patient&&state.schedule){state.registration='payment';state.pageId='P02';state.invoiceChecked=false;state.paymentMethod='';state.notice='E-14 前置校验通过，已进入 P02 收费交接。';}else{state.notice='请先识别患者并选择号源。';}}
      if(action==='open-patient'){state.pageId='P05';state.cardName=state.patientName;state.cardId=state.patientInput;}
      if(action==='check-invoice'){state.invoiceChecked=true;state.notice='发票余量检查通过（模拟）。';state.actionId='E-22';}
      if(action==='confirm'){if(state.registration==='payment'&&state.invoiceChecked&&state.paymentMethod){state.registration='complete';state.pageId='P01';state.notice='模拟挂号收费成功，已刷新 P01 已挂列表；没有真实写入。';}else{state.notice='先通过发票检查并选择支付方式。';}}
      if(action==='go-register'){state.pageId='P01';state.actionId='E-14';}
      if(action==='book'){if(!state.patientInput.trim()||!state.appointmentDate){state.notice='请填写患者卡号和预约日期。';}else{state.appointment='booked';state.notice='预约已创建（本地模拟）；取消落库待 Q-03。';}}
      if(action==='cancel-booking'){state.appointment='cancelled';state.notice='预约已取消（本地状态）；未写入服务端，Q-03 待关闭。';}
      if(action==='take')state.notice='取号操作受 Q-02 阻断，当前不可执行。';
      if(action==='manage-appointments'){state.notice='预约管理列表已刷新（演示）。';state.actionId='E-26';}
      if(action==='refresh-triage'){state.notice='分诊队列已刷新（演示）。';state.actionId='E-34';}
      if(action==='triage'){state.triage='triaged';state.notice='患者已进入分诊状态（本地模拟）。';}
      if(action==='sign-in'){state.triage='signed_in';state.notice='患者已报到（本地模拟）。';}
      if(action==='cancel-triage'){state.triage='waiting';state.notice='已取消分诊并释放模拟坑位。';}
      if(action==='add-walkin'){state.notice='现场号额 +1（本地模拟）。';state.actionId='E-31';}
      if(action==='toggle-schedule'){state.notice='排班状态已切换（本地模拟）。';state.actionId='E-30';}
      if(action==='duplicate'){state.card='duplicate';state.notice='查到相似档案，禁止重复建卡。';state.actionId='E-35';}
      if(action==='not-found'){state.card='not-found';state.notice='未找到重复档案，可以保存新卡。';state.actionId='E-35';}
      if(action==='create-card'){state.card='created';state.notice='新卡已本地模拟保存；未创建真实档案。';state.actionId='E-35';}
      if(action==='return-card'){state.card='idle';state.notice='卡状态已注销（本地模拟）。';state.actionId='E-36';}
      if(action==='reset'){Object.assign(state,{pageId:'P01',actionId:'E-01',patient:false,patientName:'',schedule:false,scheduleQueried:false,selectedSchedule:'',registration:'prepare',invoiceChecked:false,paymentMethod:'',notice:'演示流程已重置。'});}
      renderPage();
    });
    actionSelect.addEventListener('change',()=>setAction(actionSelect.value));
    renderPage();
  `
  .replace("__ACTION_DATA__", actionData)
  .replace(
    "__PAGES__",
    JSON.stringify(
      demoPages.map(({ id, title, defaultAction }) => ({
        id,
        title,
        defaultAction,
      })),
    ).replaceAll("<", "\\u003c"),
  );

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="门诊挂号登记产品需求、交互、接口、规则和验收规格">
  <title>门诊挂号登记 PRD · 评审稿</title>
  <style>
    :root { color-scheme: light; --ink:#252a31; --muted:#65717e; --line:#dfe4e8; --paper:#fff; --canvas:#f3f5f6; --accent:#176b64; --accent-soft:#e8f3f1; }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; scroll-padding-top:24px; }
    body { margin:0; color:var(--ink); background:var(--canvas); font:15px/1.75 Inter,"Microsoft YaHei",system-ui,sans-serif; }
    .shell { display:grid; grid-template-columns:260px minmax(0,1fr); min-height:100vh; }
    aside { position:sticky; top:0; height:100vh; overflow:auto; padding:28px 18px; background:#182a31; color:#edf4f2; }
    .brand { margin:0 8px 6px; font-size:19px; font-weight:700; }
    .version { margin:0 8px 22px; color:#b4c7c4; font-size:12px; }
    .nav-title { margin:20px 8px 8px; color:#91aaa7; font-size:11px; letter-spacing:.12em; text-transform:uppercase; }
    nav { display:grid; gap:4px; }
    nav a { padding:8px 10px; color:#d9e5e3; text-decoration:none; border-radius:7px; font-size:13px; }
    nav a:hover, nav a:focus { color:#fff; background:#29434a; outline:none; }
    .tools { display:grid; gap:8px; margin:22px 8px; }
    .tools input { min-width:0; padding:9px 10px; border:1px solid #496068; border-radius:7px; color:#fff; background:#20373e; }
    .tools input::placeholder { color:#b4c7c4; }
    .tools button { padding:8px; border:1px solid #496068; border-radius:7px; color:#e7f1ef; background:transparent; cursor:pointer; }
    main { width:min(1100px,100%); margin:0 auto; padding:36px clamp(18px,4vw,56px) 72px; }
    .hero { margin-bottom:22px; padding:28px 32px; border:1px solid var(--line); border-radius:14px; background:var(--paper); }
    .eyebrow { color:var(--accent); font-size:12px; font-weight:700; letter-spacing:.1em; }
    h1 { margin:8px 0; font-size:clamp(26px,4vw,38px); line-height:1.25; }
    .hero p { margin:8px 0 0; color:var(--muted); }
    .callout { margin-top:18px; padding:12px 14px; border-left:3px solid #c28c29; border-radius:4px; background:#fff8e9; }
    .chapter { margin:18px 0; padding:26px clamp(18px,3vw,38px); border:1px solid var(--line); border-radius:14px; background:var(--paper); }
    .chapter-heading { padding-bottom:14px; border-bottom:1px solid var(--line); color:var(--accent); font-size:12px; font-weight:700; letter-spacing:.08em; }
    .demo-tabs { display:flex; flex-wrap:wrap; gap:7px; margin:16px 0; }
    .call-analysis-frame { display:block; width:100%; height:calc(100vh - 210px); min-height:760px; margin-top:14px; border:1px solid var(--line); border-radius:10px; background:#f4f8fd; }
    .all-actions-demo { margin-top:18px; border-top:1px solid var(--line); padding-top:12px; }
    .all-actions-demo > summary { color:#12685f; font-weight:700; cursor:pointer; }
    .demo-page-tab { padding:8px 12px; border:1px solid var(--line); border-radius:7px; color:var(--ink); background:#fff; cursor:pointer; }
    .demo-page-tab[aria-pressed="true"] { border-color:var(--accent); color:#fff; background:var(--accent); }
    .analysis-view-tabs,.analysis-mode-tabs { display:flex; flex-wrap:wrap; gap:7px; margin:12px 0; }
    .analysis-view-tabs button,.analysis-mode-tabs button { padding:8px 12px; border:1px solid var(--line); border-radius:7px; color:var(--ink); background:#fff; cursor:pointer; }
    .analysis-view-tabs button[aria-pressed="true"],.analysis-mode-tabs button[aria-pressed="true"] { border-color:var(--accent); color:#fff; background:var(--accent); }
    .demo-layout { display:grid; grid-template-columns:minmax(180px,.55fr) minmax(0,1.35fr) minmax(260px,.85fr); gap:12px; align-items:start; }
    .demo-canvas,.action-panel,.action-directory,.graph-workspace { min-width:0; padding:12px; border:1px solid var(--line); border-radius:10px; background:#fbfcfc; }
    .action-directory,.action-panel { position:sticky; top:12px; max-height:78vh; overflow:auto; }
    .action-directory label { display:block; }
    .action-directory select { width:100%; padding:8px; border:1px solid var(--line); border-radius:6px; background:#fff; }
    .action-tree { display:grid; gap:10px; margin-top:12px; }
    .tree-page { display:grid; gap:4px; }
    .tree-page > strong { position:sticky; top:0; padding:6px; color:#355c56; background:#edf4f2; font-size:12px; }
    .tree-page button,.method-guide button { padding:6px 8px; border:0; border-radius:5px; color:#3c514d; background:transparent; text-align:left; cursor:pointer; font-size:11px; }
    .tree-page button:hover,.method-guide button:hover { background:#e7f2ef; }
    .tree-page button[aria-current="true"],.method-guide button[aria-current="true"] { color:#fff; background:var(--accent); }
    .workbench-center { min-width:0; }
    .graph-workspace > header { display:grid; gap:5px; padding:4px 4px 14px; color:var(--muted); font-size:12px; }
    .graph-workspace > header strong { color:#173f3b; font-size:16px; }
    .call-graph { display:grid; justify-items:center; gap:7px; }
    .call-node { width:min(100%,440px); padding:12px; border:1px solid #cbded9; border-radius:8px; background:#fff; }
    .call-node > span { display:inline-grid; place-items:center; width:22px; height:22px; margin-right:7px; border-radius:50%; color:#fff; background:var(--accent); font-size:11px; }
    .call-node strong { color:#244c46; font-size:13px; }
    .call-node p { margin:7px 0 0; color:#52615e; font-size:12px; line-height:1.5; }
    .graph-arrow { color:#85a49d; font-style:normal; }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    .inspector-header { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; padding-bottom:9px; border-bottom:1px solid var(--line); }
    .inspector-header strong { color:#173f3b; }
    .inspector-header span { color:var(--muted); font-size:11px; text-align:right; }
    .mock-window-header { display:flex; justify-content:space-between; gap:12px; padding:10px 14px; border-radius:7px 7px 0 0; color:#eff7f5; background:#173f3b; font-size:12px; }
    .connection-dot { display:inline-block; width:7px; height:7px; margin:0 4px; border-radius:50%; background:#78d29e; }
    .mock-window-title { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; border:1px solid var(--line); border-top:0; background:#fff; }
    .mock-window-title h3 { margin:0; font-size:17px; }
    .mock-window-title span { color:var(--muted); font-size:12px; }
    .mock-flow { display:grid; gap:10px; margin-top:14px; padding:14px; border:1px solid #dce7e4; border-radius:8px; background:#f2f8f6; }
    .mock-flow p { margin:0; }
    .mock-section { display:grid; gap:12px; padding:14px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .workbench-flow { grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr); align-items:start; }
    .workbench-zone.zone-a,.workbench-zone.zone-d { grid-column:1/-1; }
    .workbench-zone { border-top:3px solid #5b9b90; }
    .workbench-zone h4 { color:#244c46; }
    .mock-section h4 { margin:0; padding-bottom:7px; border-bottom:1px solid var(--line); font-size:14px; }
    .form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .form-field { display:grid; gap:5px; color:#52615e; font-size:12px; font-weight:600; }
    .form-field input,.form-field select { width:100%; min-width:0; padding:8px 9px; border:1px solid #cbd5d3; border-radius:5px; color:var(--ink); background:#fff; font:inherit; font-size:13px; }
    .field-source-card { margin-top:10px; padding:10px 12px; border:1px solid #cbded9; border-radius:7px; background:#f4f9f7; font-size:12px; }
    .field-source-card summary { color:#235850; font-weight:700; cursor:pointer; }
    .field-source-card p { margin:8px 0 0; color:#495b57; line-height:1.55; }
    .field-source-card strong { color:#244c46; }
    .table-scroll { overflow:auto; }
    .mock-table { width:100%; border-collapse:collapse; white-space:nowrap; font-size:12px; }
    .mock-table th,.mock-table td { padding:8px; border:1px solid var(--line); text-align:left; }
    .mock-table th { background:#eef4f2; }
    .mock-table tbody tr[data-schedule] { cursor:pointer; }
    .mock-table tbody tr[data-schedule]:hover { background:#e8f3f1; }
    .patient-result,.inline-notice,.subtle { margin:0; color:var(--muted); font-size:12px; }
    .inline-notice { padding:8px 10px; border-left:3px solid var(--accent); background:#eef7f5; }
    .charge-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
    .charge-summary div { display:flex; justify-content:space-between; gap:6px; padding:10px; border-radius:6px; background:#f0f4f4; font-size:12px; }
    .charge-summary strong { font-size:17px; color:#173f3b; }
    .success-panel { border-color:#8fc6a5; background:#f1faf4; }
    .mock-actions { display:flex; flex-wrap:wrap; gap:7px; }
    .mock-actions button { padding:8px 10px; border:1px solid #b9cac6; border-radius:6px; color:#184b46; background:#fff; cursor:pointer; }
    .mock-actions button:disabled { color:#899391; background:#edf0f0; cursor:not-allowed; }
    .flow-state { font-weight:700; color:var(--accent); }
    .action-panel h3 { margin:12px 0 6px; font-size:14px; color:#244c46; }
    .method-detail { margin-top:18px; padding-top:14px; border-top:1px solid var(--line); }
    .action-panel > .method-detail { margin:14px 0 0; padding:14px 0 0; border-top:1px solid var(--line); }
    .method-detail h3 { margin:0 0 6px; font-size:17px; }
    .method-source-note { color:var(--muted); font-size:12px; }
    .method-links { display:flex; flex-wrap:wrap; gap:7px; margin-top:12px; }
    .method-links a { padding:5px 8px; border-radius:5px; color:#12685f; background:var(--accent-soft); font-size:12px; text-decoration:none; }
    .action-detail { display:grid; gap:7px; margin-top:8px; }
    .action-detail div { padding:8px; border-radius:6px; background:#f0f4f4; overflow-wrap:anywhere; }
    .method-step-row { display:block; width:100%; padding:8px; border:0; border-radius:6px; background:#f0f4f4; text-align:left; cursor:pointer; }
    .method-step-row[aria-current="true"] { outline:2px solid #5b9b90; background:#e7f2ef; }
    .method-step-row strong { display:block; margin-bottom:3px; color:#40524f; font-size:12px; }
    .method-step-row span { color:#334440; font-size:12px; }
    .action-detail strong { display:block; margin-bottom:3px; color:#40524f; font-size:12px; }
    .demo-disclaimer { margin:14px 0 0; color:#765a21; font-size:13px; }
    article h1, article h2, article h3, article h4 { line-height:1.35; }
    article h1 { margin-top:22px; font-size:28px; }
    article h2 { margin-top:30px; padding-bottom:7px; border-bottom:1px solid var(--line); font-size:21px; }
    article h3 { margin-top:23px; font-size:17px; }
    article p, article li { max-width:90ch; }
    article a { color:#12685f; }
    article code { padding:2px 5px; border-radius:4px; background:#f0f3f4; font-size:.9em; overflow-wrap:anywhere; }
    article pre { overflow:auto; padding:14px 16px; border-radius:8px; background:#17262d; color:#e4eeeb; line-height:1.6; }
    article pre code { padding:0; color:inherit; background:none; }
    article table { width:100%; margin:16px 0; border-collapse:collapse; font-size:13px; }
    article th, article td { padding:9px 10px; border:1px solid var(--line); text-align:left; vertical-align:top; }
    article th { background:#edf4f3; }
    article tr:nth-child(even) td { background:#fafbfb; }
    article blockquote { margin:16px 0; padding:8px 16px; border-left:3px solid #91bdb5; color:#4e5d61; background:#f5f9f8; }
    article img { max-width:100%; height:auto; }
    .empty { display:none; padding:22px; color:var(--muted); text-align:center; }
    footer { padding:24px 8px; color:var(--muted); font-size:12px; text-align:center; }
    @media (max-width:1100px) { .demo-layout { grid-template-columns:minmax(160px,.55fr) minmax(0,1.2fr); } .action-panel { position:static; grid-column:1/-1; max-height:none; } }
    @media (max-width:800px) { .shell { grid-template-columns:1fr; } aside { position:relative; height:auto; padding:18px; } nav { grid-template-columns:repeat(2,minmax(0,1fr)); } main { padding:18px 12px 42px; } .hero { padding:22px; } .chapter { padding:20px 16px; } .demo-layout { grid-template-columns:1fr; } .action-directory,.action-panel { position:static; max-height:none; } .action-directory { max-height:50vh; } .workbench-flow { grid-template-columns:1fr; } .workbench-zone.zone-a,.workbench-zone.zone-d { grid-column:auto; } }
    @media (max-width:520px) { .form-grid,.charge-summary { grid-template-columns:1fr; } .mock-window-header { display:grid; } .call-analysis-frame { height:82vh; min-height:680px; } }
    @media print { body { background:#fff; } .shell { display:block; } aside,.tools { display:none; } main { width:100%; padding:0; } .hero,.chapter { break-inside:avoid; border:0; box-shadow:none; } .chapter { break-before:page; } }
  </style>
</head>
<body>
  <div class="shell">
    <aside>
      <p class="brand">门诊挂号登记 PRD</p>
      <p class="version">v0.2 · 评审稿 · 2026-11-02 基线</p>
      <div class="tools">
        <input id="search" type="search" placeholder="搜索本文档" aria-label="搜索本文档">
        <button type="button" id="print">打印 / 导出 PDF</button>
      </div>
      <p class="nav-title">文档章节</p>
      <nav aria-label="文档章节">${navigation}</nav>
    </aside>
    <main>
      <header class="hero">
        <span class="eyebrow">产品需求文档 · 评审稿</span>
        <h1>门诊挂号登记</h1>
        <p>汇总需求基线、页面交互、领域接口、业务规则、验收测试与决策跟踪。</p>
        <div class="callout"><strong>基线说明：</strong>020 潼南为默认业务事实基线；003 东港仅作补充证据。未决行为保持待确认，不视为已实现或已验收。</div>
      </header>
      ${prototype}
      ${articles.join("\n")}
      <div class="empty" id="empty">没有匹配的内容。</div>
      <footer>表单、列表和状态变化均为本地交互模拟，不会产生真实业务写入。</footer>
    </main>
  </div>
  <script>
    ${demoRuntime}
    const query = document.querySelector('#search');
    const chapters = [...document.querySelectorAll('.chapter')];
    const empty = document.querySelector('#empty');
    query.addEventListener('input', () => {
      const term = query.value.trim().toLocaleLowerCase();
      let visible = 0;
      for (const chapter of chapters) {
        const matches = !term || chapter.textContent.toLocaleLowerCase().includes(term);
        chapter.hidden = !matches;
        visible += Number(matches);
      }
      empty.style.display = visible ? 'none' : 'block';
    });
    document.querySelector('#print').addEventListener('click', () => window.print());
  </script>
</body>
</html>`;

await writeFile(outputPath, html, "utf8");
await writeFile(
  path.join(prdRoot, "workbench", "prd-actions.js"),
  `window.CLINIC_REG_PRD_ACTIONS=${actionData};\n`,
  "utf8",
);
console.log(`Wrote ${path.relative(dashboardRoot, outputPath)}`);
