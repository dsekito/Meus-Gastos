// Real file-picker -> native confirmation -> real IndexedDB, isolated Edge only.
// Run: node test/backup-recovery-ui.e2e.cjs
// No localhost:8000 dependency, real Google credentials, production edits or uploads.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(__dirname, 'artifacts', 'backup-recovery-ui');
const user = { id: 'isolated-backup-ui-user', email: 'backup-ui@example.invalid' };
const ids = {
  original: '00000000-0000-4000-8000-000000000011',
  duplicate: '00000000-0000-4000-8000-000000000012',
  added: '00000000-0000-4000-8000-000000000013',
  deleted: '00000000-0000-4000-8000-000000000014',
};
const coreKeys = ['entries', 'settings', 'settingsDirty', 'recurrenceSeries', 'recurrenceDirty',
  'types', 'descriptions', 'customDescriptionOptionsByType', 'hiddenTypes',
  'hiddenDescriptionsByType', 'syncQueue'];
const settingsKeys = coreKeys.filter(key => !['entries', 'syncQueue'].includes(key));
const pick = (value, keys = coreKeys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const authStub = `window.__backupUIToken = false;
window.MGGoogleAuth = { create: () => ({
  restoreSession: () => JSON.parse(localStorage.getItem('meus-gastos-google-user') || 'null'),
  hasAccessToken: () => window.__backupUIToken,
  getAccessToken: () => window.__backupUIToken ? 'synthetic-never-send-token' : null,
  isAccessTokenExpired: () => false,
  clearToken: () => { window.__backupUIToken = false; },
  signOut: async () => {},
  signIn: async () => { throw new Error('REAL_GOOGLE_FORBIDDEN_IN_TEST'); }
}) };`;

function createServer() {
  return http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (pathname === '/__backup_ui_seed') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><title>Isolated backup UI seed</title>');
    }
    if (pathname === '/js/google-auth.js') {
      res.setHeader('Content-Type', 'application/javascript');
      return res.end(authStub);
    }
    let file;
    try { file = path.resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname)); }
    catch { res.writeHead(400); return res.end(); }
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (error, body) => {
      if (error) { res.writeHead(404); return res.end('Not found'); }
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(body);
    });
  });
}

async function snapshot(page) {
  return page.evaluate(async ({ userId, keys }) => {
    const memory = Object.fromEntries(keys.map(key => [key, structuredClone(state[key])]));
    // Diagnostic reads must not advance this tab's stale-save/CAS baseline.
    return { memory, persisted: await MGLocalStore.load(userId, { observe: false }) };
  }, { userId: user.id, keys: coreKeys });
}

