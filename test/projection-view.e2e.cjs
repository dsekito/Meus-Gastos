/* Run against python -m http.server 8000. Uses an isolated, fictitious profile. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const user = { id: 'projection-view-test', email: 'test@example.invalid', user_metadata: { full_name: 'Teste Projeção' } };

async function open(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.goto('http://localhost:8000');
  const month = await page.evaluate(async (user) => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const at = day => `${month}-${String(day).padStart(2, '0')}`;
    const entry = (n, day, description, flow_type, value, paid) => ({ id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
      date: at(day), type: flow_type === 'income' ? 'SALÁRIO' : 'MORADIA', description, flow_type, value, paid,
      created_at: `${at(1)}T12:00:00Z`, updated_at: `${at(1)}T12:00:00Z` });
    localStorage.setItem('meus-gastos-google-user', JSON.stringify(user));
    await MGLocalStore.save(user.id, {
      settings: { onboarding_status: 'completed', current_balance: 500, balance_reference_date: at(1) },
      entries: [entry(1, 2, 'ALUGUEL', 'expense', 1200, false), entry(2, 28, 'SALÁRIO', 'income', 3000, false)],
    });
    return month;
  }, user);
  await page.reload();
  await page.waitForSelector('#appShell:not([hidden])');
  return { page, errors, month };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const width of [320, 412, 1280]) {
      const { page, errors, month } = await open(browser, width);
      // Home: no duplicate shortcuts to views that are already in the navigation.
      assert.equal(await page.locator('[data-app-panel="home"] [data-app-destination="projection"]').count(), 0);
      assert.equal(await page.locator('[data-app-panel="home"] [data-app-destination="monthly"]').count(), 0);
      assert.equal(await page.locator('.entries-panel [data-app-destination="monthly"]').count(), 0);
      assert.equal(await page.locator('#goToCurrentMonth').isVisible(), false);

      await page.locator('.app-navigation [data-app-destination="projection"]').click();
      assert.match(await page.locator('#projectionOpening').innerText(), /500,00/);
      assert.match(await page.locator('#projectionMonthExpense').innerText(), /−\s*R\$\s*1\.200,00/);
      assert.match(await page.locator('#projectionMonthPayable').innerText(), /1\.200,00 a pagar/);
      assert.match(await page.locator('#projectionClosing').innerText(), /2\.300,00/);
      // A negative balance is said in words, not only in red.
      assert.match(await page.locator('#projectionRisk').innerText(), /negativo[\s\S]*−?-?R\$\s*700,00/);
      assert.equal(await page.locator('#projectionRisk').getAttribute('data-negative'), 'true');
      assert.match(await page.locator('#projectionChart svg[role="img"]').getAttribute('aria-label'), /menor saldo de -R\$\s*700,00/);
      // Days already behind today are folded; open them when present.
      const past = page.locator('.projection-past > summary');
      if (await past.count()) await past.click();
      const day2 = page.locator('.projection-day', { has: page.locator('text=ALUGUEL') });
      assert.equal(await day2.first().getAttribute('data-negative'), 'true');
      assert.match(await day2.first().innerText(), /negativo/);
      await page.locator('.projection-entry', { hasText: 'ALUGUEL' }).click();
      await page.locator('#entryDialog[open]').waitFor();
      assert.equal(await page.locator('#value').inputValue(), '1200');
      await page.keyboard.press('Escape');
      await page.locator('#entryDialog').waitFor({ state: 'hidden' });

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `no horizontal scroll at ${width}px (${overflow}px)`);
      for (const target of await page.locator('.projection-entry').all()) {
        const box = await target.boundingBox();
        if (box) assert.ok(box.height >= 48, 'entry targets keep 48px');
      }

      // Another month shows the way back; it is hidden again once used.
      await page.locator('#nextMonth').click();
      assert.notEqual(await page.locator('#filterMonth').inputValue(), month);
      assert.equal(await page.locator('#goToCurrentMonth').isVisible(), true);
      assert.match(await page.locator('#projectionTimeline').innerText(), /Nenhum lançamento neste mês/);
      await page.locator('#goToCurrentMonth').click();
      assert.equal(await page.locator('#filterMonth').inputValue(), month);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('projection view e2e: ok');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
