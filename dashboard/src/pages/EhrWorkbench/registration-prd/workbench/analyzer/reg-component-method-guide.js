/* 门诊挂号登记组件动作指南：按组件分组展示事件方法与源码依据。
   数据形态适配：components/switches 为字典；无 actions（事件即动作）；快照键与方法 id 同名，源码依据直接按 method.id 取 CLINIC_REG_LEGACY_SOURCE。 */
(function () {
  'use strict';
  const data = window.CLINIC_REG_CALL_ANALYSIS_DATA;
  const snapshots = window.CLINIC_REG_LEGACY_SOURCE || {};
  const apis = (data && data.apis) || {};
  const host = document.getElementById('componentGuideContent');
  const title = document.getElementById('graphTitle');
  if (!data || !host || !title) return;

  const methods = data.methods || {};
  const events = data.events || {};
  const switches = Array.isArray(data.switches) ? data.switches : Object.values(data.switches || {});
  const actions = Array.isArray(data.actions) ? data.actions : [];
  const components = {};
  if (Array.isArray(data.components)) data.components.forEach(component => { components[component.id] = component; });
  else Object.entries(data.components || {}).forEach(([id, component]) => { components[id] = typeof component === 'object' ? component : { id, name: component }; });
  const eventsByComponent = {};
  Object.values(events).forEach(event => {
    if (!event || !event.componentId) return;
    (eventsByComponent[event.componentId] = eventsByComponent[event.componentId] || []).push(event);
  });
  const actionsByComponent = {};
  actions.forEach(action => {
    if (!action || !action.componentId) return;
    (actionsByComponent[action.componentId] = actionsByComponent[action.componentId] || []).push(action);
  });
  // 挂号包 14 个组件全部登记了事件；此表仅作为模型缺登记时的诚实兜底位。
  const EMPTY_COMPONENT_NOTES = {};
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  let renderedComponentId = '';
  let eventTrees = [];

  function componentIdFromTitle() {
    const match = title.textContent.match(/^\s*(C\d{3})\b/);
    return match ? match[1] : components[Object.keys(components)[0]]?.id;
  }
  function switchName(id) {
    const item = switches.find(entry => entry.id === id);
    return item ? (id + (item.name ? ' · ' + item.name : '')) : id;
  }
  function apiName(id) {
    const api = apis[id];
    if (!api) return { text: id + ' · 接口字典未登记', ok: false };
    return { text: (api.method ? api.method + ' ' : '') + (api.path || id) + (api.purpose ? ' · ' + api.purpose : ''), ok: true };
  }
  function makeTree(event, id, depth, path) {
    const method = methods[id];
    const cyclic = path.includes(id);
    const nextPath = path.concat(id);
    return {
      eventId: event.id, id, depth, path: nextPath, method, cyclic,
      children: !cyclic && method ? (method.calls || []).map(childId => makeTree(event, childId, depth + 1, nextPath)) : []
    };
  }
  function countUnique(nodes, seen = new Set()) {
    nodes.forEach(node => { if (!seen.has(node.id)) { seen.add(node.id); countUnique(node.children, seen); } });
    return seen;
  }
  function findPath(eventTree, id, preferredPrefix = []) {
    const search = nodes => {
      for (const node of nodes) {
        if (node.id === id && preferredPrefix.every((part, i) => node.path[i] === part)) return node;
        const child = search(node.children); if (child) return child;
      }
      return null;
    };
    return search(eventTree.nodes);
  }
  function methodParameterNames(method) {
    const names = new Set();
    (method.args || []).forEach(value => {
      const text = String(value || '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(text)) names.add(text);
    });
    return names;
  }
  function formatCode(lines, parameterNames) {
    const source = lines.join('\n');
    if (!parameterNames.size) return esc(source);
    const tokenPattern = /(\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|[A-Za-z_$][\w$]*)/g;
    let result = '';
    let cursor = 0;
    for (const match of source.matchAll(tokenPattern)) {
      result += esc(source.slice(cursor, match.index));
      const token = match[0];
      result += /^[A-Za-z_$][\w$]*$/.test(token) && parameterNames.has(token)
        ? '<strong class="guide-code-parameter">' + token + '</strong>'
        : esc(token);
      cursor = match.index + token.length;
    }
    return result + esc(source.slice(cursor));
  }
  function codeBlocks(method, blocks, scopeKey) {
    const parameterNames = methodParameterNames(method);
    return blocks.map((block, index) => {
      const codeId = 'guide-code-' + esc(scopeKey) + '-' + method.id + '-' + index;
      const start = Number(block.startLine) || 1;
      const lines = block.code || [];
      const extension = (block.path || '').split('.').pop().toLowerCase();
      const language = ({ java: 'Java', xml: 'XML', fxml: 'FXML', js: 'JavaScript', sql: 'SQL' })[extension] || '文本';
      return '<section class="guide-code-block"><header><b>' + esc(block.version + ' · ' + block.label) + '</b>' + (block.path ? '<code>' + esc(block.path + ':' + start + '–' + block.endLine) + '</code>' : '') + '</header>' +
        '<div class="guide-code-meta">真实源码摘录 · ' + esc(language) + ' <span>粗体标记方法入参</span></div>' +
        '<button type="button" class="guide-code-toggle" data-guide-code="' + codeId + '" data-line-count="' + lines.length + '" aria-expanded="false">显示代码（' + lines.length + ' 行）</button>' +
        '<div class="guide-code" id="' + codeId + '" hidden><pre><code>' + formatCode(lines, parameterNames) + '</code></pre></div></section>';
    }).join('');
  }
  /* 挂号包源码依据：快照键与方法 id 同名（L003_/L020_ 逐行取自 E:\old\yy 工作副本）；
     M_ 前缀为 V2 目标模型方法，不冒充旧版事实，只渲染登记的参考实现。 */
  function sourceMarkup(method, eventId) {
    const blocks = snapshots[method.id] || [];
    if (!blocks.length) {
      if (method.id.indexOf('M_') === 0 || method.code) {
        return '<p class="guide-unknown">V2 目标方法，未绑定 003/020 源码证据；实现以登记的伪代码为准，不回填旧版行为。</p>';
      }
      return '<p class="guide-unknown">该方法未登记源码快照；如需核对请回源 003/020 工作副本。</p>';
    }
    const list = blocks.map(block => '<li><b>' + esc(block.version + ' · ' + block.label) + '</b><code>' + esc((block.path || '') + ':' + (block.startLine || '') + '–' + (block.endLine || '')) + '</code></li>').join('');
    const codes = codeBlocks(method, blocks, eventId);
    return '<section class="guide-source-group"><h4>方法实现源码</h4><ul class="guide-source-list">' + list + '</ul>' + codes + '</section>';
  }
  function renderMethodDetail(target, activeSelection) {
    if (!target) return;
    const eventTree = eventTrees.find(item => item.id === activeSelection.eventId);
    const event = eventTree?.event;
    const method = activeSelection && methods[activeSelection.id];
    if (!event) {
      target.innerHTML = '<div class="guide-detail-empty">选择方法，查看对应说明。</div>';
      return;
    }
    if (!method) {
      target.innerHTML = '<section class="guide-method-detail"><span class="evidence-state unknown">UNKNOWN</span><h2>' + esc(activeSelection.id || '方法') + '</h2><p class="guide-unknown">该方法尚未登记；保留树节点，不补猜方法内容。</p></section>';
      return;
    }
    const explain = method.explain || [];
    const explanationItems = explain.length ? explain.map(item => '<li>' + esc(item) + '</li>').join('') : '<li class="guide-unknown">未登记独立的方法说明；不根据源码名称推断。</li>';
    const pseudoLines = Array.isArray(method.code) ? method.code : null;
    const stepsMarkup = pseudoLines
      ? '<div class="guide-pseudocode"><div class="guide-code-meta">V2 参考实现 · 目标代码 <span>方法入参加粗</span></div><pre><code>' + formatCode(pseudoLines, methodParameterNames(method)) + '</code></pre></div>'
      : '<pre class="guide-pseudocode-empty"><code>// 当前方法未登记独立伪代码；Legacy 实现见下方源码依据</code></pre>';
    const args = method.args && method.args.length ? method.args.join('、') : '未登记';
    const returns = method.returns || '未登记';
    const resources = [
      ...(method.dataAccess || []).map(id => ({ kind: '数据访问', name: apiName(id).text })),
      ...(method.switchIds || []).map(id => ({ kind: '开关', name: switchName(id) }))
    ];
    const resourcesMarkup = resources.length ? '<section class="guide-detail-section"><h3>关联信息</h3><div class="guide-related-items">' + resources.map(item => '<span><b>' + esc(item.kind) + '</b> ' + esc(item.name) + '</span>').join('') + '</div></section>' : '';
    const childIds = method.calls || [];
    const childrenMarkup = childIds.length ? '<section class="guide-detail-section"><h3>子方法 / 子节点</h3><div class="guide-child-links">' + childIds.map(id => {
      const child = findPath(eventTree, id, activeSelection.path);
      const childMethod = methods[id];
      return '<button type="button" class="guide-child-link" data-guide-event="' + esc(event.id) + '" data-guide-method="' + esc(id) + '" data-guide-path="' + esc(JSON.stringify(child?.path || activeSelection.path.concat(id))) + '"><b>' + esc(childMethod?.name || id) + '</b><small>' + esc(childMethod?.type || childMethod?.status || 'UNKNOWN · 未登记') + '</small></button>';
    }).join('') + '</div></section>' : '';
    target.innerHTML = '<article class="guide-method-detail"><header><div><span class="evidence-state ' + esc((method.status || 'UNKNOWN').toLowerCase()) + '">' + esc(method.status || 'UNKNOWN') + '</span><small>' + esc(event.id + ' · ' + (event.trigger || '触发方式未登记')) + '</small></div></header>' +
      '<h2>' + esc(method.name) + (method.type ? ' · ' + esc(method.type) : '') + '</h2>' +
      '<section class="guide-detail-section"><h3>总结说明</h3><p>' + esc(explain[0] || '当前模型未登记方法说明。') + '</p></section>' +
      '<div class="guide-io"><section><h3>入参</h3><p>' + esc(args) + '</p></section><section><h3>出参</h3><p>' + esc(returns) + '</p></section></div>' +
      '<section class="guide-detail-section"><h3>行说明</h3><ol>' + explanationItems + '</ol><p class="guide-note">以上为模型登记的方法说明；未与源码行建立对应关系的内容不会标成具体行号。</p></section>' +
      '<section class="guide-detail-section"><h3>伪代码 / 参考实现</h3>' + stepsMarkup + '</section>' +
      childrenMarkup + resourcesMarkup +
      '<section class="guide-detail-section"><h3>源码依据</h3>' + sourceMarkup(method, event.id) + '</section></article>';
  }
  function actionCard(action) {
    return '<details class="component-action-card" open><summary class="action-card-head"><div><span class="action-card-kicker">业务动作 · ' + esc(action.fid || '') + '</span><span class="action-title">' + esc(action.name) + '</span></div><span class="action-method-count">' + (action.steps || []).length + ' 步</span></summary>' +
      '<div class="action-card-meta"><code>' + esc(action.id) + '</code><span>目标：' + esc(action.target || '未登记') + '</span></div>' +
      '<section class="guide-detail-section action-summary"><h4>执行步骤</h4><ol>' + (action.steps || []).map(step => '<li>' + esc(step) + '</li>').join('') + '</ol></section>' +
      '<div class="guide-io"><section><h3>失败边界</h3><p>' + esc(action.failure || '未登记') + '</p></section><section><h3>恢复路径</h3><p>' + esc(action.recovery || '未登记') + '</p></section></div>' +
      (action.legacy && action.legacy.length ? '<section class="guide-detail-section"><h3>Legacy 锚点</h3><p>' + action.legacy.map(item => esc(item)).join('；') + '</p></section>' : '') +
      '</details>';
  }
  function render() {
    const componentId = componentIdFromTitle();
    const component = components[componentId];
    if (!component) return;
    eventTrees = (eventsByComponent[componentId] || []).map(event => {
      return { id: event.id, event, nodes: (event.methodIds || []).map(id => makeTree(event, id, 0, [])) };
    });
    const methodCount = countUnique(eventTrees.flatMap(item => item.nodes)).size;
    const componentActions = actionsByComponent[componentId] || [];
    const cards = componentActions.map(actionCard).join('');
    const emptyNote = EMPTY_COMPONENT_NOTES[componentId];
    const emptyMarkup = emptyNote
      ? '<div class="method-empty"><b>' + esc(component.id + ' · ' + component.name) + '</b>　' + esc(emptyNote) + '</div>'
      : '<div class="method-empty">当前组件尚未登记事件或方法资料。</div>';
    const eventCards = eventTrees.length ? eventTrees.map(tree => {
      const name = tree.event?.name || '动作未登记';
      const trigger = tree.event?.trigger || '触发方式未登记';
      const summary = tree.event?.summary || '事件未登记独立说明。';
      const count = countUnique(tree.nodes).size;
      const flatMethods = [];
      const seenMethods = new Set();
      const collectMethods = nodes => nodes.forEach(node => {
        if (!node.cyclic && !seenMethods.has(node.id)) {
          seenMethods.add(node.id);
          flatMethods.push(node);
          collectMethods(node.children);
        }
      });
      collectMethods(tree.nodes);
      const methodList = tree.event ? flatMethods.map((node, index) => {
        const method = node.method;
        const methodName = method?.name || node.id;
        const status = method?.status || 'UNKNOWN';
        const targetId = 'action-method-' + tree.id + '-' + index;
        return '<details class="guide-flat-method"' + (index === 0 ? ' open' : '') + '><summary><code>' + esc(status) + '</code><b>' + esc(methodName) + '</b><span>' + esc(method?.type || method?.layer || '方法') + '</span></summary><section class="guide-detail" id="' + esc(targetId) + '" aria-live="polite"></section></details>';
      }).join('') : '<p class="guide-unknown">该事件未登记，无法显示方法详情。</p>';
      return '<details class="component-action-card" data-action-card="' + esc(tree.id) + '" open><summary class="action-card-head"><div><span class="action-card-kicker">事件动作</span><span class="action-title">' + esc(name) + '</span></div><span class="action-method-count">' + count + ' 个方法</span></summary>' +
        '<div class="action-card-meta"><code>' + esc(tree.id) + '</code><span>' + esc(trigger) + '</span></div>' +
        '<section class="guide-detail-section action-summary"><h4>动作说明</h4><p>' + esc(summary) + '</p></section>' +
        (tree.event ? '<div class="guide-flat-method-list">' + (methodList || '<p class="guide-unknown">该动作当前没有登记可达方法。</p>') + '</div>' : '') + '</details>';
    }).join('') : emptyMarkup;
    const versionTags = (component.versionTags || []).join(' / ');
    const stats = (componentActions.length ? componentActions.length + ' 个业务动作 · ' : '') + eventTrees.length + ' 个事件 · ' + methodCount + ' 个方法';
    const heading = '<header class="guide-reader-heading"><div><h2>' + esc(component.id + ' · ' + component.name) + '：动作说明</h2><p class="component-scope-note"><strong>' + esc(component.groupName || '') + ' · ' + esc(component.kind || '') + (versionTags ? ' · ' + esc(versionTags) : '') + '</strong> · 证据级别 ' + esc(component.evidenceStatus || 'UNKNOWN') + '；事件方法按登记信息展示，源码快照可展开核对。</p></div><span>' + stats + '</span></header>';
    host.innerHTML = '<div class="guide-method-reader action-reader">' + heading + '<div class="component-action-list">' + cards + eventCards + '</div></div>';
    eventTrees.forEach(tree => {
      const flatMethods = [];
      const seenMethods = new Set();
      const collectMethods = nodes => nodes.forEach(node => {
        if (!node.cyclic && !seenMethods.has(node.id)) {
          seenMethods.add(node.id);
          flatMethods.push(node);
          collectMethods(node.children);
        }
      });
      collectMethods(tree.nodes);
      flatMethods.forEach((node, index) => {
        const target = host.querySelector('[id="action-method-' + tree.id + '-' + index + '"]');
        if (target) renderMethodDetail(target, { eventId: tree.id, id: node.id, path: node.path });
      });
    });
    renderedComponentId = componentId;
  }
  host.addEventListener('click', event => {
    const codeButton = event.target.closest('[data-guide-code]');
    if (codeButton) {
      const code = document.getElementById(codeButton.dataset.guideCode);
      if (!code) return;
      const expanded = codeButton.getAttribute('aria-expanded') !== 'true';
      code.hidden = !expanded;
      codeButton.setAttribute('aria-expanded', String(expanded));
      codeButton.textContent = expanded ? '隐藏代码' : '显示代码（' + codeButton.dataset.lineCount + ' 行）';
      return;
    }
    const methodButton = event.target.closest('[data-guide-method]');
    if (!methodButton) return;
    const path = JSON.parse(methodButton.dataset.guidePath || '[]');
    const nextSelection = { eventId: methodButton.dataset.guideEvent, id: methodButton.dataset.guideMethod, path };
    eventTrees.forEach(tree => {
      if (tree.id !== nextSelection.eventId) return;
      const card = host.querySelector('[data-action-card="' + tree.id + '"]');
      if (!card) return;
      card.querySelectorAll('.guide-tree-node').forEach(node => {
        const button = node.querySelector(':scope > .guide-tree-method');
        const selected = button && button.dataset.guideEvent === nextSelection.eventId && button.dataset.guideMethod === nextSelection.id && JSON.stringify(JSON.parse(button.dataset.guidePath || '[]')) === JSON.stringify(nextSelection.path);
        node.classList.toggle('is-selected', !!selected);
        if (button) button.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      const detailTarget = card.querySelector('.guide-flat-method [data-guide-method="' + CSS.escape(nextSelection.id) + '"]');
      const detail = detailTarget ? detailTarget.closest('.guide-flat-method').querySelector('.guide-detail') : null;
      const fallback = detail || card.querySelector('.guide-detail');
      if (fallback) {
        fallback.closest('.guide-flat-method')?.setAttribute('open', '');
        renderMethodDetail(fallback, nextSelection);
      }
    });
  });
  let queued = false;
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; render(); }); }
  new MutationObserver(schedule).observe(title, { childList: true, characterData: true, subtree: true });
  render();
})();
