/* 门诊收费调用链分析 · V2 参考实现视图
 * 纯展示模块：消费 window.CLINIC_REG_V2_REFERENCE，不读取或修改 Legacy 源码索引。
 * 默认展示精编骨架代码；完整参考源码按需展开，避免面板无限拉高。
 */
(function(){
  'use strict';

  const viewState=new WeakMap();

  function pickReference(ref, tab, methodId){
    const groups=Object.values((ref&&ref.groups)||{});
    const matched=groups.find(group=>(group.methodIds||[]).includes(methodId));
    const group=matched||groups.find(item=>item.layers&&item.layers[tab])||groups[0]||null;
    const layer=group&&group.layers?group.layers[tab]:null;
    return {group,layer};
  }

  function renderCode(lines,highlightCode){
    return '<div class="v2-code-wrap"><ol class="v2-code">'+
      lines.map(line=>'<li><code>'+highlightCode(line)+'</code></li>').join('')+
      '</ol></div>';
  }

  function render(options){
    const {
      tab,
      methodId,
      methods,
      ref=window.CLINIC_REG_V2_REFERENCE||{groups:{}},
      box,
      label,
      esc,
      highlightCode
    }=options||{};

    if(!box||!label||typeof esc!=='function'||typeof highlightCode!=='function'){
      throw new Error('V2 reference view missing required render dependencies');
    }

    const selected=methods&&methods[methodId];
    const picked=pickReference(ref,tab,methodId);
    const group=picked.group;
    const layer=picked.layer;

    if(!layer){
      label.textContent='PROPOSED · 暂无该分层参考实现';
      box.innerHTML='<div class="empty">该分层暂未登记目标参考实现。现有 003 / 020 源码事实仍以调用图和源码索引为准。</div>';
      return picked;
    }

    const focus=selected?selected.name:'完整业务链';
    label.textContent=focus+' · '+(group&&group.title?group.title:'目标实现')+' · PROPOSED';

    const meta='<div class="v2-reference-meta"><b>'+esc(group&&group.title?group.title:'V2 目标参考实现')+'</b>'+
      '<span>目标文件：<code>'+esc(layer.path||'未登记')+'</code></span>'+
      (layer.referenceFile?'<span>参考源码：<a href="'+esc(layer.referenceFile)+'" target="_blank" rel="noopener">'+esc(layer.referenceFile)+'</a></span>':'')+
      '<span>语言：'+esc(layer.language||tab)+' · 状态：'+esc(ref.status||'PROPOSED')+'</span>'+
      '<span class="v2-reference-warning">'+esc(ref.notice||'这是可落地的目标代码骨架，不把尚未确认的接口地址、院区字段或运行时行为伪装成 VERIFIED。')+'</span></div>';

    const token=[tab,methodId,layer.referenceFile||layer.path||''].join('::');
    box.dataset.referenceToken=token;
    box.dataset.referenceSource='skeleton';
    viewState.set(box,{ref,tab,methodId,highlightCode});
    box.innerHTML=meta+
      '<div data-v2-code-host>'+renderCode(layer.code||[],highlightCode)+'</div>'+
      (layer.referenceFile?'<div class="v2-reference-actions"><button type="button" class="v2-expand" data-v2-expand>⇩ 展开完整参考源码</button></div>':'');

    return picked;
  }

  let expandWired=false;
  function wireExpandToggle(){
    if(expandWired||typeof fetch!=='function')return;
    expandWired=true;
    document.addEventListener('click',e=>{
      const btn=e.target.closest('[data-v2-expand]');
      if(!btn||btn.disabled)return;
      const box=btn.closest('[data-reference-token]');
      const state=box&&viewState.get(box);
      if(!box||!state)return;
      const host=box.querySelector('[data-v2-code-host]');
      if(!host)return;
      const [tab,methodId]=box.dataset.referenceToken.split('::');
      const expand=box.dataset.referenceSource!=='file';
      if(expand){
        const file=(box.dataset.referenceToken.split('::')[2])||'';
        if(!file)return;
        btn.disabled=true;
        btn.textContent='加载中…';
        const token=box.dataset.referenceToken;
        fetch(file,{cache:'no-store'})
          .then(response=>{
            if(!response.ok)throw new Error('HTTP '+response.status);
            return response.text();
          })
          .then(source=>{
            if(box.dataset.referenceToken!==token)return;
            host.innerHTML=renderCode(source.replace(/\r\n/g,'\n').split('\n'),state.highlightCode);
            box.dataset.referenceSource='file';
            btn.disabled=false;
            btn.textContent='⇧ 收起，回到骨架代码';
          })
          .catch(()=>{
            if(box.dataset.referenceToken!==token)return;
            btn.disabled=false;
            btn.textContent='展开失败 · 参考源码暂不可达';
          });
      }else{
        const picked=pickReference(state.ref,tab,methodId);
        if(!picked.layer)return;
        host.innerHTML=renderCode(picked.layer.code||[],state.highlightCode);
        box.dataset.referenceSource='skeleton';
        btn.textContent='⇩ 展开完整参考源码';
      }
    });
  }

  wireExpandToggle();

  window.CLINIC_REG_V2_REFERENCE_VIEW={pickReference,render};
})();
