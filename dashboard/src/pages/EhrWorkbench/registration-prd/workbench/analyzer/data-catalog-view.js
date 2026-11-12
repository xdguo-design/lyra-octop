/* 门诊挂号登记 · 数据与接口目录渲染。消费 CLINIC_REG_DATA_SOURCES 聚合 + 主模型 switches。 */
(function(){
'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(m){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]});}
function badge(s){s=s||'UNKNOWN';var c=s==='VERIFIED'?'ok':s==='INFERRED'?'inferred':s==='PROPOSED'?'proposed':'warn';return '<span class="badge '+c+'">'+esc(s)+'</span>';}
function vals(o){return Object.keys(o||{}).map(function(k){return o[k]});}
function table(rows,head,render){
  if(!rows.length)return '<div class="empty">暂无数据。</div>';
  return '<table><thead><tr>'+head.map(function(h){return '<th>'+h+'</th>'}).join('')+'</tr></thead><tbody>'+
    rows.map(render).join('')+'</tbody></table>';
}
function renderCatalog(){
  var body=document.getElementById('dsBody');
  if(!body)return;
  var DS=window.CLINIC_REG_DATA_SOURCES||{};
  var DATA=window.CLINIC_REG_CALL_ANALYSIS_DATA||{};
  var apisL=vals(DS.apisLegacy),apisV=vals(DS.apisV2),enums=vals(DS.enums),dicts=vals(DS.dictionaries);
  var tablesL=vals(DS.tablesLegacy),tablesV=vals(DS.tablesV),switches=vals((DATA||{}).switches);
  var all=[].concat(apisL,apisV,enums,dicts,tablesL,tablesV,switches);
  var byStatus={};all.forEach(function(x){var s=x.status||'UNKNOWN';byStatus[s]=(byStatus[s]||0)+1;});
  var sum=document.getElementById('dsSummary');
  if(sum)sum.innerHTML=['VERIFIED','INFERRED','PROPOSED'].map(function(s){return byStatus[s]?'<span class="badge '+s.toLowerCase()+'">'+s+' <b>'+byStatus[s]+'</b></span>':''}).join('')+'<span>共 <b>'+all.length+'</b> 项</span>';
  var apiRow=function(x){return '<tr><td><code>'+esc(x.id)+'</code></td><td><span>'+esc(x.method||'')+'</span> <code>'+esc(x.path||'')+'</code></td><td>'+badge(x.status)+'</td><td>'+esc(x.purpose||'')+'</td><td class="muted">'+esc(x.source||'')+'</td></tr>';};
  var enumRow=function(x){return '<tr><td><code>'+esc(x.id)+'</code></td><td>'+badge(x.status)+'</td><td>'+((x.values||[]).map(function(v){return '<div><code>'+esc(v.code)+'</code> '+esc(v.label||v.displayName||'')+'</div>'}).join('')||'—')+'</td><td class="muted">'+esc(x.note||'')+'</td></tr>';};
  var dictRow=function(x){return '<tr><td><code>'+esc(x.name||x.id)+'</code></td><td>'+badge(x.status)+'</td><td class="muted">'+esc((x.fields||[]).join(' · '))+'</td><td class="muted">'+esc(x.source||'')+'</td></tr>';};
  var tableRow=function(x){return '<tr><td><code>'+esc(x.name||x.id)+'</code></td><td>'+badge(x.status)+'</td><td class="muted">'+esc(x.note||'')+'</td></tr>';};
  var swRow=function(x){return '<tr><td><code>'+esc(x.name||x.id)+'</code></td><td>'+badge(x.status)+'</td><td class="muted">'+esc(x.def||'—')+'</td><td>'+esc(x.description||'')+'</td><td class="muted">'+esc(x.source||'')+'</td></tr>';};
  body.innerHTML=
    '<section class="ds-section"><h3>旧版接口 · 003/020 客户端真实调用 <small>'+apisL.length+'</small></h3>'+table(apisL,['标识','方法 / 路径','状态','用途','源码位置'],apiRow)+'</section>'+
    '<section class="ds-section"><h3>V2 目标接口 <small>'+apisV.length+'</small></h3>'+table(apisV,['标识','方法 / 路径','状态','用途','源码位置'],apiRow)+'</section>'+
    '<section class="ds-section"><h3>枚举 <small>'+enums.length+'</small></h3>'+table(enums,['枚举','状态','取值（源码可证实部分）','说明'],enumRow)+'</section>'+
    '<section class="ds-section"><h3>数据字典 <small>'+dicts.length+'</small></h3>'+table(dicts,['字典','状态','字段','来源'],dictRow)+'</section>'+
    '<section class="ds-section"><h3>旧版数据表 <small>'+tablesL.length+'</small></h3>'+table(tablesL,['表 / 逻辑对象','状态','说明'],tableRow)+'</section>'+
    '<section class="ds-section"><h3>V2 逻辑表 <small>'+tablesV.length+'</small></h3>'+table(tablesV,['表 / 逻辑对象','状态','说明'],tableRow)+'</section>'+
    '<section class="ds-section"><h3>业务开关 <small>'+switches.length+'</small></h3>'+table(switches,['开关','状态','默认','影响','源码位置'],swRow)+'</section>';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',renderCatalog);
else renderCatalog();
})();
