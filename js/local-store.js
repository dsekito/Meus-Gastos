(function attachLocalStore(global) {
  const names = ["types", "desc", "entries", "settings", "sync-queue"];

  function key(name, userId) {
    return userId ? `mg-${name}:${userId}` : null;
  }

  function read(name, userId, fallback) {
    const storageKey = key(name, userId);
    if (!storageKey) return fallback;
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "null") ?? fallback;
    } catch {
      return fallback;
    }
  }

  function save(userId, snapshot) {
    if (!userId) return;
    localStorage.setItem(key("types", userId), JSON.stringify(snapshot.types));
    localStorage.setItem(key("desc", userId), JSON.stringify(snapshot.descriptions));
    localStorage.setItem(key("entries", userId), JSON.stringify(snapshot.entries));
    localStorage.setItem(key("settings", userId), JSON.stringify(snapshot.settings));
    localStorage.setItem(key("sync-queue", userId), JSON.stringify(snapshot.syncQueue));
  }

  function clear(userId) {
    names.forEach((name) => localStorage.removeItem(key(name, userId)));
  }

  global.MGLocalStore = { key, read, save, clear };
})(window);
