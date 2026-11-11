(function attachBackupRecovery(global) {
  // Recovery is additive and local-only. Drive's current whole-document writer
  // does not provide an atomic precondition; a version GET followed by PATCH is
  // not protection against a concurrent device. Never send these records there.
  function create({ store = global.MGLocalStore, getUserId } = {}) {
    const plans = new Map();

    function checkUser(userId) {
      if (typeof userId !== "string" || !userId || (getUserId && getUserId() !== userId)) {
        throw new Error("IMPORT_USER_CHANGED");
      }
    }

    async function preview(userId, input) {
      checkUser(userId);
      const source = global.MGDocumentValidator.parseImport(input);
      const baseline = await store.load(userId, { observe: false });
      checkUser(userId);
      const data = structuredClone(baseline || { entries: [], recurrenceSeries: [], syncQueue: [] });
      const existing = new Map((data.entries || []).map(entry => [entry.id, entry]));
      (data.syncQueue || []).filter(op => op.type === "upsert").forEach(op => existing.set(op.entry.id, op.entry));
      const deleted = new Set([
        ...Object.keys(data.tombstones || {}),
        ...(data.syncQueue || []).filter(op => op.type === "delete").map(op => op.id),
      ]);
      const additions = [];
      const report = { added: 0, duplicateIds: [], conflictIds: [], deletedIds: [], detached: 0,
        ignoredSettings: true, ignoredRecurrenceSeries: (source.recurrenceSeries || []).length,
        localOnly: true, remoteSyncSupported: false };
      for (const sourceEntry of source.entries) {
        if (deleted.has(sourceEntry.id)) { report.deletedIds.push(sourceEntry.id); continue; }
        if (existing.has(sourceEntry.id)) {
          const current = existing.get(sourceEntry.id);
          const equal = Object.keys(sourceEntry).filter(key => key !== "updated_at")
            .every(key => JSON.stringify(sourceEntry[key]) === JSON.stringify(current[key]));
          (equal ? report.duplicateIds : report.conflictIds).push(sourceEntry.id);
          continue;
        }
        const entry = structuredClone(sourceEntry);
        delete entry.updated_at;
        entry.import_local_only = true;
        if (entry.series_id) {
          entry.recovery_source_series_id = entry.series_id;
          entry.series_id = null;
          entry.detached_from_series = true;
          report.detached++;
        }
        additions.push(entry);
      }
      data.entries = [...(data.entries || []), ...additions];
      data.syncQueue = [...(data.syncQueue || []), ...additions.map(entry => ({
        type: "upsert", entry: structuredClone(entry), baseUpdatedAt: null,
        localOnly: true, mutationId: global.crypto.randomUUID(),
      }))];
      report.added = additions.length;
      const previewId = global.crypto.randomUUID();
      plans.clear();
      plans.set(previewId, { userId, baseline, data, report });
      return { previewId, ...structuredClone(report) };
    }

    async function commit(userId, previewId, { confirmed = false } = {}) {
      checkUser(userId);
      if (confirmed !== true) throw new Error("IMPORT_CONFIRMATION_REQUIRED");
      const plan = plans.get(previewId);
      if (!plan || plan.userId !== userId) throw new Error("IMPORT_PREVIEW_EXPIRED");
      const data = await store.compareAndSwap(userId, plan.baseline, plan.data);
      plans.delete(previewId);
      checkUser(userId);
      return { data, ...structuredClone(plan.report) };
    }

    function discard(previewId) { plans.delete(previewId); }

    return { preview, commit, discard };
  }

  global.MGBackupRecovery = { create };
})(window);
