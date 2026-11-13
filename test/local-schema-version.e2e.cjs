/* Run against python -m http.server 8000. Uses an isolated, fictitious profile. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const user = { id: 'schema-version-test', email: 'test@example.invalid', user_metadata: { full_name: 'Teste Versão' } };

// Writes the IndexedDB record as an older or newer app would, bypassing MGLocalStore.
const putRaw = (page, record) => page.evaluate(({ user, record }) => new Promise((resolve, reject) => {
  localStorage.setItem('meus-gastos-google-user', JSON.stringify(user));
  const request = indexedDB.open('meus-gastos', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('user-data');
  request.onsuccess = () => {
    const transaction = request.result.transaction('user-data', 'readwrite');
    transaction.objectStore('user-data').put(record, user.id);
    transaction.oncomplete = () => { request.result.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error);
  };
  request.onerror = () => reject(request.error);
}), { user, record });

const getRaw = page => page.evaluate(id => new Promise((resolve, reject) => {
  const request = indexedDB.open('meus-gastos', 1);
  request.onsuccess = () => {
    const get = request.result.transaction('user-data').objectStore('user-data').get(id);
    get.onsuccess = () => { request.result.close(); resolve(get.result); };
    get.onerror = () => reject(get.error);
  };
}), user.id);

const today = new Date().toISOString().slice(0, 10);
const entry = { id: '00000000-0000-4000-8000-000000000301', date: today, type: 'MORADIA', description: 'ALUGUEL',
  flow_type: 'expense', value: 900, paid: false, created_at: `${today}T12:00:00Z`, updated_at: `${today}T12:00:00Z` };
const settings = { onboarding_status: 'completed', current_balance: 2000, balance_reference_date: '2020-01-01' };

async function open(browser) {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.goto('http://localhost:8000');
  return { page, errors };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    // A record saved before versioning opens normally and is stamped on the next save.
    {
      const { page, errors } = await open(browser);
      await putRaw(page, { settings, entries: [entry], syncQueue: [] });
      await page.reload();
      await page.waitForSelector('#appShell:not([hidden])');
      assert.equal(await page.locator('#appShell').getAttribute('data-locked'), null);
      await page.locator('.app-navigation [data-app-destination="records"]').click();
      assert.match(await page.locator('#rows').innerText(), /ALUGUEL/);
      await page.locator('[data-toggle-status]').first().click();
      await page.waitForFunction(() => /Status salvo/.test(document.querySelector('#toast')?.textContent || ''));
      const stored = await getRaw(page);
      assert.equal(stored.schemaVersion, 1);
      assert.equal(stored.entries[0].paid, true);
      assert.deepEqual(errors, []);
      await page.close();
    }

    // Data from a newer version is not shown, synchronized or overwritten.
    {
      const { page, errors } = await open(browser);
      const newer = { schemaVersion: 2, settings: { ...settings, onboarding_status: 'pending' }, entries: [entry], futureField: { kept: true } };
      await putRaw(page, newer);
      await page.reload();
      await page.waitForSelector('#appShell:not([hidden])');
      assert.equal(await page.locator('#appShell').getAttribute('data-locked'), 'newer-data');
      assert.equal(await page.locator('#interfaceUpdateNotice').isVisible(), true);
      assert.match(await page.locator('#interfaceUpdateMessage').innerText(), /versão mais nova/);
      assert.equal(await page.locator('.app-navigation').isVisible(), false);
      assert.equal(await page.locator('.decision-overview').isVisible(), false);
      assert.equal(await page.locator('#onboardingDialog').evaluate(dialog => dialog.open), false);
      await page.locator('#reloadInterface').click();
      await page.waitForSelector('#appShell:not([hidden])');
      assert.deepEqual(await getRaw(page), newer, 'the newer record stays byte-for-byte');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('local schema version e2e: ok');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
