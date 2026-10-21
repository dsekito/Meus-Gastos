const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../js/document-validator.js');
require('../js/google-drive-repository.js');

function driveMock({ afterCommit = null, onRead = null } = {}) {
  let doc = { schemaVersion: 2, revision: 1, entries: [{ id: 'one', value: 10, updated_at: '2026-08-01T10:00:00.000Z' }, { id: 'removed', value: 5, updated_at: '2026-08-01T10:00:00.000Z' }], recurrenceSeries: [], settings: { current_balance: 1000 }, tombstones: {}, compactedDeltas: {} };
  let version = 1, writes = 0;
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  global.fetch = async (url, options = {}) => {
    if (url.includes('/files?')) return json({ files: new URL(url).searchParams.get('q').includes("name = 'meus-gastos.json'") ? [{ id: 'main', name: 'meus-gastos.json', version: String(version) }] : [] });
    if (url.includes('/files/main?alt=media')) return onRead ? onRead(options) : json(doc);
    if (url.includes('/files/main?fields=version')) return json({ version: String(version) });
    if (url.includes('/files/main?uploadType=media')) {
      writes++; version++; doc = JSON.parse(options.body);
      if (afterCommit) await afterCommit(writes, options);
      return json({ id: 'main', version: String(version) });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  return { get document() { return structuredClone(doc); }, get writes() { return writes; } };
}

test('entries, settings and recurrence share one upload, without rewriting an unchanged batch', async () => {
  const drive = driveMock();
  const repo = MGGoogleDriveRepository.create({ getAccessToken: () => 'fake' });
  const batch = { operations: [{ type: 'upsert', entry: { id: 'one', value: 20 }, baseUpdatedAt: '2026-08-01T10:00:00.000Z' }], settings: { current_balance: 2000 }, recurrenceSeries: [{ id: 'series', value: 25 }] };
  await repo.applySyncBatch(batch);
  assert.equal(drive.writes, 1);
  assert.equal(drive.document.settings.current_balance, 2000);
  assert.equal(drive.document.recurrenceSeries[0].value, 25);
  await repo.load();
  await repo.applySyncBatch(batch);
  assert.equal(drive.writes, 1, 'confirmed data should be acknowledged without another upload');
});

test('a lost acknowledgement does not create a false conflict or repeat a deletion', async () => {
  const drive = driveMock({ afterCommit: writes => { if (writes === 1) throw new TypeError('Response lost after commit'); } });
  const repo = MGGoogleDriveRepository.create({ getAccessToken: () => 'fake' });
  const batch = { operations: [
    { type: 'upsert', entry: { id: 'one', value: 30 }, baseUpdatedAt: '2026-08-01T10:00:00.000Z' },
    { type: 'delete', id: 'removed', baseUpdatedAt: '2026-08-01T10:00:00.000Z' },
  ], settings: { current_balance: 3000 } };
  await assert.rejects(repo.applySyncBatch(batch), /Response lost/);
  await repo.load();
  const saved = await repo.applySyncBatch(batch);
  assert.equal(saved[0].value, 30);
  assert.equal(drive.writes, 1);
  assert.equal(drive.document.entries.some(entry => entry.id === 'removed'), false);
});

test('simultaneous batches are serialized without losing either change', async () => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const firstStarted = new Promise(resolve => { started = resolve; });
  const drive = driveMock({ afterCommit: async writes => { if (writes === 1) { started(); await gate; } } });
  const repo = MGGoogleDriveRepository.create({ getAccessToken: () => 'fake' });
  const first = repo.applySyncBatch({ operations: [{ type: 'upsert', entry: { id: 'new-a', value: 1 } }] });
  await firstStarted;
  const second = repo.applySyncBatch({ operations: [{ type: 'upsert', entry: { id: 'new-b', value: 2 } }] });
  assert.equal(drive.writes, 1);
  release(); await Promise.all([first, second]);
  assert.equal(drive.writes, 2);
  assert.ok(drive.document.entries.some(entry => entry.id === 'new-a'));
  assert.ok(drive.document.entries.some(entry => entry.id === 'new-b'));
});

test('a reset during upload cannot restore the previous account snapshot', async () => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const uploadStarted = new Promise(resolve => { started = resolve; });
  driveMock({ afterCommit: async () => { started(); await gate; } });
  const repo = MGGoogleDriveRepository.create({ getAccessToken: () => 'fake' });
  const upload = repo.applySyncBatch({ operations: [{ type: 'upsert', entry: { id: 'old-user', value: 10 } }] });
  await uploadStarted;
  repo.reset();
  release();
  await assert.rejects(upload, /GOOGLE_DRIVE_CANCELLED/);
  assert.equal(repo.getDocumentStats().entryCount, 0);
});

function stalledBody(options) {
  return new Response(new ReadableStream({ start(controller) {
    options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
  } }));
}

test('timeout covers a stalled body after successful HTTP headers', async () => {
  let attempts = 0;
  driveMock({ onRead: options => { attempts++; return stalledBody(options); } });
  const repo = MGGoogleDriveRepository.create({ getAccessToken: () => 'fake', requestTimeoutMs: 15 });
  await assert.rejects(repo.load(), /GOOGLE_DRIVE_TIMEOUT/);
  assert.equal(attempts, 3);
});

test('cancel interrupts retry backoff, without starting another request', async () => {
  let attempts = 0;
  driveMock({ onRead: options => { attempts++; return stalledBody(options); } });
  const repo = MGGoogleDriveRepository.create({ getAccessToken: () => 'fake', requestTimeoutMs: 15 });
  const pending = repo.load();
  const cancel = setTimeout(() => repo.cancelPendingRequests(), 80);
  try { await assert.rejects(pending, /GOOGLE_DRIVE_CANCELLED/); }
  finally { clearTimeout(cancel); }
  assert.equal(attempts, 1);
});
