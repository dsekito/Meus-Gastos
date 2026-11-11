// Isolated ephemeral browser profile + localhost origin; no real user data or Drive.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
(async () => {
  const server = http.createServer((req, res) => {
    const name = req.url.slice(1);
    if (/^js\/[a-z-]+\.js$/.test(name)) {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(fs.readFileSync(path.join(__dirname, '..', name)));
    } else res.end('<!doctype html><title>Isolated recovery tests</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const a = await context.newPage(), b = await context.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const page of [a, b]) {
      await page.goto(origin);
      await page.addScriptTag({ url: origin + '/js/local-store.js' });
    }
    await a.evaluate(() => MGLocalStore.save('test', { entries: [{ id: 'original', value: 1 }], syncQueue: [] }));
    const baseline = await a.evaluate(() => MGLocalStore.load('test'));
    await b.evaluate(async () => {
      const current = await MGLocalStore.load('test');
      current.entries.push({ id: 'other-tab', value: 2 });
      await MGLocalStore.save('test', current);
    });
    const staleSave = await a.evaluate(async baseline => {
      try { await MGLocalStore.save('test', baseline); return 'UNSAFE_SUCCESS'; }
      catch (error) { return error.message; }
    }, baseline);
    assert.equal(staleSave, 'LOCAL_STORE_CONFLICT', 'ordinary saves from stale tabs must not erase recovery data');
    const result = await a.evaluate(async baseline => {
      if (typeof MGLocalStore.compareAndSwap !== 'function') return 'MISSING_ATOMIC_COMPARE_AND_SWAP';
      try { await MGLocalStore.compareAndSwap('test', baseline, { entries: [] }); return 'UNSAFE_SUCCESS'; }
      catch (error) { return error.message; }
    }, baseline);
    assert.equal(result, 'LOCAL_STORE_CONFLICT', 'stale tab must not overwrite a concurrent commit');
    assert.deepEqual((await a.evaluate(() => MGLocalStore.load('test'))).entries.map(e => e.id), ['original', 'other-tab']);
    const current = await a.evaluate(() => MGLocalStore.load('test'));
    const swapped = await a.evaluate(async current => {
      const next = { ...current, recoveryMarker: true };
      await MGLocalStore.compareAndSwap('test', current, next);
      return MGLocalStore.load('test');
    }, current);
    assert.equal(swapped.recoveryMarker, true);
    for (const page of [a, b]) {
      await page.addScriptTag({ url: origin + '/js/document-validator.js' });
      await page.addScriptTag({ url: origin + '/js/backup-recovery.js' });
      await page.evaluate(() => { window.recovery = MGBackupRecovery.create({ getUserId: () => 'recovery-user' }); });
    }
    const seed = { entries: [{ id: 'original', value: 10, date: '2026-11-10' }], settings: { current_balance: 555 }, recurrenceSeries: [{ id: 'keep-series', active: true }], syncQueue: [] };
    await a.evaluate(seed => MGLocalStore.save('recovery-user', seed), seed);
    const preview = await a.evaluate(() => recovery.preview('recovery-user', [{ id: 'imported', value: 20, date: '2026-11-10', series_id: 'old-series' }]));
    await b.evaluate(async () => {
      const latest = await MGLocalStore.load('recovery-user');
      latest.entries.push({ id: 'concurrent', value: 30, date: '2026-11-10' });
      await MGLocalStore.save('recovery-user', latest);
    });
    const conflict = await a.evaluate(async id => {
      try { await recovery.commit('recovery-user', id, { confirmed: true }); return 'UNSAFE_SUCCESS'; }
      catch (error) { return error.message; }
    }, preview.previewId);
    assert.equal(conflict, 'LOCAL_STORE_CONFLICT');
    const beforeImport = await a.evaluate(() => MGLocalStore.load('recovery-user'));
    assert.deepEqual(beforeImport.entries.map(e => e.id), ['original', 'concurrent']);
    const nextPreview = await a.evaluate(() => recovery.preview('recovery-user', [{ id: 'imported', value: 20, date: '2026-11-10', series_id: 'old-series' }]));
    const aborted = await a.evaluate(async id => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, key) {
        const request = put.call(this, value, key);
        if (key === 'recovery-user') this.transaction.abort();
        return request;
      };
      try { await recovery.commit('recovery-user', id, { confirmed: true }); return 'UNSAFE_SUCCESS'; }
      catch (error) { return error.message; }
      finally { IDBObjectStore.prototype.put = put; }
    }, nextPreview.previewId);
    assert.equal(aborted, 'INDEXED_DB_TRANSACTION_ABORTED');
    assert.deepEqual(await a.evaluate(() => MGLocalStore.load('recovery-user')), beforeImport, 'an aborted put must leave all persisted fields unchanged');
    const recovered = await a.evaluate(id => recovery.commit('recovery-user', id, { confirmed: true }), nextPreview.previewId);
    assert.deepEqual(recovered.data.entries.map(e => e.id), ['original', 'concurrent', 'imported']);
    assert.deepEqual(recovered.data.settings, seed.settings);
    assert.deepEqual(recovered.data.recurrenceSeries, seed.recurrenceSeries);
    assert.equal(recovered.data.entries[2].series_id, null);
    assert.equal(recovered.data.syncQueue[0].localOnly, true);
    assert.deepEqual(await a.evaluate(() => MGLocalStore.load('recovery-user')), recovered.data);
    const afterImportStaleSave = await b.evaluate(async () => {
      try { await MGLocalStore.save('recovery-user', { entries: [], syncQueue: [] }); return 'UNSAFE_SUCCESS'; }
      catch (error) { return error.message; }
    });
    assert.equal(afterImportStaleSave, 'LOCAL_STORE_CONFLICT');
    await a.evaluate(async () => {
      await MGLocalStore.save('observer-user', { entries: [], syncQueue: [] });
      window.staleView = await MGLocalStore.load('observer-user');
    });
    await b.evaluate(async () => {
      const latest = await MGLocalStore.load('observer-user');
      latest.entries.push({ id: 'newer', value: 10, date: '2026-11-10' });
      await MGLocalStore.save('observer-user', latest);
    });
    const previewMustNotAuthorizeStaleSave = await a.evaluate(async () => {
      const recovery = MGBackupRecovery.create();
      await recovery.preview('observer-user', [{ id: 'recovery', value: 20, date: '2026-11-10' }]);
      try { await MGLocalStore.save('observer-user', window.staleView); return 'UNSAFE_SUCCESS'; }
      catch (error) { return error.message; }
    });
    assert.equal(previewMustNotAuthorizeStaleSave, 'LOCAL_STORE_CONFLICT', 'read-only preview must not advance the write baseline of a stale UI');
    console.log('recovery indexeddb: atomic CAS, concurrent tabs, stale preview, aborted-put rollback, retry and committed readback OK');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
