(function(){
'use strict';
const SUFFIX='_CALL_ANALYSIS_DATA';
function detectAdapter(){
  const matches=Object.keys(window).filter(key=>key.endsWith(SUFFIX)&&window[key]&&typeof window[key]==='object');
  if(matches.length!==1)return {error:matches.length?'页面加载了多个调用链数据包，无法确定当前包。':'未找到调用链数据，请检查 call-analysis-data.js。'};
  const namespace=matches[0].slice(0,-SUFFIX.length);
  return {
    namespace,
    data:window[matches[0]],
    legacySource:window[namespace+'_LEGACY_SOURCE']||{},
    v2Reference:window[namespace+'_V2_REFERENCE']||{groups:{}},
    v2ReferenceView:window[namespace+'_V2_REFERENCE_VIEW'],
    dataView:window[namespace+'_ANALYZER_DATA_VIEW'],
    report:window[namespace+'_ANALYSIS_REPORT'],
    methodIoDetails:window[namespace+'_METHOD_IO_DETAILS']||{},
    defaultV2Tab:namespace==='OUTPATIENT'?'react':'hook',
    sourceMode:namespace==='OUTPATIENT'?'legacy-only':'mixed'
  };
}
function start(adapter){
'use strict';
const $=id=>document.getElementById(id);
const viewRequirements=[
  {nodes:['componentTree','eventSelect','callGraph','textTree','codeLines'],label:'分析工作台'},
  {nodes:['versionMap'],label:'版本对照'},
  {nodes:['v2Content','v2SelectionLabel'],label:'新架构实现'},
  {nodes:['usageList','sourceUsageSummary'],label:'引用统计'},
  {nodes:['dataSourceContent'],label:'数据与接口'}
];
function showError(message){
  const host=$('callGraph')||$('versionMap')||$('v2Content')||$('usageList')||$('dataSourceContent')||document.querySelector('main')||document.body;
  if(host)host.insertAdjacentHTML('afterbegin','<div class="empty" role="alert">调用链分析初始化失败：'+String(message).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'</div>');
}
if(adapter.error){showError(adapter.error);return false;}
const selectedView=viewRequirements.find(view=>view.nodes.some(id=>$(id)));
const missing=selectedView&&selectedView.nodes.filter(id=>!$(id));
if(missing&&missing.length){showError(selectedView.label+'缺少必需节点：'+missing.join('、'));return false;}
const missingModules=[];
if(!adapter.v2ReferenceView||typeof adapter.v2ReferenceView.render!=='function')missingModules.push('V2_REFERENCE_VIEW');
if(!adapter.dataView||typeof adapter.dataView.renderDataSources!=='function'||typeof adapter.dataView.renderUsage!=='function')missingModules.push('ANALYZER_DATA_VIEW');
if(!adapter.report||typeof adapter.report.buildReport!=='function'||typeof adapter.report.download!=='function')missingModules.push('ANALYSIS_REPORT');
if(missingModules.length){showError('包 '+adapter.namespace+' 缺少运行模块：'+missingModules.join('、'));return false;}
const DATA=adapter.data;
const pageHierarchyEnabled=adapter.namespace==='OUTPATIENT'&&Boolean(window.OUTPATIENT_CALL_ANALYSIS_HIERARCHY);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const icon=name=>'<svg class="ic" aria-hidden="true"><use href="#icon-'+name+'"/></svg>';
const highlightCode=line=>{
  if(/^\s*(?:\/\/|\/\*|\*|\*\/)/.test(String(line)))return '<span class="comment">'+esc(line)+'</span>';
  const keywords=new Set(['const','let','return','export','async','await','if','else','new','function','public','private','protected','record','class','final','boolean','void','package','import','enum','var','static','implements','throw','this','int']);
  const types=new Set(['QueryType','DateRange','PatientQuery','PatientQueryParams','Patient','PatientSummary','ValidationCode','ValidationIssue','ValidationResult','VisitType','PatientQueryPolicy','OutpatientPatientService','PatientQueryPort','PatientQueryResult','InvalidPatientQueryException','PatientVisitQueryRequest','PatientVisitApiAdapter','PatientVisitHttpClient','RequestContext','RequestReason','LocalDate','List','ArrayList','Promise','Form','Service','Component']);
  const clickableTypes=new Set(['DateRange','PatientQuery','PatientQueryParams','Patient','PatientSummary','ValidationCode','ValidationIssue','ValidationResult','VisitType','PatientQueryPolicy','OutpatientPatientService','PatientQueryPort','PatientQueryResult','InvalidPatientQueryException','PatientVisitQueryRequest','PatientVisitApiAdapter','PatientVisitHttpClient','RequestContext','LocalDate','List','ArrayList','Promise','String','QueryTypeOption','QueryTypeConfig',...Object.keys(DATA.enums||{})]);
  const source=String(line);
  const pattern=/\/\/.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[A-Za-z_$][\w$]*\b/g;
  let out='',last=0,match;
  while((match=pattern.exec(source))){
    out+=esc(source.slice(last,match.index));
    const token=match[0];
    if(!/^['"]/.test(token)&&clickableTypes.has(token)){
      out+='<button class="type-reference" type="button" data-type-reference="'+esc(token)+'" aria-haspopup="dialog" title="查看 '+esc(token)+' 类型定义">'+esc(token)+'</button>';
    }else{
      const kind=token.startsWith('//')?'comment':/^['"]/.test(token)?'string':keywords.has(token)?'keyword':types.has(token)?'type':/^(true|false|null|undefined)$/.test(token)?'literal':/^[A-Za-z_$][\w$]*$/.test(token)&&new RegExp('\\b'+token+'\\s*\\(').test(source)?'call':'';
      out+=kind?'<span class="'+kind+'">'+esc(token)+'</span>':esc(token);
    }
    last=match.index+token.length;
  }
  return out+esc(source.slice(last));
};
const statusClass=s=>s==='VERIFIED'?'ok':s==='UNKNOWN'?'warn':'';
const kindClass=c=>{
  const x=((c&&c.type)||'')+' '+((c&&c.layer)||'');
  if((c&&c.status)==='UNKNOWN')return 'err';
  if(/Error|错误|异常/i.test(x))return 'err';
  if(/API|Adapter|Gateway|Repository|data|query/i.test(x))return 'api';
  if(/Validation|Policy|rule|校验/i.test(x))return 'rule';
  if(/State|状态/i.test(x))return 'state';
  if(/Legacy|Command|Application/i.test(x))return 'purple';
  return 'event';
};
const allEvents=Object.values(DATA.events||{});
const allMethods=DATA.methods||{};
let activeComponent='C001';
let activeEvent=DATA.events.EVT_QUERY_TYPE_CHANGE?.id||allEvents.find(e=>e.componentId==='C001')?.id||allEvents[0]?.id||'';
let activeMethod='';
let activeV2Tab=adapter.defaultV2Tab||'hook';
let versionFocus='all';
let srcMode='legacy';
const LEGACY_SOURCE=adapter.legacySource;
/* 旧版源码双版本（003 东港 / 020 潼南）导航与覆盖统计 */
const VERSION_LABELS={'003':'003 东港','020':'020 潼南'};
let legacyVersionFilter='all';
function legacyVersionInfo(methodId){
  const blocks=LEGACY_SOURCE[methodId];
  const arr=Array.isArray(blocks)?blocks:[];
  const has=v=>arr.some(block=>String(block.version)===v);
  return {blocks:arr,has003:has('003'),has020:has('020')};
}
function legacyCoverageStats(){
  const ids=Object.keys(allMethods).filter(id=>String(id).indexOf('M_')===0);
  let both=0,only003=0,only020=0,unregistered=0;
  const singleVersionIds=[];
  ids.forEach(id=>{
    const info=legacyVersionInfo(id);
    if(!info.blocks.length){unregistered++;return;}
    if(info.has003&&info.has020)both++;
    else if(info.has003){only003++;singleVersionIds.push(id);}
    else if(info.has020){only020++;singleVersionIds.push(id);}
  });
  return {modelMethods:ids.length,registered:ids.length-unregistered,bothVersions:both,only003,only020,unregistered,singleVersionIds};
}
function renderLegacySourceBlocks(blocks,filter){
  return blocks.filter(block=>!filter||filter==='all'||String(block.version)===filter).map(block=>'<li class="src-head">'+esc(block.version+' · '+block.label+' · 原始行 '+block.startLine+'–'+block.endLine)+'</li><li class="src-src">'+esc(block.path)+'</li>'+(block.code||[]).map((line,index)=>'<li class="src-java"><span class="legacy-source-number">'+(block.startLine+index)+'</span><code>'+esc(line)+'</code></li>').join('')).join('');
}
function componentHaystack(c){
  const e=(c.eventIds||[]).map(id=>DATA.events[id]).filter(Boolean);
  const m=e.flatMap(x=>(x.methodIds||[]).map(id=>allMethods[id])).filter(Boolean);
  return [c.id,c.name,c.groupName,...e.map(x=>x.name),...m.map(x=>x.name)].join(' ').toLowerCase();
}
function renderComponents(filter=''){
  const tree=$('componentTree');
  if(!tree)return;
  const q=filter.trim().toLowerCase();
  let visible=0;
  tree.innerHTML=(DATA.groups||[]).map(g=>{
    const items=(g.componentIds||[]).map(id=>DATA.components[id]).filter(Boolean).filter(c=>!q||componentHaystack(c).includes(q));
    if(!items.length)return '';
    visible+=items.length;
    return '<div class="group"><h3><span>'+esc(g.name)+'</span><span>'+items.length+'</span></h3>'+
      items.map(c=>{const events=(c.eventIds||[]).map(id=>DATA.events[id]).filter(Boolean);const badge=events.length?'<svg class="ic event-bolt" aria-hidden="true"><use href="#icon-bolt"/></svg><span class="visually-hidden">有事件：'+esc(events.map(e=>e.name).join('、'))+'</span>':'';return '<button type="button" data-component-id="'+esc(c.id)+'" class="'+(c.id===activeComponent?'active':'')+'" title="'+esc(c.name)+(events.length?'（有事件：'+esc(events.map(e=>e.name).join('、'))+'）':'')+'"><span class="cid">'+esc(c.id)+'</span><span class="component-name">'+esc(c.name)+'</span>'+badge+'<span class="kind '+(c.kind==='data'?'data':c.kind==='rule'?'rule':'fe')+'">'+esc(c.evidenceStatus||'')+'</span></button>'}).join('')+
      '</div>';
  }).join('');
  const count=$('logicCount');
  if(count)count.textContent=visible+' / '+Object.keys(DATA.components||{}).length+' 个';
  document.querySelectorAll('[data-component-id]').forEach(b=>b.addEventListener('click',()=>{
    activeComponent=b.dataset.componentId;
    const c=DATA.components[activeComponent];
    const evts=(c.eventIds||[]).map(id=>DATA.events[id]).filter(Boolean);
    const e=evts.find(x=>(x.trigger||'')!=='page init')||evts[0];
    if(e){activeEvent=e.id;$('eventSelect').value=e.id;renderEvent(e.id)}
    else renderComponentWithoutEvent(c);
    renderComponents($('componentSearch').value);
  }));
}
function renderEventOptions(){
  const select=$('eventSelect');
  if(!select)return;
  select.innerHTML=allEvents
    .slice()
    .sort((a,b)=>String(a.componentId).localeCompare(String(b.componentId))||String(a.name).localeCompare(String(b.name)))
    .map(e=>'<option value="'+esc(e.id)+'">'+esc(e.componentId)+' · '+esc(e.name)+' · '+esc(e.status)+'</option>').join('');
  if(activeEvent)select.value=activeEvent;
}
function methodNode(methodId){
  const m=allMethods[methodId];
  if(!m)return '<div class="node err"><b>'+esc(methodId)+'</b><small>UNKNOWN · 方法未登记</small></div>';
  const details=(LEGACY_SOURCE[methodId]||[]).slice(0,2).map(block=>'<span>↳ '+esc(block.version+' · '+block.path+':'+block.startLine+'-'+block.endLine)+'</span>').join('')||(m.dataAccess||[]).slice(0,4).map(x=>'<span>↳ '+esc(x)+'</span>').join('');
  return '<div class="node '+kindClass(m)+'" role="button" tabindex="0" aria-pressed="'+(methodId===activeMethod)+'" data-method-id="'+esc(methodId)+'">'+
    '<b>'+esc(m.name)+'</b><small>'+esc(m.type||m.layer||'Method')+' · '+esc(m.status||'UNKNOWN')+'</small>'+
    (details?'<div class="children">'+details+'</div>':'')+
    '</div>';
}
function renderMethodBranch(methodId,stack=new Set(),depth=0){
  const method=allMethods[methodId];
  if(!method)return '<div class="method-branch">'+methodNode(methodId)+'</div>';
  if(stack.has(methodId))return '<div class="method-branch">'+methodNode(methodId)+(pageHierarchyEnabled?'<small class="call-path-note">↺ 循环回边，已停止展开</small>':'')+'</div>';
  if(depth>=7)return '<div class="method-branch">'+methodNode(methodId)+(pageHierarchyEnabled&&(method.calls||[]).length?'<small class="call-path-note">已到图形安全深度上限 A7；下游方法见下方完整解说</small>':'')+'</div>';
  const calls=method.calls||[];
  if(!calls.length)return '<div class="method-branch">'+methodNode(methodId)+'</div>';
  const next=new Set(stack);next.add(methodId);
  const inset=(50/calls.length)+'%';
  return '<div class="method-branch">'+methodNode(methodId)+'<div class="call-children '+(calls.length===1?'single':'')+'" style="--branch-count:'+calls.length+';--branch-inset:'+inset+'">'+
    calls.map(id=>'<div class="call-child">'+renderMethodBranch(id,next,depth+1)+'</div>').join('')+
    '</div></div>';
}
function patientApiNode(){
  const api=DATA.apis?.API_PATIENT_LIST;
  if(!api)return '<div class="node api"><b>患者 / 就诊查询接口</b><small>UNKNOWN · 尚未登记接口职责</small></div>';
  const method=api.method||'';
  const path=api.path||'';
  return '<div class="node api"><b>'+icon('db')+esc(api.name||'患者 / 就诊查询接口')+'</b><small>'+esc(api.status||'UNKNOWN')+' · '+esc([method,path].filter(Boolean).join(' '))+'</small></div>';
}
function renderGraph(event){
  const roots=event?.methodIds||[];
  if(event?.componentId==='C001'&&event?.id==='EVT_QUERY_TYPE_CHANGE'){
    const idByName=name=>Object.keys(allMethods).find(id=>allMethods[id]?.name===name);
    const handle=idByName('handleQueryTypeChange'),state=idByName('setQueryType'),reset=idByName('resetQueryFields');
    const build=idByName('buildQueryParams'),validate=idByName('validateParams'),error=idByName('showError'),patient=idByName('getPatientList');
    if(handle&&state&&reset&&build&&validate&&error&&patient){
      $('callGraph').innerHTML='<div class="reference-flow">'+
        '<div class="node event flow-event"><b>用户操作 / 组件事件 onChange</b><small>（查询方式变更）</small></div><span class="arrow">↓</span>'+methodNode(handle)+'<span class="arrow">↓</span>'+methodNode(state)+'<span class="arrow">↓</span>'+methodNode(reset)+'<span class="arrow flow-branch-arrow">↘</span>'+methodNode(build)+'<span class="arrow">↓</span>'+methodNode(validate)+
        '<div class="flow-branches"><div class="flow-condition">校验结果<br>是否通过？</div><div class="flow-no"><em>否</em>'+methodNode(error)+'</div><div class="flow-yes"><em>是</em>'+methodNode(patient)+'<span class="arrow">↓</span>'+patientApiNode()+'</div></div></div>';
      wireMethodNodes();
      drawReferenceConnectors({handle,state,reset,build,validate,error,patient});
      return;
    }
  }
  if(!roots.length){
    $('callGraph').innerHTML='<div class="empty">当前事件未登记方法调用。</div>';
    return;
  }
  const inset=(50/roots.length)+'%';
  let out='<div class="method-flow"><div class="node event"><b>'+esc(event.name)+'</b><small>'+esc(event.trigger||'event')+' · '+esc(event.status||'UNKNOWN')+'</small></div><div class="call-children '+(roots.length===1?'single':'')+'" style="--branch-count:'+roots.length+';--branch-inset:'+inset+'">'+
    roots.map(id=>'<div class="call-child">'+renderMethodBranch(id)+'</div>').join('')+'</div></div>';
  $('callGraph').innerHTML=out;
  wireMethodNodes();
}
function drawReferenceConnectors(methodIds){
  const flow=document.querySelector('#callGraph .reference-flow');
  if(!flow)return;
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('class','flow-connectors');
  svg.setAttribute('aria-hidden','true');
  svg.innerHTML='<defs><marker id="flow-arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#4285e8"/></marker><marker id="flow-arrow-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#23956b"/></marker><marker id="flow-arrow-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#d74d57"/></marker></defs>';
  flow.appendChild(svg);
  const findMethod=id=>Array.from(flow.querySelectorAll('[data-method-id]')).find(node=>node.dataset.methodId===id);
  const getPoint=(element,side,root)=>{
    if(!element)return null;
    const rect=element.getBoundingClientRect(),base=root.getBoundingClientRect();
    const x=rect.left-base.left,y=rect.top-base.top;
    if(side==='top')return [x+rect.width/2,y];
    if(side==='bottom')return [x+rect.width/2,y+rect.height];
    if(side==='left')return [x,y+rect.height/2];
    if(side==='right')return [x+rect.width,y+rect.height/2];
    return [x+rect.width/2,y+rect.height/2];
  };
  const connections=[
    {from:()=>flow.querySelector('.flow-event'),fromSide:'bottom',to:()=>findMethod(methodIds.handle),toSide:'top',kind:'main'},
    {from:()=>findMethod(methodIds.handle),fromSide:'bottom',to:()=>findMethod(methodIds.state),toSide:'top',kind:'main'},
    {from:()=>findMethod(methodIds.state),fromSide:'bottom',to:()=>findMethod(methodIds.reset),toSide:'top',kind:'main'},
    {from:()=>findMethod(methodIds.handle),fromSide:'right',to:()=>findMethod(methodIds.build),toSide:'left',kind:'main'},
    {from:()=>findMethod(methodIds.build),fromSide:'bottom',to:()=>findMethod(methodIds.validate),toSide:'top',kind:'main'},
    {from:()=>findMethod(methodIds.validate),fromSide:'bottom',to:()=>flow.querySelector('.flow-condition'),toSide:'top',kind:'main'},
    {from:()=>flow.querySelector('.flow-condition'),fromSide:'right',to:()=>flow.querySelector('.flow-no [data-method-id]'),toSide:'left',kind:'no'},
    {from:()=>flow.querySelector('.flow-condition'),fromSide:'bottom',to:()=>flow.querySelector('.flow-yes [data-method-id]'),toSide:'top',kind:'yes'},
    {from:()=>flow.querySelector('.flow-yes [data-method-id]'),fromSide:'bottom',to:()=>flow.querySelector('.flow-yes .node.api'),toSide:'top',kind:'yes'}
  ];
  const draw=()=>{
    const bounds=flow.getBoundingClientRect();
    if(!bounds.width||!bounds.height)return;
    svg.setAttribute('viewBox','0 0 '+bounds.width+' '+bounds.height);
    svg.querySelectorAll('path.flow-path').forEach(path=>path.remove());
    connections.forEach(connection=>{
      const start=getPoint(connection.from(),connection.fromSide,flow),end=getPoint(connection.to(),connection.toSide,flow);
      if(!start||!end)return;
      const dx=end[0]-start[0],dy=end[1]-start[1];
      const path=document.createElementNS(ns,'path');
      path.setAttribute('class','flow-path '+connection.kind);
      path.setAttribute('d',Math.abs(dx)>Math.abs(dy)
        ?'M '+start[0]+' '+start[1]+' C '+(start[0]+dx*.42)+' '+start[1]+' '+(end[0]-dx*.42)+' '+end[1]+' '+end[0]+' '+end[1]
        :'M '+start[0]+' '+start[1]+' C '+start[0]+' '+(start[1]+dy*.42)+' '+end[0]+' '+(end[1]-dy*.42)+' '+end[0]+' '+end[1]);
      path.setAttribute('marker-end','url(#flow-arrow-'+(connection.kind==='main'?'blue':connection.kind)+')');
      svg.appendChild(path);
    });
  };
  requestAnimationFrame(draw);
  setTimeout(draw,80);
  if(window.ResizeObserver){const observer=new ResizeObserver(()=>{requestAnimationFrame(draw);setTimeout(draw,120);});observer.observe(flow);}
}
function wireMethodNodes(){
  document.querySelectorAll('#callGraph [data-method-id]').forEach(n=>{
    const pick=()=>renderMethod(n.dataset.methodId);
    n.addEventListener('click',pick);
    n.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick()}});
  });
}
function treeLines(methodId,prefix='',isLast=true,stack=new Set()){
  const m=allMethods[methodId];
  const branch=prefix+(prefix?'':'')+(isLast?'└─ ':'├─ ');
  if(!m)return [branch+methodId+' [UNKNOWN]'];
  const line=branch+m.name+((m.args||[]).length?'('+m.args.join(', ')+')':'');
  if(stack.has(methodId))return [line+' ↺'];
  const next=new Set(stack);next.add(methodId);
  const calls=m.calls||[];
  const childPrefix=prefix+(isLast?'   ':'│  ');
  let rows=[line];
  calls.forEach((id,i)=>{rows=rows.concat(treeLines(id,childPrefix,i===calls.length-1,next))});
  (m.dataAccess||[]).forEach((id,i)=>{
    const last=i===(m.dataAccess||[]).length-1 && !calls.length;
    rows.push(childPrefix+(last?'└─ ':'├─ ')+'DATA '+id);
  });
  return rows;
}
function renderTextTree(event){
  const roots=event?.methodIds||[];
  const component=DATA.components[event?.componentId]||{};
  let rows=[component.name||'', '└─ '+(event?.trigger||event?.name||'事件')+' 组件事件（页面事件）'];
  roots.forEach((id,i)=>{rows=rows.concat(treeLines(id,'   ',i===roots.length-1,new Set()))});
  renderTreeRows(rows);
}
function renderTreeRows(rows){
  $('textTree').innerHTML=rows.map((row,index)=>{
    const match=row.match(/^((?:│  |   )*)(?:├─ |└─ )?(.*)$/)||['', '', row];
    const depth=Math.floor(match[1].length/3)+(/^(?:├─ |└─ )/.test(row)&&index>0?1:0);
    const label=match[2];
    const kind=index===0?'root':/事件/.test(label)?'event':/DATA|api|API/.test(label)?'api':/校验|validate|error|ERROR/.test(label)?'rule':'method';
    const marker=kind==='root'?'◉':kind==='event'?'◆':kind==='api'?icon('db'):'○';
    const apiId=kind==='api'?label.replace(/^DATA\s+/,''):'';
    const method=Object.values(allMethods).find(item=>label===item.name||label.startsWith(item.name+'('));
    const interAttrs=method?'tabindex="0" data-method-id="'+esc(method.id)+'" aria-selected="'+(method.id===activeMethod)+'"':(kind==='api'&&apiId?'tabindex="0" data-resource-reference="api:'+esc(apiId)+'" title="查看数据访问详情（表 / SQL / 源码位置）"':'');
    return '<div class="tree-row '+kind+(method?' method-selectable':'')+'" role="treeitem" '+interAttrs+' style="--depth:'+depth+'"><span class="tree-marker">'+marker+'</span><span class="tree-label">'+esc(label)+'</span></div>';
  }).join('');
  $('textTree').querySelectorAll('[data-method-id]').forEach(row=>{
    const pick=()=>renderMethod(row.dataset.methodId);
    row.addEventListener('click',pick);
    row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();pick()}});
  });
}
function methodUseCount(methodId){
  let count=0;
  Object.values(DATA.events||{}).forEach(e=>{count+=(e.methodIds||[]).filter(id=>id===methodId).length});
  Object.values(allMethods).forEach(m=>{count+=(m.calls||[]).filter(id=>id===methodId).length});
  return count;
}
const METHOD_IO_DETAILS=adapter.methodIoDetails;
function renderSqlPanel(methodId){
  const panel=$('apiSqlPanel');
  if(!panel)return;
  const m=allMethods[methodId];
  const sources=(m&&m.dataAccess||[]).flatMap(id=>(LEGACY_SOURCE[id]||[]).map(block=>Object.assign({apiId:id},block)));
  const blocks=sources.map(block=>'<div class="sql-block"><div class="sql-head"><b>'+esc(block.version+' · '+block.label+' · 原始行 '+block.startLine+'–'+block.endLine)+'</b><small>'+esc(block.path)+'</small></div><pre>'+esc(block.code.join('\n'))+'</pre></div>');
  panel.innerHTML=blocks.length?'<h3>'+icon('db')+'旧版 Mapper 原文</h3><div class="sql-list">'+blocks.join('')+'</div>':'';
  panel.hidden=!blocks.length;
}
function renderMethod(methodId){
  const m=allMethods[methodId];
  const v2Label=$('v2SelectionLabel');
  const v2Ready=v2Label&&$('v2Content');
  if(!m){
    activeMethod='';
    $('lineTitle').textContent='运行解析 · UNKNOWN (V1.2.0)';
    $('methodName').textContent='UNKNOWN';
    $('methodOwner').textContent='未关联组件';
    $('methodType').textContent='UNKNOWN';
    $('methodArgs').textContent='未登记';
    $('methodReturns').textContent='未登记';
    $('methodUses').textContent='未登记';
    $('methodIo').textContent='未登记';
    $('codeLines').innerHTML='<li class="source-empty"><b>方法尚未登记</b><span>该调用在证据模型中没有条目；载入源码索引或补充数据后展示。</span></li>';
    $('lineExplain').innerHTML='<li>保持 UNKNOWN；接入原始源码后补 path / commit / line / signature。</li>';
    if(v2Label)v2Label.textContent='当前方法：未选择';
    if(v2Ready)renderV2(activeV2Tab);
    renderSqlPanel('');
    if($('srcModeToggle'))$('srcModeToggle').hidden=true;
    {const lp=document.querySelector('.analysis-top>.lines');if(lp)lp.classList.remove('src-legacy');}
    return;
  }
  if(activeMethod!==methodId)legacyVersionFilter='all';
  activeMethod=methodId;
  document.querySelectorAll('#callGraph [data-method-id]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.methodId===methodId)));
  document.querySelectorAll('#textTree [data-method-id]').forEach(row=>row.setAttribute('aria-selected',String(row.dataset.methodId===methodId)));
  $('lineTitle').textContent='方法语义与旧版证据 · '+m.name;
  $('methodName').textContent=m.name;
  const owner=DATA.components[activeComponent]||{};
  $('methodOwner').textContent=(owner.name||'未知组件')+'（'+(owner.id||'UNKNOWN')+'）';
  const io=METHOD_IO_DETAILS[methodId];
  const legacy=LEGACY_SOURCE[methodId];
  const code=Array.isArray(m.code)&&m.code.length?m.code:(io?.code||[]);
  const hasLegacy=!!legacy;
  const hasTarget=adapter.sourceMode!=='legacy-only'&&code.length>0;
  // 只有一侧证据时强制落到该侧，避免把已有代码吞成「未登记」
  if(hasLegacy&&!hasTarget)srcMode='legacy';
  if(!hasLegacy&&hasTarget)srcMode='v2';
  const useLegacy=hasLegacy&&srcMode==='legacy';
  const useTarget=hasTarget&&srcMode==='v2';
  if($('srcModeToggle')){
    $('srcModeToggle').hidden=!(hasLegacy&&hasTarget);
    $('srcModeToggle').querySelectorAll('button').forEach(button=>{
      const active=button.dataset.srcMode===srcMode;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
    });
  }
  const linesPanel=document.querySelector('.analysis-top>.lines');
  if(linesPanel)linesPanel.classList.toggle('src-legacy',!!useLegacy);
  const explain=(m.explain&&m.explain.length)?m.explain:[];
  const inputText=io?.args||(m.args||[]).join(', ')||'无';
  const outputText=io?.returns||m.returns||'未登记';
  const facts=[
    ...explain.map(line=>({html:linkTypeReferences(line)})),
    ...(io?.explain||[]).map(line=>({html:linkTypeReferences(line)})),
    ...(m.calls||[]).map(id=>{
      const target=allMethods[id];
      return {html:target?'<button class="method-reference" type="button" data-method-reference="'+esc(id)+'" title="查看 '+esc(target.name)+' 的解析与流程图">调用关系：'+esc(target.name)+'</button>':esc('调用关系：'+id)};
    }),
    ...(m.dataAccess||[]).map(id=>({html:icon('db')+'<button class="resource-reference" type="button" data-resource-reference="api:'+esc(id)+'" title="查看数据访问详情（表 / SQL / 源码位置）">数据访问：'+esc(id)+'</button>'})),
    ...(m.switchIds||[]).map(id=>{
      const sw=(DATA.switches||{})[id];
      return {html:icon('switch')+'<button class="resource-reference" type="button" data-resource-reference="switch:'+esc(id)+'" title="查看开关定义">开关：'+esc((sw&&sw.name)||id)+'</button>'};
    }),
    ...(m.parameterIds||[]).map(id=>{
      const p=(DATA.parameters||{})[id];
      return {html:icon('param')+'<button class="resource-reference" type="button" data-resource-reference="parameter:'+esc(id)+'" title="查看参数定义">参数：'+esc((p&&p.name)||id)+'</button>'};
    })
  ];
  if(useLegacy){
    const info=legacyVersionInfo(methodId);
    const missing=info.has003&&info.has020?'':(info.has003?'020（潼南）':(info.has020?'003（东港）':'003（东港）/ 020（潼南）'));
    const nav='<li class="src-version-nav">'+['all','003','020'].map(v=>{
      const has=v==='all'||(v==='003'?info.has003:info.has020);
      return '<button type="button" class="'+(legacyVersionFilter===v?'active':'')+'" data-version-filter="'+v+'"'+(has?'':' disabled title="该版本旧版源码未登记"')+'>'+(v==='all'?'全部':VERSION_LABELS[v])+(has?'':' · 未登记')+'</button>';
    }).join('')+(missing?'<span class="src-version-missing">'+missing+'旧版源码未登记；登记后在此对照两版差异。</span>':'')+'</li>';
    $('codeLines').innerHTML=nav+renderLegacySourceBlocks(info.blocks,legacyVersionFilter);
    document.querySelectorAll('#codeLines [data-version-filter]').forEach(btn=>btn.addEventListener('click',()=>{legacyVersionFilter=btn.dataset.versionFilter;renderMethod(methodId);}));
  }else{
    $('codeLines').innerHTML=useTarget?('<li class="source-scope-note"><b>原型方案视图 · '+esc(m.status||'PROPOSED')+'</b><span>以下为 V2 / 原型目标实现，不是 003 / 020 旧版源码；旧版证据见「旧版源码」页签或数据与接口子页。</span></li>'+code.map((line,index)=>'<li class="target-code-line"><span class="legacy-source-number">'+(index+1)+'</span><code>'+esc(line)+'</code></li>').join('')):'<li class="source-empty"><b>'+esc(m.name)+'</b><span>未登记逐行源码 · 业务模型状态：'+esc(m.status||'UNKNOWN')+(m.layer||m.type?' · '+esc(m.layer||m.type):'')+'</span><span>该节点尚未接入 003 / 020 原始文件行号，也未登记 V2 原型实现；等待现场仓库对应文件证据或补充目标实现后填充。</span></li>';
  }
  const explanation=[{html:'业务模型证据状态：<b>'+esc(m.status||'UNKNOWN')+'</b>。旧版代码只按上方原始文件与行号展示。'},...(m.explain||[]).map(line=>({html:linkTypeReferences(line)})),...(io?.explain||[]).map(line=>({html:linkTypeReferences(line)})),...(m.calls||[]).map(id=>{const target=allMethods[id];return {html:target?'<button class="method-reference" type="button" data-method-reference="'+esc(id)+'" title="查看 '+esc(target.name)+' 的解析与流程图">业务模型关系：'+esc(target.name)+' · '+esc(target.status||'UNKNOWN')+'</button>':esc('业务模型关系：'+id)}}),...(m.dataAccess||[]).map(id=>({html:icon('db')+'<button class="resource-reference" type="button" data-resource-reference="api:'+esc(id)+'" title="查看数据访问详情（表 / SQL / 源码位置）">数据访问：'+esc(id)+'</button>'})),...(m.switchIds||[]).map(id=>{const sw=(DATA.switches||{})[id];return {html:icon('switch')+'<button class="resource-reference" type="button" data-resource-reference="switch:'+esc(id)+'" title="查看开关定义">开关：'+esc((sw&&sw.name)||id)+'</button>'}}),...(m.parameterIds||[]).map(id=>{const p=(DATA.parameters||{})[id];return {html:icon('param')+'<button class="resource-reference" type="button" data-resource-reference="parameter:'+esc(id)+'" title="查看参数定义">参数：'+esc((p&&p.name)||id)+'</button>'}})];
  $('lineExplain').innerHTML=explanation.map(line=>'<li>'+line.html+'</li>').join('')||'<li>尚无逐行说明。</li>';
  $('methodType').textContent=(m.type||m.layer||'Method')+' · '+(m.status||'UNKNOWN');
  $('methodReturns').innerHTML=linkTypeReferences(outputText,outputText);
  $('methodArgs').innerHTML=linkTypeReferences(inputText);
  $('methodUses').textContent=methodUseCount(methodId)+' 处';
  const ioList=(m.dataAccess||[]).join(', ');
  $('methodIo').innerHTML=ioList?icon('db')+'<span class="fact-inline">'+esc(ioList)+'</span>':'无';
  const sourceInfo=$('sourceFileInfo');
  if(sourceInfo)sourceInfo.textContent=io?.source||'';
  if(v2Label)v2Label.textContent='当前方法：'+m.name+' · PROPOSED';
  if(v2Ready)renderV2(activeV2Tab);
  renderSqlPanel(methodId);
}
function linkTypeReferences(value,context=''){
  let markup=esc(value);
  const typeNames=[...new Set([...Object.keys(DATA.enums||{}),'PatientQueryParams','DateRange','ValidationResult','ValidationIssue','Promise'])].sort((a,b)=>b.length-a.length);
  typeNames.forEach(typeName=>{
    const escapedName=esc(typeName);
    const pattern=new RegExp('\\b'+typeName+'\\b','g');
    markup=markup.replace(pattern,'<button class="type-reference" type="button" data-type-reference="'+escapedName+'" data-type-context="'+esc(context)+'" aria-haspopup="dialog" title="查看 '+escapedName+' 类型定义">'+escapedName+'</button>');
  });
  return markup;
}
function showResourceReference(resourceKey){
  const [kind,id]=String(resourceKey||'').split(':');
  const collection=kind==='switch'?DATA.switches:kind==='dictionary'?DATA.dictionaries:kind==='api'?DATA.apis:DATA.parameters;
  const item=collection?.[id];
  if(!item)return;
  const label=kind==='switch'?'业务开关':kind==='dictionary'?'业务字典':kind==='api'?'数据访问接口':'方法 / 业务参数';
  const catalogLabels={dict:'参数表参数（DICT_SWITCH 维护）',contract:'方法契约参数（非参数表参数）',page:'页面私有变量（非参数表参数）',design:'V2 设计开关（非参数表现有项）'};
  const catalogNote=item.catalog&&catalogLabels[item.catalog]?'<p class="catalog-scope-note"><b>维护位置：</b>'+esc(catalogLabels[item.catalog])+'</p>':'';
  const refs=Object.values(allMethods).filter(method=>kind==='switch'?(method.switchIds||[]).includes(id):kind==='api'?(method.dataAccess||[]).includes(id):kind==='dictionary'?(method.dataAccess||[]).includes(id):(method.parameterIds||[]).includes(id));
  $('typeDialogEyebrow').textContent='代码引用 · '+label;
  $('typeDialogTitle').textContent=item.name||item.id;
  const tableRows=(item.tableIds||[]).map(tid=>{const tb=(DATA.tables||{})[tid];return {name:(tb&&tb.name)||tid,note:(tb&&tb.source)||''};});
  const uniqTables=[...new Map(tableRows.map(t=>[t.name,t])).values()];
  const tableLinks=uniqTables.length?'<p><b>数据库表：</b>'+uniqTables.map(t=>'<code title="'+esc(t.note)+'">'+esc(t.name)+'</code>').join('、')+'</p>':'';
  const endpoint=kind==='api'&&([item.method,item.path].filter(Boolean).join(' '))?'<p><b>'+esc([item.method,item.path].filter(Boolean).join(' '))+'</b></p>':'';
  const sql=kind==='api'&&item.detail?'<p><b>数据访问摘要（非原始 SQL）：</b>'+esc(item.detail)+'</p>':'';
  const sourceBlocks=(LEGACY_SOURCE[id]||[]).map(block=>'<div class="sql-block"><div class="sql-head"><b>'+esc(block.version+' · '+block.label+' · 原始行 '+block.startLine+'–'+block.endLine)+'</b><small>'+esc(block.path)+'</small></div><pre>'+esc(block.code.join('\n'))+'</pre></div>');
  const sqlBlocks=sourceBlocks.length?'<section class="sql-list">'+sourceBlocks.join('')+'</section>':kind==='api'&&(item.sql||[]).length?'<div class="source-empty"><b>原始 SQL 尚未逐行接入</b><span>当前数据访问说明是筛选条件摘要，不按旧版源码展示。来源文件可按路径与行号复核。</span></div>':'';
  $('typeDialogDefinition').innerHTML='<div class="type-dialog-meta"><span>'+esc(label)+'</span><span class="type-dialog-status">'+esc(item.status||'UNKNOWN')+'</span></div>'+catalogNote+endpoint+(item.type?'<p>类型：'+linkTypeReferences(item.type):'')+'</p>'+tableLinks+sql+sqlBlocks+(item.description?'<p>'+esc(item.description)+'</p>':'')+(item.def?'<p>默认值：<code>'+esc(item.def)+'</code></p>':'')+(item.source?'<div class="type-dialog-source">来源定位：'+esc(item.source)+'</div>':'')+'<p><b>使用位置</b></p><ul>'+ (refs.map(method=>'<li><code>'+esc(method.name)+'</code></li>').join('')||'<li>本地调用模型未登记直接引用</li>')+'</ul><a href="data-sources.html" target="_self">打开参数、开关、字典、枚举独立目录 →</a>';
  $('typeReferenceDialog').showModal();
}
function showTypeReference(typeName,context=''){
  const definition=DATA.enums?.[typeName];
  $('typeDialogEyebrow').textContent='类型定义';
  if(typeName==='Promise'){
    const genericMatch=context.match(/Promise\s*<(.+)>/);
    const resultType=genericMatch?.[1]||'T';
    $('typeDialogTitle').textContent='Promise<T>';
    $('typeDialogDefinition').innerHTML='<div class="type-dialog-meta"><span>JavaScript / TypeScript 内置泛型</span><span class="type-dialog-status">标准类型</span></div>'+(genericMatch?'<p>当前出参：<code>'+esc(context)+'</code><br>因此 <code>T = '+esc(resultType)+'</code>。</p>':'')+'<p><code>Promise&lt;T&gt;</code> 表示一个尚未完成的异步操作。操作成功时，兑现值的类型为 <code>T</code>；它不是 <code>T</code> 本身。</p><table class="type-dialog-values"><thead><tr><th>状态</th><th>含义</th></tr></thead><tbody><tr><td><code>pending</code></td><td>操作仍在处理中</td></tr><tr><td><code>fulfilled</code></td><td>操作成功，可通过 await 得到类型为 T 的结果</td></tr><tr><td><code>rejected</code></td><td>操作失败，await 会抛出拒绝原因</td></tr></tbody></table><div class="type-dialog-source">来源：ECMAScript Promise / TypeScript Promise&lt;T&gt;</div>';
  }else if(typeName==='PatientQueryParams'){
    $('typeDialogTitle').textContent='PatientQueryParams';
    $('typeDialogDefinition').innerHTML='<div class="type-dialog-meta"><span>患者查询条件对象</span><span class="type-dialog-status">PROPOSED · V2</span></div><table class="type-dialog-values"><thead><tr><th>字段</th><th>类型 / 必填</th><th>含义</th></tr></thead><tbody><tr><td><code>queryType</code></td><td><button class="type-reference" type="button" data-type-reference="QueryType" aria-haspopup="dialog">QueryType · 必填</button></td><td>查询方式</td></tr><tr><td><code>identifierValue</code></td><td><code>string · 必填</code></td><td>患者标识内容，如就诊卡号或身份证号</td></tr><tr><td><code>dateRange</code></td><td><button class="type-reference" type="button" data-type-reference="DateRange" aria-haspopup="dialog">DateRange · 必填</button></td><td>查询开始和结束日期</td></tr><tr><td><code>departmentId</code></td><td><code>string · 可选</code></td><td>科室过滤条件</td></tr><tr><td><code>doctorId</code></td><td><code>string · 可选</code></td><td>医生过滤条件</td></tr><tr><td><code>visitType</code></td><td><code>string · 可选</code></td><td>就诊类型；编码由院区配置提供</td></tr></tbody></table><p class="type-dialog-note">这是 V2 / 原型目标结构，尚未核实为 003 / 020 Legacy 的实际入参结构。</p><div class="type-dialog-source">依据：本页 V2 React + TypeScript 目标模型</div>';
  }else if(typeName==='DateRange'){
    $('typeDialogTitle').textContent='DateRange';
    $('typeDialogDefinition').innerHTML='<div class="type-dialog-meta"><span>日期范围对象</span><span class="type-dialog-status">PROPOSED · V2</span></div><table class="type-dialog-values"><thead><tr><th>字段</th><th>类型</th><th>含义</th></tr></thead><tbody><tr><td><code>startDate</code></td><td><code>string</code></td><td>查询开始日期，格式 YYYY-MM-DD</td></tr><tr><td><code>endDate</code></td><td><code>string</code></td><td>查询结束日期，格式 YYYY-MM-DD</td></tr></tbody></table><p class="type-dialog-note">V2 / 原型模型字段；Legacy 的实际结构尚未核实。</p><div class="type-dialog-source">依据：本页 V2 React + TypeScript 目标模型</div>';
  }else if(typeName==='ValidationResult'){
    $('typeDialogTitle').textContent='ValidationResult';
    $('typeDialogDefinition').innerHTML='<div class="type-dialog-meta"><span>参数校验结果对象</span><span class="type-dialog-status">PROPOSED · V2</span></div><table class="type-dialog-values"><thead><tr><th>字段</th><th>类型</th><th>含义</th></tr></thead><tbody><tr><td><code>valid</code></td><td><code>boolean</code></td><td>全部校验通过时为 true</td></tr><tr><td><code>errors</code></td><td><button class="type-reference" type="button" data-type-reference="ValidationIssue" aria-haspopup="dialog">ValidationIssue[]</button></td><td>校验失败详情列表；通过时为空数组</td></tr></tbody></table><p class="type-dialog-note">字段和错误码来自本页 V2 目标模型，尚未核实为 003 / 020 Legacy 的实际返回结构。</p><div class="type-dialog-source">依据：本页 V2 React + TypeScript 目标模型</div>';
  }else if(typeName==='ValidationIssue'){
    $('typeDialogTitle').textContent='ValidationIssue';
    $('typeDialogDefinition').innerHTML='<div class="type-dialog-meta"><span>单条校验错误</span><span class="type-dialog-status">PROPOSED · V2</span></div><table class="type-dialog-values"><thead><tr><th>字段</th><th>类型 / 取值</th><th>含义</th></tr></thead><tbody><tr><td><code>field</code></td><td><code>queryType</code> / <code>identifierValue</code> / <code>dateRange</code></td><td>哪一项未通过校验</td></tr><tr><td><code>code</code></td><td><code>REQUIRED</code> / <code>UNSUPPORTED_TYPE</code> / <code>INVALID_FORMAT</code> / <code>INVALID_RANGE</code></td><td>机器可读的错误类别</td></tr><tr><td><code>message</code></td><td><code>string</code></td><td>供页面展示的说明文字</td></tr></tbody></table><p class="type-dialog-note">错误字段和代码按本页 V2 目标模型列示；Legacy 返回结构尚未核实。</p><div class="type-dialog-source">依据：本页 V2 React + TypeScript 目标模型</div>';
  }else{
    const typeDescriptions={
      PatientQuery:'患者查询领域操作的抽象类型；具体结构需以其定义文件为准。',
      Patient:'患者领域对象；此处展示的是目标架构引用，实际字段由领域模型定义。',
      PatientSummary:'患者摘要结果类型，用于向查询页面返回患者基本信息。',
      PatientQueryPolicy:'Java 21 业务规则类，负责校验患者查询参数，不直接访问 HTTP。',
      OutpatientPatientService:'Java 21 应用服务，编排查询校验和患者查询端口调用。',
      PatientQueryPort:'领域端口接口，定义应用服务访问患者查询能力的边界。',
      PatientQueryResult:'患者查询结果类型，承载查询服务返回的数据。',
      InvalidPatientQueryException:'患者查询参数未通过校验时使用的业务异常类型。',
      PatientVisitQueryRequest:'患者就诊查询 API 的请求 DTO，由 Adapter 将领域参数转换而来。',
      PatientVisitApiAdapter:'API 适配器，将领域查询调用转换为外部接口请求。',
      PatientVisitHttpClient:'负责发起患者就诊查询 HTTP 请求的客户端类型。',
      RequestContext:'请求上下文，承载当前用户、院区或会话等服务端上下文信息。',
      QueryTypeOption:'查询方式选项类型，描述可供当前院区选择的查询方式。',
      QueryTypeConfig:'查询方式配置类型，承载院区启用状态及自动识别配置。',
      LocalDate:'Java 21 java.time.LocalDate，不可变的日期类型，不包含时分秒。',
      List:'Java 集合接口，表示有序元素列表。',
      ArrayList:'Java 可变数组列表实现，常用于构建校验错误集合。',
      String:'Java 字符串类型。'
    };
    if(!definition){
      const description=typeDescriptions[typeName];
      if(!description)return;
      $('typeDialogTitle').textContent=typeName;
      $('typeDialogDefinition').innerHTML='<div class="type-dialog-meta"><span>类型定义 · Java 21 / V2 目标代码</span><span class="type-dialog-status">PROPOSED</span></div><p>'+esc(description)+'</p><p class="type-dialog-note">这里只确认它在当前示例代码中的类型职责；完整字段/方法以对应正式源码或契约为准。</p>';
    }else{
      $('typeDialogTitle').textContent=definition.name||definition.id||typeName;
      const values=(definition.values||[]).map(value=>'<tr><td><code>'+esc(value.code)+'</code></td><td>'+esc(value.displayName||'')+'</td></tr>').join('');
      const status=definition.status||'UNKNOWN';
      const parameterUses=Object.values(DATA.parameters||{}).filter(parameter=>parameter.type===typeName).map(parameter=>'<li><code>'+esc(parameter.name||parameter.id)+'</code> 字段/参数类型</li>');
      const methodUses=Object.values(allMethods).filter(method=>[method.args||[],method.returns||'',...(method.code||[])].flat().join(' ').includes(typeName)).map(method=>'<li><code>'+esc(method.name)+'</code> 方法签名或代码</li>');
      const usage='<section class="type-dialog-note"><b>它是什么、出现在哪里</b><p><b>这是枚举类型</b>，定义一组可选编码；它本身不是某个参数。方法参数通常写成 <code>type: '+esc(typeName)+'</code>，例如 <code>getDefaultDateRange(type: '+esc(typeName)+')</code>；对象字段可写成 <code>queryType: '+esc(typeName)+'</code>。</p>'+(parameterUses.length?'<b>参数 / 字段：</b><ul>'+parameterUses.join('')+'</ul>':'')+(methodUses.length?'<b>方法引用：</b><ul>'+methodUses.slice(0,8).join('')+'</ul>':'')+'<a href="data-sources.html" target="_self">在参数、开关、字典、枚举目录中查看 →</a></section>';
      $('typeDialogDefinition').innerHTML='<div class="type-dialog-meta"><span>枚举类型 · '+esc(definition.category||'未分类')+'</span><span class="type-dialog-status">'+esc(status)+(definition.sourceStatus?' · '+esc(definition.sourceStatus):'')+'</span></div>'+usage+(values?'<table class="type-dialog-values"><thead><tr><th>编码</th><th>含义</th></tr></thead><tbody>'+values+'</tbody></table>':'<p>当前模型未登记取值。</p>')+(definition.note?'<p class="type-dialog-note">'+esc(definition.note)+'</p>':'')+(definition.source?'<div class="type-dialog-source">来源：'+esc(definition.source)+'</div>':'');
    }
  }
  $('typeReferenceDialog').showModal();
}
function showEvidenceDefinitions(){
  $('typeDialogEyebrow').textContent='状态标记';
  $('typeDialogTitle').textContent='证据状态说明';
  $('typeDialogDefinition').innerHTML='<div class="evidence-status-list"><div class="evidence-status-row verified"><b>VERIFIED</b><span>已在可查证的源码或正式材料中定位并核对，可追溯到具体证据位置。</span></div><div class="evidence-status-row inferred"><b>INFERRED</b><span>根据现有材料推导出的业务含义或版本映射，尚未由原始实现直接确认。</span></div><div class="evidence-status-row proposed"><b>PROPOSED</b><span>新架构或原型中的建议设计，表示目标方案；不代表 003 / 020 现网代码已经这样实现。</span></div><div class="evidence-status-row unknown"><b>UNKNOWN</b><span>目前没有足够证据确认，需补充源码、接口契约或其他原始资料。</span></div></div>';
  $('typeReferenceDialog').showModal();
}
function jumpToMethod(methodId){
  if(!allMethods[methodId])return;
  if(!$('callGraph')){location.href='call-analysis.html#m='+encodeURIComponent(methodId);return;}
  const reaches=(currentId,seen=new Set())=>{
    if(currentId===methodId)return true;
    if(seen.has(currentId))return false;
    seen.add(currentId);
    return (allMethods[currentId]?.calls||[]).some(nextId=>reaches(nextId,seen));
  };
  const ownerEvent=allEvents.find(event=>(event.methodIds||[]).some(rootId=>reaches(rootId)));
  if(ownerEvent&&ownerEvent.id!==activeEvent)renderEvent(ownerEvent.id);
  renderMethod(methodId);
  const node=Array.from(document.querySelectorAll('#callGraph [data-method-id]')).find(item=>item.dataset.methodId===methodId);
  if(node)node.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'});
}
function renderComponentWithoutEvent(c){
  $('graphTitle').textContent=c.id+' '+c.name+' · 未登记事件';
  $('callGraph').innerHTML='<div class="empty">该组件已进入逻辑目录，但当前证据模型尚未登记可展开事件。证据状态：'+esc(c.evidenceStatus||'UNKNOWN')+'。</div>';
  renderTreeRows([c.id+' '+c.name,'└─ 事件 / 方法：UNKNOWN']);
  renderMethod('');
}
function renderEvent(eventId){
  const event=DATA.events[eventId];
  if(!event||!$('callGraph'))return;
  activeEvent=eventId;activeComponent=event.componentId;
  const component=DATA.components[event.componentId]||{};
  $('graphTitle').textContent=(component.id||'')+' '+(component.name||'');
  renderGraph(event);
  renderTextTree(event);
  renderMethod((event.methodIds||[])[0]||'');
  renderComponents($('componentSearch').value);
  if(linesNote)linesNote.textContent=defaultLinesNote;
}
function renderVersions(focus='all'){
  versionFocus=focus;
  const map=$('versionMap');
  if(!map)return;
  const order=focus==='all'?['003','020','V2']:[focus==='v2'?'V2':focus];
  const headers=order.map(v=>{
    const cls=v==='020'?'v020':v==='V2'?'v2':'v003';
    return '<th class="'+cls+'">'+esc(v==='V2'?'V2 新架构':v+' Legacy')+'</th>';
  }).join('');
  const rows=(DATA.versionMappings||[]).map(vm=>{
    const cells=order.map(v=>'<td><div class="version-cell '+(v==='020'?'v020':v==='V2'?'v2':'v003')+'">'+(vm[v]||[]).map(x=>'<div class="version-method">'+esc(x)+'</div>').join('')+'</div></td>').join('');
    const caption='<tr class="version-caption"><th colspan="'+order.length+'">'+esc(vm.businessResponsibility)+'<small>'+esc(vm.status||'UNKNOWN')+'</small></th></tr>';
    const evidence=(vm.evidenceIds||[]).length?'<tr class="version-evidence"><td colspan="'+order.length+'">证据：'+esc(vm.evidenceIds.join(' · '))+'</td></tr>':'';
    return caption+'<tr class="version-row">'+cells+'</tr>'+evidence;
  }).join('');
  map.innerHTML='<table class="version-table"><colgroup>'+order.map(()=>'<col>').join('')+'</colgroup><thead><tr>'+headers+'</tr></thead><tbody>'+rows+'</tbody></table>';
}
const V2REF=adapter.v2Reference;
function pickV2Reference(tab,methodId){
  return adapter.v2ReferenceView.pickReference(V2REF,tab,methodId);
}
function renderV2(tab){
  const view=adapter.v2ReferenceView;
  const box=$('v2Content'),label=$('v2SelectionLabel');
  if(!box||!label)return null;
  if(!view||typeof view.render!=='function'){
    box.innerHTML='<div class="empty">V2 参考实现视图模块未加载或版本不匹配，请强制刷新页面（Ctrl+F5）。</div>';
    return null;
  }
  try{
    return view.render({
      tab,
      methodId:activeMethod,
      methods:allMethods,
      ref:V2REF,
      box,
      label,
      esc,
      highlightCode
    });
  }catch(err){
    box.innerHTML='<div class="empty">V2 参考实现渲染出错：'+esc(err&&err.message||String(err))+'。请强制刷新页面（Ctrl+F5）；若持续出现请检查 analyzer/v2-reference-view.js。</div>';
    return null;
  }
}
function renderDataSources(){
  if(!$('dataSourceContent'))return null;
  return adapter.dataView.renderDataSources({
    data:DATA,
    titleNode:$('dataSourceTitle'),
    contentNode:$('dataSourceContent'),
    apiContentNode:$('httpApiContent'),
    esc,
    statusClass
  });
}
function collectUsage(){
  return adapter.dataView.collectUsage(DATA,allMethods,methodUseCount);
}
function renderUsage(){
  if(!$('sourceUsageSummary')||!$('usageList'))return null;
  return adapter.dataView.renderUsage({
    data:DATA,
    methods:allMethods,
    methodUseCount,
    summaryNode:$('sourceUsageSummary'),
    listNode:$('usageList'),
    esc
  });
}
function setupV2Workbench(hashMethod){
  if(hashMethod&&allMethods[hashMethod])activeMethod=hashMethod;
  const select=$('v2MethodSelect');
  if(!select)return;
  const preferred=[];
  Object.values(V2REF.groups||{}).forEach(group=>(group.methodIds||[]).forEach(id=>{
    if(allMethods[id]&&!preferred.includes(id))preferred.push(id);
  }));
  const others=Object.keys(allMethods).filter(id=>!preferred.includes(id));
  const option=id=>'<option value="'+esc(id)+'">'+esc(allMethods[id].name+'（'+id+'）')+'</option>';
  select.innerHTML=(preferred.length?'<optgroup label="V2 参考覆盖的方法">'+preferred.map(option).join('')+'</optgroup>':'')+
    (others.length?'<optgroup label="其他方法">'+others.map(option).join('')+'</optgroup>':'');
  if(!activeMethod)activeMethod=preferred[0]||Object.keys(allMethods)[0]||'';
  select.value=activeMethod;
  select.addEventListener('change',e=>{activeMethod=e.target.value;renderV2(activeV2Tab)});
}
function renderLegacyCoverageSummary(){
  const box=$('legacyCoverageSummary');
  if(!box)return;
  const stats=legacyCoverageStats();
  const partial=stats.only003+stats.only020;
  box.innerHTML='<div class="coverage-row"><b>旧版源码 · 版本覆盖</b><span class="coverage-value">'+stats.registered+' / '+stats.modelMethods+'</span></div>'+
    '<div class="coverage-row"><span>003 + 020 双版本</span><span>'+stats.bothVersions+'</span></div>'+
    '<div class="coverage-row"><span>仅 003 东港 / 仅 020 潼南</span><span class="'+(partial?'coverage-value warn':'coverage-value')+'">'+stats.only003+' / '+stats.only020+'</span></div>'+
    '<div class="coverage-row"><span>未登记旧版源码</span><span>'+stats.unregistered+'</span></div>'+
    '<small>单版本登记的方法在运行解析里带“未登记”标记；缺口按证据边界保留，不按名称猜测补齐。</small>';
}
function exportAnalysisReport(){
  const report=adapter.report.buildReport({
    data:DATA,
    methods:allMethods,
    activeComponent,
    activeEvent,
    activeMethod,
    activeV2Tab,
    versionFocus,
    v2Reference:V2REF,
    legacyVersionCoverage:legacyCoverageStats(),
    pickV2Reference:(ref,tab,methodId)=>adapter.v2ReferenceView.pickReference(ref,tab,methodId)
  });
  adapter.report.download(report);
}
/* 页面画布联动：prototype.html（iframe）激活事件时，运行解析面板同步展示对应 V1.2.0 事件链。
   映射表维护在画布侧（prototype.html RUNTIME_LINKS）；这里只校验模型事件存在后渲染。 */
const canvasFrame=$('canvasFrame');
const linesNote=document.querySelector('.panel.lines .ph small');
const defaultLinesNote=linesNote?linesNote.textContent:'';
let lastCanvasNote='';
if(canvasFrame){
  window.addEventListener('message',event=>{
    const expectedOrigin=location.origin==='null'?'null':location.origin;
    if(event.source!==canvasFrame.contentWindow||event.origin!==expectedOrigin)return;
    const msg=event.data;
    if(!msg||msg.source!=='pd-outpatient-prototype'||msg.type!=='runtime-link'||typeof msg.eventId!=='string'||typeof msg.modelEventId!=='string')return;
    const modelEvent=DATA.events[msg.modelEventId];
    if(!modelEvent)return;
    if($('eventSelect'))$('eventSelect').value=modelEvent.id;
    renderEvent(modelEvent.id);
    const componentName=typeof msg.componentName==='string'?msg.componentName:'';
    const note=typeof msg.note==='string'?msg.note:'';
    lastCanvasNote='画布事件 '+msg.eventId+(componentName?'（'+componentName+'）':'')+' → '+modelEvent.id+' · '+modelEvent.name+(note?' · '+note:'');
    if(linesNote)linesNote.textContent=lastCanvasNote;
    const linesPanel=document.querySelector('.panel.lines');
    if(linesPanel){linesPanel.classList.remove('rt-linked');void linesPanel.offsetWidth;linesPanel.classList.add('rt-linked');}
  });
  /* 画布模式期间联动渲染发生在隐藏的 #callGraph 里，C001 特判的 reference-flow SVG 连线依赖可见时测量；
     切回调用图视图后若连线缺失（rAF/ResizeObserver 时序不可靠），补渲染一次并恢复画布联动说明。 */
  window.addEventListener('pd-workbench-restored',()=>{
    const flow=document.querySelector('#callGraph .reference-flow');
    if(flow&&!flow.querySelector('path.flow-path')&&activeEvent){
      renderEvent(activeEvent);
      if(linesNote&&lastCanvasNote)linesNote.textContent=lastCanvasNote;
    }
  });
}
const hashMethod=(()=>{const match=location.hash.match(/^#m=([A-Za-z0-9_-]+)$/);return match?match[1]:'';})();
if($('eventSelect')){
  renderEventOptions();
  $('eventSelect').addEventListener('change',e=>renderEvent(e.target.value));
}
if($('componentSearch'))$('componentSearch').addEventListener('input',e=>renderComponents(e.target.value));
if($('componentViewToggle'))$('componentViewToggle').addEventListener('click',()=>{
  const compact=$('components').classList.toggle('codes-only');
  document.querySelector('.shell').classList.toggle('sidebar-codes-only',compact);
  $('componentViewToggle').setAttribute('aria-pressed',String(compact));
  $('componentViewToggle').title=compact?'恢复显示组件名称':'切换仅显示组件编码';
});
if($('componentTree')){
  renderComponents('');
  if(activeEvent)renderEvent(activeEvent);
  if(hashMethod&&allMethods[hashMethod])jumpToMethod(hashMethod);
}
if($('versionMap')){
  renderVersions('all');
  if($('versionFocus'))$('versionFocus').addEventListener('change',e=>renderVersions(e.target.value));
}
if($('v2Content')&&$('v2SelectionLabel')){
  setupV2Workbench(hashMethod);
  renderV2(activeV2Tab);
}
renderDataSources();
renderLegacyCoverageSummary();
renderUsage();
if($('exportAnalysisReport'))$('exportAnalysisReport').addEventListener('click',exportAnalysisReport);
document.addEventListener('click',e=>{
  if(e.target.closest('[data-evidence-help]'))showEvidenceDefinitions();
  const reference=e.target.closest('[data-type-reference]');
  if(reference)showTypeReference(reference.dataset.typeReference,reference.dataset.typeContext||'');
  const resource=e.target.closest('[data-resource-reference]');
  if(resource)showResourceReference(resource.dataset.resourceReference);
  const methodReference=e.target.closest('[data-method-reference]');
  if(methodReference)jumpToMethod(methodReference.dataset.methodReference);
});
if($('typeDialogClose')){
  $('typeDialogClose').addEventListener('click',()=>$('typeReferenceDialog').close());
  $('typeReferenceDialog').addEventListener('click',e=>{if(e.target===$('typeReferenceDialog'))$('typeReferenceDialog').close()});
}
if($('srcModeToggle')){
  $('srcModeToggle').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{srcMode=b.dataset.srcMode;$('srcModeToggle').querySelectorAll('button').forEach(x=>{const on=x.dataset.srcMode===srcMode;x.classList.toggle('active',on);x.setAttribute('aria-pressed',String(on))});if(activeMethod)renderMethod(activeMethod);}));
}
document.querySelectorAll('[data-v2]').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('[data-v2]').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeV2Tab=b.dataset.v2;renderV2(activeV2Tab);
}));
document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',()=>{
  const e=$(b.dataset.copy);if(e&&navigator.clipboard)navigator.clipboard.writeText(e.textContent||'');
  const old=b.textContent;b.textContent='已复制';setTimeout(()=>b.textContent=old,900);
}));
return true;
}
window.PDCallAnalysisEngine={start,detectAdapter};
start(detectAdapter());
})();
