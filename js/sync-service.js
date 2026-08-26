(function attachSyncService(global) {
  function create({ state, repository, persist, normalizeEntryIds, onProgress = () => {} }) {
    let queueIndexReference = null;
    let queueIndexLength = -1;
    let queuedByEntryId = new Map();

    function createMutationId() {
      return global.crypto?.randomUUID?.()
        || `mutation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function ensureMutationIds() {
      state.syncQueue.forEach((operation) => {
        if (!operation.mutationId) operation.mutationId = createMutationId();
      });
    }

    function ensureQueueIndex() {
      if (queueIndexReference === state.syncQueue && queueIndexLength === state.syncQueue.length) return;
      queuedByEntryId = new Map();
      state.syncQueue.forEach((operation, index) => {
        const id = operation.type === "delete" ? operation.id : operation.entry.id;
        queuedByEntryId.set(id, { operation, index });
      });
      queueIndexReference = state.syncQueue;
      queueIndexLength = state.syncQueue.length;
    }

    function setQueueOperation(id, operation) {
      ensureQueueIndex();
      const queued = queuedByEntryId.get(id);
      if (queued) state.syncQueue[queued.index] = operation;
      else state.syncQueue.push(operation);
      queueIndexReference = state.syncQueue;
      queueIndexLength = state.syncQueue.length;
      queuedByEntryId.set(id, { operation, index: queued?.index ?? state.syncQueue.length - 1 });
    }

    function removeQueueOperation(id) {
      ensureQueueIndex();
      const queued = queuedByEntryId.get(id);
      if (!queued) return;
      state.syncQueue.splice(queued.index, 1);
      queueIndexReference = null;
      ensureQueueIndex();
    }

    function queueUpsert(entry) {
      ensureQueueIndex();
      const previous = queuedByEntryId.get(entry.id)?.operation;
      setQueueOperation(entry.id, {
        type: "upsert",
        entry: { ...entry },
        baseUpdatedAt: previous?.type === "upsert"
          ? previous.baseUpdatedAt ?? entry.updated_at ?? null
          : entry.updated_at ?? null,
        mutationId: createMutationId(),
      });
    }

    function queueDelete(id, baseUpdatedAt = null) {
      ensureQueueIndex();
      const queued = queuedByEntryId.get(id)?.operation;
      const pendingUpsert = queued?.type === "upsert" ? queued : null;
      if (pendingUpsert && !pendingUpsert.baseUpdatedAt && !baseUpdatedAt) {
        removeQueueOperation(id);
        state.deletedEntryIds.delete(id);
        return;
      }
      if (queued?.type !== "delete") {
        setQueueOperation(id, {
          type: "delete",
          id,
          baseUpdatedAt: baseUpdatedAt ?? pendingUpsert?.baseUpdatedAt ?? null,
          mutationId: createMutationId(),
        });
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
        const entriesById = new Map(state.entries.map((entry) => [entry.id, entry]));
        const pendingById = new Map();
        state.syncQueue.forEach((pending) => {
          const pendingId = pending.id || pending.entry?.id;
          if (!pendingById.has(pendingId)) pendingById.set(pendingId, []);
          pendingById.get(pendingId).push(pending);
        });
        for (const operation of operations) {
          const operationId = operation.type === "delete" ? operation.id : operation.entry.id;
          const laterOperations = (pendingById.get(operationId) || [])
            .filter((pending) => pending.mutationId !== operation.mutationId);
          if (operation.type === "delete") {
            if (!laterOperations.length) state.deletedEntryIds.delete(operation.id);
            continue;
          }
          const entry = entriesById.get(operation.entry.id);
          const savedVersion = versions.get(operation.entry.id);
          if (entry && savedVersion) entry.updated_at = savedVersion;
          laterOperations.forEach((pending) => {
            if (!savedVersion) return;
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
