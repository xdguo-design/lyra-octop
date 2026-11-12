/* 门诊挂号登记 · 前端参数与开关子模型（精简版）。
   口径同门诊收费包：只有参数表（Legacy DICT_SWITCH）维护的才算参数；本包当前仅登记源码可证实的开关。 */
window.CLINIC_REG_FRONTEND_LOGIC = {
  "switchSources": [
    { "id": "SW_ECON_OTHER_PAY", "code": "Econ_Other_Pay", "readPoint": "020 AmbClinicRegistController.java:690 ClinicCommonUtil.isSwitchOn", "behavior": "开启且支付方式非现金时，挂号提交走三方支付分支；关闭时直接执行挂号命令（POS 快捷支付代码在 020 中已整体注释）。" }
  ],
  "params": [],
  "notes": [
    "003 的月挂号限额取自人员档案 monRegistLimit 字段（020 源码 :568），不是参数表参数。",
    "费别默认值 08（自费）硬编码在 003 患者模型监听中（:350），未见参数化读取点。"
  ]
};
