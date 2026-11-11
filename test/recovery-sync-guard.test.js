const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../js/document-validator.js');
require('../js/google-drive-repository.js');
require('../js/sync-service.js');

test('local-only recovery blocks every remote operation before upload, including mixed batches', async () => {
  let calls = 0, persisted = 0;
  const entry = { id: 'recovered', value: 10, import_local_only: true };
  const state = { entries: [entry], syncQueue: [{ type: 'delete', id: 'other', mutationId: 'existing' }, { type: 'upsert', entry, localOnly: true, mutationId: 'recovery' }], deletedEntryIds: new Set(['other']) };
  const original = structuredClone(state);
  const sync = MGSyncService.create({ state, normalizeEntryIds: () => {}, persist: async () => { persisted++; }, repository: { async applySyncBatch() { calls++; return []; } } });
  await assert.rejects(sync.syncEntries('user', { settings: { current_balance: 99 } }), /SAFE_IMPORT_REMOTE_DISABLED/);
  assert.equal(calls, 0);
  assert.equal(persisted, 0);
  assert.deepEqual(state, original);
  entry.value = 12;
  sync.queueUpsert(entry);
  await assert.rejects(sync.syncEntries('user'), /SAFE_IMPORT_REMOTE_DISABLED/);
  sync.queueUpsert({ id: entry.id, value: 13 }); // Some editors rebuild the entry object.
  await assert.rejects(sync.syncEntries('user'), /SAFE_IMPORT_REMOTE_DISABLED/);
  assert.equal(calls, 0);
});

test('repository independently rejects local-only recovered records without contacting Drive', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('network forbidden'); };
  const repository = MGGoogleDriveRepository.create({ getAccessToken: () => 'fake-test-token' });
  const entry = { id: 'recovered', value: 10, import_local_only: true };
  await assert.rejects(repository.applySyncBatch({ operations: [{ type: 'upsert', entry }] }, 'user'), /SAFE_IMPORT_REMOTE_DISABLED/);
  await assert.rejects(repository.applyEntryOperations([{ type: 'upsert', entry: { id: 'other' }, localOnly: true }], 'user'), /SAFE_IMPORT_REMOTE_DISABLED/);
  assert.equal(calls, 0);
});

test('failed local acknowledgement retains the queue for an idempotent retry', async () => {
  let attempts = 0, saves = 0;
  const entry = { id: 'pending', value: 10 };
  const state = { entries: [entry], syncQueue: [], deletedEntryIds: new Set() };
  const sync = MGSyncService.create({ state, normalizeEntryIds: () => {}, persist: async () => { if (++saves === 1) throw new Error('quota exceeded'); }, repository: {
    async applyEntryOperations(operations) { attempts++; return operations.filter(op => op.type === 'upsert').map(op => ({ ...op.entry, updated_at: 'remote-v2' })); },
  } });
  sync.queueUpsert(entry);
  sync.queueDelete('removed', 'remote-v1');
  const mutations = state.syncQueue.map(op => op.mutationId);
  await assert.rejects(sync.syncEntries('user'), /quota exceeded/);
  assert.deepEqual(state.syncQueue.map(op => op.mutationId), mutations, 'local persistence failure must not discard unacknowledged work');
  assert.equal(state.deletedEntryIds.has('removed'), true);
  await sync.syncEntries('user');
  assert.equal(attempts, 2);
  assert.equal(state.syncQueue.length, 0);
  assert.equal(state.deletedEntryIds.size, 0);
});

test('legacy single-entry acknowledgement also retains work when persistence fails', async () => {
  const state = { entries: [{ id: 'legacy', value: 5 }], syncQueue: [], deletedEntryIds: new Set() };
  const sync = MGSyncService.create({ state, normalizeEntryIds: () => {}, persist: async () => { throw new Error('disk full'); }, repository: {
    async upsertEntry(entry) { return { ...entry, updated_at: 'remote-v2' }; },
  } });
  sync.queueUpsert(state.entries[0]);
  const mutationId = state.syncQueue[0].mutationId;
  await assert.rejects(sync.syncEntries('user'), /disk full/);
  assert.equal(state.syncQueue[0]?.mutationId, mutationId);
});
