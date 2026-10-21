/* Run against python -m http.server 8000. Uses an isolated, fictitious profile. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.goto('http://localhost:8000');
    const today = await page.evaluate(async () => {
      const day = new Date();
      const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      localStorage.setItem('meus-gastos-google-user', JSON.stringify({ id: 'ux-navigation-test', email: 'test@example.invalid', user_metadata: { full_name: 'Teste UX' } }));
      await MGLocalStore.save('ux-navigation-test', { settings: { onboarding_status: 'completed', current_balance: 3240, balance_reference_date: date }, entries: [{ id: '00000000-0000-4000-8000-000000000001', date, type: 'ALIMENTAÇÃO', description: 'SUPERMERCADO', flow_type: 'expense', value: 186.50, paid: false, created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z` }, { id: '00000000-0000-4000-8000-000000000002', date, type: 'A RECEBER', description: 'ENTRADA DE TESTE', flow_type: 'expense', value: 200, paid: false, created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z` }] });
      return date;
    });
    await page.reload();
    await page.waitForSelector('#appShell:not([hidden])');
    const nav = view => page.locator(`.app-navigation [data-app-destination="${view}"]`);
    assert.match(await page.locator('#nextSevenDaysIncomeTotal').innerText(), /200,00/);
    assert.match(await page.locator('#upcomingList').innerText(), /A receber/);
    await nav('records').click();
    assert.equal(await page.locator('[data-app-panel="home"]').first().isVisible(), false);
    assert.equal(await page.locator('.entries-panel').isVisible(), true);
    await nav('projection').click();
    await page.locator('[data-calendar-date]').first().click();
    assert.equal(await page.locator('[data-calendar-date]').first().getAttribute('aria-pressed'), 'true');
    assert.ok((await page.locator('#calendarDayTitle').innerText()).length > 5);
    await page.locator('#viewCalendarEntries').click();
    assert.equal(await nav('records').getAttribute('aria-current'), 'page');
    await page.locator('#clearEntryFilters').evaluate(button => button.click());
    await nav('settings').click();
    await page.locator('[data-settings-topic="data"]').click();
    assert.equal(await page.locator('#dataSettingsTitle').isVisible(), true);
    assert.equal(await page.locator('#currentBalance').isVisible(), false);
    fs.mkdirSync('outputs/mobile-improvements', { recursive: true });
    await page.screenshot({ path: 'outputs/mobile-improvements/backups-live.png' });
    await page.locator('[data-settings-switch="options"]').click();
    assert.equal(await page.locator('#optionsSettingsTitle').isVisible(), true);
    await page.locator('[data-add-option="types"]').click();
    await page.locator('#optionName').fill('Teste UX');
    await page.locator('#saveOption').click();
    await page.waitForSelector('#optionDialog:not([open])', { state: 'attached' });
    await page.locator('#deleteTypeOption').selectOption('TESTE UX');
    assert.equal(await page.locator('#deleteTypeOption').inputValue(), 'TESTE UX');
    await page.locator('#settingsDialog [data-close-settings]').first().click();
    await nav('home').click();
    await page.locator('#openModalMobile').click();
    await page.screenshot({ path: 'outputs/mobile-improvements/entry-live.png' });
    assert.equal(await page.locator('#entryAdvanced').getAttribute('open'), null);
    await page.locator('#value').fill('150');
    await page.locator('#type').selectOption('ALIMENTAÇÃO');
    await page.locator('#description').selectOption('SUPERMERCADO');
    await page.locator('#entryAdvanced > summary').click();
    await page.locator('#recurrence').selectOption('installments');
    await page.locator('#installments').fill('3');
    assert.match(await page.locator('#installmentPreview').innerText(), /3 parcelas de R\$\s*50,00/);
    assert.equal(await page.locator('#entryValueLabel').innerText(), 'Valor total da compra');
    await page.locator('#saveEntry').click();
    await page.waitForSelector('#entryDialog:not([open])', { state: 'attached' });
    await nav('records').click();
    await page.locator('#filterMonth').fill(today.slice(0, 7));
    await page.locator('#filterMonth').dispatchEvent('change');
    assert.match(await page.locator('#rows').innerText(), /50,00/);
    // Reload proves that the offline change was persisted rather than only rendered.
    await page.reload();
    await page.waitForSelector('#appShell:not([hidden])');
    assert.equal(await nav('records').getAttribute('aria-current'), 'page');
    assert.match(await page.locator('#rows').innerText(), /50,00/);
    const geometry = [];
    fs.mkdirSync('outputs/mobile-improvements', { recursive: true });
    for (const [width, height] of [[320, 740], [375, 812], [412, 915], [690, 400]]) {
      await page.setViewportSize({ width, height });
      for (const view of ['home', 'records', 'projection', 'settings']) {
        await nav(view).click();
        const result = await page.evaluate(() => {
          const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
          const small = [...document.querySelectorAll('#appShell button, #appShell input, #appShell select, #appShell summary')].filter(visible).filter(e => !e.matches('input[type="checkbox"]')).filter(e => e.getBoundingClientRect().width < 47.9 || e.getBoundingClientRect().height < 47.9).map(e => e.id || e.textContent.trim());
          return { overflow: document.documentElement.scrollWidth > innerWidth, small };
        });
        geometry.push({ width, height, view, ...result });
        if (width === 375) await page.screenshot({ path: `outputs/mobile-improvements/${view}.png`, fullPage: true });
      }
    }
    fs.writeFileSync('outputs/mobile-improvements/geometry.json', JSON.stringify(geometry, null, 2));
    assert.deepEqual(geometry.filter(r => r.overflow || r.small.length), []);
    const dialogs = [];
    for (const [width, height] of [[375, 812], [480, 360], [320, 480], [690, 400]]) {
      await page.setViewportSize({ width, height });
      await nav('home').click();
      await page.locator('#openModalMobile').click();
      await page.locator('#entryAdvanced > summary').click();
      await page.locator('#recurrence').selectOption('custom');
      await page.locator('#endMode').selectOption('on_date');
      const dialogIds = ['entryDialog', 'settingsDialog', 'recordsManagerDialog', 'recentRecordsDialog', 'deleteConfirmDialog', 'seriesScopeDialog', 'syncConflictDialog', 'bulkDateDialog', 'onboardingDialog', 'optionDialog'];
      for (const id of dialogIds) {
        if (id !== 'entryDialog') await page.evaluate(id => document.getElementById(id).showModal(), id);
        const result = await page.evaluate(async id => {
          const root = document.getElementById(id);
          root.querySelectorAll('details').forEach(details => { details.open = true; });
          const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
          const unreachable = [], small = [];
          for (const e of [...root.querySelectorAll('button,input,select,textarea,summary')].filter(visible)) {
            const target = e.matches('input[type="checkbox"]') && e.closest('label') || e;
            const bounds = target.getBoundingClientRect();
            if (bounds.width < 47.9 || bounds.height < 47.9) small.push(e.id || e.textContent.trim());
            target.scrollIntoView({ block: 'center', behavior: 'instant' });
            await new Promise(requestAnimationFrame);
            const r = target.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (!hit || !(hit === target || target.contains(hit))) unreachable.push(e.id || e.textContent.trim());
          }
          return { small, unreachable, overflow: root.scrollWidth > root.clientWidth + 1 };
        }, id);
        dialogs.push({ width, height, id, ...result });
        if (width === 375 && ['entryDialog', 'settingsDialog'].includes(id)) {
          await page.locator(`#${id} .modal`).evaluate(el => el.scrollTo(0, 0));
          await page.locator(`#${id} .form-grid`).first().evaluate(el => el.scrollTo(0, 0));
          await page.screenshot({ path: `outputs/mobile-improvements/${id}.png` });
        }
        await page.evaluate(id => document.getElementById(id).close(), id);
      }
    }
    fs.writeFileSync('outputs/mobile-improvements/dialogs.json', JSON.stringify(dialogs, null, 2));
    assert.deepEqual(dialogs.filter(r => r.overflow || r.small.length || r.unreachable.length), []);
    await page.setViewportSize({ width: 375, height: 812 });
    await nav('home').click();
    await page.locator('#openModalMobile').click();
    await page.locator('#value').fill('80');
    await page.locator('#type').selectOption('ALIMENTAÇÃO');
    await page.locator('#description').selectOption('SUPERMERCADO');
    await page.locator('#entryAdvanced > summary').click();
    await page.locator('#recurrence').selectOption('custom');
    await page.locator('#endMode').selectOption('on_date');
    await page.locator('#entryAdvanced > summary').click();
    await page.locator('#saveEntry').click();
    assert.equal(await page.locator('#entryAdvanced').getAttribute('open'), '');
    assert.equal(await page.locator('#endDate').getAttribute('aria-invalid'), 'true');
    await page.locator('#entryDialog [data-close]').first().click();
    assert.deepEqual(errors, []);
    console.log('Mobile navigation, calendar, settings, installments, offline persistence and responsive geometry: OK');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