async function fixture(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const external = [], writes = [], errors = [], dialogs = [];
  await context.route('**/*', async route => {
    const request = route.request();
    if (new URL(request.url()).origin === origin) return route.continue();
    // The app includes the GIS bootstrap independently of google-auth.js.
    // Fulfill that static script locally; do not confuse it with recovery API traffic.
    if (request.url() === 'https://accounts.google.com/gsi/client' && request.method() === 'GET'
        && request.resourceType() === 'script') {
      return route.fulfill({ contentType: 'application/javascript', body: '/* isolated GIS bootstrap: no Google */' });
    }
    external.push({ method: request.method(), url: request.url() });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(external.at(-1));
    // Never let a real Google request (or other third party) leave the browser.
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/__backup_ui_seed');
  await page.addScriptTag({ url: origin + '/js/local-store.js' });
  const seed = await page.evaluate(async ({ user, ids }) => {
    const date = new Date().toISOString().slice(0, 10);
    const entry = (id, value, notes) => ({ id, date, value, type: 'OUTROS', description: 'OUTROS',
      notes, paid: false, updated_at: '2026-01-01T12:00:00.000Z' });
    const original = entry(ids.original, 41, 'LOCAL ORIGINAL MUST SURVIVE');
    const duplicate = entry(ids.duplicate, 17, 'LOCAL DUPLICATE MUST SURVIVE');
    const data = {
      entries: [original, duplicate],
      settings: { current_balance: 987.65, balance_reference_date: date, onboarding_status: 'completed' },
      settingsDirty: true,
      recurrenceSeries: [{ id: 'local-inactive-series', active: false, value: 10, start_date: date }],
      recurrenceDirty: true,
      types: ['OUTROS', 'TIPO LOCAL'], descriptions: ['DESCRIÇÃO LOCAL', 'OUTROS'],
      customDescriptionOptionsByType: { OUTROS: ['DESCRIÇÃO LOCAL'] },
      hiddenTypes: ['LAZER'], hiddenDescriptionsByType: { OUTROS: ['OCULTA LOCAL'] },
      syncQueue: [{ type: 'upsert', entry: original, baseUpdatedAt: original.updated_at, mutationId: 'local-pending' },
        { type: 'delete', id: ids.deleted, baseUpdatedAt: null, mutationId: 'local-delete' }],
      lastSyncedAt: null, syncConflict: null,
    };
    localStorage.setItem('meus-gastos-google-user', JSON.stringify(user));
    await MGLocalStore.save(user.id, data);
    return { data, date };
  }, { user, ids });
  await page.goto(origin + '/');
  await page.waitForFunction(userId => typeof state !== 'undefined' && state.user?.id === userId
    && state.entries.length === 2 && document.body.getAttribute('aria-busy') === 'false', user.id);
  assert.equal(await page.locator('#importBackupFile').count(), 1, 'RED: missing #importBackupFile integration');
  assert.equal(await page.locator('#importLocalBackup').count(), 1, 'RED: missing #importLocalBackup integration');
  await page.locator('[data-app-destination="settings"]').click();
  await page.locator('[data-settings-topic="data"]').click();
  await page.locator('#importLocalBackup').waitFor({ state: 'visible' });
  const baseline = await snapshot(page);
  return { context, page, seed, baseline, external, writes, errors, dialogs };
}

function backup(f, entries) {
  return { schemaVersion: 1, exportedAt: '2026-01-01T12:00:00.000Z', entries,
    settings: { current_balance: -999, balance_reference_date: f.seed.date, onboarding_status: 'pending', types: ['BACKUP TYPE'] },
    recurrenceSeries: [{ id: 'backup-series', active: true, start_date: f.seed.date, value: 99 }] };
}
function addedEntry(f) {
  return { id: ids.added, date: f.seed.date, value: 23.5, type: 'OUTROS', description: 'OUTROS',
    notes: 'RECOVERED ENTRY', paid: false, series_id: 'backup-series' };
}

async function selectFile(f, value, { confirm = true, invalid = false } = {}) {
  const { page } = f;
  const seen = [];
  let dialogFailure, finishDialog;
  const handledDialog = new Promise(resolve => { finishDialog = resolve; });
  const onDialog = async dialog => {
    const item = { type: dialog.type(), message: dialog.message(), accepted: confirm };
    seen.push(item); f.dialogs.push(item);
    try {
      if (invalid || dialog.type() !== 'confirm') {
        dialogFailure = new Error('Unexpected native dialog: ' + JSON.stringify(item));
        await dialog.dismiss();
      } else if (confirm) await dialog.accept();
      else await dialog.dismiss();
    } catch (error) { dialogFailure = error; }
    finally { finishDialog(); }
  };
  page.on('dialog', onDialog);
  try {
    // Exercise the actual visible button and native file chooser, not a direct recovery call.
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'), page.locator('#importLocalBackup').click(),
    ]);
    await chooser.setFiles({ name: 'isolated-backup.json', mimeType: 'application/json',
      buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
    if (invalid) {
      await page.waitForFunction(() => /inválid|invalido|invalid/i.test(document.querySelector('#toast')?.textContent || ''));
    } else {
      let timer;
      try {
        await Promise.race([handledDialog, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('RED: native confirmation was never shown')), 7000);
        })]);
      } finally { clearTimeout(timer); }
      // Cancellation need not show a toast. Completion is the released recovery lock/control.
      await page.waitForFunction(() => document.querySelector('#importLocalBackup')?.disabled === false);
      assert.equal(seen.length, 1, 'file selection must show one explicit native confirmation');
    }
    await page.waitForFunction(() => document.querySelector('#importLocalBackup')?.disabled === false);
    if (dialogFailure) throw dialogFailure;
    return seen;
  } finally { page.off('dialog', onDialog); }
}

function assertUnchanged(f, after) {
  assert.deepEqual(after.memory, f.baseline.memory, 'in-memory user data must not change');
  assert.deepEqual(pick(after.persisted), pick(f.baseline.persisted), 'persisted user data must not change');
}
function assertLocalWarning(message) {
  assert.match(message, /local|aparelho|dispositivo/i, 'preview must say local-only');
  assert.match(message, /sem sincroniza|n[aã]o.{0,35}(envi|sincroniz)|(?:sincroniza|envio).{0,55}(pausad|bloquead)/i,
    'preview must explicitly warn that sync is paused/blocked and data is not uploaded');
}

