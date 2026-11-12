/* 门诊挂号登记 · 枚举与字典子模型。取值口径来自 003/020 源码中出现的真实代码值；未给全集合的标 INFERRED 并注明。 */
window.CLINIC_REG_ENUMS = {
  "FeeType": { "id": "FeeType", "status": "INFERRED", "sourceStatus": "CODE_REFERENCED", "note": "003 源码仅证实 08=自费（默认费别）、07=职工医保（社保卡读卡分支）、09=工伤（工伤接口读卡分支）；完整费别集合以字典维护为准。", "values": [
    { "code": "08", "label": "自费", "evidence": "003 PatadAmbRegistController.java:350 默认费别" },
    { "code": "07", "label": "职工医保", "evidence": "003 :1185 dgAmbBusiness.readMiCaedIdNo 分支" },
    { "code": "09", "label": "工伤", "evidence": "003 :1196 miInjuryInterface.readCard 分支" }
  ] },
  "PayWay": { "id": "PayWay", "status": "INFERRED", "sourceStatus": "CODE_REFERENCED", "note": "020 源码证实 PTZH=普通账户、XJ=现金；完整集合以 PayWayEnum 为准。", "values": [
    { "code": "PTZH", "label": "普通账户", "evidence": "020 AmbClinicRegistController.java:352/647" },
    { "code": "XJ", "label": "现金", "evidence": "020 :691 三方支付分支排除项" }
  ] },
  "CardQueryType": { "id": "CardQueryType", "status": "VERIFIED", "sourceStatus": "CODE_SET", "values": [
    { "code": "1", "label": "身份证 / 卡号（15/18 位自动识别）", "evidence": "003 :621-624 长度分支" },
    { "code": "MED_ID", "label": "其他证件（电子凭证等）", "evidence": "003 :624/:1153" }
  ] }
};
window.CLINIC_REG_DICTIONARIES = {
  "D_ADMINISTRATIVE_DIVISIONS": { "id": "D_ADMINISTRATIVE_DIVISIONS", "name": "AdministrativeDivesions", "status": "VERIFIED", "fields": ["elementCode(前6位)", "liveAddr"], "source": "003 PatadAmbRegistController.java:1116/1158：读卡后取证件号前 6 位对照行政区划回填户籍地址（源码字典码原样拼写 Divesions）" }
};
window.CLINIC_REG_TABLES_LEGACY = {
  "T_REG_PAT_MI": { "id": "T_REG_PAT_MI", "name": "患者主索引", "status": "INFERRED", "note": "020 pat/regpatmi/query 读写的主索引实体（RegPatMIVO），物理表名待服务端 Mapper 复核。" },
  "T_AMB_REGIST": { "id": "T_AMB_REGIST", "name": "门诊挂号记录", "status": "INFERRED", "note": "amb/regist/list/sourceregist 返回 AmbRegistVO[]，物理表名待服务端复核。" },
  "T_AMB_SCHEDULE": { "id": "T_AMB_SCHEDULE", "name": "号源排班", "status": "INFERRED", "note": "排班表数据源（AmbScheduleVO），物理表名待服务端复核。" }
};
window.CLINIC_REG_TABLES_V2 = {
  "T_SCHEDULE_V2": { "id": "T_SCHEDULE_V2", "name": "号源（V2 逻辑表）", "status": "PROPOSED", "note": "当前阶段业务逻辑表名，非最终物理表名。" },
  "T_REGIST_V2": { "id": "T_REGIST_V2", "name": "挂号记录（V2 逻辑表）", "status": "PROPOSED", "note": "当前阶段业务逻辑表名，非最终物理表名。" }
};
