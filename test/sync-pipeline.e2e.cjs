// Real app + repository, isolated user, mocked Google endpoints. No real upload.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
    const errors = [], uploads = [];
    page.on('pageerror', error => errors.push(error.message));
    let version = 1, remote, release, started, listFailures = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const uploadStarted = new Promise(resolve => { started = resolve; });
    await page.route('**/js/google-auth.js?*', route => route.fulfill({ contentType: 'application/javascript', body: `window.MGGoogleAuth={create:()=>({restoreSession:()=>JSON.parse(localStorage.getItem('meus-gastos-google-user')||'null'),hasAccessToken:()=>true,getAccessToken:()=>'fake-test-token',isAccessTokenExpired:()=>false,clearToken:()=>{},signOut:async()=>{}})};` }));
    await page.route('https://**/*', async route => {
      const url = route.request().url();
      const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      if (!url.includes('www.googleapis.com')) return route.abort();
      if (url.includes('/files?')) {
        if (listFailures > 0) { listFailures--; return route.fulfill({ status: 503, body: 'Transient test failure' }); }
        return json({ files: new URL(url).searchParams.get('q').includes("name = 'meus-gastos.json'") ? [{ id: 'main', name: 'meus-gastos.json', version: String(version) }] : [] });
      }
      if (url.includes('/files/main?alt=media')) return json(remote);
      if (url.includes('/files/main?fields=version')) return json({ version: String(version) });
      if (url.includes('/files/main?uploadType=media')) {
        remote = JSON.parse(route.request().postData()); version++;
        uploads.push(structuredClone(remote));
        if (uploads.length === 1) { started(); await gate; }
        return json({ id: 'main', version: String(version) });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });
    await page.goto('http://localhost:8000');
    const date = await page.evaluate(async () => {
      const date = new Date().toISOString().slice(0, 10);
      const user = { id: 'sync-pipeline-test', email: 'sync@example.invalid' };
      const entry = { id: '00000000-0000-4000-8000-000000000001', date, value: 30, type: 'ALIMENTAÇÃO', description: 'SUPERMERCADO', paid: false, updated_at: '2026-08-01T10:00:00.000Z' };
      localStorage.setItem('meus-gastos-google-user', JSON.stringify(user));
      await MGLocalStore.save(user.id, { entries: [entry], settings: { current_balance: 1000, balance_reference_date: date, onboarding_status: 'completed' }, settingsDirty: true, recurrenceDirty: true, recurrenceSeries: [{ id: 'inactive-series', active: false, value: 10, start_date: date }], syncQueue: [{ type: 'upsert', entry, baseUpdatedAt: entry.updated_at, mutationId: 'mutation-test' }] });
      return date;
    });
    remote = { schemaVersion: 2, revision: 1, entries: [{ id: '00000000-0000-4000-8000-000000000001', date, value: 10, type: 'ALIMENTAÇÃO', description: 'SUPERMERCADO', paid: false, updated_at: '2026-08-01T10:00:00.000Z' }], settings: { current_balance: 500, balance_reference_date: date, onboarding_status: 'completed' }, recurrenceSeries: [], tombstones: {}, compactedDeltas: {} };
    await page.reload();
    await uploadStarted;
    // Edit settings while the previous snapshot is being uploaded.
    await page.evaluate(date => {
      document.querySelector('#currentBalance').value = '2000';
      document.querySelector('#balanceReferenceDate').value = date;
      document.querySelector('#settingsForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }, date);
    await page.waitForFunction(async () => (await MGLocalStore.load('sync-pipeline-test')).settings.current_balance === 2000);
    release();
    await page.waitForSelector('#syncStatus[data-state="synced"]');
    assert.equal(uploads.length, 2, 'one upload per snapshot; the later edit must get its own upload');
    assert.equal(uploads[0].entries[0].value, 30);
    assert.equal(uploads[0].settings.current_balance, 1000);
    assert.equal(uploads[0].recurrenceSeries[0].id, 'inactive-series');
    assert.equal(remote.settings.current_balance, 2000);
    const cached = await page.evaluate(() => MGLocalStore.load('sync-pipeline-test'));
    assert.equal(cached.settings.current_balance, 2000);
    assert.equal(cached.settingsDirty, false);
    assert.equal(cached.recurrenceDirty, false);
    assert.equal(cached.syncQueue.length, 0);
    listFailures = 3;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForSelector('#syncStatus[data-state="pending"]');
    await page.waitForSelector('#syncStatus[data-state="synced"]');
    assert.equal(listFailures, 0);
    assert.equal(uploads.length, 2, 'recovering from a read failure must not upload unchanged data');
    assert.deepEqual(errors, []);
    console.log('Real sync pipeline: combined upload, concurrent settings edit, confirmed queue and local persistence OK');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
