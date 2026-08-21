const assert = require("node:assert/strict");

global.window = global;
require("../js/sync-service.js");

(async () => {
  let batchCalls = 0;
  let persistCalls = 0;
  const state = {
    entries: [{ id: "a", value: 1 }, { id: "b", value: 2 }],
    syncQueue: [],
    deletedEntryIds: new Set(),
  };
  const repository = {
    async applyEntryOperations(operations) {
      batchCalls++;
      assert.equal(operations.length, 3);
      return operations
        .filter((operation) => operation.type === "upsert")
        .map((operation) => ({ ...operation.entry, updated_at: `saved-${operation.entry.id}` }));
    },
  };
  const sync = global.MGSyncService.create({
    state,
    repository,
    persist: async () => { persistCalls++; },
    normalizeEntryIds: () => {},
  });

  sync.queueUpsert(state.entries[0]);
  sync.queueUpsert(state.entries[1]);
  sync.queueDelete("removed", "old-version");
  await sync.syncEntries("user");

  assert.equal(batchCalls, 1);
  assert.equal(persistCalls, 1);
  assert.equal(state.syncQueue.length, 0);
  assert.equal(state.entries[0].updated_at, "saved-a");
  assert.equal(state.entries[1].updated_at, "saved-b");
  assert.equal(state.deletedEntryIds.size, 0);

  const bulkState = {
    entries: Array.from({ length: 2449 }, (_, index) => ({ id: `bulk-${index}`, value: index })),
    syncQueue: [],
    deletedEntryIds: new Set(),
  };
  let bulkCalls = 0;
  const bulkSync = global.MGSyncService.create({
    state: bulkState,
    repository: {
      async applyEntryOperations(operations) {
        bulkCalls++;
        assert.equal(operations.length, 2449);
        return operations.map((operation) => ({ ...operation.entry, updated_at: "bulk-saved" }));
      },
    },
    persist: async () => {},
    normalizeEntryIds: () => {},
  });
  bulkState.entries.forEach((entry) => bulkSync.queueUpsert(entry));
  await bulkSync.syncEntries("user");
  assert.equal(bulkCalls, 1, "2.449 alterações devem ser enviadas em um único lote");
  assert.equal(bulkState.syncQueue.length, 0);

  const raceState = {
    entries: [{ id: "race", value: 1, updated_at: "remote-v1" }],
    syncQueue: [],
    deletedEntryIds: new Set(),
  };
  let releaseUpload;
  let uploadStarted;
  const uploadStartedPromise = new Promise((resolve) => { uploadStarted = resolve; });
  const uploadGate = new Promise((resolve) => { releaseUpload = resolve; });
  const raceSync = global.MGSyncService.create({
    state: raceState,
    repository: {
      async applyEntryOperations(operations) {
        uploadStarted();
        await uploadGate;
        return operations.map((operation) => ({ ...operation.entry, updated_at: "remote-v2" }));
      },
    },
    persist: async () => {},
    normalizeEntryIds: () => {},
  });
  raceSync.queueUpsert(raceState.entries[0]);
  const firstUpload = raceSync.syncEntries("user");
  await uploadStartedPromise;
  raceState.entries[0].value = 2;
  raceSync.queueUpsert(raceState.entries[0]);
  releaseUpload();
  await firstUpload;

  assert.equal(raceState.syncQueue.length, 1, "uma edição feita durante o envio deve continuar pendente");
  assert.equal(raceState.syncQueue[0].entry.value, 2);
  assert.equal(raceState.syncQueue[0].baseUpdatedAt, "remote-v2");
  assert.equal(raceState.entries[0].updated_at, "remote-v2");

  const transient = { id: "local-only", value: 10 };
  raceSync.queueUpsert(transient);
  raceSync.queueDelete(transient.id);
  assert.equal(
    raceState.syncQueue.some((operation) => operation.id === transient.id || operation.entry?.id === transient.id),
    false,
    "criar e excluir antes do envio não deve gerar uma operação remota",
  );
  console.log("sync service tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