const scenarios = [
  ['cancel-confirmation', async f => {
    const dialogs = await selectFile(f, backup(f, [addedEntry(f)]), { confirm: false });
    assertLocalWarning(dialogs[0].message);
    assertUnchanged(f, await snapshot(f.page));
    assert.equal(await f.page.locator('#importBackupFile').inputValue(), '', 'clear file selection so the same file can be selected again');
  }],
  ['additive-confirmation-preserves-local-data', async f => {
    const dialogs = await selectFile(f, backup(f, [addedEntry(f)]));
    assertLocalWarning(dialogs[0].message);
    assert.match(dialogs[0].message, /1/, 'preview contains addition count');
    assert.match(dialogs[0].message, /recorr|avuls|desvincul/i, 'preview explains recurrence detachment');
    const after = await snapshot(f.page);
    assert.equal(after.memory.entries.length, 3);
    assert.deepEqual(after.memory.entries.slice(0, 2), f.baseline.memory.entries);
    assert.deepEqual(pick(after.memory, settingsKeys), pick(f.baseline.memory, settingsKeys));
    assert.deepEqual(after.memory.syncQueue.slice(0, 2), f.baseline.memory.syncQueue);
    const recovered = after.memory.entries.find(entry => entry.id === ids.added);
    assert.equal(recovered.value, 23.5);
    assert.equal(recovered.import_local_only, true);
    assert.equal(recovered.series_id, null);
    assert.equal(recovered.detached_from_series, true);
    assert.equal(recovered.recovery_source_series_id, 'backup-series');
    const op = after.memory.syncQueue.find(item => item.entry?.id === ids.added);
    assert.equal(op.localOnly, true);
    assert.equal(op.baseUpdatedAt, null);
    assert.deepEqual(pick(after.persisted), after.memory, 'memory applied only after successful persistent commit');
    assert.match(await f.page.locator('#syncStatus').innerText(), /pausad|bloquead|apenas.{0,15}local|somente.{0,15}local/i);
    await f.page.reload();
    await f.page.waitForFunction(id => typeof state !== 'undefined' && state.entries.some(entry => entry.id === id), ids.added);
    assert.deepEqual((await snapshot(f.page)).memory, after.memory, 'confirmed import survives page reload');
  }],
  ['duplicate-conflict-and-deleted-id-never-overwritten', async f => {
    const [original, duplicate] = f.baseline.memory.entries;
    const dialogs = await selectFile(f, backup(f, [
      { ...original, value: 999999, notes: 'MUST NEVER OVERWRITE ORIGINAL' }, duplicate,
      { ...addedEntry(f), id: ids.deleted }, addedEntry(f),
    ]));
    assert.match(dialogs[0].message, /1\s+duplic/i);
    assert.match(dialogs[0].message, /1\s+conflit/i);
    assert.match(dialogs[0].message, /1\s+exclu|1\s+delet/i);
    const after = await snapshot(f.page);
    assert.deepEqual(after.memory.entries.slice(0, 2), f.baseline.memory.entries);
    assert.equal(after.memory.entries.filter(entry => entry.id === ids.duplicate).length, 1);
    assert.equal(after.memory.entries.some(entry => entry.id === ids.deleted), false);
    assert.equal(after.memory.entries.length, 3);
    assert.deepEqual(pick(after.persisted), after.memory);
  }],
  ['invalid-json-does-not-change-data', async f => {
    await selectFile(f, '{ definitely not JSON', { invalid: true });
    assertUnchanged(f, await snapshot(f.page));
  }],
  ['invalid-schema-value-does-not-change-data', async f => {
    await selectFile(f, backup(f, [{ ...addedEntry(f), value: '23.50' }]), { invalid: true });
    assertUnchanged(f, await snapshot(f.page));
  }],
  ['indexeddb-abort-does-not-apply-memory-or-persistence', async f => {
    await f.page.evaluate(({ userId, addedId }) => {
      const put = IDBObjectStore.prototype.put;
      window.__backupUIAbort = { count: 0, preflight: null };
      IDBObjectStore.prototype.put = function(value, key) {
        const request = put.call(this, value, key);
        if (key === userId && value?.entries?.some(entry => entry.id === addedId)) {
          window.__backupUIAbort.count++;
          this.transaction.abort(); // Abort a REAL IDB transaction after put, not a mocked rejection.
        } else if (key === userId) {
          const snapshot = structuredClone(value);
          this.transaction.addEventListener('complete', () => { window.__backupUIAbort.preflight = snapshot; });
        }
        return request;
      };
    }, { userId: user.id, addedId: ids.added });
    await selectFile(f, backup(f, [addedEntry(f)]));
    const fault = await f.page.evaluate(() => window.__backupUIAbort);
    assert.equal(fault.count, 1, 'the injected failure must be exercised by recovery, not by preflight save');
    assert.ok(fault.preflight, 'preflight save completed before confirmation');
    const after = await snapshot(f.page);
    assertUnchanged(f, after);
    assert.deepEqual(after.persisted, fault.preflight, 'exact entire persisted snapshot unchanged after aborted put');
    assert.match(await f.page.locator('#toast').innerText(), /falh|n[aã]o foi poss[ií]vel|preservad/i);
    await f.page.reload();
    await f.page.waitForFunction(() => typeof state !== 'undefined' && state.entries.length === 2);
    assertUnchanged(f, await snapshot(f.page));
  }],
  ['local-only-sync-paused-with-zero-remote-calls', async f => {
    const dialogs = await selectFile(f, backup(f, [addedEntry(f)]));
    assertLocalWarning(dialogs[0].message);
    // Simulate a valid token only after local import; all external networking remains blocked.
    // Exercise the actual retry and online lifecycle, rather than proving zero uploads merely by being signed out.
    await f.page.evaluate(async () => {
      window.__backupUIToken = true;
      await retrySynchronization();
      window.dispatchEvent(new Event('online'));
    });
    await f.page.waitForTimeout(1500); // Cover debounce/retry scheduling; not an integration/file polling loop.
    assert.deepEqual(f.external, [], 'blocked recovery must stop before even a remote read, not only before upload');
    const after = await snapshot(f.page);
    assert.equal(after.memory.entries.some(entry => entry.id === ids.added), true);
    assert.equal(after.memory.syncQueue.find(op => op.entry?.id === ids.added)?.localOnly, true);
    assert.equal(after.memory.settingsDirty, true);
    assert.equal(after.memory.recurrenceDirty, true);
    assert.match(await f.page.locator('#syncStatus').innerText(), /pausad|bloquead|apenas.{0,15}local|somente.{0,15}local/i);
  }],
];

