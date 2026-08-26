(function attachLocalStore(global) {
  const DATABASE_NAME = "meus-gastos";
  const STORE_NAME = "user-data";
  const DATABASE_VERSION = 1;
  let databasePromise = null;
  let writeChain = Promise.resolve();

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

  function load(userId) {
    return run("readonly", (store) => store.get(userId));
  }

  function save(userId, data) {
    const snapshot = structuredClone(data);
    return runWrite((store) => store.put(snapshot, userId));
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

  global.MGLocalStore = { load, save, remove, clearLegacyCache, requestPersistence };
})(window);
