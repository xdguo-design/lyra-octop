(function () {
  "use strict";
  const data = window.CLINIC_REG_CALL_ANALYSIS_DATA;
  const source = window.CLINIC_REG_LEGACY_SOURCE || {};
  if (!data) return;

  const esc = (value) =>
    String(value == null ? "" : value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  let activeEventId = "";
  let activeMethodId = "";

  function collect(event) {
    const queue = (event.methodIds || []).map((id) => ({
      id,
      depth: 0,
      path: [],
    }));
    const best = new Map();
    const cycles = new Set();
    for (let cursor = 0; cursor < queue.length && cursor < 2500; cursor += 1) {
      const item = queue[cursor];
      if (item.path.includes(item.id)) {
        cycles.add(item.id);
        continue;
      }
      const old = best.get(item.id);
      if (old && old.depth <= item.depth) continue;
      best.set(item.id, item);
      const method = data.methods[item.id];
      if (!method || item.depth >= 12) continue;
      const path = [...item.path, item.id];
      (method.calls || []).forEach((id) =>
        queue.push({ id, depth: item.depth + 1, path }),
      );
    }
    return {
      items: [...best.values()].sort(
        (left, right) =>
          left.depth - right.depth || left.id.localeCompare(right.id),
      ),
      cycles,
    };
  }

  function priorityFor(component) {
    return (
      component.businessPriority ||
      component.priorityLevel ||
      component.priority ||
      "待分级"
    );
  }

  function sourceMarkup(method) {
    const blocks = source[method.id] || [];
    if (!blocks.length)
      return '<p class="explain-missing">未登记 003 / 020 实现源码；不得把方法说明或伪代码作为旧版源码展示。</p>';
    return blocks
      .map((block, index) => {
        const codeId = "prd-legacy-" + method.id + "-" + index;
        const lines = (block.code || [])
          .map(
            (line, lineIndex) =>
              "<div><i>" +
              (Number(block.startLine || 1) + lineIndex) +
              "</i><code>" +
              esc(line) +
              "</code></div>",
          )
          .join("");
        return (
          '<section class="guide-code-block"><header><b>' +
          esc(block.version + " · " + block.label) +
          "</b><code>" +
          esc(block.path + ":" + block.startLine + "–" + block.endLine) +
          "</code></header>" +
          '<button type="button" class="guide-code-toggle" data-legacy-code="' +
          esc(codeId) +
          '" aria-expanded="false">显示源码（' +
          (block.code || []).length +
          " 行）</button>" +
          '<div class="guide-code" id="' +
          esc(codeId) +
          '" hidden>' +
          lines +
          "</div></section>"
        );
      })
      .join("");
  }

  function card(item, event, cycles) {
    const method = data.methods[item.id];
    if (!method)
      return (
        '<article class="explain-card unknown"><b>' +
        esc(item.id) +
        "</b><span>UNKNOWN · 方法未登记。</span></article>"
      );
    const component = data.components[event.componentId] || {};
    const priority = priorityFor(component);
    const args = (method.args || []).length
      ? method.args.join("、")
      : "模型未登记入参";
    const calls = (method.calls || [])
      .map((id) =>
        data.methods[id]
          ? '<button type="button" data-hierarchy-method="' +
            esc(id) +
            '">' +
            esc(data.methods[id].name) +
            " · " +
            esc(data.methods[id].status || "UNKNOWN") +
            "</button>"
          : "<span>" + esc(id) + " · UNKNOWN（未登记）</span>",
      )
      .join("");
    const apis =
      (method.dataAccess || [])
        .map((id) => {
          const api = (data.apis || {})[id];
          return (
            "<p>" +
            esc(
              api
                ? [api.name, api.method, api.path, api.status]
                    .filter(Boolean)
                    .join(" · ")
                : id + " · 接口定义未登记",
            ) +
            "</p>"
          );
        })
        .join("") || "<p>没有登记数据表或接口访问。</p>";
    const priorityText =
      priority === "待分级"
        ? "PRD 未登记此组件的 P0/P1/P2 映射，保持待分级。"
        : "依据组件登记优先级与其需求映射。";
    return (
      '<article class="explain-card' +
      (activeMethodId === method.id ? " selected" : "") +
      '" data-explanation-method="' +
      esc(method.id) +
      '">' +
      '<header><button type="button" class="explain-method-link" data-hierarchy-method="' +
      esc(method.id) +
      '"><span>A' +
      item.depth +
      "</span><b>" +
      esc(method.name) +
      "</b><small>" +
      esc(method.id + " · " + (method.type || method.layer || "方法")) +
      '</small></button><span class="hierarchy-priority unrated">' +
      esc(priority) +
      '</span><span class="evidence-state ' +
      esc((method.status || "UNKNOWN").toLowerCase()) +
      '">' +
      esc(method.status || "UNKNOWN") +
      "</span></header>" +
      '<div class="explain-grid">' +
      '<section class="explain-field"><h4>职责与入口</h4><p>' +
      esc((method.explain || [])[0] || "UNKNOWN：尚无职责说明。") +
      "</p><p>当前动作：" +
      esc(event.name) +
      " · " +
      esc(event.trigger || "触发方式 UNKNOWN") +
      "</p></section>" +
      '<section class="explain-field"><h4>参数与返回</h4><p><b>入参：</b>' +
      esc(args) +
      "</p><p><b>出参：</b>" +
      esc(method.returns || "UNKNOWN：模型未登记返回类型。") +
      "</p></section>" +
      '<section class="explain-field"><h4>执行步骤与分支</h4>' +
      ((method.explain || []).length
        ? "<ol>" +
          method.explain.map((line) => "<li>" + esc(line) + "</li>").join("") +
          "</ol>"
        : "<p>UNKNOWN：没有登记步骤或条件分支。</p>") +
      "</section>" +
      '<section class="explain-field"><h4>数据与接口</h4>' +
      apis +
      "</section>" +
      '<section class="explain-field"><h4>下游调用与结果</h4>' +
      (calls
        ? '<div class="explain-links">' + calls + "</div>"
        : "<p>没有登记下游调用。</p>") +
      "</section>" +
      '<section class="explain-field"><h4>业务重要程度 P</h4><p><b>' +
      esc(priority) +
      "</b> · " +
      esc(priorityText) +
      "</p></section>" +
      '<section class="explain-field"><h4>003 / 020 旧版源码</h4>' +
      sourceMarkup(method) +
      "<p>源码状态：" +
      esc(method.status || "UNKNOWN") +
      "。动作到方法之间的映射状态见当前事件状态。</p></section>" +
      "</div>" +
      (cycles.has(method.id)
        ? '<p class="cycle-note">检测到调用回边，已停止递归以避免循环展开。</p>'
        : "") +
      "</article>"
    );
  }

  function render() {
    const select = document.getElementById("eventSelect");
    const event = data.events[select && select.value];
    if (!event) return;
    activeEventId = event.id;
    const action = data.prdActionByEventId && data.prdActionByEventId[event.id];
    const component = data.components[event.componentId] || {};
    const eventLabel = document.getElementById("hierarchyEventLabel");
    if (eventLabel)
      eventLabel.textContent =
        (component.id || "UNKNOWN") +
        " · " +
        (component.name || "未映射组件") +
        " / " +
        event.name;
    const { items, cycles } = collect(event);
    const summary = document.getElementById("hierarchyPrioritySummary");
    const levels = ["P0", "P1", "P2", "待分级"];
    if (summary)
      summary.innerHTML = levels
        .map((level) => {
          const matches = items.filter(
            (item) => priorityFor(component) === level,
          );
          const note =
            level === "待分级"
              ? "当前 PRD 未登记组件优先级映射；不从源码或动作名称推断。"
              : matches.length
              ? "按已登记需求映射归类。"
              : "当前事件无已登记的此级别方法。";
          return (
            '<section class="priority-group priority-' +
            level.toLowerCase().replace("待分级", "unrated") +
            '"><header><b>' +
            level +
            "</b><span>" +
            matches.length +
            " 个方法</span></header><p>" +
            esc(note) +
            "</p><div>" +
            (matches
              .map(
                (item) =>
                  '<button type="button" data-hierarchy-method="' +
                  esc(item.id) +
                  '">' +
                  esc(data.methods[item.id].name) +
                  "</button>",
              )
              .join("") || "<small>—</small>") +
            "</div></section>"
          );
        })
        .join("");
    const host = document.getElementById("hierarchyMethodDetails");
    if (host)
      host.innerHTML = items.length
        ? [...new Set(items.map((item) => item.depth))]
            .sort((a, b) => a - b)
            .map(
              (depth) =>
                '<section class="depth-group"><h3>A' +
                depth +
                " <small>调用深度</small></h3>" +
                items
                  .filter((item) => item.depth === depth)
                  .map((item) => card(item, event, cycles))
                  .join("") +
                "</section>",
            )
            .join("")
        : '<div class="unknown-analysis"><b>' +
          esc(event.name) +
          " · UNKNOWN</b>" +
          esc(event.summary || "此动作尚未登记可追溯的方法调用链。") +
          "<p>可查到的 PRD 触发、前置条件、读写、成功/失败与后续说明在方法逐层解读视图；当前没有可展示的 003/020 实现源码。</p></div>";
    const actionSummary = document.getElementById("prdActionSummary");
    if (actionSummary)
      actionSummary.innerHTML = action
        ? "<strong>" +
          esc(action.id + " · " + action.title) +
          " · " +
          esc(event.status) +
          "</strong><br>触发：" +
          esc(action.trigger || "UNKNOWN") +
          "；前置：" +
          esc(action.precondition || "无") +
          "<br>PRD 调用记录：" +
          esc(action.legacyAction || "UNKNOWN")
        : "";
    if (event.methodIds && event.methodIds[0])
      activeMethodId = event.methodIds[0];
    syncSelected();
  }

  function syncSelected() {
    document
      .querySelectorAll("[data-explanation-method]")
      .forEach((node) =>
        node.classList.toggle(
          "selected",
          node.dataset.explanationMethod === activeMethodId,
        ),
      );
  }

  function queueRender() {
    window.requestAnimationFrame(render);
  }
  document
    .getElementById("eventSelect")
    ?.addEventListener("change", queueRender);
  document.addEventListener("click", (event) => {
    const node = event.target.closest(
      "#callGraph [data-method-id], #textTree [data-method-id]",
    );
    if (node) {
      activeMethodId = node.dataset.methodId;
      syncSelected();
    }
    const hierarchyMethod = event.target.closest("[data-hierarchy-method]");
    if (hierarchyMethod) {
      activeMethodId = hierarchyMethod.dataset.hierarchyMethod;
      syncSelected();
    }
    const codeButton = event.target.closest("[data-legacy-code]");
    if (codeButton) {
      const code = document.getElementById(codeButton.dataset.legacyCode);
      if (!code) return;
      const open = codeButton.getAttribute("aria-expanded") !== "true";
      code.hidden = !open;
      codeButton.setAttribute("aria-expanded", String(open));
      codeButton.textContent = open
        ? "隐藏源码"
        : "显示源码（" + code.children.length + " 行）";
    }
  });
  new MutationObserver(() => {
    const method = document.getElementById("methodName");
    const found = Object.entries(data.methods).find(
      ([, value]) => value.name === method?.textContent,
    );
    if (found) {
      activeMethodId = found[0];
      syncSelected();
    }
  }).observe(document.getElementById("methodName"), {
    childList: true,
    characterData: true,
    subtree: true,
  });
  queueRender();
})();
