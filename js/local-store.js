(function attachLocalStore(global) {
  const DATABASE_NAME = "meus-gastos";
  const STORE_NAME = "user-data";
  const DATABASE_VERSION = 1;
  let databasePromise = null;
  let writeChain = Promise.resolve();
  const observed = new Map();

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        databasePromise = null;
        reject(request.error);
      };
    });
    return databasePromise;
  }

  async function run(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      let request;
      try {
        request = operation(store);
      } catch (error) {
        reject(error);
        return;
      }
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("INDEXED_DB_TRANSACTION_ABORTED"));
    });
  }

  function runWrite(operation) {
    const pendingWrite = () => run("readwrite", operation);
    writeChain = writeChain.then(pendingWrite, pendingWrite);
    return writeChain;
  }

  async function load(userId, { observe = true } = {}) {
    const value = await run("readonly", (store) => store.get(userId));
    if (observe) observed.set(userId, structuredClone(value));
    return value;
  }

  function save(userId, data) {
    return writeConditional(userId, undefined, data, true);
  }

  // The read and conditional put share ONE IndexedDB transaction. A separate
  // load()+save() is not a compare-and-swap, even with a per-tab promise chain.
  function writeConditional(userId, expected, replacement, useObserved = false) {
    const baseline = structuredClone(expected);
    const snapshot = structuredClone(replacement);
    const pendingWrite = async () => {
      const database = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        let failure = null;
        const request = store.get(userId);
        request.onsuccess = () => {
          if (JSON.stringify(request.result) !== JSON.stringify(useObserved ? observed.get(userId) : baseline)) {
            failure = new Error("LOCAL_STORE_CONFLICT");
            transaction.abort();
            return;
          }
          store.put(snapshot, userId);
        };
        transaction.oncomplete = () => {
          observed.set(userId, structuredClone(snapshot));
          resolve(structuredClone(snapshot));
        };
        transaction.onerror = () => reject(failure || transaction.error || new Error("INDEXED_DB_TRANSACTION_ABORTED"));
        transaction.onabort = () => reject(failure || transaction.error || new Error("INDEXED_DB_TRANSACTION_ABORTED"));
      });
    };
    writeChain = writeChain.then(pendingWrite, pendingWrite);
    return writeChain;
  }

  function compareAndSwap(userId, expected, replacement) {
    return writeConditional(userId, expected, replacement);
  }

  function remove(userId) {
    return runWrite((store) => store.delete(userId));
  }

  function clearLegacyCache() {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const storageKey = localStorage.key(index);
      if (storageKey && storageKey.startsWith("mg-")) localStorage.removeItem(storageKey);
    }
  }

  async function requestPersistence() {
    if (!global.navigator?.storage?.persist) return false;
    try {
      return await global.navigator.storage.persist();
    } catch (error) {
      console.warn("Não foi possível solicitar armazenamento persistente.", error);
      return false;
    }
  }

  global.MGLocalStore = { load, save, compareAndSwap, remove, clearLegacyCache, requestPersistence };
})(window);
