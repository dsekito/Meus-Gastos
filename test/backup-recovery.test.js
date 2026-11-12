const assert = require('node:assert/strict');
const test = require('node:test');
global.window = global;
require('../js/document-validator.js');
const entry = (id, extra = {}) => ({ id, value: 25, date: '2026-11-10', type: 'CASA', description: 'Conta', ...extra });
const backup = (entries = [entry('new')], extra = {}) => ({ schemaVersion: 1, entries, recurrenceSeries: [], settings: { current_balance: 0 }, ...extra });

test('import accepts a backup or legacy entry array but rejects coercible numbers and malformed records', () => {
  const validator = MGDocumentValidator;
  assert.equal(typeof validator.parseImport, 'function', 'strict import parser is missing');
  // Legacy absence migrates to pending; invalid/null status is still rejected.
  assert.deepEqual(validator.parseImport(JSON.stringify(backup())).entries, [entry('new', { paid: false })]);
  assert.deepEqual(validator.parseImport(JSON.stringify([entry('legacy')])).entries, [entry('legacy', { paid: false })]);
  for (const value of [true, '', '12', null, {}, Infinity]) {
    assert.throws(() => validator.parseImport(backup([entry('bad', { value })])), /IMPORT_INVALID/);
  }
  for (const input of ['{bad', '[null]', '[]', backup([entry('a'), entry('a')]), backup([entry('a', { date: '2026-02-31' })]), backup([entry('__proto__')]), backup([], { schemaVersion: 99 }), '{"__proto__":{},"entries":[]}']) {
    assert.throws(() => validator.parseImport(input), /IMPORT_INVALID/);
  }
});

test('import rejects malformed financial flags, recurrence metadata and option collections', () => {
  for (const fields of [{ paid: 'false' }, { flow_type: 'bogus' }, { installment: {} }, { installment: 0 }, { installments: true }, { excluded_from_series: [] }, { description: {} }]) {
    assert.throws(() => MGDocumentValidator.parseImport(backup([entry('bad', fields)])), /IMPORT_INVALID/);
  }
  for (const extra of [{ settings: { current_balance: true } }, { settings: { types: {} } }, { recurrenceSeries: [{ id: 'series', value: true }] }, { recurrenceSeries: [{ id: 'series', active: 'false' }] }]) {
    assert.throws(() => MGDocumentValidator.parseImport(backup([entry('good')], extra)), /IMPORT_INVALID/);
  }
});

test('preview is side-effect free and commit adds only new records after explicit confirmation', async () => {
  try { require('../js/backup-recovery.js'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  assert.equal(typeof global.MGBackupRecovery?.create, 'function', 'recovery module is missing');
  let current = { entries: [entry('keep')], syncQueue: [{ type: 'delete', id: 'deleted', mutationId: 'old' }], recurrenceSeries: [{ id: 'existing-series', active: true }], settings: { current_balance: 500 }, settingsDirty: true };
  const original = structuredClone(current);
  let writes = 0;
  const store = {
    async load() { return structuredClone(current); },
    async compareAndSwap(user, expected, next) {
      assert.deepEqual(current, expected);
      writes++; current = structuredClone(next); return structuredClone(current);
    },
  };
  const recovery = MGBackupRecovery.create({ store, getUserId: () => 'user' });
  const preview = await recovery.preview('user', backup([entry('keep', { value: 999 }), entry('deleted'), entry('new', { series_id: 'foreign-series', scheduled_date: '2026-11-10' })], { recurrenceSeries: [{ id: 'foreign-series', value: 25 }], settings: { current_balance: 0 } }));
  assert.deepEqual(current, original);
  assert.equal(writes, 0);
  assert.equal(preview.added, 1);
  assert.deepEqual(preview.conflictIds, ['keep']);
  assert.deepEqual(preview.deletedIds, ['deleted']);
  assert.equal(preview.detached, 1);
  assert.equal(preview.localOnly, true);
  await assert.rejects(recovery.commit('user', preview.previewId), /IMPORT_CONFIRMATION_REQUIRED/);
  const result = await recovery.commit('user', preview.previewId, { confirmed: true });
  assert.equal(writes, 1);
  assert.deepEqual(result.data.entries.map(e => e.id), ['keep', 'new']);
  assert.equal(result.data.entries[0].value, 25);
  assert.deepEqual(result.data.settings, original.settings);
  assert.deepEqual(result.data.recurrenceSeries, original.recurrenceSeries);
  assert.deepEqual(result.data.syncQueue[0], original.syncQueue[0]);
  const added = result.data.entries[1];
  assert.equal(added.series_id, null);
  assert.equal(added.recovery_source_series_id, 'foreign-series');
  assert.equal(added.detached_from_series, true);
  assert.equal(added.import_local_only, true);
  assert.equal(result.data.syncQueue[1].localOnly, true);
  assert.equal(result.data.syncQueue[1].baseUpdatedAt, null);
  await assert.rejects(recovery.commit('user', preview.previewId, { confirmed: true }), /IMPORT_PREVIEW_EXPIRED/);
});

test('recovery does not resurrect tombstones or overwrite queued records absent from the view', async () => {
  const current = { entries: [], syncQueue: [{ type: 'upsert', entry: entry('queued'), mutationId: 'pending' }], tombstones: { deleted: '2026-11-10T00:00:00.000Z' } };
  const recovery = MGBackupRecovery.create({ store: { async load() { return structuredClone(current); } } });
  const preview = await recovery.preview('user', [entry('queued', { value: 99 }), entry('deleted')]);
  assert.equal(preview.added, 0);
  assert.deepEqual(preview.conflictIds, ['queued']);
  assert.deepEqual(preview.deletedIds, ['deleted']);
});

test('a superseded or discarded preview cannot be committed', async () => {
  let writes = 0;
  const recovery = MGBackupRecovery.create({ store: { async load() { return { entries: [], syncQueue: [] }; }, async compareAndSwap() { writes++; return {}; } } });
  const first = await recovery.preview('user', [entry('first')]);
  const second = await recovery.preview('user', [entry('second')]);
  await assert.rejects(recovery.commit('user', first.previewId, { confirmed: true }), /IMPORT_PREVIEW_EXPIRED/);
  recovery.discard(second.previewId);
  await assert.rejects(recovery.commit('user', second.previewId, { confirmed: true }), /IMPORT_PREVIEW_EXPIRED/);
  assert.equal(writes, 0);
});

test('a user switch during persistence never returns data for the previous account to the UI', async () => {
  let user = 'first', writes = 0;
  const recovery = MGBackupRecovery.create({ getUserId: () => user, store: {
    async load() { return { entries: [], syncQueue: [] }; },
    async compareAndSwap(id, expected, next) { assert.equal(id, 'first'); writes++; user = 'second'; return next; },
  } });
  const plan = await recovery.preview('first', [entry('new')]);
  await assert.rejects(recovery.commit('first', plan.previewId, { confirmed: true }), /IMPORT_USER_CHANGED/);
  assert.equal(writes, 1, 'only the original user-scoped transaction may have committed');
  await assert.rejects(recovery.preview('first', [entry('new')]), /IMPORT_USER_CHANGED/);
});
