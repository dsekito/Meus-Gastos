/* Run against python -m http.server 8000. Uses an isolated, fictitious profile. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const user = { id: 'reference-offer-test', email: 'test@example.invalid', user_metadata: { full_name: 'Teste Saldo' } };

async function open(browser, today) {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { errors.push(`native dialog: ${dialog.message()}`); return dialog.dismiss(); });
  await page.route('https://**/*', route => route.abort());
  await page.goto('http://localhost:8000');
  await page.evaluate(async ({ user, today }) => {
    localStorage.setItem('meus-gastos-google-user', JSON.stringify(user));
    await MGLocalStore.save(user.id, {
      settings: { onboarding_status: 'completed', current_balance: 3240, balance_reference_date: today },
      entries: [{ id: '00000000-0000-4000-8000-00000000000a', date: today, type: 'ALIMENTAÇÃO', description: 'SUPERMERCADO',
        flow_type: 'expense', value: 186.5, paid: false, created_at: `${today}T12:00:00Z`, updated_at: `${today}T12:00:00Z` }],
    });
  }, { user, today });
  await page.reload();
  await page.waitForSelector('#appShell:not([hidden])');
  await page.locator('.app-navigation [data-app-destination="records"]').click();
  return { page, errors };
}

const persistedBalance = page => page.evaluate(async id => (await MGLocalStore.load(id, { observe: false })).settings.current_balance, user.id);

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // Accept: the informed balance moves by the bill and the projection stays put.
    {
      const { page, errors } = await open(browser, date);
      assert.match(await page.locator('#currentBalanceTotal').innerText(), /3\.053,50/);
      const status = page.locator('[data-toggle-status]').first();
      await status.click();
      const dialog = page.locator('#confirmDialog[open]');
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /3\.240,00 → R\$\s?3\.053,50/);
      assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-confirm-accept')), true);
      assert.equal(await page.evaluate(() => state.pendingStatusEntries.size), 0, 'the entry is not locked while the person decides');
      await dialog.locator('[data-confirm-accept]').click();
      await page.waitForFunction(() => /saldo informado atualizado/i.test(document.querySelector('#toast')?.textContent || ''));
      assert.equal(await persistedBalance(page), 3053.5);
      assert.equal(await page.evaluate(() => state.entries[0].paid), true);
      assert.match(await page.locator('#currentBalanceTotal').innerText(), /3\.053,50/);
      assert.deepEqual(errors, []);
      await page.close();
    }

    // Esc keeps the informed balance and returns focus to the status button.
    {
      const { page, errors } = await open(browser, date);
      const status = page.locator('[data-toggle-status]').first();
      await status.focus();
      await page.keyboard.press('Enter');
      await page.locator('#confirmDialog[open]').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('#confirmDialog').waitFor({ state: 'hidden' });
      assert.equal(await persistedBalance(page), 3240);
      assert.equal(await page.evaluate(() => state.entries[0].paid), true, 'the status change itself is kept');
      assert.match(await page.locator('#toast').innerText(), /Status salvo/);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('reference balance offer e2e: ok');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
