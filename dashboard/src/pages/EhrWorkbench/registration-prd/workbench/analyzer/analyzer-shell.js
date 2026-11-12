/* 代码逻辑分析器 · 共享壳层脚本：按 body[data-analyzer-tab] 注入顶栏与维度导航，避免每页复制标记。
   依赖：analyzer-shell.css；页面需有 .page 容器。 */
(function () {
  'use strict';
  var TABS = [
    ['页面分析', 'prototype.html'],
    ['组件分析', 'call-analysis.html#components'],
    ['事件/方法', 'call-analysis.html#event-method'],
    ['调用链分析', 'call-analysis.html#call-graph'],
    ['数据源&枚举', 'data-sources.html'],
    ['代码对比', 'call-analysis.html#version-compare'],
    ['新架构实现', 'call-analysis.html#v2-implementation'],
    ['影响分析', 'call-analysis.html#usage-impact']
  ];
  function mount() {
    var page = document.querySelector('.page');
    if (!page || page.querySelector('.analyzer-topbar')) return;
    var active = document.body.getAttribute('data-analyzer-tab') || '';
    var bar = document.createElement('div');
    bar.className = 'analyzer-topbar';
    bar.innerHTML =
      '<div class="analyzer-row">' +
      '<div class="analyzer-brand"><span class="mark">✚</span><b>医疗信息化平台</b><span class="divider"></span><strong>代码逻辑分析器</strong></div>' +
      '<div class="analyzer-crumb">经济 &gt; 门诊收费 · 代码逻辑分析器</div>' +
      '<span class="analyzer-spacer"></span>' +
      '<div class="release-compare"><select aria-label="当前版本"><option>V1.2.0（当前）</option><option>003 Legacy</option><option>020 Legacy</option></select><span class="swap">⇄</span><select aria-label="目标版本"><option>V2.0.0（新架构）</option></select></div>' +
      '<button class="export-report" type="button" title="打印 / 另存为 PDF">⇩ 导出报告</button>' +
      '</div>' +
      '<nav class="analysis-nav" aria-label="代码分析导航">' +
      TABS.map(function (t) {
        return '<a href="' + t[1] + '"' + (t[0] === active ? ' class="active" aria-current="page"' : '') + '>' + t[0] + '</a>';
      }).join('') +
      '</nav>';
    bar.querySelector('.export-report').addEventListener('click', function () { window.print(); });
    page.insertBefore(bar, page.firstChild);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
