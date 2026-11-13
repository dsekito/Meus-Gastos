(function attachLocalProfile(global) {
  // Perfil usado sem conta Google. Guarda só um identificador estável; nenhum
  // token ou dado pessoal. Os dados financeiros ficam no IndexedDB sob esse id.
  const PROFILE_KEY = "meus-gastos-local-profile";
  const ID_PREFIX = "local:";
  const ID_PATTERN = /^local:[0-9a-f-]{36}$/i;
  const CHOICES = new Set(["device", "drive", "cancel"]);

  function isLocalId(id) {
    return typeof id === "string" && ID_PATTERN.test(id);
  }

  function isLocalUser(user) {
    return isLocalId(user?.id);
  }

  function toUser(profile) {
    return { id: profile.id, local: true, email: "", user_metadata: { full_name: "Neste aparelho" } };
  }

  function restore(storage = global.localStorage) {
    try {
      const saved = JSON.parse(storage?.getItem(PROFILE_KEY) || "null");
      return isLocalId(saved?.id) ? toUser(saved) : null;
    } catch (error) {
      console.warn("Não foi possível restaurar o perfil local.", error);
      return null;
    }
  }

  // Reuses an existing profile: choosing "local" twice must never orphan data.
  // Throws when the browser refuses storage, so the caller can tell the person.
  function create(storage = global.localStorage, randomUUID = () => global.crypto.randomUUID()) {
    const existing = restore(storage);
    if (existing) return existing;
    const profile = { id: `${ID_PREFIX}${randomUUID()}`, created_at: new Date().toISOString() };
    if (!isLocalId(profile.id)) throw new Error("LOCAL_PROFILE_INVALID_ID");
    storage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return toUser(profile);
  }

  function forget(storage = global.localStorage) {
    try {
      storage?.removeItem(PROFILE_KEY);
      return true;
    } catch (error) {
      console.warn("Não foi possível remover o perfil local.", error);
      return false;
    }
  }

  // A Google session next to a local profile means a migration that did not
  // finish. The local profile wins: its data has not been moved yet.
  function resolveStartupUser({ googleUser = null, localUser = null } = {}) {
    if (localUser) return { user: localUser, forgetGoogleSession: !!googleUser };
    return { user: googleUser, forgetGoogleSession: false };
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function hasDeviceData(record) {
    if (!record) return false;
    return list(record.entries).length > 0
      || list(record.recurrenceSeries).length > 0
      || Math.round(Number(record.settings?.current_balance || 0) * 100) !== 0;
  }

  // Conservative on purpose: any trace of a previous use of the account counts
  // as data, so it is never replaced without an explicit choice.
  function hasAccountData(record) {
    if (!record) return false;
    return list(record.entries).length > 0
      || list(record.recurrenceSeries).length > 0
      || list(record.syncQueue).length > 0
      || record.settings != null;
  }

  function summarize(local, target, remote) {
    const accountIds = new Set([...list(remote?.entries), ...list(target?.entries)].map((entry) => entry.id));
    return {
      deviceEntries: list(local?.entries).length,
      deviceSeries: list(local?.recurrenceSeries).length,
      accountEntries: accountIds.size,
      accountSeries: Math.max(list(remote?.recurrenceSeries).length, list(target?.recurrenceSeries).length),
    };
  }

  async function planMigration({ store, localId, googleId, readRemote }) {
    if (!isLocalId(localId) || typeof googleId !== "string" || !googleId || isLocalId(googleId)) {
      throw new Error("LOCAL_MIGRATION_INVALID_IDS");
    }
    const local = await store.load(localId, { observe: false });
    const target = await store.load(googleId, { observe: false });
    if (!hasDeviceData(local)) {
      return { kind: "empty", localId, googleId, local, target, remote: null, summary: summarize(local, target, null) };
    }
    // Never migrate blind: if the Drive cannot be read, nothing moves.
    const remote = await readRemote();
    const kind = hasAccountData(target) || hasAccountData(remote) ? "conflict" : "move";
    return { kind, localId, googleId, local, target, remote, summary: summarize(local, target, remote) };
  }

  // Every local entry becomes an upsert without a base version: they were never
  // on the Drive. Entries only on the Drive are deleted, because the person
  // chose to keep exactly what is on this device.
  function buildMigratedRecord(local, { replaceEntryIds = [], now = new Date().toISOString(),
    createMutationId = () => global.crypto.randomUUID() } = {}) {
    const record = structuredClone(local);
    const entries = list(record.entries);
    const localIds = new Set(entries.map((entry) => entry.id));
    const upserts = entries.map((entry) => ({
      type: "upsert",
      ...(entry.import_local_only ? { localOnly: true } : {}),
      entry: structuredClone(entry),
      baseUpdatedAt: null,
      mutationId: createMutationId(),
    }));
    const deletes = [...new Set(replaceEntryIds)].filter((id) => !localIds.has(id)).map((id) => ({
      type: "delete", id, baseUpdatedAt: null, mutationId: createMutationId(),
    }));
    record.entries = entries;
    record.recurrenceSeries = list(record.recurrenceSeries);
    record.syncQueue = [...upserts, ...deletes];
    record.settingsDirty = true;
    record.recurrenceDirty = true;
    record.lastSyncedAt = null;
    record.syncConflict = null;
    delete record.syncDiagnostics;
    record.savedAt = now;
    return record;
  }

  async function commitMigration({ store, plan, choice = null, now, createMutationId }) {
    if (plan.kind === "conflict" && !CHOICES.has(choice)) throw new Error("LOCAL_MIGRATION_CHOICE_REQUIRED");
    if (choice === "cancel") return { status: "cancelled", choice };
    const resolved = plan.kind === "empty" ? "drive" : plan.kind === "move" ? "device" : choice;
    const replacement = resolved === "device"
      ? buildMigratedRecord(plan.local, {
        replaceEntryIds: list(plan.remote?.entries).map((entry) => entry.id), now, createMutationId,
      })
      : undefined;
    // Atomic: the local profile is deleted only in the same committed
    // transaction that wrote (or confirmed) the account record.
    await store.transfer(plan.localId, plan.local, plan.googleId, plan.target, replacement);
    return { status: "migrated", choice: resolved, record: replacement };
  }

  global.MGLocalProfile = {
    PROFILE_KEY,
    isLocalId,
    isLocalUser,
    restore,
    create,
    forget,
    resolveStartupUser,
    hasDeviceData,
    hasAccountData,
    planMigration,
    buildMigratedRecord,
    commitMigration,
  };
})(window);
