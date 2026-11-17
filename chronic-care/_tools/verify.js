// 交互流程验证 + 分屏截图
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const EXE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text()));

  await page.goto('file:///' + path.resolve(__dirname, '../prototype/index.html').replace(/\\/g, '/'));
  await page.waitForTimeout(400);

  const out = path.resolve(__dirname, '../prototype/shots');
  fs.mkdirSync(out, { recursive: true });

  const snap = async (sel, name) => {
    const el = page.locator(sel);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(220);
    await page.evaluate(() => document.querySelector('#toast')?.classList.remove('on'));
    await page.waitForTimeout(120);
    await el.screenshot({ path: path.join(out, name + '.png') });
    console.log('  →', name);
  };

  // 1. 首页默认
  await snap('#screen-today .phone', '01-today');

  // 2. 正常值提交
  await page.fill('#in-sbp', '138');
  await page.fill('#in-dbp', '86');
  await page.click('#btn-submit');
  await page.waitForTimeout(350);
  await snap('#screen-checkin .phone', '02-checkin-ok');

  // 3. 红灯：178/108
  await page.fill('#in-sbp', '178');
  await page.fill('#in-dbp', '108');
  await page.click('#btn-submit');
  await page.waitForTimeout(400);
  await snap('#screen-checkin .phone', '03-checkin-red');

  // 4. 指标 - 血糖
  await page.click('#metric-seg button[data-m="glu"]');
  await page.waitForTimeout(300);
  await snap('#screen-metrics .phone', '04-metrics-glu');

  // 5. 用药
  await snap('#screen-meds .phone', '05-meds');

  // 6. 报告解读
  await page.click('#upload-zone');
  await page.waitForTimeout(1600);
  await snap('#screen-report .phone', '06-report');
  await page.click('text=模拟：医生在后台点了「确认」');
  await page.waitForTimeout(350);
  await snap('#screen-report .phone', '07-report-confirmed');

  // 7. AI：拒答
  await page.fill('#chat-in', '我能不能停药了？');
  await page.click('.composer button');
  await page.waitForTimeout(700);
  await snap('#screen-ai .phone', '08-ai-block');

  // 8. AI：知识库
  await page.fill('#chat-in', '他汀能不能晚上吃？');
  await page.click('.composer button');
  await page.waitForTimeout(700);
  await snap('#screen-ai .phone', '09-ai-kb');

  // 9. 工作台：切到第二个患者
  await page.click('#queue .qitem:nth-child(2)');
  await page.waitForTimeout(300);
  await page.locator('.workbench').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.locator('.workbench').screenshot({ path: path.join(out, '10-workbench.png') });
  console.log('  → 10-workbench');

  // 10. 关掉一条待办
  await page.click('.wb-detail .btn-sm.primary');
  await page.waitForTimeout(400);
  await page.locator('.workbench').screenshot({ path: path.join(out, '11-workbench-closed.png') });
  console.log('  → 11-workbench-closed');

  // ---- 新增屏 ----
  await snap('#screen-onboard .phone', '12-onboard');

  await page.fill('#glu-in', '6.8');
  await page.click('#screen-glu .btn-primary');
  await page.waitForTimeout(400);
  await snap('#screen-glu .phone', '13-glu-green');

  await page.fill('#glu-in', '12.1');
  await page.click('#screen-glu .btn-primary');
  await page.waitForTimeout(400);
  await snap('#screen-glu .phone', '14-glu-amber');

  // 体重 + 水肿
  await page.click('#symptom-picks .pick:nth-child(3)');
  await page.click('#screen-weight .btn-primary');
  await page.waitForTimeout(400);
  await snap('#screen-weight .phone', '15-weight-amber');

  // 复诊
  await page.click('#slots .slot:nth-child(2)');
  await page.click('#screen-visit .btn-primary');
  await page.waitForTimeout(400);
  await snap('#screen-visit .phone', '16-visit-booked');

  await snap('#screen-profile .phone', '17-profile');
  await snap('#screen-msg .phone', '18-msg');

  // ---- 工作台四张视图 ----
  for (const v of ['patients', 'reports', 'board', 'rules', 'follow']) {
    await page.click(`#wb-nav a[data-view="${v}"]`);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      document.querySelector('#toast')?.classList.remove('on');
      const wb = document.querySelector('.workbench');
      const el = document.querySelector('#wb-view');
      el.style.bottom = 'auto';
      el.style.height = 'auto';
      el.style.overflow = 'visible';
      const h = Math.max(800, el.scrollHeight + 40);
      wb.style.height = h + 'px';
      wb.style.overflow = 'visible';
      el.style.height = h + 'px';
    });
    await page.waitForTimeout(200);
    await page.locator('.workbench').screenshot({ path: path.join(out, `19-wb-${v}.png`) });
    await page.evaluate(() => {
      const wb = document.querySelector('.workbench');
      const el = document.querySelector('#wb-view');
      el.style.bottom = '';
      el.style.height = '';
      el.style.overflow = '';
      wb.style.height = '';
      wb.style.overflow = '';
    });
    console.log('  → 19-wb-' + v);
  }
  await page.click('#wb-nav a[data-view="todo"]');
  await page.waitForTimeout(200);

  // 12. 全页
  await page.screenshot({ path: path.resolve(__dirname, '../prototype/shot-full.png'), fullPage: true });

  console.log('errors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
