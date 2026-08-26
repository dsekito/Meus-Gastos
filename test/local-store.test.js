const assert = require("node:assert/strict");

global.window = global;

const pendingCompletions = [];
const writes = [];
let abortNextWrite = false;
const database = {
  objectStoreNames: { contains: () => true },
  createObjectStore() {},
  close() {},
  transaction() {
    const transaction = {
      objectStore() {
        return {
          get() { throw new Error("get não esperado neste teste"); },
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

  console.log("local store tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
