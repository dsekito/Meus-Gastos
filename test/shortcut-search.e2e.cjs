/* Run against python -m http.server 8000. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.goto('http://localhost:8000');
    const today = await page.evaluate(async () => {
      const d = new Date();
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      localStorage.setItem('meus-gastos-google-user', JSON.stringify({ id: 'shortcut-test', email: 'shortcut@example.invalid', user_metadata: { full_name: 'Teste' } }));
      const entries = [false, true].map((paid, i) => ({ id: `00000000-0000-4000-8000-00000000000${i+1}`, date, type: 'ALIMENTAÇÃO', description: 'SUPERMERCADO', flow_type: 'expense', value: 100 + i, paid, created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z` }));
      const otherDate = `${date.slice(0, 8)}${date.endsWith('-01') ? '02' : '01'}`;
      entries.push({ ...entries[0], id: '00000000-0000-4000-8000-000000000003', date: otherDate });
      await MGLocalStore.save('shortcut-test', { entries, settings: { onboarding_status: 'completed', current_balance: 1000, balance_reference_date: date } });
      return date;
    });
    await page.reload();
    await page.waitForSelector('#appShell:not([hidden])');
    const nav = view => page.locator(`.app-navigation [data-app-destination="${view}"]`);
    const search = async () => { await nav('records').click(); await page.locator('.filter-disclosure').evaluate(el => { el.open = true; }); await page.locator('#filterSearch').fill('texto inexistente'); assert.equal(await page.locator('#rows [data-entry]').count(), 0); };
    const verify = async (status, count) => {
      assert.equal(await page.locator('#filterSearch').inputValue(), '');
      assert.equal(await page.locator('#filterMonth').inputValue(), today.slice(0, 7));
      assert.equal(await page.locator('#filterStatus').inputValue(), status);
      assert.equal(await page.locator('#rows [data-entry]').count(), count);
    };
    if (!process.argv[2] || process.argv[2] === 'monthly') {
    await search();
    await nav('monthly').click();
    await page.locator('#monthlyYear').selectOption(today.slice(0, 4));
    await page.locator('#monthlyStatus').selectOption('paid');
    await page.locator(`[data-cash-flow-month="${today.slice(0, 7)}"] button`).click();
    await verify('paid', 1);
    }
    if (!process.argv[2] || process.argv[2] === 'upcoming') {
    await search();
    await nav('home').click();
    await page.locator(`[data-upcoming-date="${today}"]`).first().click();
    await verify('pending', 1);
    }
    if (!process.argv[2] || process.argv[2] === 'calendar') {
    await search();
    await nav('projection').click();
    await page.locator(`[data-calendar-date="${today}"]`).click();
    await page.locator('#viewCalendarEntries').click();
    await verify('', 2);
    }
    assert.deepEqual(errors, []);
    console.log('Shortcut search reset and intended filters: OK');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });