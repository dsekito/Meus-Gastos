const assert = require("node:assert/strict");

global.window = global;

const pendingCompletions = [];
const writes = [];
const records = new Map();
let abortNextWrite = false;
const database = {
  objectStoreNames: { contains: () => true },
  createObjectStore() {},
  close() {},
  transaction(name, mode) {
    const transaction = {
      abort() { queueMicrotask(() => transaction.onabort?.()); },
      objectStore() {
        return {
          get(key) {
            const request = {};
            queueMicrotask(() => {
              request.result = structuredClone(records.get(key));
              request.onsuccess?.();
              if (mode === "readonly") transaction.oncomplete?.();
            });
            return request;
          },
          put(value, key) {
            writes.push({ value, key });
            const request = {};
            queueMicrotask(() => {
              request.result = key;
              request.onsuccess?.();
              pendingCompletions.push(() => {
                if (abortNextWrite) {
                  abortNextWrite = false;
                  transaction.error = new Error("quota exceeded");
                  transaction.onabort?.();
                } else {
                  records.set(key, structuredClone(value));
                  transaction.oncomplete?.();
                }
              });
            });
            return request;
          },
          delete() { throw new Error("delete não esperado neste teste"); },
        };
      },
    };
    return transaction;
  },
};

global.indexedDB = {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = database;
      request.onsuccess?.();
    });
    return request;
  },
};

require("../js/local-store.js");

// A promise left pending ends the process quietly; that must not count as a pass.
let finished = false;
process.on("exit", () => {
  if (!finished) {
    console.error("local store tests: ended before finishing");
    process.exitCode = 1;
  }
});

(async () => {
  const source = { entries: [{ id: "one", value: 1 }] };
  let firstResolved = false;
  const firstSave = global.MGLocalStore.save("user", source).then(() => { firstResolved = true; });
  source.entries[0].value = 99;
  const secondSave = global.MGLocalStore.save("user", { entries: [{ id: "two", value: 2 }] });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(firstResolved, false, "save deve aguardar o commit da transação");
  assert.equal(writes.length, 1, "gravações concorrentes devem ser serializadas");
  assert.equal(writes[0].value.entries[0].value, 1, "o snapshot deve ser capturado no momento de save");

  pendingCompletions.shift()();
  await firstSave;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 2);
  pendingCompletions.shift()();
  await secondSave;

  abortNextWrite = true;
  const failedSave = global.MGLocalStore.save("user", { entries: [{ id: "three", value: 3 }] });
  await new Promise((resolve) => setImmediate(resolve));
  pendingCompletions.shift()();
  await assert.rejects(failedSave, /quota exceeded/, "uma transação abortada não pode confirmar o salvamento");

  // Every write carries the local format version.
  assert.equal(writes.at(-1).value.schemaVersion, global.MGLocalStore.LOCAL_SCHEMA_VERSION);

  // A record written before versioning reads as version 1 and can be saved over.
  records.set("legacy", { entries: [{ id: "old", value: 5 }] });
  const legacy = await global.MGLocalStore.load("legacy");
  assert.equal(legacy.schemaVersion, 1);
  assert.deepEqual(legacy.entries, [{ id: "old", value: 5 }]);
  const legacySave = global.MGLocalStore.save("legacy", { ...legacy, entries: [] });
  await new Promise((resolve) => setImmediate(resolve));
  pendingCompletions.shift()();
  await legacySave;
  assert.deepEqual(records.get("legacy"), { entries: [], schemaVersion: 1 });

  // A compare-and-swap baseline without the stamp still matches a stamped record.
  const swap = global.MGLocalStore.compareAndSwap("legacy", { entries: [] }, { entries: [{ id: "new" }] });
  await new Promise((resolve) => setImmediate(resolve));
  pendingCompletions.shift()();
  await swap;
  assert.deepEqual(records.get("legacy").entries, [{ id: "new" }]);

  // Data from a newer app version is neither read nor overwritten.
  const newer = { entries: [{ id: "future" }], schemaVersion: 99 };
  records.set("newer", structuredClone(newer));
  await assert.rejects(global.MGLocalStore.load("newer"), /LOCAL_STORE_NEWER_SCHEMA/);
  const writesBefore = writes.length;
  await assert.rejects(global.MGLocalStore.save("newer", { entries: [] }), /LOCAL_STORE_NEWER_SCHEMA/);
  await assert.rejects(global.MGLocalStore.compareAndSwap("newer", newer, { entries: [] }), /LOCAL_STORE_NEWER_SCHEMA/);
  assert.equal(writes.length, writesBefore);
  assert.deepEqual(records.get("newer"), newer);

  finished = true;
  console.log("local store tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
