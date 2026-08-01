(function attachSyncService(global) {
  function create({ state, repository, persist, normalizeEntryIds }) {
    function queueUpsert(entry) {
      const previous = state.syncQueue.find((operation) => operation.type === "upsert" && operation.entry.id === entry.id);
      state.syncQueue = state.syncQueue.filter((operation) => operation.type !== "upsert" || operation.entry.id !== entry.id);
      state.syncQueue = state.syncQueue.filter((operation) => operation.type !== "delete" || operation.id !== entry.id);
      state.syncQueue.push({ type: "upsert", entry: { ...entry }, baseUpdatedAt: previous?.baseUpdatedAt ?? entry.updated_at ?? null });
    }

    function queueDelete(id, baseUpdatedAt = null) {
      state.syncQueue = state.syncQueue.filter((operation) => !(operation.type === "upsert" && operation.entry.id === id));
      if (!state.syncQueue.some((operation) => operation.type === "delete" && operation.id === id)) {
        state.syncQueue.push({ type: "delete", id, baseUpdatedAt });
      }
      state.deletedEntryIds.add(id);
    }

    async function ensureUnchanged(id, baseUpdatedAt) {
      if (!baseUpdatedAt) return;
      const remote = await repository.fetchEntryVersion(id);
      if (remote && remote.updated_at !== baseUpdatedAt) {
        throw new Error("CONFLICT: este lançamento foi alterado em outro dispositivo.");
      }
    }

    async function syncEntries(userId) {
      normalizeEntryIds();
      while (state.syncQueue.length) {
        const operation = state.syncQueue[0];
        if (operation.type === "delete") {
          await ensureUnchanged(operation.id, operation.baseUpdatedAt);
          await repository.deleteEntry(operation.id, userId);
          state.deletedEntryIds.delete(operation.id);
        } else {
          await ensureUnchanged(operation.entry.id, operation.baseUpdatedAt);
          const saved = await repository.upsertEntry(operation.entry, userId);
          const entry = state.entries.find((item) => item.id === saved.id);
          if (entry) entry.updated_at = saved.updated_at;
        }
        state.syncQueue.shift();
        persist();
      }
    }

    return { queueUpsert, queueDelete, syncEntries };
  }

  global.MGSyncService = { create };
})(window);
