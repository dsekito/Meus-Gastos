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
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return res.writeHead(404).end();
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const failures = [];
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block' });
    await page.clock.install({ time: new Date('2026-11-11T15:00:00Z') });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
      localStorage.setItem('meus-gastos-google-user', JSON.stringify({ id: 'review-functions', email: 'functions@example.invalid' }));
      await MGLocalStore.save('review-functions', { settings: { onboarding_status: 'completed', current_balance: 1000, balance_reference_date: '2026-11-01' }, entries: [{ id: 'function-entry', date: '2026-11-10', type: 'ALIMENTAÇÃO', description: 'SUPERMERCADO', value: 200, paid: false }], recurrenceSeries: [], syncQueue: [] });
    });
    await page.reload();
    await page.waitForSelector('#appShell:not([hidden])');
    async function check(name, run) {
      try { await run(); console.log('PASS ' + name); }
      catch (error) { failures.push({ name, message: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
    }
    await check('projection wording makes pending-inclusive balance explicit without changing arithmetic', async () => {
      assert.match(await page.locator('.balance-card .label').innerText(), /saldo projetado hoje/i);
      assert.match(await page.locator('#currentBalanceTotal').innerText(), /800,00/);
      assert.match(await page.locator('#balanceReferenceSummary').innerText(), /11\/11\/2026.*pendências/i);
      assert.equal(await page.locator('#appViewTitle').innerText(), 'Visão geral');
    });
    await check('new installments do not offer an ignored paid checkbox', async () => {
      await page.locator('#openModalMobile').click();
      await page.locator('#entryAdvanced > summary').click();
      await page.locator('#recurrence').selectOption('installments');
      assert.equal(await page.locator('#paid').isVisible(), false);
      assert.equal(await page.locator('#paid').isDisabled(), true);
      assert.match(await page.locator('#installmentPreview').innerText(), /parcelas.*em aberto/i);
    });
    await page.locator('#entryDialog').evaluate(dialog => dialog.close());
    await check('month-empty state has an actionable return to current month', async () => {
      await page.locator('.app-navigation [data-app-destination="records"]').click();
      await page.locator('#filterMonth').fill('2026-12');
      await page.locator('#filterMonth').dispatchEvent('change');
      assert.match(await page.locator('#rows').innerText(), /nenhum lançamento em dezembro/i);
      await page.locator('[data-empty-action="current-month"]').click();
      assert.equal(await page.locator('#filterMonth').inputValue(), '2026-11');
      assert.match(await page.locator('#rows').innerText(), /SUPERMERCADO/);
    });
    await check('local mode without pending uploads stays compact but authorization remains reachable', async () => {
      await page.evaluate(() => setSyncStatus('pending', 'Autorização necessária'));
      assert.equal(await page.locator('#syncNotice').isVisible(), false, 'no blocking banner when there is nothing to upload');
      assert.equal(await page.locator('#reconnectGoogle').isVisible(), true);
      await page.evaluate(() => { state.syncQueue.push({ type: 'upsert', entry: state.entries[0] }); setSyncStatus('pending', 'Envio pendente'); });
      assert.equal(await page.locator('#syncNotice').isVisible(), true, 'pending uploads must retain the authorization action');
      assert.equal(await page.locator('#syncNoticeAction').getAttribute('data-action'), 'authorize');
      await page.evaluate(() => { state.syncQueue = []; });
    });
    await check('critical synchronization details open automatically', async () => {
      await page.evaluate(() => setSyncStatus('conflict', 'Conflito de teste'));
      assert.equal(await page.locator('#syncDetails').getAttribute('open'), '');
      assert.equal(await page.locator('#syncNoticeAction').isVisible(), true);
      assert.match(await page.locator('#syncNoticeAction').innerText(), /resolver conflito/i);
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, [], 'Professional functional regressions must pass');
    console.log('PASS 5 functional review scenarios; isolated Edge, no real Google');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
