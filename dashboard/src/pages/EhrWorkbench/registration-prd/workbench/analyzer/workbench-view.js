(function () {
  "use strict";
  const data = window.CLINIC_REG_CALL_ANALYSIS_DATA;
  const analysisTab = document.getElementById("viewTabAnalysis");
  const canvasTab = document.getElementById("viewTabCanvas");
  const modeTabs = document.getElementById("analysisModeTabs");
  const shell = document.getElementById("workbenchShell");
  const analysisTop = document.getElementById("analysisTopContent");
  const canvasView = document.getElementById("canvasView");
  const frame = document.getElementById("canvasFrame");
  const hierarchy = document.getElementById("hierarchyExplanation");
  const methodGuide = document.getElementById("methodGuideView");
  const eventSelect = document.getElementById("eventSelect");
  if (
    !data ||
    !analysisTab ||
    !canvasTab ||
    !modeTabs ||
    !shell ||
    !analysisTop ||
    !canvasView ||
    !frame ||
    !eventSelect
  )
    return;

  const modeTabsById = {
    graph: document.getElementById("analysisModeGraph"),
    full: document.getElementById("analysisModeFull"),
    guide: document.getElementById("analysisModeGuide"),
  };
  let activeMode = "graph";
  let canvasLoaded = false;
  let canvasReady = false;
  const targetByComponent = {
    C001: "z2ScheduleQuery",
    C002: "z3Schedule",
    C003: "z2PatQuery",
    C004: "wb-C004",
    C005: "wb-C005",
    C006: "z5Regist",
    C007: "wb-C007",
    C008: "wb-C008",
    C009: "wb-C009",
    C010: "wb-C010",
    C011: "wb-C011",
    C012: "wb-C012",
    C013: "wb-C013",
    C014: "wb-C014",
  };

  function setVisible(node, visible) {
    if (node) node.hidden = !visible;
  }
  function updateMode(mode) {
    activeMode = mode;
    Object.entries(modeTabsById).forEach(([key, tab]) => {
      if (!tab) return;
      const active = key === mode;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    setVisible(analysisTop, mode === "graph");
    setVisible(hierarchy, mode === "full");
    setVisible(methodGuide, mode === "guide");
    shell.hidden = false;
  }

  function selectEvent(eventId) {
    if (!eventId || !data.events[eventId]) return false;
    eventSelect.value = eventId;
    eventSelect.dispatchEvent(new Event("change", { bubbles: true }));
    syncCanvasComponent(data.events[eventId].componentId);
    return true;
  }

  function syncCanvasComponent(componentId) {
    if (!canvasReady || !frame.contentWindow || !targetByComponent[componentId])
      return;
    frame.contentWindow.postMessage(
      {
        source: "pd-reg-workbench",
        type: "select-component",
        componentId,
        targetId: targetByComponent[componentId],
      },
      location.origin,
    );
  }

  function openCanvas() {
    analysisTab.classList.remove("active");
    analysisTab.setAttribute("aria-selected", "false");
    canvasTab.classList.add("active");
    canvasTab.setAttribute("aria-selected", "true");
    modeTabs.hidden = true;
    shell.classList.add("canvas-mode");
    setVisible(canvasView, true);
    setVisible(document.getElementById("call-graph"), false);
    if (!canvasLoaded) {
      frame.src = "reg-canvas.html?workbench=1";
      canvasLoaded = true;
    }
  }

  function openAnalysis() {
    analysisTab.classList.add("active");
    analysisTab.setAttribute("aria-selected", "true");
    canvasTab.classList.remove("active");
    canvasTab.setAttribute("aria-selected", "false");
    modeTabs.hidden = false;
    shell.classList.remove("canvas-mode");
    setVisible(canvasView, false);
    setVisible(document.getElementById("call-graph"), true);
    updateMode(activeMode);
  }

  analysisTab.addEventListener("click", openAnalysis);
  canvasTab.addEventListener("click", openCanvas);
  modeTabsById.graph?.addEventListener("click", () => updateMode("graph"));
  modeTabsById.full?.addEventListener("click", () => updateMode("full"));
  modeTabsById.guide?.addEventListener("click", () => updateMode("guide"));
  eventSelect.addEventListener("change", () =>
    syncCanvasComponent(data.events[eventSelect.value]?.componentId),
  );
  frame.addEventListener("load", () => {
    if (!frame.contentWindow) return;
    frame.contentWindow.postMessage(
      { source: "pd-reg-workbench", type: "handshake-request" },
      location.origin,
    );
  });

  window.addEventListener("message", (event) => {
    if (
      event.source !== frame.contentWindow ||
      event.origin !== location.origin
    )
      return;
    const message = event.data;
    if (
      !message ||
      message.source !== "pd-reg-canvas" ||
      typeof message.type !== "string"
    )
      return;
    if (message.type === "ready") {
      canvasReady = true;
      syncCanvasComponent(data.events[eventSelect.value]?.componentId);
      return;
    }
    if (
      message.type !== "runtime-link" ||
      typeof message.modelEventId !== "string"
    )
      return;
    const targetEventId = data.prdRuntimeEventMap[message.modelEventId];
    if (!targetEventId) {
      const summary = document.getElementById("prdActionSummary");
      if (summary)
        summary.innerHTML =
          "<strong>该画布事件尚未映射到 43 项 PRD 动作</strong><br>事件标识：" +
          String(message.modelEventId).replace(/[&<>"']/g, "") +
          " · UNKNOWN";
      return;
    }
    selectEvent(targetEventId);
  });

  document
    .getElementById("componentTree")
    ?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-component-id]");
      const component = button && data.components[button.dataset.componentId];
      const eventId = component && (component.eventIds || [])[0];
      if (eventId) selectEvent(eventId);
    });

  setVisible(hierarchy, false);
  setVisible(methodGuide, false);
})();
