(function attachLocalStore(global) {
  const DATABASE_NAME = "meus-gastos";
  const STORE_NAME = "user-data";
  const DATABASE_VERSION = 1;
  // Format of the record kept on this device. Records written before the
  // field existed have the same shape as version 1. Bump it with a migration
  // in upgrade() whenever the stored shape changes.
  const LOCAL_SCHEMA_VERSION = 1;
  let databasePromise = null;
  let writeChain = Promise.resolve();
  const observed = new Map();

  const isRecord = (value) => value !== null && typeof value === "object";
  const isNewer = (record) => isRecord(record) && Number(record.schemaVersion) > LOCAL_SCHEMA_VERSION;

  // A record from a newer app version is never read nor overwritten by this
  // one: an older cached tab must not reinterpret or replace that data.
  function upgrade(record) {
    if (!isRecord(record)) return record;
    if (isNewer(record)) throw new Error("LOCAL_STORE_NEWER_SCHEMA");
    return record.schemaVersion === LOCAL_SCHEMA_VERSION ? record : { ...record, schemaVersion: LOCAL_SCHEMA_VERSION };
  }

  function stamp(record) {
    return isRecord(record) ? { ...record, schemaVersion: LOCAL_SCHEMA_VERSION } : record;
  }

  // Compare-and-swap looks at the data, not at the version stamp, so a legacy
  // record still matches the upgraded copy that load() handed out.
  function sameContent(current, baseline) {
    const content = (record) => {
      if (!isRecord(record)) return record;
      const { schemaVersion, ...rest } = record;
      return rest;
    };
    return JSON.stringify(content(current)) === JSON.stringify(content(baseline));
  }

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
    const value = upgrade(await run("readonly", (store) => store.get(userId)));
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
    const snapshot = stamp(structuredClone(replacement));
    const pendingWrite = async () => {
      const database = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        let failure = null;
        const request = store.get(userId);
        request.onsuccess = () => {
          if (isNewer(request.result)) {
            failure = new Error("LOCAL_STORE_NEWER_SCHEMA");
            transaction.abort();
            return;
          }
          if (!sameContent(request.result, useObserved ? observed.get(userId) : baseline)) {
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

  // Moves a profile between keys in ONE transaction. Both current records must
  // still match what the caller previewed; the target write and the source
  // delete commit together or not at all. `replacement === undefined` keeps
  // the target untouched and only deletes the source.
  function transfer(fromId, expectedFrom, toId, expectedTo, replacement) {
    const baselineFrom = structuredClone(expectedFrom);
    const baselineTo = structuredClone(expectedTo);
    const snapshot = replacement === undefined ? undefined : stamp(structuredClone(replacement));
    const pendingWrite = async () => {
      const database = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        let failure = null;
        const conflict = (code = "LOCAL_STORE_CONFLICT") => {
          failure = new Error(code);
          transaction.abort();
        };
        const fromRequest = store.get(fromId);
        fromRequest.onsuccess = () => {
          if (isNewer(fromRequest.result)) return conflict("LOCAL_STORE_NEWER_SCHEMA");
          if (!sameContent(fromRequest.result, baselineFrom)) return conflict();
          const toRequest = store.get(toId);
          toRequest.onsuccess = () => {
            if (isNewer(toRequest.result)) return conflict("LOCAL_STORE_NEWER_SCHEMA");
            if (!sameContent(toRequest.result, baselineTo)) return conflict();
            if (snapshot !== undefined) store.put(snapshot, toId);
            store.delete(fromId);
          };
        };
        transaction.oncomplete = () => {
          observed.delete(fromId);
          if (snapshot !== undefined) observed.set(toId, structuredClone(snapshot));
          resolve(structuredClone(snapshot));
        };
        transaction.onerror = () => reject(failure || transaction.error || new Error("INDEXED_DB_TRANSACTION_ABORTED"));
        transaction.onabort = () => reject(failure || transaction.error || new Error("INDEXED_DB_TRANSACTION_ABORTED"));
      });
    };
    writeChain = writeChain.then(pendingWrite, pendingWrite);
    return writeChain;
  }

  async function remove(userId) {
    const result = await runWrite((store) => store.delete(userId));
    // The record is gone; a stale observed snapshot would fail the next save().
    observed.delete(userId);
    return result;
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

  global.MGLocalStore = { LOCAL_SCHEMA_VERSION, load, save, compareAndSwap, transfer, remove, clearLegacyCache, requestPersistence };
})(window);
