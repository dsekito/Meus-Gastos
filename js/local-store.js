(function attachLocalStore(global) {
  const DATABASE_NAME = "meus-gastos";
  const STORE_NAME = "user-data";
  const DATABASE_VERSION = 1;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function run(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function load(userId) {
    return run("readonly", (store) => store.get(userId));
  }

  function save(userId, data) {
    return run("readwrite", (store) => store.put(data, userId));
  }

  function remove(userId) {
    return run("readwrite", (store) => store.delete(userId));
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
