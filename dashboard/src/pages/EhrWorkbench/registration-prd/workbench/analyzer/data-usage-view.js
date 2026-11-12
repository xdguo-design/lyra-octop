/* 门诊收费调用链分析 · 数据目录与使用位置视图 */
(function(){
  'use strict';

  const icon=name=>'<svg class="ic" aria-hidden="true"><use href="#icon-'+name+'"/></svg>';

  function renderDataSources(options){
    const {data,titleNode,contentNode,apiContentNode,esc,statusClass}=options||{};
    if(!data||!titleNode||!contentNode)throw new Error('data source view missing dependencies');

    const enums=Object.values(data.enums||{});
    const dicts=Object.values(data.dictionaries||{});
    const apis=Object.values(data.apis||{});
    const resources=Object.values(data.repositories||{});
    const repos=resources.filter(x=>/^R_/.test(String(x.id||''))||/^R0/.test(String(x.id||'')));
    const services=resources.filter(x=>/^S_|^X_/.test(String(x.id||'')));
    const tables=Object.values(data.tables||{});
    const apiGroupIds=new Set(['API_PATIENT_LIST','API003_PATIENT_QUERY','API020_PATIENT_QUERY']);
    const apiRows=apis.filter(x=>String(x.method||'').toUpperCase()!=='SVC'&&!apiGroupIds.has(x.id));
    const apiGroups=apis.filter(x=>apiGroupIds.has(x.id));
    const serviceMethodRows=apis.filter(x=>String(x.method||'').toUpperCase()==='SVC');

    titleNode.textContent=enums.length+' 枚举 · '+dicts.length+' 字典 · '+apiRows.length+
      ' HTTP API · '+serviceMethodRows.length+' Service 方法 · '+repos.length+
      ' Repository · '+tables.length+' Table';

    const table=(title,definition,rows,iconName)=>'<section class="data-section"><h3>'+(iconName?icon(iconName):'')+esc(title)+
      '<small>'+esc(definition)+'</small></h3><table><thead><tr><th>名称</th><th>状态</th><th>定义 / 来源</th></tr></thead><tbody>'+
      rows.map(r=>'<tr><td><code>'+esc(r.name||r.id)+'</code></td><td><span class="badge '+
        statusClass(r.status)+'">'+esc(r.status||'UNKNOWN')+'</span></td><td>'+esc(r.detail||'')+'</td></tr>').join('')+
      '</tbody></table></section>';

    const enumRows=enums.map(e=>({
      name:e.id,status:e.status,
      detail:(e.values||[]).map(v=>v.code+' '+v.displayName).join(' / ')
    }));
    const dictionaryRows=dicts.map(x=>({
      name:x.name||x.id,status:x.status,
      detail:(x.source||'')+(x.fields?.length?' · 字段：'+x.fields.join(', '):'')
    }));
    const endpointRows=apiRows.map(x=>({
      name:x.name||x.id,status:x.status,
      detail:(x.method||'')+' '+(x.path||'UNKNOWN')+
        (x.detail?' · '+x.detail:'')+(x.source?' · 源码：'+x.source:'')
    }));
    const groupRows=apiGroups.map(x=>({
      name:x.name||x.id,status:x.status,
      detail:(x.method||'')+' · '+(x.detail||'')+
        (x.evidenceIds?.length?' · 证据：'+x.evidenceIds.join(', '):'')
    }));
    const logicRows=serviceMethodRows.map(x=>({
      name:x.name||x.id,status:x.status,
      detail:(x.path||'')+(x.detail?' · '+x.detail:'')+
        (x.source?' · 来源：'+x.source:'')
    }));
    const repositoryRows=repos.map(x=>({
      name:x.name||x.id,status:x.status,
      detail:(x.tableIds||[]).length
        ? '关联表：'+x.tableIds.join(', ')+(x.note?' · '+x.note:'')
        : (x.note||'')
    }));
    const serviceRows=services.map(x=>({
      name:x.name||x.id,status:x.status,
      detail:(x.category||'')+(x.note?' · '+x.note:'')+
        (x.source?' · 来源：'+x.source:'')
    }));
    const tableRows=tables.map(x=>({
      name:x.name||x.id,status:x.status,
      detail:(x.category||'')+(x.note?' · '+x.note:'')+
        (x.fields?.length?' · 字段：'+x.fields.join(', '):'')+
        (x.source?' · 来源：'+x.source:'')
    }));

    const apiSection=table('HTTP API（'+endpointRows.length+'）','前后端或外部系统的 HTTP 请求端点',endpointRows,'db');
    if(apiContentNode){
      apiContentNode.innerHTML='<div class="data-stack">'+apiSection+'</div>';
    }
    contentNode.innerHTML=
      '<div class="data-stack">'+
      table('枚举 / 编码（'+enumRows.length+'）','固定取值集合',enumRows)+
      table('业务字典（'+dictionaryRows.length+'）','可配置的编码、名称和业务属性',dictionaryRows)+
      '</div>'+
      '<div class="data-stack">'+
      (apiContentNode?'':apiSection)+
      table('接口职责索引（'+groupRows.length+'）','跨版本业务归类，不代表单个 HTTP 路径',groupRows,'db')+
      table('Service 逻辑方法（'+logicRows.length+'）','业务操作入口；不等同于 HTTP API',logicRows)+
      table('Repository（'+repositoryRows.length+'）','数据查询与持久化访问边界',repositoryRows,'db')+
      table('领域服务 / 外部权威数据源（'+serviceRows.length+'）','业务能力或权威数据提供方',serviceRows)+
      table('Table / 逻辑表（'+tableRows.length+'）','V2 为业务逻辑模型，非已核实物理表',tableRows,'db')+
      '</div>';
  }

  function collectUsage(data,methods,methodUseCount){
    const methodRows=Object.values(methods||{}).map(m=>{
      const callers=Object.values(methods||{})
        .filter(caller=>(caller.calls||[]).includes(m.id))
        .map(caller=>({id:caller.id,name:caller.name,detail:'调用此方法'}));
      return {
        kind:'方法',
        id:m.id,
        name:m.name,
        count:methodUseCount(m.id),
        where:[...(m.evidenceIds||[]),...(m.dataAccess||[])].join(' · '),
        targets:callers
      };
    });

    const paramKindByCatalog={dict:'参数表参数',contract:'契约参数',page:'页面私有'};
    const paramRows=Object.values(data.parameters||{}).map(p=>{
      const refs=Object.values(methods||{}).filter(m=>(m.parameterIds||[]).includes(p.id));
      return {
        kind:paramKindByCatalog[p.catalog]||'V2 设计参数',id:p.id,name:p.name,count:refs.length,
        where:refs.slice(0,4).map(m=>m.name).join(' · '),
        targets:refs.map(m=>({
          id:m.id,name:m.name,
          detail:(m.args||[]).join('；')||m.type||'引用该参数'
        }))
      };
    });

    const switchKindByCatalog={dict:'参数表开关',page:'页面私有状态',design:'V2 设计开关'};
    const switchRows=Object.values(data.switches||{}).map(sw=>{
      const refs=Object.values(methods||{}).filter(m=>(m.switchIds||[]).includes(sw.id));
      return {
        kind:switchKindByCatalog[sw.category]||'开关',id:sw.id,name:sw.name,count:refs.length,
        where:refs.slice(0,4).map(m=>m.name).join(' · '),
        targets:refs.map(m=>({
          id:m.id,name:m.name,
          detail:(m.code||[]).filter(line=>line.includes(sw.name||sw.id)).join(' ').trim()||
            '该方法登记读取此开关'
        }))
      };
    });

    const rows=[
      ...methodRows.filter(x=>x.count),
      ...paramRows.filter(x=>x.count),
      ...switchRows.filter(x=>x.count)
    ].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,5);

    const directRows=[...paramRows,...switchRows].filter(x=>x.count);
    return {
      rows,
      total:directRows.reduce((sum,row)=>sum+row.count,0),
      methods:new Set(directRows.flatMap(row=>row.targets.map(target=>target.id))).size,
      items:directRows.length
    };
  }

  function renderUsage(options){
    const {
      data,methods,methodUseCount,summaryNode,listNode,esc
    }=options||{};
    if(!summaryNode||!listNode)throw new Error('usage view missing dependencies');

    const usage=collectUsage(data,methods,methodUseCount);
    const rows=usage.rows;

    summaryNode.innerHTML=
      '<div><strong>'+usage.total+'</strong><span>参数 / 开关引用</span></div>'+
      '<div><strong>'+usage.methods+'</strong><span>涉及方法</span></div>'+
      '<div><strong>'+usage.items+'</strong><span>有引用条目</span></div>';

    listNode.dataset.count=rows.length;
    listNode.innerHTML=rows.map(r=>
      '<div class="use"><details><summary><b>'+(r.kind.indexOf('开关')>=0?icon('switch'):r.kind.indexOf('参数')>=0?icon('param'):'')+'<span class="use-label">'+esc(r.kind+' · '+r.name)+'</span></b><strong>'+r.count+
      '</strong></summary><div class="use-details">'+
      (r.targets&&r.targets.length
        ? r.targets.map(target=>
            '<button type="button" data-method-reference="'+esc(target.id)+'">'+esc(target.name)+
            '<small>'+esc(target.detail||'具体调用关系已登记')+'</small></button>'
          ).join('')
        : '<small>当前模型没有登记可跳转的调用方。</small>')+
      '</div></details></div>'
    ).join('');

    return usage;
  }

  window.CLINIC_REG_ANALYZER_DATA_VIEW={
    renderDataSources,
    collectUsage,
    renderUsage
  };
})();
