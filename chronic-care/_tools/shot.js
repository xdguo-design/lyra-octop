// usage: node shot.js <file.html> <out.png> [width] [height] [fullPage]
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const [html, out, w = '1440', h = '1000', full = 'true'] = process.argv.slice(2);
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter((p) => require('fs').existsSync(p));
  const browser = await chromium.launch(
    candidates.length ? { executablePath: candidates[0] } : {}
  );
  const page = await browser.newPage({
    viewport: { width: +w, height: +h },
    deviceScaleFactor: 2,
  });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('file:///' + path.resolve(html).replace(/\\/g, '/'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: out, fullPage: full === 'true' });
  const dims = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  console.log('shot ->', out, JSON.stringify(dims));
  console.log('errors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
