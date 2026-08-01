(function attachLocalStore(global) {
  function clearLegacyCache() {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const storageKey = localStorage.key(index);
      if (storageKey && storageKey.startsWith("mg-")) {
        localStorage.removeItem(storageKey);
      }
    }
  }

  global.MGLocalStore = { clearLegacyCache };
})(window);
