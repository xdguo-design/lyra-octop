/* 门诊挂号登记 · 接口子模型。LEGACY 调用点按客户端真实 REST 调用登记（路径可在源码复核）；V2 为目标逻辑方法，全部 PROPOSED。 */
window.CLINIC_REG_APIS_LEGACY = {
  "API_PAT_BY_IDNO": { "id": "API_PAT_BY_IDNO", "method": "GET", "path": "pat/getbyidno/query", "status": "VERIFIED", "purpose": "按身份证号查就诊卡号（电子凭证读卡后回查档案）", "source": "003 PatadAmbRegistController.java:1148" },
  "API_PAT_QUERY_BY_CARD": { "id": "API_PAT_QUERY_BY_CARD", "method": "GET", "path": "pat/regpatmi/query?cardCode&statusCode=ACTIVE", "status": "VERIFIED", "purpose": "按证件号查患者主索引（020 防重复建档与回车查患者共用）", "source": "020 AmbClinicRegistController.java:443/611" },
  "API_REGIST_SOURCE_LIST": { "id": "API_REGIST_SOURCE_LIST", "method": "GET", "path": "amb/regist/list/sourceregist?createUser&startDateStr&endDateStr", "status": "VERIFIED", "purpose": "按医生查本月已挂号数量（月挂号限额校验）", "source": "020 AmbClinicRegistController.java:586" }
};
window.CLINIC_REG_APIS_V2 = {
  "API_SCHEDULE_RESERVE": { "id": "API_SCHEDULE_RESERVE", "method": "SVC", "path": "/v2/schedules/{scheduleId}/reserve", "status": "PROPOSED", "purpose": "号源占用（服务端保证并发安全）" },
  "API_REG_SETTLE": { "id": "API_REG_SETTLE", "method": "SVC", "path": "/v2/regist-settle", "status": "PROPOSED", "purpose": "挂号费统一结算（现金 / 账户 / 三方支付）" }
};
