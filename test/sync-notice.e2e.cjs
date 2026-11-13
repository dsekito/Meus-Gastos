/* Run against python -m http.server 8000. Synthetic profile, Google endpoints simulated.
   What the sync status and notice tell the person in each situation. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const today = new Date().toISOString().slice(0, 10);
const entry = { id: '00000000-0000-4000-8000-000000000701', date: today, type: 'MORADIA', description: 'ALUGUEL', flow_type: 'expense',
  value: 100, paid: false, created_at: `${today}T12:00:00Z`, updated_at: `${today}T12:00:00Z` };
const settings = { onboarding_status: 'completed', current_balance: 1000, balance_reference_date: '2020-01-01' };
const validRemote = () => ({ schemaVersion: 2, revision: 1, entries: [structuredClone(entry)], settings, recurrenceSeries: [], tombstones: {}, compactedDeltas: {} });

// drive.remote: document served; drive.failLists: how many list calls answer 503;
// drive.holdUploads: uploads wait for drive.release().
async function open(browser, drive) {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let version = 1;
  drive.uploads = [];
  await page.route('**/js/google-auth.js?*', route => route.fulfill({ contentType: 'application/javascript', body: `window.MGGoogleAuth={create:()=>({restoreSession:()=>JSON.parse(localStorage.getItem('meus-gastos-google-user')||'null'),hasAccessToken:()=>true,getAccessToken:()=>'fake-test-token',isAccessTokenExpired:()=>false,clearToken:()=>{},signOut:async()=>{}})};` }));
  await page.route('https://**/*', async route => {
    const url = route.request().url();
    const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    if (!url.includes('www.googleapis.com')) return route.abort();
    if (url.includes('/files?')) {
      if (drive.failLists > 0) { drive.failLists--; return route.fulfill({ status: 503, body: 'Transient test failure' }); }
      return json({ files: new URL(url).searchParams.get('q').includes("name = 'meus-gastos.json'") ? [{ id: 'main', name: 'meus-gastos.json', version: String(version) }] : [] });
    }
    if (url.includes('/files/main?alt=media')) return json(drive.remote);
    if (url.includes('/files/main?fields=version')) return json({ version: String(version) });
    if (url.includes('/files/main?uploadType=media')) {
      drive.uploads.push(JSON.parse(route.request().postData()));
      if (drive.holdUploads) await new Promise(resolve => { drive.release = resolve; });
      drive.remote = drive.uploads.at(-1); version++;
      return json({ id: 'main', version: String(version) });
    }
    return route.abort();
  });
  await page.goto('http://localhost:8000');
  await page.evaluate(async ({ entry, settings }) => {
    localStorage.setItem('meus-gastos-google-user', JSON.stringify({ id: 'sync-notice-test', email: 'sync@example.invalid' }));
    await MGLocalStore.save('sync-notice-test', { entries: [entry], settings, recurrenceSeries: [], syncQueue: [], lastSyncedAt: null });
  }, { entry, settings });
  await page.reload();
  await page.waitForSelector('#appShell:not([hidden])');
  return { page, errors };
}

const status = page => page.locator('#syncStatus');
const action = page => page.locator('#syncNoticeAction');

const scenarios = {
  async retryThenSynced(browser) {
    // Reads are retried automatically; three failures outlast those retries.
    const drive = { remote: validRemote(), failLists: 3 };
    const { page, errors } = await open(browser, drive);
    await page.waitForSelector('#syncStatus[data-state="pending"]');
    assert.equal(await page.locator('#syncNotice').isVisible(), true);
    assert.equal(await action(page).innerText(), 'Tentar novamente');
    assert.match(await action(page).getAttribute('aria-label'), /Tentar sincronizar novamente/);
    drive.failLists = 0;
    await action(page).click();
    await page.waitForSelector('#syncStatus[data-state="synced"]');
    assert.equal(await status(page).innerText(), 'Tudo sincronizado');
    // Success takes no space, and the button keeps no stale accessible name.
    assert.equal(await page.locator('#syncNotice').isVisible(), false);
    assert.equal(await action(page).getAttribute('aria-label'), null);
    return { page, errors };
  },

  async changesWaitingForUpload(browser) {
    const drive = { remote: validRemote(), holdUploads: true };
    const { page, errors } = await open(browser, drive);
    await page.locator('.app-navigation [data-app-destination="records"]').click();
    await page.locator('[data-toggle-status]').first().click();
    await page.waitForFunction(() => /Status salvo/.test(document.querySelector('#toast').textContent));
    while (!drive.release) await page.waitForTimeout(50);
    // A second change while the first upload is still in flight.
    await page.locator('[data-toggle-status]').first().click();
    drive.holdUploads = false;
    drive.release();
    await page.waitForSelector('#syncStatus[data-state="queued"]');
    assert.equal(await status(page).innerText(), 'Salvo neste aparelho');
    assert.match(await status(page).getAttribute('aria-label'), /aguardando envio ao Google Drive/);
    await page.waitForSelector('#syncStatus[data-state="synced"]');
    assert.equal(drive.uploads.at(-1).entries[0].paid, false, 'the later change is uploaded too');
    return { page, errors };
  },

  async invalidDriveCopyOffersBackup(browser) {
    const drive = { remote: { schemaVersion: 2, revision: 1, entries: 'not a list', settings: {} } };
    const { page, errors } = await open(browser, drive);
    await page.waitForFunction(() => document.querySelector('#syncStatus').textContent === 'Cópia do Drive inválida');
    assert.equal(await action(page).innerText(), 'Restaurar backup');
    await action(page).click();
    await page.locator('#settingsDialog[open]').waitFor();
    assert.equal(await page.locator('[data-settings-switch="data"]').getAttribute('aria-pressed'), 'true');
    assert.equal((await page.evaluate(() => MGLocalStore.load('sync-notice-test', { observe: false }))).entries.length, 1, 'local data preserved');
    return { page, errors };
  },

  async newerDriveCopyAsksForUpdate(browser) {
    const drive = { remote: { ...validRemote(), schemaVersion: 99 } };
    const { page, errors } = await open(browser, drive);
    await page.waitForFunction(() => document.querySelector('#syncStatus').textContent === 'Atualização necessária');
    assert.equal(await action(page).innerText(), 'Verificar atualização');
    await action(page).click();
    // Service workers are blocked in this test, so the app says it cannot check.
    await page.waitForFunction(() => /não permite verificar atualizações/.test(document.querySelector('#toast').textContent));
    assert.equal(drive.uploads.length, 0, 'nothing is uploaded over a newer copy');
    return { page, errors };
  },
};

(async () => {
  const only = process.argv[2];
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const [name, run] of Object.entries(scenarios)) {
      if (only && name !== only) continue;
      const { page, errors } = await run(browser);
      assert.deepEqual(errors, [], name);
      await page.close();
      console.log(`ok ${name}`);
    }
    console.log('sync notice e2e: ok');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
