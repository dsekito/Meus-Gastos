(function attachSyncService(global) {
  function create({ state, repository, persist, normalizeEntryIds, onProgress = () => {} }) {
    function createMutationId() {
      return global.crypto?.randomUUID?.()
        || `mutation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function ensureMutationIds() {
      state.syncQueue.forEach((operation) => {
        if (!operation.mutationId) operation.mutationId = createMutationId();
      });
    }

    function queueUpsert(entry) {
      const previous = state.syncQueue.find((operation) => operation.type === "upsert" && operation.entry.id === entry.id);
      state.syncQueue = state.syncQueue.filter((operation) => operation.type !== "upsert" || operation.entry.id !== entry.id);
      state.syncQueue = state.syncQueue.filter((operation) => operation.type !== "delete" || operation.id !== entry.id);
      state.syncQueue.push({
        type: "upsert",
        entry: { ...entry },
        baseUpdatedAt: previous?.baseUpdatedAt ?? entry.updated_at ?? null,
        mutationId: createMutationId(),
      });
    }

    function queueDelete(id, baseUpdatedAt = null) {
      const pendingUpsert = state.syncQueue.find((operation) =>
        operation.type === "upsert" && operation.entry.id === id,
      );
      state.syncQueue = state.syncQueue.filter((operation) => !(operation.type === "upsert" && operation.entry.id === id));
      if (pendingUpsert && !pendingUpsert.baseUpdatedAt && !baseUpdatedAt) {
        state.deletedEntryIds.delete(id);
        return;
      }
      if (!state.syncQueue.some((operation) => operation.type === "delete" && operation.id === id)) {
        state.syncQueue.push({ type: "delete", id, baseUpdatedAt, mutationId: createMutationId() });
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
      ensureMutationIds();
      if (state.syncQueue.length && repository.applyEntryOperations) {
        const operations = state.syncQueue.map((operation) =>
          operation.type === "delete"
            ? { ...operation }
            : { ...operation, entry: { ...operation.entry } },
        );
        onProgress({ completed: 0, total: operations.length });
        const saved = await repository.applyEntryOperations(operations, userId, onProgress);
        const versions = new Map(saved.map((entry) => [entry.id, entry.updated_at]));
        for (const operation of operations) {
          if (operation.type === "delete") {
            const stillPending = state.syncQueue.some((pending) =>
              pending.mutationId !== operation.mutationId
              && (pending.id === operation.id || pending.entry?.id === operation.id),
            );
            if (!stillPending) state.deletedEntryIds.delete(operation.id);
            continue;
          }
          const entry = state.entries.find((item) => item.id === operation.entry.id);
          const savedVersion = versions.get(operation.entry.id);
          if (entry && savedVersion) entry.updated_at = savedVersion;
          state.syncQueue.forEach((pending) => {
            const pendingId = pending.id || pending.entry?.id;
            if (pending.mutationId === operation.mutationId || pendingId !== operation.entry.id || !savedVersion) return;
            pending.baseUpdatedAt = savedVersion;
            if (pending.entry) pending.entry.updated_at = savedVersion;
          });
        }
        const confirmed = new Set(operations.map((operation) => operation.mutationId));
        state.syncQueue = state.syncQueue.filter((operation) => !confirmed.has(operation.mutationId));
        await persist();
        onProgress({ completed: operations.length, total: operations.length });
        return;
      }
      while (state.syncQueue.length) {
        const operation = state.syncQueue[0];
        if (operation.type === "delete") {
          await ensureUnchanged(operation.id, operation.baseUpdatedAt);
          await repository.deleteEntry(operation.id, userId);
          const stillPending = state.syncQueue.some((pending) =>
            pending.mutationId !== operation.mutationId
            && (pending.id === operation.id || pending.entry?.id === operation.id),
          );
          if (!stillPending) state.deletedEntryIds.delete(operation.id);
        } else {
          await ensureUnchanged(operation.entry.id, operation.baseUpdatedAt);
          const saved = await repository.upsertEntry(operation.entry, userId);
          const entry = state.entries.find((item) => item.id === saved.id);
          if (entry) entry.updated_at = saved.updated_at;
          state.syncQueue.forEach((pending) => {
            const pendingId = pending.id || pending.entry?.id;
            if (pending.mutationId === operation.mutationId || pendingId !== saved.id) return;
            pending.baseUpdatedAt = saved.updated_at;
            if (pending.entry) pending.entry.updated_at = saved.updated_at;
          });
        }
        state.syncQueue = state.syncQueue.filter((pending) => pending.mutationId !== operation.mutationId);
        await persist();
      }
    }

    return { queueUpsert, queueDelete, syncEntries };
  }

  global.MGSyncService = { create };
})(window);
