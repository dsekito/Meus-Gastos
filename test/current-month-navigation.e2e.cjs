const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.goto(origin);
    await page.evaluate(async () => {
      const date = new Date().toISOString().slice(0, 10);
      localStorage.setItem('meus-gastos-google-user', JSON.stringify({ id: 'period-test', email: 'period@example.invalid' }));
      await MGLocalStore.save('period-test', { settings: { onboarding_status: 'completed', current_balance: 0, balance_reference_date: date }, entries: [], recurrenceSeries: [], syncQueue: [] });
    });
    await page.reload();
    await page.waitForSelector('#appShell:not([hidden])');
    assert.equal(await page.locator('#goToCurrentMonth').count(), 1, 'a one-tap current-month action must exist');
    assert.equal(await page.locator('#goToCurrentMonth').isVisible(), false, 'the action is hidden while the current month is shown');
    const currentMonth = await page.evaluate(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; });
    const expectedDate = new Date(currentMonth + '-15T12:00:00');
    expectedDate.setMonth(expectedDate.getMonth() + 4);
    const future = `${expectedDate.getFullYear()}-${String(expectedDate.getMonth() + 1).padStart(2, '0')}`;
    await page.locator('#filterMonth').fill(future);
    await page.locator('#filterMonth').dispatchEvent('change');
    await page.locator('#goToCurrentMonth').click();
    assert.equal(await page.locator('#filterMonth').inputValue(), currentMonth);
    assert.equal(await page.locator('#goToCurrentMonth').isVisible(), false);
    await page.locator('.app-navigation [data-app-destination="records"]').click();
    assert.equal(await page.locator('#filterMonth').inputValue(), currentMonth, 'the selected period stays consistent across views');
    assert.deepEqual(errors, []);
    console.log('PASS current-month action restores the local current month and keeps navigation consistent');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
