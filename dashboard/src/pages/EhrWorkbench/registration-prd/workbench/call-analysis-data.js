/* 门诊挂号登记 · 统一调用分析模型。证据分层同门诊收费包：VERIFIED / INFERRED / PROPOSED / UNKNOWN 分离。
   源码事实（L003_/L020_）逐行取自 E:\old\yy 对应文件；M_ 前缀为 V2 目标模型，不冒充旧版事实。 */
window.CLINIC_REG_CALL_ANALYSIS_DATA = {
  "schemaVersion": "2.2.0",
  "title": "门诊挂号登记统一调用分析模型",
  "sourceEvidenceFile": "legacy-source-snapshots.js",
  "rules": {
    "evidenceSeparation": true,
    "rawSourceRequiredForPathLineVerification": true,
    "graphMustIncludeAllMethodCalls": true,
    "textTreeMustDeriveFromSameGraph": true,
    "usageMustDeriveFromEntityReferences": true
  },
  "versions": {
    "003": { "id": "003", "label": "003 Legacy", "status": "INFERRED" },
    "020": { "id": "020", "label": "020 Legacy", "status": "INFERRED" },
    "V2": { "id": "V2", "label": "V2 新架构", "status": "PROPOSED" }
  },
  "versionMappings": [
    { "businessResponsibility": "号源查询与占用", "status": "VERIFIED", "003": ["queryScheduleByPerm (PatadAmbRegistController:1031)", "updateScheduleCommand (UpdateScheduleCommand:34-66)，页面选择态 GET/PUT ±1"], "020": ["排班选择/金额刷新", "windowRegist 提交时条件扣减 REG_REMAINING_NUM"], "V2": ["M_RESERVE_SCHEDULE · /v2/schedules/{id}/reserve"], "evidenceIds": ["L003_SCHEDULE_QUERY", "L003_SCHEDULE_UPDATE", "L020_CLINIC_CODE_COMMIT", "L020_REGIST_COMMIT"] },
    { "businessResponsibility": "患者身份识别", "status": "VERIFIED", "003": ["readPatCard 身份证 (:1107)", "miECReadCard 电子凭证 (:1140)", "miBaseReadAmbCard 医保卡 07/09 (:1178)", "queryPatByCardCommand 汇聚"], "020": ["readIDCard (:525)", "regCardCode 回车查患者 (:431)"], "V2": ["M_PAT_IDENTIFY · detectCredential 统一识别"], "evidenceIds": ["L003_READ_ID_CARD", "L003_READ_ECERT", "L003_READ_MI_CARD", "L020_READ_ID_CARD", "L020_CARD_ENTER"] },
    { "businessResponsibility": "挂号提交与结算", "status": "VERIFIED", "003": ["regist 费别校验 (:1078)", "RegistCommand 预处理并打开收费窗", "CommitRcptRegisterAmbCommand 提交收费窗"], "020": ["doPay 预处理/支付分支", "CommitRcptRegisterAmbCommand 最终提交（服务端路由映射待确认）"], "V2": ["M_REGIST_PIPELINE · 校验-占号-结算三段式"], "evidenceIds": ["L003_REGIST_SUBMIT", "L003_REGIST_CMD", "L003_REGIST_COMMIT", "L020_REGIST_PAY", "L020_REGIST_COMMIT"] },
    { "businessResponsibility": "退号", "status": "VERIFIED", "003": ["cancelRegist (:1093)", "cancelRegistCommand"], "020": ["由门诊退费包逆向链覆盖"], "V2": ["随 M_REGIST_PIPELINE 对冲结算"], "evidenceIds": ["L003_REGIST_CANCEL"] },
    { "businessResponsibility": "挂号费支付（020 独有弹窗内结算）", "status": "VERIFIED", "003": ["无：003 挂号与收费分离"], "020": ["payWay commit (:343)", "余额差额 czbc (:363-403)", "Econ_Other_Pay 三方支付分支 (:690)"], "V2": ["M_SETTLE_REG_FEE · 统一结算服务"], "evidenceIds": ["L020_PAYWAY_COMMIT", "L020_PRICE_BALANCE_CHECK"] }
  ],
  "groups": [
    { "id": "schedule", "name": "号源查询区", "componentIds": ["C001", "C002"] },
    { "id": "patient", "name": "患者识别区", "componentIds": ["C003", "C004", "C005"] },
    { "id": "regist", "name": "挂号操作区", "componentIds": ["C006", "C007", "C008"] },
    { "id": "pay", "name": "费用支付区", "componentIds": ["C009", "C010", "C014"] },
    { "id": "support", "name": "辅助功能", "componentIds": ["C011", "C012", "C013"] }
  ],
  "components": {
    "C001": { "id": "C001", "name": "号源查询条件", "groupId": "schedule", "groupName": "号源查询区", "kind": "frontend", "eventIds": ["EVT_SCHEDULE_QUERY", "EVT_SCHEDULE_REFRESH"], "versionTags": ["COMMON"], "evidenceStatus": "VERIFIED" },
    "C002": { "id": "C002", "name": "号源排班表", "groupId": "schedule", "groupName": "号源查询区", "kind": "data", "eventIds": ["EVT_SCHEDULE_SELECT", "EVT_MY_SCHEDULE"], "versionTags": ["COMMON"], "evidenceStatus": "VERIFIED" },
    "C003": { "id": "C003", "name": "患者查询条件", "groupId": "patient", "groupName": "患者识别区", "kind": "frontend", "eventIds": ["EVT_PAT_QUERY_NAME", "EVT_PAT_QUERY_CARD"], "versionTags": ["COMMON"], "evidenceStatus": "VERIFIED" },
    "C004": { "id": "C004", "name": "患者信息表单", "groupId": "patient", "groupName": "患者识别区", "kind": "form", "eventIds": ["EVT_BIRTH_AGE_SYNC"], "versionTags": ["COMMON"], "evidenceStatus": "VERIFIED" },
    "C005": { "id": "C005", "name": "读卡区", "groupId": "patient", "groupName": "患者识别区", "kind": "frontend", "eventIds": ["EVT_READ_ID_CARD", "EVT_READ_ECERT", "EVT_READ_MI_CARD"], "versionTags": ["COMMON"], "evidenceStatus": "VERIFIED" },
    "C006": { "id": "C006", "name": "挂号提交", "groupId": "regist", "groupName": "挂号操作区", "kind": "frontend", "eventIds": ["EVT_REGIST_SUBMIT"], "versionTags": ["COMMON"], "evidenceStatus": "VERIFIED" },
    "C007": { "id": "C007", "name": "退号", "groupId": "regist", "groupName": "挂号操作区", "kind": "frontend", "eventIds": ["EVT_REGIST_CANCEL"], "versionTags": ["COMMON"], "evidenceStatus": "VERIFIED" },
    "C008": { "id": "C008", "name": "已挂号列表", "groupId": "regist", "groupName": "挂号操作区", "kind": "data", "eventIds": ["EVT_REGIST_LIST"], "versionTags": ["COMMON"], "evidenceStatus": "VERIFIED" },
    "C009": { "id": "C009", "name": "支付方式", "groupId": "pay", "groupName": "费用支付区", "kind": "frontend", "eventIds": ["EVT_PAYWAY_COMMIT"], "versionTags": ["020"], "evidenceStatus": "VERIFIED" },
    "C010": { "id": "C010", "name": "账户充值", "groupId": "pay", "groupName": "费用支付区", "kind": "frontend", "eventIds": ["EVT_ACCOUNT_RECHARGE"], "versionTags": ["020"], "evidenceStatus": "VERIFIED" },
    "C011": { "id": "C011", "name": "指引单打印", "groupId": "support", "groupName": "辅助功能", "kind": "adapter", "eventIds": ["EVT_PRINT_GUIDE"], "versionTags": ["003"], "evidenceStatus": "VERIFIED" },
    "C012": { "id": "C012", "name": "跳转收费", "groupId": "support", "groupName": "辅助功能", "kind": "frontend", "eventIds": ["EVT_ECON_SKIP"], "versionTags": ["003"], "evidenceStatus": "VERIFIED" },
    "C013": { "id": "C013", "name": "建卡入口", "groupId": "support", "groupName": "辅助功能", "kind": "frontend", "eventIds": ["EVT_CREATE_PAT_CARD"], "versionTags": ["COMMON"], "evidenceStatus": "VERIFIED" },
    "C014": { "id": "C014", "name": "挂号收费确认", "groupId": "pay", "groupName": "费用支付区", "kind": "frontend", "eventIds": ["EVT_REGIST_COMMIT"], "versionTags": ["003", "020"], "evidenceStatus": "VERIFIED" }
  },
  "events": {
    "EVT_SCHEDULE_QUERY": { "id": "EVT_SCHEDULE_QUERY", "componentId": "C001", "name": "click.querySchedule", "trigger": "click", "methodIds": ["L003_SCHEDULE_QUERY"], "status": "VERIFIED", "summary": "按科室 / 医生 / 急诊标记查询可挂号源。" },
    "EVT_SCHEDULE_REFRESH": { "id": "EVT_SCHEDULE_REFRESH", "componentId": "C001", "name": "click.refreshSchedule", "trigger": "click", "methodIds": ["L003_SCHEDULE_REFRESH"], "status": "VERIFIED", "summary": "刷新号源排班列表。" },
    "EVT_SCHEDULE_SELECT": { "id": "EVT_SCHEDULE_SELECT", "componentId": "C002", "name": "select.scheduleRow", "trigger": "select", "methodIds": ["L003_SCHEDULE_SELECT"], "status": "VERIFIED", "summary": "选中号源行后更新号别余量并锁定选择。" },
    "EVT_MY_SCHEDULE": { "id": "EVT_MY_SCHEDULE", "componentId": "C002", "name": "click.mySchedule", "trigger": "click", "methodIds": ["L003_MY_SCHEDULE"], "status": "VERIFIED", "summary": "按当前登录医生查询本人号源。" },
    "EVT_PAT_QUERY_NAME": { "id": "EVT_PAT_QUERY_NAME", "componentId": "C003", "name": "enter.patName", "trigger": "enter", "methodIds": ["L003_PAT_QUERY_NAME"], "status": "VERIFIED", "summary": "按姓名模糊查询患者档案。" },
    "EVT_PAT_QUERY_CARD": { "id": "EVT_PAT_QUERY_CARD", "componentId": "C003", "name": "enter.cardCode", "trigger": "enter", "methodIds": ["L003_PAT_QUERY_CARD"], "status": "VERIFIED", "summary": "按卡号 / 证件号查询患者档案。" },
    "EVT_BIRTH_AGE_SYNC": { "id": "EVT_BIRTH_AGE_SYNC", "componentId": "C004", "name": "change.birthDate", "trigger": "onChange", "methodIds": ["L003_BIRTH_AGE", "L020_BIRTH_DATE_COMMIT"], "status": "VERIFIED", "summary": "出生日期与年龄双向换算同步。" },
    "EVT_READ_ID_CARD": { "id": "EVT_READ_ID_CARD", "componentId": "C005", "name": "click.readIDCard", "trigger": "click", "methodIds": ["L003_READ_ID_CARD", "L020_READ_ID_CARD"], "status": "VERIFIED", "summary": "身份证阅读器读卡并回填患者信息。" },
    "EVT_READ_ECERT": { "id": "EVT_READ_ECERT", "componentId": "C005", "name": "click.readEcert", "trigger": "click", "methodIds": ["L003_READ_ECERT"], "status": "VERIFIED", "summary": "医保电子凭证扫码识别患者。" },
    "EVT_READ_MI_CARD": { "id": "EVT_READ_MI_CARD", "componentId": "C005", "name": "click.readMiCard", "trigger": "click", "methodIds": ["L003_READ_MI_CARD"], "status": "VERIFIED", "summary": "按费别分支读社保卡（07 职工 / 09 工伤）。" },
    "EVT_REGIST_SUBMIT": { "id": "EVT_REGIST_SUBMIT", "componentId": "C006", "name": "click.regist", "trigger": "click", "methodIds": ["L003_REGIST_SUBMIT", "L020_REGIST_PAY"], "status": "VERIFIED", "summary": "开始挂号提交：003 校验后打开收费窗，020 先执行限额、患者和支付分支。" },
    "EVT_REGIST_COMMIT": { "id": "EVT_REGIST_COMMIT", "componentId": "C014", "name": "confirm.registrationCharge", "trigger": "confirm", "methodIds": ["L003_REGIST_COMMIT", "L020_REGIST_COMMIT"], "status": "VERIFIED", "summary": "收费窗确认后提交挂号；客户端请求路径可见，020 服务端路由命中仍待确认。" },
    "EVT_REGIST_CANCEL": { "id": "EVT_REGIST_CANCEL", "componentId": "C007", "name": "click.cancelRegist", "trigger": "click", "methodIds": ["L003_REGIST_CANCEL"], "status": "VERIFIED", "summary": "对已挂号记录执行退号。" },
    "EVT_REGIST_LIST": { "id": "EVT_REGIST_LIST", "componentId": "C008", "name": "click.queryAlreadyRegist", "trigger": "click", "methodIds": ["L003_REGIST_LIST"], "status": "VERIFIED", "summary": "查询当日已挂号记录。" },
    "EVT_PAYWAY_COMMIT": { "id": "EVT_PAYWAY_COMMIT", "componentId": "C009", "name": "change.payWay", "trigger": "onChange", "methodIds": ["L020_PAYWAY_COMMIT"], "status": "VERIFIED", "summary": "支付方式切换；普通账户时展开账户与充值补差。" },
    "EVT_ACCOUNT_RECHARGE": { "id": "EVT_ACCOUNT_RECHARGE", "componentId": "C010", "name": "change.accountBalance", "trigger": "onChange", "methodIds": ["L020_PRICE_BALANCE_CHECK"], "status": "VERIFIED", "summary": "挂号费大于账户余额时显示充值补差金额。" },
    "EVT_PRINT_GUIDE": { "id": "EVT_PRINT_GUIDE", "componentId": "C011", "name": "click.printGuide", "trigger": "click", "methodIds": ["L003_PRINT_GUIDE"], "status": "VERIFIED", "summary": "补打就诊指引单（热敏打印）。" },
    "EVT_ECON_SKIP": { "id": "EVT_ECON_SKIP", "componentId": "C012", "name": "click.econSkip", "trigger": "click", "methodIds": ["L003_ECON_SKIP"], "status": "VERIFIED", "summary": "携带挂号上下文跳转门诊收费。" },
    "EVT_CREATE_PAT_CARD": { "id": "EVT_CREATE_PAT_CARD", "componentId": "C013", "name": "click.createPatCard", "trigger": "click", "methodIds": ["L003_CREATE_PAT_CARD"], "status": "VERIFIED", "summary": "读卡后建档建卡。" }
  },
  "methods": {
    "L003_SCHEDULE_QUERY": {
      "id": "L003_SCHEDULE_QUERY", "name": "queryScheduleByPerm", "layer": "Legacy 003 / UI", "type": "号源查询", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["把字典元素置空后触发号源查询命令。", "003 中科室 / 医生 / 急诊标记变更后都会走到同一命令。"]
    },
    "L003_SCHEDULE_REFRESH": {
      "id": "L003_SCHEDULE_REFRESH", "name": "refreshSchedule", "layer": "Legacy 003 / UI", "type": "号源刷新", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["直接透传事件给刷新命令，重查当前号源条件。"]
    },
    "L003_SCHEDULE_SELECT": {
      "id": "L003_SCHEDULE_SELECT", "name": "scheduleRowSelected", "layer": "Legacy 003 / UI", "type": "号源选中", "status": "VERIFIED",
      "args": [], "returns": "void", "calls": ["L003_SCHEDULE_UPDATE"], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["排班表选中行变化后写入选中号源。", "余量为 0 的号别不可再选，由命令内部校验。"]
    },
    "L003_SCHEDULE_UPDATE": {
      "id": "L003_SCHEDULE_UPDATE", "name": "updateScheduleCommand", "layer": "Legacy 003 / Command", "type": "号源占用更新", "status": "VERIFIED",
      "args": [], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["选中号源后更新排班占用状态。"]
    },
    "L003_MY_SCHEDULE": {
      "id": "L003_MY_SCHEDULE", "name": "mySchedule", "layer": "Legacy 003 / UI", "type": "我的号源", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": ["L003_REGIST_LIST_CMD"], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["把当前登录医生 staffCode 设为查询条件后复用已挂号查询命令。"]
    },
    "L003_REGIST_LIST_CMD": {
      "id": "L003_REGIST_LIST_CMD", "name": "queryAlreadyRegistCommand", "layer": "Legacy 003 / Command", "type": "已挂号查询命令", "status": "VERIFIED",
      "args": [], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["查询已挂号记录并回填列表。"]
    },
    "L003_REGIST_LIST": {
      "id": "L003_REGIST_LIST", "name": "queryAlreadyRegist", "layer": "Legacy 003 / UI", "type": "已挂号查询", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": ["L003_REGIST_LIST_CMD"], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["透传事件查询已挂号记录。"]
    },
    "L003_PAT_QUERY_NAME": {
      "id": "L003_PAT_QUERY_NAME", "name": "queryPatByNameCommand", "layer": "Legacy 003 / Command", "type": "按姓名查患者", "status": "VERIFIED",
      "args": [], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["姓名回车后模糊查询患者档案，多结果时弹选择。"]
    },
    "L003_PAT_QUERY_CARD": {
      "id": "L003_PAT_QUERY_CARD", "name": "queryPatByCardCommand", "layer": "Legacy 003 / Command", "type": "按卡号查患者", "status": "VERIFIED",
      "args": [], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["卡号输入或读卡回填后按卡号精确查询患者档案。", "003 中身份证读卡、电子凭证、医保卡读卡最终都汇到该命令。"]
    },
    "L003_BIRTH_AGE": {
      "id": "L003_BIRTH_AGE", "name": "birthDateAgeCommand", "layer": "Legacy 003 / Command", "type": "出生日期转年龄", "status": "VERIFIED",
      "args": [], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["患者表单里出生日期变化后换算年龄；反向换算由 AgeBirthDateCommand 承担。"]
    },
    "L003_READ_ID_CARD": {
      "id": "L003_READ_ID_CARD", "name": "readPatCard", "layer": "Legacy 003 / UI", "type": "身份证读卡", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": ["L003_PAT_QUERY_CARD"], "parameterIds": [], "switchIds": [], "dataAccess": ["API_PAT_BY_IDNO"], "evidenceIds": [],
      "explain": ["身份证阅读器读出卡号与地址并回填查询区。", "取卡号前 6 位对照行政区划字典回填户籍地址。", "读卡成功后触发按卡号查患者。"]
    },
    "L003_READ_ECERT": {
      "id": "L003_READ_ECERT", "name": "miECReadCard", "layer": "Legacy 003 / UI", "type": "电子凭证读卡", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": ["L003_PAT_QUERY_CARD"], "parameterIds": [], "switchIds": [], "dataAccess": ["API_PAT_BY_IDNO"], "evidenceIds": [],
      "explain": ["医保电子凭证扫码取身份证号，再按 idNo 查患者卡号。", "无档案时按需求 2663 自动带出身份证号与户口地址用于建卡。"]
    },
    "L003_READ_MI_CARD": {
      "id": "L003_READ_MI_CARD", "name": "miBaseReadAmbCard", "layer": "Legacy 003 / UI", "type": "医保卡读卡", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": ["L003_PAT_QUERY_CARD"], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["按费别分支读卡：07 职保走社保卡，09 工伤走工伤医保接口。", "费别不在分支内时提示请输入正确的费别。"]
    },
    "L003_CREATE_PAT_CARD": {
      "id": "L003_CREATE_PAT_CARD", "name": "createPatCard", "layer": "Legacy 003 / UI", "type": "建档建卡", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": ["L003_READ_CARD_CMD"], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["先读卡再走建卡接口，用于无档案患者。"]
    },
    "L003_READ_CARD_CMD": {
      "id": "L003_READ_CARD_CMD", "name": "readCardCommand", "layer": "Legacy 003 / Command", "type": "读卡命令", "status": "VERIFIED",
      "args": [], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["统一读卡入口命令，由建卡等场景复用。"]
    },
    "L003_REGIST_SUBMIT": {
      "id": "L003_REGIST_SUBMIT", "name": "regist", "layer": "Legacy 003 / UI", "type": "挂号提交", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": ["L003_REGIST_CMD"], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["提交前校验患者信息与费别必填，缺失即弹错返回。", "003 中医保患者回车会分流到 DG 医保挂号命令。"]
    },
    "L003_REGIST_CMD": {
      "id": "L003_REGIST_CMD", "name": "registCommand", "layer": "Legacy 003 / Command", "type": "挂号命令", "status": "VERIFIED",
      "args": [], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": ["API_VISIT_CODE", "API_REGIST_COST"], "evidenceIds": [],
      "explain": ["003 预处理顺序：发票/支付方式与 Econ_Rounded 校验 → GET patadAmb/query/visitCode 取号并锁定 → POST ambPatientcharge/amb/costs/byRegist 算费 → 打开 REGISTER_AMB_RCPT_MODEL。", "收费窗确认后由 CommitRcptRegisterAmbCommand 另行 POST windowRegist/insert；本节点不等于最终收费提交。", "选号时的 AMB_SCHEDULE.registUseNum 读改写与挂号服务写 AMB_REGIST 是不同动作；服务端 SQL / 事务边界见页面级 PRD。"]
    },
    "L003_REGIST_CANCEL": {
      "id": "L003_REGIST_CANCEL", "name": "cancelRegist", "layer": "Legacy 003 / UI", "type": "退号", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["对选中已挂号记录执行退号，由 cancelRegistCommand 承担。"]
    },
    "L003_PRINT_GUIDE": {
      "id": "L003_PRINT_GUIDE", "name": "printRegist", "layer": "Legacy 003 / UI", "type": "指引单补打", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["取已挂号列表选中行的 patMiCode，按「指引单补打」模板走热敏打印。", "未选中行时 selectedItem 为空会拼出 null 参数，属 003 已知缺陷。"]
    },
    "L003_ECON_SKIP": {
      "id": "L003_ECON_SKIP", "name": "econSkipButton", "layer": "Legacy 003 / UI", "type": "跳转收费", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["携带挂号上下文跳转门诊收费工作台，由 skipEconCommand 承担。"]
    },
    "L003_BACK_CARD": {
      "id": "L003_BACK_CARD", "name": "backCard", "layer": "Legacy 003 / UI", "type": "退卡", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["回收就诊卡，由 backCardCommand 承担。"]
    },
    "L020_PAYWAY_COMMIT": {
      "id": "L020_PAYWAY_COMMIT", "name": "payWayCommit", "layer": "Legacy 020 / UI", "type": "支付方式提交", "status": "VERIFIED",
      "args": ["value"], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["先隐藏账户与充值补差控件，普通账户（PTZH）再展开。", "020 独有：挂号收费在同一弹窗完成。"]
    },
    "L020_PRICE_BALANCE_CHECK": {
      "id": "L020_PRICE_BALANCE_CHECK", "name": "priceBalanceCheck", "layer": "Legacy 020 / UI", "type": "余额校验", "status": "VERIFIED",
      "args": [], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["挂号价格变化且支付方式为普通账户时，用账户余额计算差额。", "差额大于 0 时显示充值金额与充值支付方式选择。"]
    },
    "L020_CLINIC_CODE_COMMIT": {
      "id": "L020_CLINIC_CODE_COMMIT", "name": "clinicCodeCommit", "layer": "Legacy 020 / UI", "type": "号别提交", "status": "VERIFIED",
      "args": ["value"], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["切换号别后先把价格清零，再按号别重算挂号费。"]
    },
    "L020_BIRTH_DATE_COMMIT": {
      "id": "L020_BIRTH_DATE_COMMIT", "name": "birthDateCommit", "layer": "Legacy 020 / UI", "type": "出生日期提交", "status": "VERIFIED",
      "args": ["value"], "returns": "void", "calls": ["L020_BIRTH_AGE_CMD"], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["出生日期提交后写回患者模型并换算年龄。"]
    },
    "L020_BIRTH_AGE_CMD": {
      "id": "L020_BIRTH_AGE_CMD", "name": "birthDateAgeForRegistCommand", "layer": "Legacy 020 / Command", "type": "出生日期转年龄命令", "status": "VERIFIED",
      "args": ["map"], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["挂号场景专用的出生日期转年龄命令，支持参数透传。"]
    },
    "L020_AGE_ENTER": {
      "id": "L020_AGE_ENTER", "name": "ageEnter", "layer": "Legacy 020 / UI", "type": "年龄回车", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["年龄回车后反向换算出生日期（AgeToBirthDateCommand）。"]
    },
    "L020_CARD_ENTER": {
      "id": "L020_CARD_ENTER", "name": "cardCodeEnter", "layer": "Legacy 020 / UI", "type": "证件号回车查患者", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": ["API_PAT_QUERY_BY_CARD"], "evidenceIds": [],
      "explain": ["证件类型与证件号都非空时按卡查患者（statusCode=ACTIVE）。", "020 独有：查询参数带 method=queryByCardType。"]
    },
    "L020_READ_ID_CARD": {
      "id": "L020_READ_ID_CARD", "name": "readIDCard", "layer": "Legacy 020 / UI", "type": "身份证读卡", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": ["L020_BIRTH_AGE_CMD"], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["读身份证后从证件号解析出生日期与性别并回填模型。", "读卡失败或关键字段为空时提示重新读卡。"]
    },
    "L020_REGIST_PAY": {
      "id": "L020_REGIST_PAY", "name": "doPay", "layer": "Legacy 020 / UI", "type": "挂号结算提交", "status": "VERIFIED",
      "args": ["event"], "returns": "void", "calls": ["L020_AUTO_REGIST_CMD"], "parameterIds": [], "switchIds": ["SW_ECON_OTHER_PAY"], "dataAccess": ["API_REGIST_SOURCE_LIST", "API_PAT_QUERY_MI"], "evidenceIds": [],
      "explain": ["挂号 / 收费提交前置分支：校验当月医生挂号限额；创建主索引前按证件号防重复建档；新建时校验姓名 / 性别 / 出生日期 / 费别。", "普通账户余额不足时走充值补差，支付方式必选；金额大于 0 且开启三方支付开关时走 POS 分支。", "该节点表示 doPay 阶段；收费窗确认后的 CommitRcptRegisterAmbCommand 和 windowRegist 服务提交由 EVT_REGIST_COMMIT 单独展示。"]
    },
    "L020_AUTO_REGIST_CMD": {
      "id": "L020_AUTO_REGIST_CMD", "name": "AmbAptAutoRegistNewCommand", "layer": "Legacy 020 / Command", "type": "挂号执行命令", "status": "VERIFIED",
      "args": ["map"], "returns": "void", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "explain": ["挂号弹窗最终执行命令，关闭窗体后回调刷新。"]
    },
    "L003_REGIST_COMMIT": {
      "id": "L003_REGIST_COMMIT", "name": "CommitRcptRegisterAmbCommand.getServiceData", "layer": "Legacy 003 / Command", "type": "收费窗最终提交", "status": "VERIFIED",
      "args": ["AmbRegistVO", "payWays"], "returns": "Message", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": ["API_WINDOW_REGIST_INSERT"], "evidenceIds": [],
      "explain": ["收费窗确认后写入登录医院编码和支付条目，POST patad/evn/amb/windowRegist/insert。", "接口失败或返回‘挂号失败’时，客户端释放所选的首个排班并调用 UpdateScheduleCommand；服务端事务与该补偿的最终一致性仍需核实。"]
    },
    "L020_REGIST_COMMIT": {
      "id": "L020_REGIST_COMMIT", "name": "CommitRcptRegisterAmbCommand.doServer", "layer": "Legacy 020 / Command", "type": "收费窗最终提交", "status": "VERIFIED",
      "args": ["AmbRegistVO", "payWays"], "returns": "Message", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": ["API_WINDOW_REGIST_INSERT"], "evidenceIds": [],
      "explain": ["收费窗确认后写入医院编码和支付条目，客户端 POST patad/evn/amb/windowRegist/insert。", "服务端可见路由写作 patad/evn/amb/window/regist/insert；客户端请求是否经框架映射到该方法仍待确认，不能把 handler 连接标成已闭环。"]
    },
    "M_REGIST_PIPELINE": {
      "id": "M_REGIST_PIPELINE", "name": "submitRegist", "layer": "Frontend", "type": "挂号统一入口", "status": "PROPOSED",
      "args": [], "returns": "Promise<RegistResult>", "calls": ["M_VALIDATE_REGIST_INPUT", "M_RESERVE_SCHEDULE", "M_SETTLE_REG_FEE"], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "code": [
        "const submitRegist = async (): Promise<RegistResult> => {",
        "  const input = validateRegistInput(form.value);",
        "  const schedule = await reserveSchedule(input.scheduleId);",
        "  const settle = await settleRegFee(input, schedule);",
        "  return { visitCode: settle.visitCode, queueNo: schedule.queueNo };",
        "};"
      ],
      "explain": ["V2 目标：校验、占号、结算三段式，替代 003/020 分散在 UI 与命令中的流程。", "号源扣减与结算拆成独立服务方法，便于退号对冲。"]
    },
    "M_VALIDATE_REGIST_INPUT": {
      "id": "M_VALIDATE_REGIST_INPUT", "name": "validateRegistInput", "layer": "Frontend/Policy", "type": "挂号校验", "status": "PROPOSED",
      "args": ["input"], "returns": "RegistInput", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "code": [
        "const validateRegistInput = (input: RegistForm): RegistInput => {",
        "  if (!input.patMiCode && !input.cardCode) throw required('患者或证件号');",
        "  if (!input.feeType) throw required('费别');",
        "  if (!input.scheduleId) throw required('号源');",
        "  return input;",
        "};"
      ],
      "explain": ["汇总 003 的费别校验与 020 的主索引四项校验。", "校验失败统一返回字段级错误，不再逐项弹窗。"]
    },
    "M_RESERVE_SCHEDULE": {
      "id": "M_RESERVE_SCHEDULE", "name": "reserveSchedule", "layer": "Application", "type": "号源占用", "status": "PROPOSED",
      "args": ["scheduleId"], "returns": "Promise<Schedule>", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": ["API_SCHEDULE_RESERVE"], "evidenceIds": [],
      "code": [
        "const reserveSchedule = (scheduleId: string): Promise<Schedule> =>",
        "  http.post('/v2/schedules/' + scheduleId + '/reserve');"
      ],
      "explain": ["号源占用收敛为单一接口，服务端保证并发安全。", "旧版占用逻辑散落在 updateScheduleCommand 与挂号命令中。"]
    },
    "M_SETTLE_REG_FEE": {
      "id": "M_SETTLE_REG_FEE", "name": "settleRegFee", "layer": "Application", "type": "挂号费结算", "status": "PROPOSED",
      "args": ["input", "schedule"], "returns": "Promise<SettleResult>", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": ["API_REG_SETTLE"], "evidenceIds": [],
      "code": [
        "const settleRegFee = (input: RegistInput, schedule: Schedule): Promise<SettleResult> =>",
        "  http.post('/v2/regist-settle', { ...input, scheduleId: schedule.id });"
      ],
      "explain": ["结算策略覆盖现金 / 账户 / 三方支付，替代 020 doPay 内的多层分支。", "账户余额不足的充值补差由结算服务返回待支付差额。"]
    },
    "M_PAT_IDENTIFY": {
      "id": "M_PAT_IDENTIFY", "name": "identifyPatient", "layer": "Frontend", "type": "患者识别", "status": "PROPOSED",
      "args": ["credential"], "returns": "Promise<PatientIdentity>", "calls": ["M_QUERY_PAT_BY_CARD"], "parameterIds": [], "switchIds": [], "dataAccess": [], "evidenceIds": [],
      "code": [
        "const identifyPatient = async (credential: Credential): Promise<PatientIdentity> => {",
        "  const kind = detectCredential(credential.raw); // idCard | miCard | ecert | cardNo",
        "  return queryPatByCard({ type: kind, code: credential.raw });",
        "};"
      ],
      "explain": ["V2 目标：身份证 / 医保卡 / 电子凭证 / 就诊卡统一识别入口。", "旧版四种读卡各自回填后都汇到按卡查患者，V2 收敛为一个策略函数。"]
    },
    "M_QUERY_PAT_BY_CARD": {
      "id": "M_QUERY_PAT_BY_CARD", "name": "queryPatByCard", "layer": "Application", "type": "按卡查患者", "status": "PROPOSED",
      "args": ["query"], "returns": "Promise<PatientIdentity[]>", "calls": [], "parameterIds": [], "switchIds": [], "dataAccess": ["API_PAT_QUERY_BY_CARD"], "evidenceIds": [],
      "code": [
        "const queryPatByCard = (query: PatCardQuery): Promise<PatientIdentity[]> =>",
        "  http.get('/v2/patients/by-card', query);"
      ],
      "explain": ["多档案命中时返回集合由调用方弹选择。", "对齐 020 queryByCardType 语义，补充 ACTIVE 状态过滤为默认行为。"]
    }
  },
  "parameters": {},
  "switches": {
    "SW_ECON_OTHER_PAY": { "id": "SW_ECON_OTHER_PAY", "name": "Econ_Other_Pay", "status": "VERIFIED", "type": "boolean", "def": "off", "description": "三方支付开关：开启且支付方式非现金时挂号走微信 / 支付宝 POS 分支（020 AmbClinicRegistController.java:690）。", "source": "020 ClinicCommonUtil.isSwitchOn(\"Econ_Other_Pay\")" }
  },
  "enums": {
    "FeeType": { "id": "FeeType", "status": "INFERRED", "sourceStatus": "CODE_REFERENCED", "note": "003 源码仅证实 08=自费（默认）、07=职工医保、09=工伤；完整集合以字典维护为准。", "values": [
      { "code": "08", "label": "自费", "evidence": "003 PatadAmbRegistController.java:350 默认费别" },
      { "code": "07", "label": "职工医保", "evidence": "003 :1185 社保卡读卡分支" },
      { "code": "09", "label": "工伤", "evidence": "003 :1196 工伤接口读卡分支" }
    ] },
    "PayWay": { "id": "PayWay", "status": "INFERRED", "sourceStatus": "CODE_REFERENCED", "note": "020 源码证实 PTZH=普通账户、XJ=现金。", "values": [
      { "code": "PTZH", "label": "普通账户", "evidence": "020 AmbClinicRegistController.java:352/647" },
      { "code": "XJ", "label": "现金", "evidence": "020 :691 三方支付排除项" }
    ] },
    "CardQueryType": { "id": "CardQueryType", "status": "VERIFIED", "sourceStatus": "CODE_SET", "values": [
      { "code": "1", "label": "身份证 / 卡号（15/18 位自动识别）", "evidence": "003 :621-624 长度分支" },
      { "code": "MED_ID", "label": "其他证件（电子凭证等）", "evidence": "003 :624/:1153" }
    ] }
  },
  "dictionaries": {
    "D_ADMINISTRATIVE_DIVISIONS": { "id": "D_ADMINISTRATIVE_DIVISIONS", "name": "AdministrativeDivesions", "status": "VERIFIED", "fields": ["elementCode(前6位)", "liveAddr"], "source": "003 :1116/1158：证件号前 6 位对照行政区划回填户籍地址（源码字典码原样拼写 Divesions）" }
  },
  "tables": {
    "T_REG_PAT_MI": { "id": "T_REG_PAT_MI", "name": "患者主索引", "status": "INFERRED", "note": "pat/regpatmi/query 读写的 RegPatMIVO 实体，物理表名待服务端 Mapper 复核。" },
    "T_AMB_REGIST": { "id": "T_AMB_REGIST", "name": "门诊挂号记录", "status": "INFERRED", "note": "amb/regist/list/sourceregist 返回 AmbRegistVO[]，物理表名待复核。" },
    "T_AMB_SCHEDULE": { "id": "T_AMB_SCHEDULE", "name": "号源排班", "status": "INFERRED", "note": "排班表数据源（AmbScheduleVO），物理表名待复核。" }
  },
  "repositories": {},
  "apis": {
    "API_PAT_BY_IDNO": { "id": "API_PAT_BY_IDNO", "method": "GET", "path": "pat/getbyidno/query", "status": "VERIFIED", "purpose": "按身份证号查就诊卡号（电子凭证读卡后回查）", "source": "003 PatadAmbRegistController.java:1148" },
    "API_PAT_QUERY_BY_CARD": { "id": "API_PAT_QUERY_BY_CARD", "method": "GET", "path": "pat/regpatmi/query?cardCode&statusCode=ACTIVE", "status": "VERIFIED", "purpose": "按证件号查患者主索引（020 防重建档与回车查患者共用）", "source": "020 AmbClinicRegistController.java:443/611" },
    "API_REGIST_SOURCE_LIST": { "id": "API_REGIST_SOURCE_LIST", "method": "GET", "path": "amb/regist/list/sourceregist?createUser&startDateStr&endDateStr", "status": "VERIFIED", "purpose": "按医生查本月已挂号数量（月限额校验）", "source": "020 AmbClinicRegistController.java:586" },
    "API_VISIT_CODE": { "id": "API_VISIT_CODE", "method": "GET", "path": "patadAmb/query/visitCode?lockUser=", "status": "VERIFIED", "purpose": "003 预处理阶段获取并锁定 visitCode", "source": "003 RegistCommand.java:294-299；数据库序列见页面级 PRD #s9" },
    "API_REGIST_COST": { "id": "API_REGIST_COST", "method": "POST", "path": "/ambPatientcharge/amb/costs/byRegist", "status": "VERIFIED", "purpose": "003 收费窗打开前计算挂号费用", "source": "页面级 PRD #s8；费用 SQL / 事务仍待下钻" },
    "API_WINDOW_REGIST_INSERT": { "id": "API_WINDOW_REGIST_INSERT", "method": "POST", "path": "patad/evn/amb/windowRegist/insert", "status": "VERIFIED", "purpose": "003 / 020 收费窗确认后的客户端请求；020 服务端匹配路由仍待确认", "source": "003 CommitRcptRegisterAmbCommand.java:137；020 CommitRcptRegisterAmbCommand.java:130；详情见页面级 PRD #s16 / #s20" }
  }
};
