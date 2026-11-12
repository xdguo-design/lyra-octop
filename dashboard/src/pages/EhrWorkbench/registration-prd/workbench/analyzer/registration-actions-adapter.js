(function () {
  "use strict";
  const data = window.CLINIC_REG_CALL_ANALYSIS_DATA;
  const actions = window.CLINIC_REG_PRD_ACTIONS;
  if (!data || !Array.isArray(actions)) return;

  const sourceEvents = data.events;
  const directEvents = {
    "E-01": "EVT_SCHEDULE_QUERY",
    "E-02": "EVT_SCHEDULE_REFRESH",
    "E-03": "EVT_ECON_SKIP",
    "E-04": "EVT_READ_ID_CARD",
    "E-05": "EVT_READ_ECERT",
    "E-07": "EVT_READ_MI_CARD",
    "E-08": "EVT_PAT_QUERY_CARD",
    "E-14": "EVT_REGIST_SUBMIT",
    "E-15": "EVT_SCHEDULE_SELECT",
    "E-16": "EVT_REGIST_CANCEL",
    "E-17": "EVT_REGIST_LIST",
    "E-18": "EVT_PRINT_GUIDE",
    "E-21": "EVT_REGIST_COMMIT",
    "E-35": "EVT_CREATE_PAT_CARD",
  };
  const runtimeEvents = { ...directEvents, "E-17": "EVT_MY_SCHEDULE" };
  const directMethods = {
    "E-36": ["L003_BACK_CARD"],
    "E-A01": ["L003_REGIST_CMD"],
  };
  const componentByAction = {
    "E-01": "C001",
    "E-02": "C001",
    "E-03": "C012",
    "E-04": "C005",
    "E-05": "C005",
    "E-06": "C005",
    "E-07": "C005",
    "E-08": "C003",
    "E-09": "C003",
    "E-10": "C013",
    "E-11": "C013",
    "E-12": "C004",
    "E-13": "C013",
    "E-14": "C006",
    "E-15": "C002",
    "E-16": "C007",
    "E-17": "C008",
    "E-18": "C011",
    "E-19": "C008",
    "E-20": "C008",
    "E-21": "C014",
    "E-22": "C014",
    "E-23": "C015",
    "E-24": "C015",
    "E-25": "C015",
    "E-26": "C015",
    "E-27": "C016",
    "E-28": "C016",
    "E-29": "C016",
    "E-30": "C016",
    "E-31": "C016",
    "E-32": "C016",
    "E-33": "C016",
    "E-34": "C016",
    "E-35": "C013",
    "E-36": "C013",
    "E-A01": "C006",
    "E-A02": "C014",
    "E-A03": "C007",
    "E-A04": "C006",
    "E-A05": "C006",
    "E-A06": "C006",
    "E-A07": "C014",
  };
  const inferredComponents = [
    {
      id: "C015",
      name: "预约与取号区",
      groupId: "appointment",
      groupName: "预约与取号（逻辑映射）",
    },
    {
      id: "C016",
      name: "挂号分诊台",
      groupId: "triage",
      groupName: "挂号分诊（逻辑映射）",
    },
  ];
  for (const component of inferredComponents) {
    data.components[component.id] = {
      ...component,
      kind: "frontend",
      eventIds: [],
      versionTags: ["INFERRED"],
      evidenceStatus: "INFERRED",
    };
    data.groups.push({
      id: component.groupId,
      name: component.groupName,
      componentIds: [component.id],
    });
  }
  Object.values(data.components).forEach((component) => {
    component.eventIds = [];
  });

  const events = {};
  const actionByEventId = {};
  for (const action of actions) {
    const eventId = "PRD_" + action.id.replaceAll("-", "_");
    const componentId = componentByAction[action.id] || "C006";
    const sourceEvent = sourceEvents[directEvents[action.id]];
    const methodIds = sourceEvent
      ? [...(sourceEvent.methodIds || [])]
      : [...(directMethods[action.id] || [])];
    const inferredLink = !sourceEvent && methodIds.length > 0;
    const evidenceStatus = sourceEvent
      ? sourceEvent.status || "VERIFIED"
      : inferredLink
      ? "INFERRED"
      : "UNKNOWN";
    events[eventId] = {
      id: eventId,
      componentId,
      name: action.id + " · " + action.title,
      trigger: action.trigger || "UNKNOWN",
      methodIds,
      status: evidenceStatus,
      summary: [
        "PRD 前置：" + (action.precondition || "无明确前置条件"),
        "成功：" + (action.success || "未登记"),
        "失败：" + (action.failure || "未登记"),
        "PRD 调用：" + (action.legacyAction || "未登记"),
      ].join("；"),
    };
    data.components[componentId].eventIds.push(eventId);
    actionByEventId[eventId] = action;
  }
  data.events = events;
  data.prdActionByEventId = actionByEventId;
  data.prdActionEventMap = Object.fromEntries(
    actions.map((action) => [
      action.id,
      "PRD_" + action.id.replaceAll("-", "_"),
    ]),
  );
  data.prdRuntimeEventMap = Object.fromEntries(
    Object.entries(runtimeEvents).map(([actionId, sourceEventId]) => [
      sourceEventId,
      data.prdActionEventMap[actionId],
    ]),
  );
  data.prdActionEvidence = {
    directEventMappings: directEvents,
    methodOnlyMappings: directMethods,
    unmappedCount: actions.filter((action) => {
      const eventId = data.prdActionEventMap[action.id];
      return events[eventId].methodIds.length === 0;
    }).length,
  };
})();
