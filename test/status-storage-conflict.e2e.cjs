// Real isolated Edge tabs + IndexedDB; synthetic auth, no external traffic.
// Run: node test/status-storage-conflict.e2e.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const user = { id: 'status-conflict-synthetic', email: 'status@example.invalid' };
const id = '00000000-0000-4000-8000-000000000051';
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/seed') return res.end('<!doctype html><title>Synthetic status test</title>');
  if (pathname === '/js/google-auth.js') {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end(`window.MGGoogleAuth={create:()=>({restoreSession:()=>JSON.parse(localStorage.getItem('meus-gastos-google-user')||'null'),hasAccessToken:()=>false,getAccessToken:()=>null,isAccessTokenExpired:()=>false,clearToken:()=>{},signOut:async()=>{},signIn:async()=>{throw Error('REAL_AUTH_FORBIDDEN')}})};`);
  }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  });
});
async function snapshot(page) {
  return page.evaluate(async user => ({ entry: structuredClone(state.entries[0]), queue: structuredClone(state.syncQueue),
    pending: [...state.pendingStatusEntries], persisted: await MGLocalStore.load(user.id, { observe: false }),
    toast: document.querySelector('#toast').textContent }), user);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const failures = [];
  try {
    for (const scenario of ['toggle-conflict', 'undo-conflict', 'toggle-abort', 'undo-abort', 'toggle-quota', 'undo-quota']) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
      const errors = [], external = [];
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        external.push(route.request().url());
        return route.fulfill({ contentType: 'application/javascript', body: '/* no external traffic */' });
      });
      const a = await context.newPage(), b = await context.newPage();
      for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
      try {
        await a.goto(origin + '/seed');
        await a.addScriptTag({ url: origin + '/js/local-store.js' });
        await a.evaluate(async ({ user, id }) => {
          localStorage.setItem('meus-gastos-google-user', JSON.stringify(user));
          const date = new Date().toISOString().slice(0, 10);
          const entry = { id, date, value: 41, type: 'OUTROS', description: 'OUTROS', paid: false,
            notes: 'synthetic status', updated_at: '2026-01-01T12:00:00.000Z' };
          await MGLocalStore.save(user.id, { entries: [entry], settings: { onboarding_status: 'completed', current_balance: 100, balance_reference_date: date }, syncQueue: [] });
        }, { user, id });
        for (const page of [a, b]) {
          await page.goto(origin);
          await page.waitForFunction(() => typeof state !== 'undefined' && state.entries.length === 1 && document.body.getAttribute('aria-busy') === 'false');
        }
        await a.locator('.app-navigation [data-app-destination="records"]').click();
        await a.locator('#filterStatus').selectOption('', { force: true });
        const status = a.locator(`[data-toggle-status="${id}"]`);
        if (scenario.startsWith('undo')) {
          await status.click();
          await a.locator('#toast button').waitFor({ state: 'visible' });
        }
        const before = await snapshot(a);
        let concurrent;
        if (scenario.endsWith('conflict')) {
          concurrent = await b.evaluate(async user => {
            const latest = await MGLocalStore.load(user.id);
            latest.entries[0].notes = 'OTHER TAB MUST SURVIVE';
            latest.settings.current_balance = 777;
            latest.syncQueue.push({ type: 'upsert', entry: { ...latest.entries[0] }, mutationId: 'other-tab-mutation' });
            await MGLocalStore.save(user.id, latest);
            return latest;
          }, user);
        } else if (scenario.endsWith('quota')) {
          // Fault injection at the IDB boundary; do not fill the real disk/profile.
          await a.evaluate(() => {
            const transaction = IDBDatabase.prototype.transaction;
            IDBDatabase.prototype.transaction = function(...args) {
              if (args[1] === 'readwrite') {
                IDBDatabase.prototype.transaction = transaction;
                throw new DOMException('Synthetic storage quota exhausted', 'QuotaExceededError');
              }
              return transaction.apply(this, args);
            };
          });
        } else {
          // Abort a genuine IndexedDB write transaction after put, not a mocked save.
          await a.evaluate(() => {
            const put = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function(...args) {
              const request = put.apply(this, args);
              this.transaction.abort();
              IDBObjectStore.prototype.put = put;
              return request;
            };
          });
        }
        if (scenario.startsWith('undo')) await a.locator('#toast button').click();
        else await status.click();
        // Give both the real transaction and rejected event promise time to settle.
        await a.waitForTimeout(250);
        const after = await snapshot(a);
        assert.equal(after.entry.paid, before.entry.paid, 'failed status must roll back paid in memory');
        assert.equal(await status.getAttribute('aria-pressed'), String(before.entry.paid), 'financial UI must show persisted status');
        assert.deepEqual(after.pending, [], 'finally must release pendingStatusEntries');
        assert.match(after.toast, /n[aã]o.{0,20}salv/i, 'clear not-saved warning');
        assert.deepEqual(errors, [], 'no unhandled rejected event promises');
        assert.deepEqual(after.persisted, concurrent || before.persisted, 'failed save must leave persisted data unchanged');
        if (concurrent) {
          assert.equal(after.entry.notes, 'OTHER TAB MUST SURVIVE', 'reload latest entry, not just the CAS baseline');
          assert.deepEqual(after.queue, concurrent.syncQueue, 'do not queue failed intent or old snapshot');
        } else assert.deepEqual(after.queue, before.queue, 'abort must restore original sync queue');
        // Explicit retry (not automatic): must work and preserve concurrent unrelated data.
        await status.click();
        await a.waitForFunction(id => !state.pendingStatusEntries.has(id), id);
        const retry = await snapshot(a);
        assert.equal(retry.entry.paid, !before.entry.paid, 'explicit retry is not blocked');
        assert.equal(retry.persisted.entries[0].paid, !before.entry.paid);
        if (concurrent) {
          assert.equal(retry.persisted.entries[0].notes, concurrent.entries[0].notes);
          assert.deepEqual(retry.persisted.settings, concurrent.settings);
        }
        assert.deepEqual(errors, []);
        assert.ok(external.every(url => url === 'https://accounts.google.com/gsi/client'), 'no remote repository requests');
        console.log(`PASS ${scenario}: rollback/readback, pending cleanup, warning, no unhandled rejection, explicit retry`);
      } catch (error) {
        failures.push(scenario);
        console.error(`FAIL ${scenario}:`, error.message, '\nstate:', JSON.stringify(await snapshot(a)), '\nunhandled:', errors);
      } finally { await context.close(); }
    }
    assert.deepEqual(failures, [], 'all status persistence scenarios must pass');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
