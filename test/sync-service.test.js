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
  console.log("sync service tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
