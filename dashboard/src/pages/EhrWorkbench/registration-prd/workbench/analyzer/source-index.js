/* Local-only source index viewer. Imported source JSON stays in this browser's IndexedDB. */
(function () {
  'use strict';

  var DB_NAME = 'pd-outpatient-source-index';
  var STORE = 'source-index';
  var MAX_FILE_BYTES = 128 * 1024 * 1024;
  var index = null;
  var symbols = Object.create(null);
  var components = [];
  var events = Object.create(null);
  var references = [];
  var activeComponent = '';
  var activeEvent = null;
  var activeMethod = '';
  var activeLine = 0;
  var activeRootMethod = '';
  var version = 'all';
  var dbPromise;
  var businessBindings = {
    C001: { fxIds: ['queryType'], evidenceStatus: 'VERIFIED' },
    C002: { fxIds: ['ambPatMsg'], evidenceStatus: 'INFERRED' },
    C003: { evidenceStatus: 'INFERRED', unresolvedReason: '患者信息卡片由多个界面字段组合呈现，尚未定位单一 FXML 控件。' },
    C004: { evidenceStatus: 'UNKNOWN', unresolvedReason: '003/020 查询由患者输入框 ENTER 触发；当前主 FXML 未发现独立查询按钮。' },
    C013: { fxIds: ['ambPatientCharges'], evidenceStatus: 'INFERRED' },
    C019: { fxIds: ['econrcpt'], evidenceStatus: 'INFERRED' },
    C021: { handlers: ['jumpAmbRetail'], evidenceStatus: 'INFERRED' },
    C022: { handlers: ['clear'], evidenceStatus: 'INFERRED' },
    C024: { handlers: ['readCardMI', 'miECReadCard'], evidenceStatus: 'INFERRED' }
  };

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function setState(message, ready) {
    var node = $('sourceIndexState');
    if (!node) return;
    node.textContent = message;
    node.setAttribute('data-ready', ready ? 'true' : 'false');
    node.title = message;
  }
  function relativePath(path) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return false;
    return path.split(/[\\/]/).every(function (part) { return part && part !== '..'; });
  }
  function validateIndex(value) {
    if (!value || value.schemaVersion !== '1.0' || !Array.isArray(value.projects) ||
        !Array.isArray(value.components) || !value.symbols || typeof value.symbols !== 'object' ||
        !Array.isArray(value.callEdges) || !Array.isArray(value.references)) {
      throw new Error('索引结构或版本不受支持');
    }
    var profile = value.profile || (String(value.sourceRootLabel || '').indexOf('refund') !== -1 ? 'refund' : 'charge');
    if (profile !== 'charge') throw new Error('这不是 charge 源码索引；请使用 --profile charge 重新生成');
    var allowed = { '003': true, '020': true };
    value.projects.forEach(function (p) { if (!allowed[p.version]) throw new Error('索引包含未支持的版本'); });
    value.components.forEach(function (c) {
      if (!allowed[c.version] || !relativePath(c.file) || !Array.isArray(c.events)) throw new Error('组件路径或结构无效');
    });
    Object.keys(value.symbols).forEach(function (id) {
      var s = value.symbols[id];
      if (!relativePath(s.file) || !Number.isInteger(s.startLine) || !Number.isInteger(s.endLine)) throw new Error('源码符号位置无效');
    });
    value.callEdges.forEach(function (e) {
      if (typeof e.id !== 'string' || !Number.isInteger(e.line)) throw new Error('调用边结构无效');
    });
    return value;
  }
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('此浏览器不支持本地索引缓存')); return; }
      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () { request.result.createObjectStore(STORE); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('打开本地缓存失败')); };
    });
    return dbPromise;
  }
  function storeIndex(value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, 'latest');
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error || new Error('保存本地缓存失败')); };
      });
    });
  }
  function readIndex() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var request = db.transaction(STORE, 'readonly').objectStore(STORE).get('latest');
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error || new Error('读取本地缓存失败')); };
      });
    });
  }
  function clearIndex() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error || new Error('清除本地缓存失败')); };
      });
    });
  }
  function install(value) {
    document.querySelectorAll('#eventSelect option[data-source-index="true"]').forEach(function (option) { option.remove(); });
    document.querySelectorAll('.source-mapping-link').forEach(function (button) { button.remove(); });
    activeEvent = null; activeComponent = ''; activeRootMethod = '';
    var eventSelect = $('eventSelect');
    if (eventSelect && eventSelect.options.length && eventSelect.value.indexOf('source::') === 0) { eventSelect.selectedIndex = 0; eventSelect.dispatchEvent(new Event('change', { bubbles: true })); }
    index = validateIndex(value);
    symbols = index.symbols;
    components = index.components;
    references = index.references;
    events = Object.create(null);
    components.forEach(function (component) {
      component.events.forEach(function (event) { events[event.id] = event; event.component = component; });
    });
    renderComponents($('componentSearch') ? $('componentSearch').value : '');
    decorateVersionMappings();
    var diagnostics = Array.isArray(index.diagnostics) ? index.diagnostics : [];
    setState('已载入 · ' + components.length + ' 控件', true);
    renderReferenceInfo([]);
  }
  function importFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setState('文件超过 128 MB 限制', false); return; }
    setState('正在读取本地索引…', false);
    var reader = new FileReader();
    reader.onerror = function () { setState('读取失败：' + (reader.error && reader.error.message || '未知错误'), false); };
    reader.onload = function () {
      try {
        var value = validateIndex(JSON.parse(String(reader.result)));
        storeIndex(value).then(function () {
          install(value);
        }).catch(function (error) { setState('本地缓存失败：' + error.message, false); });
      } catch (error) { setState('索引无效：' + error.message, false); }
    };
    reader.readAsText(file, 'utf-8');
  }
  function visibleComponents() {
    var query = ($('componentSearch') ? $('componentSearch').value : '').trim().toLowerCase();
    return components.filter(function (c) {
      if (version !== 'all' && c.version !== version) return false;
      var model = window.CLINIC_REG_CALL_ANALYSIS_DATA;
      var linkedLabels = model && model.components ? Object.keys(businessBindings).filter(function (businessId) {
        return boundSourceComponents(businessId, 'all').some(function (source) { return source.id === c.id; });
      }).map(function (businessId) { return businessId + ' ' + (model.components[businessId].name || ''); }).join(' ') : '';
      return !query || [c.id, c.name, c.fxId, c.tag, c.group, c.version,
        linkedLabels,
        c.events.map(function (e) {
          var targets = (e.methodIds || []).map(function (id) { var method = symbols[id]; return method ? method.name + ' ' + method.className : id; });
          return [e.name, e.trigger, e.handler || '', (e.callbackCalls || []).map(function (call) { return call.expression || call.name; }).join(' '), targets.join(' ')].join(' ');
        }).join(' ')
      ].join(' ').toLowerCase().includes(query);
    });
  }
  function boundSourceComponents(businessId, targetVersion) {
    var binding = businessBindings[businessId];
    if (!binding) return [];
    return components.filter(function (component) {
      if (targetVersion !== 'all' && component.version !== targetVersion) return false;
      var fxMatch = (binding.fxIds || []).indexOf(component.fxId) !== -1;
      var handlerMatch = component.events.some(function (event) { return (binding.handlers || []).indexOf(event.handler) !== -1; });
      return fxMatch || handlerMatch;
    });
  }
  function renderMappingSummary() {
    var box = $('sourceMappingSummary');
    if (!box) return;
    var totalBusiness = Object.keys((window.CLINIC_REG_CALL_ANALYSIS_DATA && window.CLINIC_REG_CALL_ANALYSIS_DATA.components) || {}).length;
    var bindingIds = Object.keys(businessBindings);
    if (!index) {
      box.innerHTML = '<div class="coverage-row"><b>业务组件 ↔ 源码映射</b><span class="coverage-value">待导入索引</span></div>' +
        '<div class="coverage-row"><span>已登记映射规则</span><span>' + bindingIds.length + ' / ' + (totalBusiness || '—') + '</span></div>' +
        '<small>只统计有明确 fx:id / handler 规则的业务组件；未登记项不会按名称自动猜测。</small>';
      return;
    }

    var matched = bindingIds.filter(function (businessId) {
      return boundSourceComponents(businessId, 'all').length > 0;
    });
    var unresolved = bindingIds.filter(function (businessId) {
      return boundSourceComponents(businessId, 'all').length === 0;
    });
    var matched003 = matched.filter(function (businessId) {
      return boundSourceComponents(businessId, '003').length > 0;
    }).length;
    var matched020 = matched.filter(function (businessId) {
      return boundSourceComponents(businessId, '020').length > 0;
    }).length;

    box.innerHTML = '<div class="coverage-row"><b>业务组件 ↔ 源码映射</b><span class="coverage-value">' + matched.length + ' / ' + (totalBusiness || bindingIds.length) + '</span></div>' +
      '<div class="coverage-row"><span>003 可定位</span><span>' + matched003 + '</span></div>' +
      '<div class="coverage-row"><span>020 可定位</span><span>' + matched020 + '</span></div>' +
      '<div class="coverage-row"><span>有规则但未命中</span><span>' + unresolved.length + '</span></div>' +
      '<small>其余业务组件保持语义模型状态；没有明确源码证据时不自动绑定。</small>';
  }

  function displayGroup(component) {
    var identity = [component.fxId, component.name, component.tag].concat((component.events || []).map(function (event) { return event.handler || event.name; })).join(' ').toLowerCase();
    if (/(querytype|ambpatmsg|mycardcode|query|search|clinicpat)/.test(identity)) return '查询区域';
    if (/(ambpatientcharges|fee|price|charge|addprice|addnum|doctorcode|executeorg|prescription)/.test(identity) || /(table|tree)/.test(String(component.tag).toLowerCase())) return '费用列表区';
    if (/(receipt|rcpt|refund|retail|clear|unlock|readcard|jump|miin|account)/.test(identity) || /(button|menuitem)/.test(String(component.tag).toLowerCase())) return '操作区';
    return component.group && component.group !== 'children' ? component.group : '页面控件';
  }
  function decorateBusinessComponents() {
    if (!index) return;
    document.querySelectorAll('#componentTree [data-component-id]').forEach(function (button) {
      if (button.querySelector('.source-business-link')) return;
      var businessId = button.getAttribute('data-component-id');
      var matches = boundSourceComponents(businessId, 'all');
      var sourceEvents = matches.reduce(function (all, component) { return all.concat(component.events || []); }, []);
      if (sourceEvents.length) {
        var eventBadge = button.querySelector('.event-badge');
        if (!eventBadge) { eventBadge = document.createElement('span'); eventBadge.className = 'event-badge'; button.insertBefore(eventBadge, button.querySelector('.kind')); }
        eventBadge.textContent = '有事件';
        eventBadge.title = '本地源码索引关联：' + sourceEvents.map(function (event) { return event.name; }).join('、');
      }
      if (!matches.length && !businessBindings[businessId]) return;
      var label = document.createElement('span'); label.className = 'source-business-link';
      var binding = businessBindings[businessId];
      label.textContent = (binding.evidenceStatus || 'INFERRED') + (matches.length > 1 ? ' · 003/020' : matches.length ? ' · 源码' : '');
      if (!matches.length) label.classList.add('unknown');
      label.title = binding.unresolvedReason || ('源码关联证据：' + (binding.evidenceStatus || 'INFERRED'));
      button.appendChild(label);
    });
    document.querySelectorAll('#componentTree [data-component-id]').forEach(function (button) {
      if (button.dataset.sourceBusinessBound === 'true') return;
      button.dataset.sourceBusinessBound = 'true';
      button.addEventListener('click', function () {
        var selectedVersion = version === 'v2' ? 'all' : version;
        var matches = boundSourceComponents(button.getAttribute('data-component-id'), selectedVersion);
        if (!matches.length && selectedVersion !== 'all') matches = boundSourceComponents(button.getAttribute('data-component-id'), 'all');
        if (!matches.length) return;
        var preferred = selectedVersion === '020' ? '020' : '003';
        var component = matches.find(function (item) { return item.version === preferred; }) || matches[0];
        selectComponent(component.id);
      });
    });
  }
  function renderComponents() {
    var root = $('sourceComponentTree');
    if (!root) return;
    if (!index) {
      root.innerHTML = '<div class="source-tree-wrap"><details class="source-index-tree"><summary>真实源码控件 <small>导入本地索引后显示</small></summary><div class="source-tree-empty">索引载入后可浏览 003 / 020 的 FXML 控件与事件；业务组件保持在上方目录。</div></details></div>';
      renderMappingSummary();
      return;
    }
    var rows = visibleComponents();
    var groups = Object.create(null);
    rows.forEach(function (c) {
      var key = c.version + ' · ' + displayGroup(c);
      (groups[key] || (groups[key] = [])).push(c);
    });
    var html = '<div class="source-tree-wrap"><details class="source-index-tree"><summary>真实源码控件 <small>' + rows.length + ' / ' + components.length + '</small></summary><div class="source-index-groups">';
    Object.keys(groups).sort().forEach(function (key) {
      html += '<div class="source-source-group"><h4>' + esc(key) + ' · ' + groups[key].length + '</h4>';
      groups[key].forEach(function (c) {
        html += '<button type="button" data-source-component="' + esc(c.id) + '" class="' + (c.id === activeComponent ? 'active' : '') + '">' +
          '<span class="source-id">' + esc(c.fxId || c.tag) + '</span><span>' + esc(c.name) + '</span>' + (c.events.length ? '<span class="source-event-badge" title="' + esc(c.events.map(function (event) { return event.name; }).join('、')) + '">事件 ' + c.events.length + '</span>' : '') + '<span class="source-evidence">' + esc(c.evidenceStatus || 'VERIFIED') + '</span></button>';
      });
      html += '</div>';
    });
    if (!rows.length) html += '<div class="source-tree-empty">没有匹配的源码控件。</div>';
    html += '</div></details></div>';
    root.innerHTML = html;
    root.querySelectorAll('[data-source-component]').forEach(function (button) {
      button.addEventListener('click', function () { selectComponent(button.getAttribute('data-source-component')); });
    });
    decorateBusinessComponents();
    renderMappingSummary();
  }
  function selectComponent(id) {
    activeComponent = id;
    var component = components.find(function (c) { return c.id === id; });
    if (!component) return;
    renderComponents();
    var sourceDetails = $('sourceComponentTree').querySelector('details');
    if (sourceDetails) sourceDetails.open = true;
    var select = $('eventSelect');
    var first = component.events[0];
    if (!first) { renderEmptyComponent(component); return; }
    component.events.forEach(function (event) {
      var value = 'source::' + event.id;
      if (!Array.prototype.some.call(select.options, function (option) { return option.value === value; })) {
        var option = document.createElement('option'); option.value = value;
        option.textContent = component.version + ' · ' + (component.fxId || component.name) + ' · ' + event.name;
        option.dataset.sourceIndex = 'true'; select.appendChild(option);
      }
    });
    activeEvent = first;
    select.value = 'source::' + first.id;
    renderEvent(first);
  }
  function renderEmptyComponent(component) {
    activeRootMethod = '';
    $('graphTitle').textContent = component.version + ' · ' + component.name;
    $('callGraph').innerHTML = '<div class="empty">该控件在 FXML 第 ' + component.line + ' 行可定位，未发现可静态解析的事件处理器。</div>';
    $('textTree').textContent = component.name + '\n└─ FXML ' + component.file + ':' + component.line + '\n   └─ Java 事件：UNKNOWN';
    renderComponentSource(component);
  }
  function renderComponentSource(component) {
    activeRootMethod = '';
    $('lineTitle').textContent = 'FXML 控件 · ' + component.name;
    $('codeLines').start = component.line;
    $('codeLines').innerHTML = '<li value="' + component.line + '">' + esc(component.source || ('<' + component.tag + (component.fxId ? ' fx:id="' + component.fxId + '"' : '') + '>')) + '</li>';
    $('lineExplain').start = component.line;
    $('lineExplain').innerHTML = '<li value="' + component.line + '">VERIFIED · FXML 控件位置；事件与 Controller 绑定见调用目录。</li>';
    $('methodType').textContent = component.tag + ' · FXML';
    $('methodArgs').textContent = component.fxId || '无 fx:id';
    $('methodUses').textContent = component.events.length + ' 个事件';
    $('methodIo').textContent = component.controller || 'Controller 未声明';
    sourceFileInfo(component.file, component.line, component.line);
    renderSourceUsage('');
  }
  function renderListenerSource(event, call) {
    activeRootMethod = '';
    var component = event.component;
    var line = call && call.line || event.line;
    var rows = call ? [call] : [{ line: event.line, source: event.source, status: event.status, expression: event.name }].concat(event.callbackCalls || []);
    var byLine = Object.create(null);
    rows.forEach(function (row) { if (!byLine[row.line]) byLine[row.line] = row; });
    var sourceRows = Object.keys(byLine).map(function (n) { return byLine[n]; }).sort(function (a, b) { return a.line - b.line; });
    $('lineTitle').textContent = (call ? '事件回调调用 · ' : 'Java 事件注册 · ') + event.name;
    $('codeLines').start = line;
    $('codeLines').innerHTML = sourceRows.map(function (row) { return '<li value="' + row.line + '" class="' + (row.line === line ? 'source-current' : '') + '">' + esc(row.source || row.expression || event.name) + '</li>'; }).join('');
    $('lineExplain').start = line;
    $('lineExplain').innerHTML = sourceRows.map(function (row) {
      var explanation = row.line === event.line ? (event.unresolvedReason || 'Java 监听器注册位置；回调目标按源码索引结果展示。') : (row.targetLabel || row.expression || '回调方法调用');
      return '<li value="' + row.line + '">' + esc((row.status || 'UNKNOWN') + ' · ' + explanation) + '</li>';
    }).join('');
    $('methodType').textContent = 'Java listener · ' + (call && call.status || event.status);
    $('methodArgs').textContent = call ? (call.arguments || []).join(', ') || call.expression : (event.callbackCalls || []).map(function (entry) { return entry.expression || entry.name; }).join(', ') || '无可解析回调';
    $('methodUses').textContent = '事件注册 · ' + event.trigger;
    $('methodIo').textContent = component.version + ' · ' + component.name;
    sourceFileInfo(event.file || component.file, line, line);
    renderReferenceInfo([]);
    renderSourceUsage('');
  }
  function sourceFileInfo(file, start, end) {
    var box = $('sourceFileInfo');
    if (!box) return;
    box.innerHTML = '<a class="source-file-link" href="#" title="仓库相对路径；点击复制" data-source-path="' + esc(file) + '">' +
      esc(file) + ':' + start + (end && end !== start ? '-' + end : '') + '</a>';
    box.querySelector('a').addEventListener('click', function (event) {
      event.preventDefault();
      if (navigator.clipboard) navigator.clipboard.writeText(file + ':' + start);
    });
  }
  function callTarget(call, versionName) {
    if (call.targetId) return call.targetId;
    if (call.endpoint) return 'api:' + versionName + ':' + call.name + ':' + call.endpoint;
    return 'external:' + versionName + ':' + call.expression;
  }
  function callsOf(method) { return Array.isArray(method.callSites) ? method.callSites : []; }
  function statusOf(call) { return call.endpoint ? 'VERIFIED' : (call.status || 'UNKNOWN'); }
  function nodeHtml(id, call, callerId) {
    var method = symbols[id];
    if (method) {
      var facts = (method.facts || []).filter(function (fact) { return fact.kind === 'branch' || fact.kind === 'throw'; }).slice(0, 3);
      var factsHtml = facts.length ? '<span class="source-node-facts">' + facts.map(function (fact) { return esc(fact.kind === 'branch' ? fact.expression : 'throw ' + fact.expression) + ' · L' + fact.line; }).join('<br>') + '</span>' : '';
      return '<div class="node ' + (method.evidenceStatus === 'VERIFIED' ? 'purple' : 'err') + ' source-node' + (activeMethod === id ? ' selected' : '') + '" role="button" tabindex="0" aria-pressed="' + (activeMethod === id) + '" data-source-method="' + esc(id) + '">' +
        '<b>' + esc(method.name) + '</b><small>' + esc(method.className) + ' · ' + esc(method.evidenceStatus || 'VERIFIED') + ' · L' + method.startLine + '</small>' + factsHtml + '</div>';
    }
    var endpoint = call && call.endpoint;
    var label = endpoint ? call.name.toUpperCase() + ' ' + endpoint : (call && (call.targetLabel || call.expression) || id);
    return '<div class="node ' + (endpoint ? 'api' : 'err') + ' source-node" role="button" tabindex="0" data-source-call="' + esc(id) + '" data-caller="' + esc(callerId || '') + '" data-line="' + esc(call && call.line || 0) + '">' +
      '<b>' + esc(label) + '</b><small>' + (endpoint ? 'API · VERIFIED · L' + esc(call.line) : '未解析目标 · UNKNOWN · L' + esc(call && call.line || 0)) + '</small></div>';
  }
  function wireSourceNodes() {
    document.querySelectorAll('[data-source-method]').forEach(function (node) {
      function pick() { focusMethod(node.getAttribute('data-source-method')); }
      node.addEventListener('click', pick);
      node.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); } });
    });
    document.querySelectorAll('[data-source-call]').forEach(function (node) {
      function pick() { renderExternalCall(node.getAttribute('data-caller'), Number(node.getAttribute('data-line'))); }
      node.addEventListener('click', pick);
      node.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); } });
    });
  }
  function collectGraph(event) {
    var roots = event.methodIds || [];
    var levels = [];
    var queue = roots.map(function (id) { return { id: id, depth: 0 }; });
    var visited = new Set();
    var budget = 240;
    while (queue.length && budget > 0) {
      var current = queue.shift();
      var key = current.id + '@' + current.depth;
      if (current.depth > 8 || visited.has(key)) continue;
      visited.add(key); budget--;
      (levels[current.depth] || (levels[current.depth] = [])).push(current.id);
      var symbol = symbols[current.id];
      if (!symbol || current.depth === 8) continue;
      callsOf(symbol).forEach(function (call) { queue.push({ id: callTarget(call, symbol.version), depth: current.depth + 1 }); });
    }
    return { levels: levels, truncated: queue.length > 0 };
  }
  function renderGraph(event) {
    var data = collectGraph(event);
    var component = event.component;
    var callbackTargetIds = new Set();
    var callbackCalls = event.callbackCalls || [];
    var displayCallbacks = callbackCalls.filter(function (call) { return call.targetId || call.endpoint || call.status === 'UNKNOWN'; });
    displayCallbacks.forEach(function (call) { if (call.targetId) callbackTargetIds.add(call.targetId); });
    var roots = displayCallbacks.map(function (call) {
      return { id: call.targetId || callTarget(call, component.version), call: call, callerId: event.id };
    });
    (event.methodIds || []).forEach(function (id) {
      if (!callbackTargetIds.has(id)) roots.push({ id: id, call: null, callerId: event.id });
    });
    var budget = { count: 0, max: 240 };
    function renderBranch(id, call, callerId, stack, depth) {
      budget.count++;
      var method = symbols[id];
      var card = nodeHtml(id, call, callerId);
      if (!method || stack.has(id) || depth >= 8 || budget.count >= budget.max) return '<div class="method-branch">' + card + '</div>';
      var calls = callsOf(method);
      if (!calls.length) return '<div class="method-branch">' + card + '</div>';
      var nextStack = new Set(stack); nextStack.add(id);
      var inset = (50 / calls.length) + '%';
      return '<div class="method-branch">' + card + '<div class="call-children ' + (calls.length === 1 ? 'single' : '') + '" style="--branch-count:' + calls.length + ';--branch-inset:' + inset + '">' +
        calls.map(function (childCall) {
          var target = callTarget(childCall, method.version);
          return '<div class="call-child">' + renderBranch(target, childCall, id, nextStack, depth + 1) + '</div>';
        }).join('') + '</div></div>';
    }
    var inset = (50 / Math.max(roots.length, 1)) + '%';
    var html = '<div class="method-flow"><div class="node event"><b>' + esc(event.name) + '</b><small>' + esc(event.trigger || 'event') + ' · ' + esc(event.status || 'UNKNOWN') + ' · ' + esc(component.version) + '</small></div>';
    if (roots.length) html += '<div class="call-children ' + (roots.length === 1 ? 'single' : '') + '" style="--branch-count:' + roots.length + ';--branch-inset:' + inset + '">' + roots.map(function (root) {
      return '<div class="call-child">' + renderBranch(root.id, root.call, root.callerId, new Set(), 0) + '</div>';
    }).join('') + '</div>';
    html += '</div>';
    if (!roots.length) html += '<div class="empty">事件已从 FXML/Java 源码定位，但没有可静态解析的方法目标。</div>';
    if (data.truncated || budget.count >= budget.max) html += '<div class="rule-note">调用图按登记的源码调用关系展开；超出显示上限的节点已省略。</div>';
    $('callGraph').innerHTML = html;
    wireSourceNodes();
  }
  function treeRows(methodId, prefix, last, stack, out, budget) {
    var method = symbols[methodId];
    out.push(prefix + (last ? '└─ ' : '├─ ') + (method ? method.name + ' [' + (method.evidenceStatus || 'VERIFIED') + ' · L' + method.startLine + ']' : methodId + ' [UNKNOWN]'));
    if (!method || stack.has(methodId) || budget.count > 180) return;
    var nextStack = new Set(stack); nextStack.add(methodId);
    var calls = callsOf(method);
    calls.forEach(function (call, i) {
      var target = callTarget(call, method.version);
      var child = symbols[target];
      out.push(prefix + (last ? '   ' : '│  ') + (i === calls.length - 1 ? '└─ ' : '├─ ') +
        (child ? child.name + ' [' + (call.status || 'VERIFIED') + ' · L' + call.line + ']' :
          (call.endpoint ? 'API ' + call.name.toUpperCase() + ' ' + call.endpoint : call.expression) + ' [' + statusOf(call) + ' · L' + call.line + ']'));
      budget.count++;
      if (child) treeRows(child.id, prefix + (last ? '   ' : '│  ') + (i === calls.length - 1 ? '   ' : '│  '), i === calls.length - 1, nextStack, out, budget);
    });
  }
  function renderTree(event) {
    var rows = [event.component.name,
      '└─ ' + event.name + ' [' + (event.status || 'UNKNOWN') + ' · ' + (event.file || event.component.file) + ':' + event.line + ']'];
    var budget = { count: 0 };
    (event.callbackCalls || []).forEach(function (call, i, calls) {
      rows.push('   ' + (i === calls.length - 1 && !(event.methodIds || []).length ? '└─ ' : '├─ ') + (call.targetLabel || call.expression || call.name) + ' [' + (call.status || 'UNKNOWN') + ' · L' + call.line + ']');
    });
    (event.methodIds || []).forEach(function (id, i, all) { treeRows(id, '   ', i === all.length - 1, new Set(), rows, budget); });
    if (budget.count > 180) rows.push('… 更多调用关系可在图中逐方法展开');
    $('textTree').innerHTML = rows.map(function (row, index) {
      var match = row.match(/^((?:│  |   )*)(?:├─ |└─ )?(.*)$/) || ['', '', row];
      var depth = Math.floor(match[1].length / 3) + (/^(?:├─ |└─ )/.test(row) && index > 0 ? 1 : 0);
      var label = match[2];
      var kind = index === 0 ? 'root' : /事件/.test(label) ? 'event' : /API|http/i.test(label) ? 'api' : /UNKNOWN|错误|异常/.test(label) ? 'rule' : 'method';
      var marker = kind === 'root' ? '◉' : kind === 'event' ? '◆' : kind === 'api' ? '◈' : '○';
      return '<div class="tree-row ' + kind + '" role="treeitem" style="--depth:' + depth + '"><span class="tree-marker">' + marker + '</span><span class="tree-label">' + esc(label) + '</span></div>';
    }).join('');
  }
  function renderEvent(event) {
    activeEvent = event;
    activeComponent = event.component.id;
    $('graphTitle').textContent = (event.component.id || '') + ' ' + (event.component.name || event.component.fxId || '');
    renderGraph(event);
    renderTree(event);
    var root = event.methodIds && event.methodIds[0];
    activeRootMethod = root || '';
    if (root) {
      renderMethod(root);
      if (event.file && event.file !== symbols[root].file) {
        var box = $('sourceReferenceInfo');
        box.classList.add('has-details');
        box.innerHTML = '<b>事件入口</b><div>' + esc(event.file + ':' + event.line + ' · ' + event.name) + '</div>' + box.innerHTML;
      }
    } else if (event.file) renderListenerSource(event);
    else renderComponentSource(event.component);
    renderComponents();
  }
  function focusMethod(id) {
    var method = symbols[id];
    if (!method) return;
    renderMethod(id);
    document.querySelectorAll('[data-source-method]').forEach(function (node) {
      var selected = node.getAttribute('data-source-method') === id;
      node.classList.toggle('selected', selected);
      node.setAttribute('aria-pressed', String(selected));
    });
  }
  function renderMethod(id, line) {
    var method = symbols[id];
    if (!method) return;
    activeMethod = id; activeLine = line || 0;
    var selectedVersion = $('versionFocus') && $('versionFocus').value !== 'all' ? $('versionFocus').value : 'V1.2.0';
    $('lineTitle').textContent = '运行解析 · ' + method.name + ' (' + selectedVersion + ')';
    $('methodName').textContent = method.name;
    var owner = components.find(function (item) { return item.id === activeComponent; }) || {};
    $('methodOwner').textContent = (owner.name || method.className || '未知组件') + '（' + (owner.id || activeComponent || 'UNKNOWN') + '）';
    var hasSource = typeof method.source === 'string' && method.source.trim().length > 0;
    var sourceLines = hasSource ? method.source.split('\n') : [];
    var start = method.startLine || 1;
    $('codeLines').start = start;
    $('codeLines').innerHTML = hasSource ? sourceLines.map(function (code, i) {
      var n = start + i;
      return '<li value="' + n + '" data-source-line="' + n + '" class="' + (n === activeLine ? 'source-current' : '') + '">' + esc(code) + '</li>';
    }).join('') : '<li class="source-empty">未登记可核实的源码片段</li>';
    var explanation = Object.create(null);
    (method.facts || []).forEach(function (fact) { explanation[fact.line] = (explanation[fact.line] || []).concat(fact.evidenceStatus + ' · ' + fact.expression); });
    callsOf(method).forEach(function (call) {
      var target = call.endpoint ? call.name.toUpperCase() + ' ' + call.endpoint : (call.targetLabel || call.expression);
      explanation[call.line] = (explanation[call.line] || []).concat(statusOf(call) + ' · 调用 ' + target);
    });
    $('lineExplain').start = start;
    $('lineExplain').innerHTML = hasSource ? sourceLines.map(function (_code, i) {
      var n = start + i;
      var facts = explanation[n] || ['源码行；暂无更细结构事实。'];
      return '<li value="' + n + '" class="' + (n === activeLine ? 'source-current' : '') + '">' + esc(facts.join('；')) + '</li>';
    }).join('') : ['入参：' + ((method.args || []).join(', ') || '无'), '出参：' + (method.returnType || method.returns || '未登记'), '原始源码位置：' + method.file + ':' + method.startLine + '-' + method.endLine].map(function (fact) { return '<li>' + esc(fact) + '</li>'; }).join('');
    $('codeLines').querySelectorAll('[data-source-line]').forEach(function (row) {
      row.addEventListener('click', function () { renderMethod(id, Number(row.getAttribute('data-source-line'))); });
    });
    var refs = references.filter(function (r) { return r.symbolId === id; });
    var endpointCalls = callsOf(method).filter(function (c) { return c.endpoint; }).map(function (c) { return c.name.toUpperCase() + ' ' + c.endpoint; });
    $('methodType').textContent = method.className + ' · ' + method.evidenceStatus;
    $('methodArgs').textContent = (method.args || []).join(', ') || '无';
    $('methodReturns').textContent = method.returnType || method.returns || '未从源码声明中提取';
    $('methodUses').textContent = refs.length + ' 处直接引用（索引范围）';
    $('methodIo').textContent = endpointCalls.join(' · ') || '未发现已验证接口调用';
    sourceFileInfo(method.file, method.startLine, method.endLine);
    renderReferenceInfo(refs);
    renderSourceUsage(id);
  }
  function renderSourceUsage(methodId) {
    var box = $('sourceUsageSummary');
    if (!box) return;
    var method = symbols[methodId];
    if (!index || !method) {
      box.innerHTML = '<div class="source-usage-empty">' + (index ? '选择源码方法后显示当前索引范围的引用统计。' : '导入本地索引后显示源码引用统计。') + '</div>';
      return;
    }
    var incoming = references.filter(function (reference) { return reference.symbolId === methodId; }).length;
    var directMethods = callsOf(method).filter(function (call) { return call.targetId && symbols[call.targetId]; }).length;
    var apiCalls = callsOf(method).filter(function (call) { return !!call.endpoint; }).length;
    box.innerHTML = '<div><strong>' + incoming + '</strong><span>直接引用位置</span></div>' +
      '<div><strong>' + directMethods + '</strong><span>项目内方法调用</span></div>' +
      '<div><strong>' + apiCalls + '</strong><span>接口路径调用</span></div>';
    var byFile = new Map();
    references.filter(function (reference) { return reference.symbolId === methodId; }).forEach(function (reference) {
      var caller = symbols[reference.callerId];
      var path = caller && caller.file || '';
      if (!path) return;
      var name = path.split(/[\\/]/).pop();
      var entry = byFile.get(name) || { name: name, count: 0, path: path };
      entry.count++;
      byFile.set(name, entry);
    });
    var rows = Array.from(byFile.values()).sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); }).slice(0, 5);
    var list = $('usageList');
    if (list) {
      list.dataset.count = rows.length;
      list.innerHTML = rows.map(function (row) { return '<div class="use" title="' + esc(row.path) + '"><b>' + esc(row.name) + '</b><strong>' + row.count + '</strong><span>' + esc(row.path) + '</span></div>'; }).join('');
    }
  }
  function renderExternalCall(callerId, line) {
    var method = symbols[callerId];
    if (!method) {
      var event = events[callerId];
      var callback = event && (event.callbackCalls || []).find(function (call) { return Number(call.line) === line; });
      if (event && callback) renderListenerSource(event, callback);
      return;
    }
    activeRootMethod = callerId;
    var call = callsOf(method).find(function (c) { return Number(c.line) === line; });
    $('lineTitle').textContent = (call && call.endpoint ? '接口调用 · ' + call.endpoint : '未解析调用 · ' + (call && call.expression || 'UNKNOWN'));
    $('codeLines').start = line;
    $('codeLines').innerHTML = '<li value="' + line + '" class="source-current">' + esc(call && call.expression || '') + '</li>';
    $('lineExplain').start = line;
    $('lineExplain').innerHTML = '<li value="' + line + '">' + esc(call && call.endpoint ? 'VERIFIED · 源码调用中包含该接口路径。' : 'UNKNOWN · 调用目标未能在索引范围内解析。') + '</li>';
    $('methodType').textContent = call && call.endpoint ? 'API · ' + method.version : '外部/未解析符号 · ' + method.version;
    $('methodArgs').textContent = (call && call.arguments || []).join(', ') || 'UNKNOWN';
    $('methodUses').textContent = '调用位置 ' + method.file + ':' + line;
    $('methodIo').textContent = call && call.endpoint || '目标位于索引范围外或动态分派';
    sourceFileInfo(method.file, line, line);
    renderReferenceInfo([]);
    renderSourceUsage(callerId);
  }
  function renderReferenceInfo(refs) {
    var box = $('sourceReferenceInfo');
    if (!box) return;
    var places = refs.slice(0, 8).map(function (r) {
      var from = symbols[r.callerId];
      return esc(from ? from.name + ' · ' + from.file + ':' + r.line : '调用位置 L' + r.line);
    });
    var diagnostics = index && Array.isArray(index.diagnostics) ? index.diagnostics : [];
    var detail = diagnostics.map(function (d) { return esc(d.version || '索引') + ' · ' + esc(d.code || 'DIAGNOSTIC') + ' · ' + esc(d.message || ''); });
    box.classList.add('has-details');
    box.innerHTML = '<b>源码引用（当前索引范围）</b><div>' + (places.length ? places.join('<br>') : '没有其他已解析的直接引用位置。') + '</div>' +
      (detail.length ? '<b>解析诊断</b><div>' + detail.join('<br>') + '</div>' : '');
  }
  function decorateVersionMappings() {
    var root = $('versionMap');
    if (!root || !index) return;
    root.querySelectorAll('.step').forEach(function (step) {
      if (step.querySelector('.source-mapping-link')) return;
      var name = step.querySelector('b');
      if (!name) return;
      var column = step.closest('.vcol');
      if (!column || column.classList.contains('v2')) return;
      var columnVersion = column.classList.contains('v020') ? '020' : '003';
      var value = name.textContent.trim();
      var matches = Object.keys(symbols).map(function (id) { return symbols[id]; }).filter(function (s) { return s.name === value && s.version === columnVersion; });
      if (matches.length !== 1) return;
      var symbol = matches[0];
      var button = document.createElement('button'); button.type = 'button'; button.className = 'source-mapping-link';
      button.textContent = '打开源码 · ' + symbol.version + ' · L' + symbol.startLine;
      button.addEventListener('click', function () { focusMethod(symbol.id); $('callGraph').scrollIntoView({ block: 'nearest' }); });
      step.appendChild(button);
    });
  }
  function wire() {
    var picker = $('sourceIndexFile');
    if (picker) picker.addEventListener('change', function () { importFile(picker.files && picker.files[0]); picker.value = ''; });
    var clear = $('sourceIndexClear');
    if (clear) clear.addEventListener('click', function () {
      clearIndex().then(function () {
        index = null; symbols = Object.create(null); components = []; references = []; events = Object.create(null); activeEvent = null; activeComponent = ''; activeRootMethod = '';
        document.querySelectorAll('#eventSelect option[data-source-index="true"]').forEach(function (option) { option.remove(); });
        document.querySelectorAll('.source-mapping-link').forEach(function (button) { button.remove(); });
        var eventSelect = $('eventSelect');
        if (eventSelect && eventSelect.options.length) { eventSelect.selectedIndex = 0; eventSelect.dispatchEvent(new Event('change', { bubbles: true })); }
        renderComponents(); renderReferenceInfo([]); renderSourceUsage(''); renderMappingSummary(); setState('本地索引已清除', false);
      })
        .catch(function (error) { setState('清除失败：' + error.message, false); });
    });
    var search = $('componentSearch');
    if (search) search.addEventListener('input', renderComponents);
    var versionSelect = $('versionFocus');
    if (versionSelect) versionSelect.addEventListener('change', function () {
      version = versionSelect.value;
      renderComponents();
      if (version === 'v2') {
        activeEvent = null;
        var eventSelect = $('eventSelect');
        if (eventSelect && eventSelect.options.length) { eventSelect.selectedIndex = 0; eventSelect.dispatchEvent(new Event('change', { bubbles: true })); }
        return;
      }
      if (version === 'all') return;
      if (!activeEvent || !activeEvent.component) {
        var previous = components.find(function (component) { return component.id === activeComponent; });
        var restore = components.find(function (component) { return component.version === version && previous && previous.fxId && component.fxId === previous.fxId && component.events.length; });
        if (restore) selectComponent(restore.id);
        return;
      }
      if (activeEvent.component.version === version) return;
      var candidates = components.filter(function (component) { return component.version === version && component.events.length; });
      var previousFxId = activeEvent.component.fxId;
      var next = candidates.find(function (component) { return previousFxId && component.fxId === previousFxId; }) || candidates[0];
      if (next) selectComponent(next.id);
    });
    var eventSelect = $('eventSelect');
    if (eventSelect) eventSelect.addEventListener('change', function () {
      var value = eventSelect.value;
      if (value.indexOf('source::') !== 0) return;
      var selected = events[value.slice(8)]; if (selected) renderEvent(selected);
    });
    var map = $('versionMap');
    if (map && window.MutationObserver) new MutationObserver(decorateVersionMappings).observe(map, { childList: true, subtree: true });
    var businessTree = $('componentTree');
    if (businessTree && window.MutationObserver) new MutationObserver(decorateBusinessComponents).observe(businessTree, { childList: true, subtree: true });
    var exportButton = $('exportAnalysisReport');
    if (exportButton) exportButton.addEventListener('click', exportAnalysisReport);
    renderComponents();
    readIndex().then(function (stored) { if (stored) install(stored); else setState('源码索引未载入', false); })
      .catch(function (error) { setState('本地缓存不可用：' + error.message, false); });
  }
  function exportAnalysisReport() {
    var methodIds = [];
    var eventCopy = null;
    var componentCopy = null;
    if (activeEvent) {
      var selectedRoot = activeRootMethod || (activeEvent.methodIds || [])[0];
      eventCopy = { id: activeEvent.id, name: activeEvent.name, trigger: activeEvent.trigger, line: activeEvent.line, status: activeEvent.status, methodIds: selectedRoot ? [selectedRoot] : (activeEvent.methodIds || []) };
      componentCopy = { id: activeEvent.component.id, version: activeEvent.component.version, name: activeEvent.component.name, fxId: activeEvent.component.fxId, file: activeEvent.component.file, line: activeEvent.component.line };
      var reportEvent = Object.assign({}, activeEvent, { methodIds: eventCopy.methodIds });
      var graph = collectGraph(reportEvent);
      methodIds = Array.from(new Set([].concat.apply([], graph.levels || []))).filter(function (id) { return !!symbols[id]; });
    }
    var report = {
      title: '门诊收费代码逻辑分析报告',
      exportedAt: new Date().toISOString(),
      selection: { component: componentCopy, event: eventCopy },
      callTree: $('textTree') ? $('textTree').textContent : '',
      sourceMethods: methodIds.map(function (id) { return symbols[id]; }),
      sourceReferences: references.filter(function (reference) { return methodIds.indexOf(reference.symbolId) !== -1; }),
      sourceDiagnostics: index && Array.isArray(index.diagnostics) ? index.diagnostics : [],
      legacyAnalysisModel: window.CLINIC_REG_CALL_ANALYSIS_DATA || null
    };
    var blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a'); anchor.href = url;
    anchor.download = 'outpatient-call-analysis-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
