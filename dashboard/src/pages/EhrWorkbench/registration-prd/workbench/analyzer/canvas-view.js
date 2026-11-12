/* 工作台视图切换：调用图视图 ⇄ 页面画布（prototype.html 嵌入态）。
   画布 iframe 首次切换时才加载；#canvas 锚点可直接进入画布视图。
   画布模式下仅替换调用图，文字树与运行解析（方法说明）面板保留，侧栏隐藏。 */
(function () {
  'use strict';
  /* v 参数是 iframe 缓存键：prototype.html 内容更新时必须同步 +1，否则嵌入 iframe 会吃内存缓存旧版 */
  var CANVAS_SRC = 'prototype.html?package-embed=1&pure=1&v=20260928-22';
  var tabAnalysis = document.getElementById('viewTabAnalysis');
  var tabCanvas = document.getElementById('viewTabCanvas');
  var shell = document.getElementById('workbenchShell');
  var panel = document.getElementById('canvasView');
  var frame = document.getElementById('canvasFrame');
  if (!tabAnalysis || !tabCanvas || !shell || !panel || !frame) return;
  var loaded = false;
  function activate(view) {
    var canvas = view === 'canvas';
    tabAnalysis.classList.toggle('active', !canvas);
    tabAnalysis.setAttribute('aria-selected', String(!canvas));
    tabCanvas.classList.toggle('active', canvas);
    tabCanvas.setAttribute('aria-selected', String(canvas));
    shell.classList.toggle('canvas-mode', canvas);
    panel.hidden = !canvas;
    if (canvas && !loaded) { frame.src = CANVAS_SRC; loaded = true; }
    if (!canvas) window.dispatchEvent(new CustomEvent('pd-workbench-restored'));
  }
  tabAnalysis.addEventListener('click', function () { activate('analysis'); });
  tabCanvas.addEventListener('click', function () { activate('canvas'); });
  if (location.hash === '#canvas') activate('canvas');
})();
