const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'outputs/audit-fixes/ui');
fs.mkdirSync(out, { recursive: true });
const results = { cases: [], errors: [], externalRequestsBlocked: [] };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/seed') return res.end('<!doctype html><title>Isolated synthetic seed</title>');
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (e, b) => {
    if (e) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream');
    res.end(b);
  });
});
async function seed(browser, origin, entries, extra = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    results.externalRequestsBlocked.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => results.errors.push(e.message));
  await page.clock.install({ time: new Date('2026-11-11T15:00:00Z') });
  await page.goto(origin + '/seed');
  await page.addScriptTag({ url: origin + '/js/local-store.js' });
  await page.evaluate(async ({ entries, extra }) => {
    const user = { id: 'audit-fixes-ui-synthetic', email: 'synthetic@example.invalid' };
    localStorage.setItem('meus-gastos-google-user', JSON.stringify(user));
    await MGLocalStore.save(user.id, { settings: { onboarding_status: 'completed', current_balance: 1000, balance_reference_date: '2026-11-01' }, entries, syncQueue: [], recurrenceSeries: [], ...extra });
  }, { entries, extra });
  await page.goto(origin);
  await page.waitForSelector('#appShell:not([hidden])');
  await page.locator('.app-navigation [data-app-destination="records"]').click();
  return { context, page };
}
const base = { date: '2026-11-11', value: 12.5, type: 'OUTROS', description: 'AUDIT', paid: false, flow_type: 'expense', created_at: '2026-11-11T12:00:00Z' };
const cases = {
  async descriptions(browser, origin) {
    const entries = ['SUPERMERCADO', 'RESTAURANTE'].map((description, i) => ({ ...base, id: `hidden-${i}`, type: 'ALIMENTAÇÃO', description }));
    const { context, page } = await seed(browser, origin, entries, { hiddenDescriptionsByType: { 'ALIMENTAÇÃO': ['SUPERMERCADO', 'RESTAURANTE'] } });
    try {
      const snapshot = () => page.evaluate(async () => {
        const disk = await MGLocalStore.load('audit-fixes-ui-synthetic', { observe: false });
        return { entries: disk.entries, syncQueue: disk.syncQueue, hiddenDescriptionsByType: disk.hiddenDescriptionsByType };
      });
      const before = await snapshot();
      assert.match(await page.locator('#rows').innerText(), /SUPERMERCADO/);
      await page.locator('#openModalMobile').click();
      await page.locator('#type').selectOption('ALIMENTAÇÃO');
      assert.equal(await page.locator('#description option[value="SUPERMERCADO"]').count(), 0);
      assert.equal(await page.locator('#description option[value="RESTAURANTE"]').count(), 0);
      await page.screenshot({ path: path.join(out, 'hidden-description-new.png') });
      await page.locator('#entryDialog [data-close]').first().click();
      await page.locator('#rows [data-open-entry="hidden-0"]').click();
      assert.equal(await page.locator('#description').inputValue(), 'SUPERMERCADO');
      assert.equal(await page.locator('#description option[value="RESTAURANTE"]').count(), 0);
      await page.screenshot({ path: path.join(out, 'hidden-description-edit.png') });
      await page.locator('#entryDialog [data-close]').first().click();
      assert.deepEqual(await snapshot(), before, 'Opening/canceling forms must not change financial data or hidden choices');
    } finally { await context.close(); }
  },
  async mouse(browser, origin) {
    for (const width of [375, 1280]) {
      const { context, page } = await seed(browser, origin, [{ ...base, id: 'mouse-entry' }]);
      try {
        await page.setViewportSize({ width, height: width === 1280 ? 900 : 812 });
        const row = page.locator('#rows [data-entry="mouse-entry"]');
        const opener = page.locator('#rows [data-open-entry="mouse-entry"]');
        const snapshot = () => page.evaluate(async () => {
          const disk = await MGLocalStore.load('audit-fixes-ui-synthetic', { observe: false });
          return { entries: disk.entries, syncQueue: disk.syncQueue, settings: disk.settings };
        });
        const before = await snapshot();
        // The whole row opens the record; the status button is its own target on top.
        await row.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
        const rowBox = await row.boundingBox();
        assert.ok(rowBox.height >= 48, 'the row, which opens the record, is at least 48px tall');
        const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-open-entry], [data-toggle-status]')?.className || '', [rowBox.x + 8, rowBox.y + rowBox.height - 8]);
        assert.match(hit, /entry-open/, 'an empty corner of the row opens the record');
        const status = await page.locator('#rows [data-toggle-status="mouse-entry"]').boundingBox();
        assert.ok(status.width >= 48 && status.height >= 48, 'status keeps a 48px target');
        await row.click({ position: { x: 8, y: rowBox.height - 8 } });
        assert.equal(await page.locator('#entryDialog').evaluate(e => e.open), true);
        await page.screenshot({ path: path.join(out, `mouse-edit-${width}.png`), fullPage: false });
        await page.locator('#entryDialog [data-close]').first().click();
        assert.equal(await opener.evaluate(e => e === document.activeElement), true, 'Cancel Edit returns focus to the record');
        // Delete from the form: the confirmation opens over it and cancelling keeps the form.
        await opener.click();
        const remove = page.locator('#deleteEntryFromForm');
        const removeBox = await remove.boundingBox();
        assert.ok(removeBox.width >= 48 && removeBox.height >= 48, 'Excluir keeps a 48px target');
        await remove.click();
        assert.equal(await page.locator('#deleteConfirmDialog').evaluate(e => e.open), true);
        await page.locator('#deleteConfirmDialog [data-close-delete-confirm]').first().click();
        assert.equal(await page.locator('#entryDialog').evaluate(e => e.open), true, 'cancelling the deletion keeps the form open');
        assert.equal(await remove.evaluate(e => e === document.activeElement), true);
        await page.locator('#entryDialog [data-close]').first().click();
        assert.deepEqual(await snapshot(), before, 'Opening and cancelling made no financial change');
      } finally { await context.close(); }
    }
  },
  async renderer(browser, origin) {
    for (const width of [375, 1280]) {
      const { context, page } = await seed(browser, origin, [{ ...base, id: 'keyboard-entry' }]);
      try {
        await page.setViewportSize({ width, height: width === 1280 ? 900 : 812 });
        const opener = page.locator('#rows [data-open-entry="keyboard-entry"]');
        const status = page.locator('#rows [data-toggle-status="keyboard-entry"]');
        await opener.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        assert.equal(await opener.evaluate(e => e === document.activeElement), true, 'Tab reaches the record');
        assert.equal(await opener.getAttribute('aria-label'), 'Editar OUTROS - AUDIT', 'the button names the record it opens');
        const [rowBox, openerBox] = [await page.locator('#rows [data-entry="keyboard-entry"]').boundingBox(), await opener.boundingBox()];
        assert.ok(Math.abs(rowBox.height - openerBox.height) <= 1 && Math.abs(rowBox.width - openerBox.width) <= 1, 'the focused control covers the whole row');
        assert.notEqual(await opener.evaluate(e => getComputedStyle(e).outlineStyle), 'none', 'keyboard focus is visible');
        await page.screenshot({ path: path.join(out, `${process.env.PHASE || 'latest'}-row-focus-${width}.png`), fullPage: false });
        await page.keyboard.press('Tab');
        assert.equal(await status.evaluate(e => e === document.activeElement), true, 'then the status button');
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#entryDialog').evaluate(e => e.open), true, 'Enter opens the record');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#entryDialog').evaluate(e => e.open), false);
        assert.equal(await opener.evaluate(e => e === document.activeElement), true, 'Escape returns focus to the record');
        await page.keyboard.press('Space');
        assert.equal(await page.locator('#entryDialog').evaluate(e => e.open), true, 'Space opens the record too');
        await page.locator('#deleteEntryFromForm').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#deleteConfirmDialog').evaluate(e => e.open), true, 'Excluir works from the keyboard');
        await page.keyboard.press('Escape');
        await page.screenshot({ path: path.join(out, `keyboard-edit-${width}.png`) });
      } finally { await context.close(); }
    }
  }
};
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [name, run] of Object.entries(cases)) {
      if (process.env.CASE && !process.env.CASE.split(',').includes(name)) continue;
      try { await run(browser, origin); results.cases.push({ name, status: 'pass' }); }
      catch (e) { results.cases.push({ name, status: 'fail', error: e.stack }); }
    }
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
  fs.writeFileSync(path.join(out, (process.env.PHASE || 'latest') + '.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (results.cases.some(c => c.status !== 'pass') || results.errors.length) process.exitCode = 1;
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