(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  // Do not leave obsolete failure screenshots alongside a fresh passing report.
  for (const [name] of scenarios) {
    for (const extension of ['png', 'html']) {
      fs.rmSync(path.join(artifacts, `${name}.${extension}`), { force: true });
    }
  }
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    console.log(`Isolated Edge backup UI E2E: ${origin}; all third-party traffic blocked`);
    for (const [name, run] of scenarios) {
      let f;
      const result = { name, status: 'FAIL' };
      try {
        f = await fixture(browser, origin);
        await run(f);
        assert.deepEqual(f.errors, [], 'no uncaught browser errors');
        assert.deepEqual(f.writes, [], 'zero attempted external uploads');
        result.status = 'PASS';
        console.log(`PASS ${name}`);
      } catch (error) {
        result.error = error.stack || String(error);
        console.error(`FAIL ${name}: ${error.message}`);
        if (f) {
          await f.page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: true }).catch(() => {});
          fs.writeFileSync(path.join(artifacts, `${name}.html`), await f.page.content().catch(() => ''));
        }
      } finally {
        if (f) {
          result.externalRequests = f.external;
          result.uploadAttempts = f.writes;
          result.dialogs = f.dialogs;
          await f.context.close();
        }
        // Also close a partially constructed fixture when bootstrap/integration is RED.
        for (const leftover of browser.contexts()) await leftover.close();
        results.push(result);
      }
    }
    const passed = results.filter(result => result.status === 'PASS').length;
    const failed = results.length - passed;
    fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({
      browser: 'isolated Playwright msedge', passed, failed, total: results.length, results,
    }, null, 2));
    console.log(`Backup recovery UI: ${passed}/${results.length} PASS; ${failed} FAIL. Artifacts: ${artifacts}`);
    if (failed) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
