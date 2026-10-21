const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.route('https://**/*', route => route.abort());
    await page.goto('http://localhost:8000');
    await page.evaluate(async () => {
      localStorage.setItem('meus-gastos-google-user', JSON.stringify({ id: 'monthly-test', email: 'monthly@example.invalid', user_metadata: { full_name: 'Teste mensal' } }));
      const entries = [
        ['2026-01-10', 1000, 'income', true], ['2026-01-11', 200, 'expense', true],
        ['2026-01-12', 100, 'expense', false], ['2026-02-10', 50, 'income', false],
        ['2026-02-11', 120, 'expense', false], ['2026-02-12', -20, 'expense', true],
      ].map(([date, value, flow_type, paid], index) => ({ id: `00000000-0000-4000-8000-00000000000${index}`, date, value, flow_type: 'expense', paid, type: flow_type === 'income' ? 'A RECEBER' : 'ALIMENTAÇÃO', description: flow_type === 'income' ? 'SALÁRIO' : 'SUPERMERCADO', created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z` }));
      await MGLocalStore.save('monthly-test', { entries, settings: { onboarding_status: 'completed', current_balance: 99999, balance_reference_date: '2026-01-01' } });
    });
    await page.reload();
    await page.waitForSelector('#appShell:not([hidden])');
    await page.locator('.app-navigation [data-app-destination="monthly"]').click();
    await page.locator('#monthlyYear').selectOption('2026');
    assert.equal(await page.locator('[data-cash-flow-month]').count(), 12);
    const jan = page.locator('[data-cash-flow-month="2026-01"]');
    const feb = page.locator('[data-cash-flow-month="2026-02"]');
    assert.match(await jan.innerText(), /1\.000,00/);
    assert.match(await jan.innerText(), /300,00/);
    assert.match(await jan.innerText(), /700,00/);
    assert.match(await feb.innerText(), /-R\$\s*50,00|-\s*R\$\s*50,00/);
    assert.match(await page.locator('#monthlyAnnualSummary').innerText(), /650,00/);
    assert.equal(await page.locator('[data-cash-flow-month="2026-03"] button').isDisabled(), true);
    await page.locator('#monthlyStatus').selectOption('paid');
    assert.match(await page.locator('#monthlyAnnualSummary').innerText(), /820,00/);
    await jan.locator('button').click();
    assert.equal(await page.locator('#filterMonth').inputValue(), '2026-01');
    assert.equal(await page.locator('#filterStatus').inputValue(), 'paid');
    assert.equal(await page.locator('#rows [data-entry]').count(), 2);
    assert.match(await page.locator('#rows').innerText(), /Recebido/);
    assert.match(await page.locator('#rows').innerText(), /\+\s*R\$/);
    await page.goBack();
    assert.equal(await page.locator('.app-navigation [data-app-destination="monthly"]').getAttribute('aria-current'), 'page');
    await page.locator('.app-navigation [data-app-destination="projection"]').click();
    assert.match(await page.locator('#projectionMonthIncome').innerText(), /1\.000,00/);
    await page.locator('[data-calendar-date="2026-01-11"]').click();
    assert.match(await page.locator('#calendarDayMetrics').innerText(), /Entradas neste dia\s*R\$\s*0,00/);
    assert.match(await page.locator('#projectionMonthIncome').innerText(), /1\.000,00/);
    await page.locator('[data-calendar-date="2026-01-10"]').click();
    assert.match(await page.locator('#calendarDayMetrics').innerText(), /Entradas neste dia\s*R\$\s*1\.000,00/);
    await page.goBack();
    await page.locator('#monthlyStatus').selectOption('pending');
    assert.match(await page.locator('#monthlyAnnualSummary').innerText(), /170,00/);
    await page.locator('#monthlyStatus').selectOption('');
    await page.locator('#nextCashFlowYear').click();
    assert.match(await page.locator('#monthlySummaryStatus').innerText(), /Nenhum lançamento/);
    await page.locator('#previousCashFlowYear').click();
    assert.equal(await page.locator('#monthlyYear').inputValue(), '2026');
    fs.mkdirSync('outputs/monthly-cash-flow', { recursive: true });
    const checks = [];
    for (const [width, height] of [[320, 740], [375, 812], [412, 915], [690, 400], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      const geometry = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('[data-app-panel="monthly"] button, [data-app-panel="monthly"] select, .app-navigation button')];
        return { overflow: document.documentElement.scrollWidth > innerWidth, small: nodes.filter(n => n.getBoundingClientRect().width < 48 || n.getBoundingClientRect().height < 48).map(n => n.id || n.textContent.trim()) };
      });
      checks.push({ width, height, ...geometry });
      if (width === 375 || width === 1024) await page.screenshot({ path: `outputs/monthly-cash-flow/${width}.png`, fullPage: true });
    }
    fs.writeFileSync('outputs/monthly-cash-flow/geometry.json', JSON.stringify(checks, null, 2));
    assert.deepEqual(checks.filter(c => c.overflow || c.small.length), []);
    await page.reload();
    await page.waitForSelector('#appShell:not([hidden])');
    assert.equal(await page.locator('[data-app-panel="monthly"]').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('Monthly cash flow: totals, status, drill-down, empty year, history and responsive layout OK');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
