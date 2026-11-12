/* 门诊收费调用链分析 · 报告导出
 * 只导出当前工作台选择和证据边界，不上传源码，不读取本地源码索引正文。
 */
(function(){
  'use strict';

  function buildReport(context){
    const {
      data,
      methods,
      activeComponent,
      activeEvent,
      activeMethod,
      activeV2Tab,
      versionFocus,
      v2Reference,
      legacyVersionCoverage,
      pickV2Reference
    }=context;

    const component=data.components?.[activeComponent]||null;
    const event=data.events?.[activeEvent]||null;
    const method=methods?.[activeMethod]||null;
    const reference=typeof pickV2Reference==='function'
      ? pickV2Reference(v2Reference,activeV2Tab,activeMethod)
      : {group:null,layer:null};

    return {
      schemaVersion:'pd.outpatient.call-analysis.report.v1',
      generatedAt:new Date().toISOString(),
      selection:{
        versionFocus,
        component:component?{
          id:component.id,
          name:component.name,
          evidenceStatus:component.evidenceStatus||'UNKNOWN'
        }:null,
        event:event?{
          id:event.id,
          name:event.name,
          status:event.status||'UNKNOWN'
        }:null,
        method:method?{
          id:method.id,
          name:method.name,
          layer:method.layer||method.type||'Method',
          status:method.status||'UNKNOWN',
          args:method.args||[],
          returns:method.returns||'UNKNOWN',
          calls:method.calls||[],
          dataAccess:method.dataAccess||[],
          evidenceIds:method.evidenceIds||[]
        }:null
      },
      v2Reference:reference.layer?{
        status:v2Reference.status||'PROPOSED',
        group:reference.group?.title||'',
        tab:activeV2Tab,
        path:reference.layer.path||'',
        referenceFile:reference.layer.referenceFile||'',
        language:reference.layer.language||'',
        code:reference.layer.code||[]
      }:null,
      legacyVersionCoverage:legacyVersionCoverage||null,
      evidenceBoundary:{
        verified:'仅指向可追溯源码或正式材料的事实',
        inferred:'根据现有证据推导，需继续核验',
        proposed:'目标架构或参考实现，不代表现网代码',
        unknown:'当前证据不足'
      }
    };
  }

  function download(report,filename){
    const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=filename||('outpatient-call-analysis-'+new Date().toISOString().slice(0,10)+'.json');
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  window.CLINIC_REG_ANALYSIS_REPORT={buildReport,download};
})();
