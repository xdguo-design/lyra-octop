(function(){
'use strict';
const script=document.currentScript;
const base=new URL('../../../../assets/',script.src);
function loadEngine(){
  const engine=document.createElement('script');
  engine.src=new URL('pd-call-analysis-engine.js?v=20261005-1',base).href;
  engine.onerror=()=>{const host=document.getElementById('callGraph')||document.querySelector('main')||document.body;if(host)host.insertAdjacentHTML('afterbegin','<div class="empty" role="alert">调用链共享运行层加载失败，请刷新页面或检查 assets/pd-call-analysis-engine.js。</div>');};
  script.after(engine);
}
if(window.OUTPATIENT_CALL_ANALYSIS_DATA){
  const details=document.createElement('script');
  details.src=new URL('pd-outpatient-method-io-details.js?v=20261005-1',base).href;
  details.onload=loadEngine;
  details.onerror=()=>{loadEngine();};
  script.after(details);
}else loadEngine();
})();
