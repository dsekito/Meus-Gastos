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
      const trigger = page.locator('#rows [data-edit="hidden-0"]');
      await trigger.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForTimeout(150);
      await trigger.click();
      await page.locator('#contextMenu [data-action="edit"]').click();
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
        const trigger = page.locator('#rows [data-edit="mouse-entry"]');
        const popup = page.locator('#contextMenu');
        const snapshot = () => page.evaluate(async () => {
          const disk = await MGLocalStore.load('audit-fixes-ui-synthetic', { observe: false });
          return { entries: disk.entries, syncQueue: disk.syncQueue, settings: disk.settings };
        });
        const before = await snapshot();
        const open = async () => {
          await trigger.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
          await page.waitForTimeout(150);
          await trigger.click();
          assert.equal(await popup.isVisible(), true);
          assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
        };
        await open();
        for (const control of [trigger, popup.locator('button').nth(0), popup.locator('button').nth(1)]) {
          const box = await control.boundingBox();
          assert.ok(box.width >= 48 && box.height >= 48, 'Menu touch targets remain at least 48px');
        }
        await page.screenshot({ path: path.join(out, `mouse-menu-${width}.png`), fullPage: false });
        await trigger.click();
        assert.equal(await popup.isVisible(), false, 'Repeated mouse click toggles menu closed');
        assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
        await open();
        await popup.locator('[data-action="edit"]').click();
        assert.equal(await page.locator('#entryDialog').evaluate(e => e.open), true);
        await page.locator('#entryDialog [data-close]').first().click();
        assert.equal(await trigger.evaluate(e => e === document.activeElement), true, 'Cancel Edit returns focus to row trigger');
        await open();
        await popup.locator('[data-action="delete"]').click();
        assert.equal(await page.locator('#deleteConfirmDialog').evaluate(e => e.open), true);
        await page.locator('#deleteConfirmDialog [data-close-delete-confirm]').first().click();
        assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
        await open();
        await page.locator('#appViewTitle').click();
        assert.equal(await popup.isVisible(), false);
        assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
        assert.deepEqual(await snapshot(), before, 'Menu actions canceled without financial mutations');
      } finally { await context.close(); }
    }
  },
  async renderer(browser, origin) {
    const id = 'audit" data-audit-injected="yes';
    const { context, page } = await seed(browser, origin, [{ ...base, id }]);
    try {
      assert.equal(await page.locator('[data-audit-injected]').count(), 0, 'Untrusted cached ID must not create HTML attributes in records');
      assert.equal(await page.locator('#rows [data-entry]').getAttribute('data-entry'), id);
      assert.equal(await page.locator('#rows [data-edit]').getAttribute('data-edit'), id);
      assert.equal(await page.locator('#rows [data-toggle-status]').getAttribute('data-toggle-status'), id);
      await page.locator('#startSelection').click();
      await page.locator('#selectAll').click();
      assert.equal(await page.locator('[data-audit-injected]').count(), 0, 'Selection must not interpolate ID as HTML');
      assert.equal(await page.locator('#rows [data-entry][aria-pressed="true"]').getAttribute('data-entry'), id);
      await page.locator('#exitSelection').click();
      await page.locator('#openRecentRecordsMain').click();
      assert.equal(await page.locator('[data-audit-injected]').count(), 0, 'History must not interpolate ID as HTML');
      assert.equal(await page.locator('[data-edit-recent]').getAttribute('data-edit-recent'), id);
      await page.locator('[data-edit-recent]').click();
      assert.equal(await page.locator('#entryDialog').evaluate(e => e.open), true, 'Escaping preserves original identifier and edit works');
      await page.screenshot({ path: path.join(out, 'safe-identifier-edit.png') });
    } finally { await context.close(); }
  },
  async keyboard(browser, origin) {
    for (const width of [375, 1280]) {
      const { context, page } = await seed(browser, origin, [{ ...base, id: 'keyboard-entry' }]);
      try {
        await page.setViewportSize({ width, height: width === 1280 ? 900 : 812 });
        const trigger = page.locator('#rows [data-edit="keyboard-entry"]');
        await trigger.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(150);
        await trigger.focus();
        await page.keyboard.press('Enter');
        const edit = page.locator('#contextMenu [data-action="edit"]');
        const remove = page.locator('#contextMenu [data-action="delete"]');
        await page.screenshot({ path: path.join(out, `${process.env.PHASE || 'latest'}-menu-open-${width}.png`), fullPage: false });
        assert.equal(await edit.evaluate(e => e === document.activeElement), true, 'Opening the action menu must focus its first action');
        assert.equal(await trigger.getAttribute('aria-haspopup'), 'menu');
        assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
        const y = await page.evaluate(() => scrollY);
        await page.keyboard.press('ArrowDown');
        assert.equal(await remove.evaluate(e => e === document.activeElement), true);
        assert.equal(await page.evaluate(() => scrollY), y, 'Menu arrows must not scroll the document');
        assert.equal(await page.locator('#contextMenu').isVisible(), true);
        await page.keyboard.press('ArrowDown');
        assert.equal(await edit.evaluate(e => e === document.activeElement), true);
        await page.keyboard.press('ArrowUp');
        assert.equal(await remove.evaluate(e => e === document.activeElement), true);
        await page.keyboard.press('Home');
        assert.equal(await edit.evaluate(e => e === document.activeElement), true);
        await page.keyboard.press('End');
        assert.equal(await remove.evaluate(e => e === document.activeElement), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#contextMenu').isVisible(), false);
        assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
        assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
        await page.keyboard.press('ArrowUp');
        assert.equal(await remove.evaluate(e => e === document.activeElement), true, 'ArrowUp on trigger opens last action');
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#contextMenu').isVisible(), false);
        assert.equal(await page.evaluate(() => !!document.activeElement.closest('#contextMenu')), false);
        await trigger.focus();
        await page.keyboard.press('ArrowDown');
        assert.equal(await edit.evaluate(e => e === document.activeElement), true, 'ArrowDown on trigger opens first action');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.locator('#contextMenu').isVisible(), false);
        assert.equal(await page.locator('#rows [data-toggle-status]').evaluate(e => e === document.activeElement), true, 'Shift+Tab resumes before the trigger, without trapping focus');
        await trigger.focus();
        await page.keyboard.press('Space');
        assert.equal(await edit.evaluate(e => e === document.activeElement), true, 'Space opens and focuses the first action');
        await page.keyboard.press('Escape');
        assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#entryDialog').evaluate(e => e.open), true, 'Focused Edit is keyboard-activatable');
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
