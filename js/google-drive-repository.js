(function attachGoogleDriveRepository(global) {
  const FILE_NAME = "meus-gastos.json";
  const ENTRY_DELTA_PREFIX = "meus-gastos-entry-";
  const BACKUP_PREFIX = "meus-gastos-backup-";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
  const REQUEST_TIMEOUT_MS = 20000;

  function emptyDocument() {
    return {
      schemaVersion: 2,
      revision: 0,
      updatedAt: new Date(0).toISOString(),
      entries: [],
      recurrenceSeries: [],
      settings: null,
      tombstones: {},
      compactedDeltas: {},
    };
  }

  function create({ getAccessToken, isAccessTokenExpired = () => false }) {
    let fileId = null;
    let document = emptyDocument();
    let legacyEntries = [];
    let loaded = false;
    let remoteVersion = null;
    const entryDeltaFiles = new Map();
    let entryDeltaIndexLoaded = false;
    let entryDeltaIndexFresh = false;
    let loadPromise = null;
    let writeChain = Promise.resolve();
    const activeControllers = new Set();
    let requestsCancelled = false;

    async function request(url, options = {}) {
      const token = getAccessToken();
      if (!token) throw new Error("GOOGLE_AUTH_REQUIRED");
      if (isAccessTokenExpired()) throw new Error("GOOGLE_AUTH_EXPIRED");
      const controller = new AbortController();
      activeControllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
        if (response.status === 401) throw new Error("GOOGLE_AUTH_EXPIRED");
        if (!response.ok) throw new Error(`GOOGLE_DRIVE_${response.status}`);
        return response;
      } catch (error) {
        if (error?.name === "AbortError") throw new Error(requestsCancelled ? "GOOGLE_DRIVE_CANCELLED" : "GOOGLE_DRIVE_TIMEOUT");
        throw error;
      } finally {
        clearTimeout(timeout);
        activeControllers.delete(controller);
      }
    }

    function escapedName(name) { return name.replace(/'/g, "\\\\'"); }

    async function listFiles(query) {
      const files = [];
      let pageToken = null;
      do {
        const params = new URLSearchParams({ spaces: "appDataFolder", q: query, fields: "files(id,name,version),nextPageToken", pageSize: "1000" });
        if (pageToken) params.set("pageToken", pageToken);
        const page = await (await request(`${API}/files?${params.toString()}`)).json();
        files.push(...(page.files || []));
        pageToken = page.nextPageToken || null;
      } while (pageToken);
      return files;
    }

    function entryDeltaName(id) { return `${ENTRY_DELTA_PREFIX}${encodeURIComponent(id)}.json`; }

    function applyEntryDelta(delta) {
      if (!delta) return;
      const index = document.entries.findIndex((entry) => entry.id === delta.id);
      const current = index >= 0 ? document.entries[index] : null;
      const currentUpdatedAt = current?.updated_at || document.tombstones?.[delta.id] || "";
      const deltaUpdatedAt = delta.updated_at || delta.entry?.updated_at || "";
      if (currentUpdatedAt && deltaUpdatedAt && currentUpdatedAt >= deltaUpdatedAt) return;
      if (delta.deleted) {
        if (index >= 0) document.entries.splice(index, 1);
        document.tombstones = { ...(document.tombstones || {}), [delta.id]: deltaUpdatedAt };
      } else if (index >= 0) document.entries[index] = delta.entry;
      else {
        document.entries.push(delta.entry);
        if (document.tombstones?.[delta.id]) delete document.tombstones[delta.id];
      }
    }

    async function readEntryDelta(file) {
      const delta = await (await request(`${API}/files/${file.id}?alt=media`)).json();
      entryDeltaFiles.set(delta.id, { ...file, delta });
      applyEntryDelta(delta);
    }

    async function loadEntryDeltas() {
      const files = (await listFiles(`name contains '${ENTRY_DELTA_PREFIX}' and trashed = false`))
        .filter((file) => file.name?.startsWith(ENTRY_DELTA_PREFIX));
      const changed = files.filter((file) => {
        const id = decodeURIComponent(file.name.slice(ENTRY_DELTA_PREFIX.length, -5));
        if (document.compactedDeltas?.[id] === file.version) {
          entryDeltaFiles.set(id, { ...file, delta: null });
          return false;
        }
        return true;
      });
      for (let index = 0; index < changed.length; index += 6) {
        await Promise.all(changed.slice(index, index + 6).map(readEntryDelta));
      }
      entryDeltaIndexLoaded = true;
      entryDeltaIndexFresh = true;
    }

    async function refreshEntryDeltaIndex({ useFreshIndex = false } = {}) {
      // `load` já confere o índice imediatamente antes de uma sincronização.
      // Reutilizamos essa verificação uma única vez para não listar os mesmos
      // arquivos duas vezes no mesmo ciclo.
      if (useFreshIndex && entryDeltaIndexFresh) {
        entryDeltaIndexFresh = false;
        return;
      }
      const files = (await listFiles(`name contains '${ENTRY_DELTA_PREFIX}' and trashed = false`))
        .filter((file) => file.name?.startsWith(ENTRY_DELTA_PREFIX));
      const ids = new Set(files.map((file) => decodeURIComponent(file.name.slice(ENTRY_DELTA_PREFIX.length, -5))));
      for (const id of entryDeltaFiles.keys()) {
        if (!ids.has(id)) entryDeltaFiles.delete(id);
      }
      const changed = files.filter((file) => {
        const id = decodeURIComponent(file.name.slice(ENTRY_DELTA_PREFIX.length, -5));
        return entryDeltaFiles.get(id)?.version !== file.version;
      });
      for (let index = 0; index < changed.length; index += 6) await Promise.all(changed.slice(index, index + 6).map(readEntryDelta));
      entryDeltaIndexLoaded = true;
      entryDeltaIndexFresh = true;
    }

    async function loadNow() {
      const files = await listFiles(`name = '${escapedName(FILE_NAME)}' and trashed = false`);
      let mainDocumentChanged = false;
      if (files.length) {
        const remoteFile = files[0];
        mainDocumentChanged = !loaded || fileId !== remoteFile.id || remoteVersion !== (remoteFile.version || null);
        fileId = remoteFile.id;
        if (mainDocumentChanged) {
          remoteVersion = remoteFile.version || null;
          document = { ...emptyDocument(), ...(await (await request(`${API}/files/${fileId}?alt=media`)).json()) };
          legacyEntries = structuredClone(document.entries);
        }
      } else {
        document = emptyDocument();
        await persist();
        legacyEntries = structuredClone(document.entries);
      }
      if (!loaded) await loadEntryDeltas();
      else {
        await refreshEntryDeltaIndex();
        // A base foi recarregada; as diferenças que não mudaram de versão
        // também precisam ser sobrepostas à nova cópia do documento.
        if (mainDocumentChanged) entryDeltaFiles.forEach(({ delta }) => applyEntryDelta(delta));
      }
      loaded = true;
      return document;
    }

    async function load() {
      if (loadPromise) return loadPromise;
      loadPromise = loadNow();
      try {
        return await loadPromise;
      } finally {
        loadPromise = null;
      }
    }

    async function persistNow() {
      if (fileId && remoteVersion) {
        const currentVersion = (await (await request(`${API}/files/${fileId}?fields=version`)).json()).version || null;
        if (currentVersion !== remoteVersion) throw new Error("GOOGLE_DRIVE_CONFLICT");
      }
      document.revision = Number(document.revision || 0) + 1;
      document.updatedAt = new Date().toISOString();
      const body = JSON.stringify(document);
      if (fileId) {
        const response = await request(`${UPLOAD_API}/files/${fileId}?uploadType=media&fields=id,version`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
        remoteVersion = (await response.json()).version || remoteVersion;
        return;
      }
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] })], { type: "application/json" }));
      form.append("file", new Blob([body], { type: "application/json" }));
      const created = await (await request(`${UPLOAD_API}/files?uploadType=multipart&fields=id,version`, { method: "POST", body: form })).json();
      fileId = created.id;
      remoteVersion = created.version || null;
    }

    function persist() { writeChain = writeChain.then(persistNow, persistNow); return writeChain; }
    async function ensureLoaded() { if (!loaded) await load(); }
    function stamped(value) { return { ...value, updated_at: new Date().toISOString() }; }

    async function findEntryDelta(id) {
      const cached = entryDeltaFiles.get(id);
      if (cached) return cached;
      // Após a carga/atualização do índice, uma ausência no Map já é uma
      // resposta definitiva. Isso evita uma busca remota por lançamento em
      // cada item novo de uma sincronização em lote.
      if (entryDeltaIndexLoaded) return null;
      const files = await listFiles(`name = '${escapedName(entryDeltaName(id))}' and trashed = false`);
      const file = files[0];
      if (!file) return null;
      await readEntryDelta(file);
      return entryDeltaFiles.get(id);
    }

    async function writeJsonFile(name, value, existingFile) {
      const body = JSON.stringify(value);
      if (existingFile) return (await request(`${UPLOAD_API}/files/${existingFile.id}?uploadType=media&fields=id,name,version`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body })).json();
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify({ name, parents: ["appDataFolder"] })], { type: "application/json" }));
      form.append("file", new Blob([body], { type: "application/json" }));
      return (await request(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name,version`, { method: "POST", body: form })).json();
    }

    function backupName() {
      return `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    }

    async function createDriveBackup(snapshot) {
      const saved = await writeJsonFile(backupName(), snapshot, null);
      return { id: saved.id, name: saved.name, version: saved.version };
    }

    async function listDriveBackups() {
      const files = await listFiles(`name contains '${BACKUP_PREFIX}' and trashed = false`);
      return files
        .filter((file) => file.name?.startsWith(BACKUP_PREFIX))
        .sort((a, b) => b.name.localeCompare(a.name));
    }

    async function fetchDriveBackup(id) {
      return (await (await request(`${API}/files/${id}?alt=media`)).json());
    }

    async function saveEntryDelta(id, value, deleted, baseUpdatedAt) {
      await ensureLoaded();
      const previous = await findEntryDelta(id);
      const current = document.entries.find((entry) => entry.id === id);
      if (baseUpdatedAt && current?.updated_at !== baseUpdatedAt) throw new Error("CONFLICT: este lançamento foi alterado em outro dispositivo.");
      const entry = deleted ? null : stamped(value);
      const delta = { id, deleted, entry, updated_at: entry?.updated_at || new Date().toISOString() };
      const savedFile = await writeJsonFile(entryDeltaName(id), delta, previous);
      entryDeltaFiles.set(id, { ...savedFile, delta });
      applyEntryDelta(delta);
      return entry;
    }

    async function upsertCollection(key, values) {
      await ensureLoaded();
      const byId = new Map(document[key].map((item) => [item.id, item]));
      const saved = values.map(stamped);
      saved.forEach((value) => byId.set(value.id, value));
      document[key] = [...byId.values()];
      await persist();
      return saved;
    }

    async function deleteWhere(key, predicate) {
      await ensureLoaded();
      if (key === "entries") {
        const operations = document.entries
          .filter(predicate)
          .map((entry) => ({ type: "delete", id: entry.id, baseUpdatedAt: entry.updated_at }));
        if (operations.length) await applyEntryOperations(operations);
        return;
      }
      document[key] = document[key].filter((item) => !predicate(item));
      await persist();
    }

    async function applyEntryOperations(operations, _userId, onProgress = () => {}) {
      await ensureLoaded();
      onProgress({ completed: 0, total: operations.length, phase: "checking" });
      await refreshEntryDeltaIndex({ useFreshIndex: true });
      const documentBeforeChanges = structuredClone(document);
      const entriesById = new Map(document.entries.map((entry) => [entry.id, entry]));

      for (const operation of operations) {
        const id = operation.type === "delete" ? operation.id : operation.entry.id;
        const current = entriesById.get(id);
        if (operation.baseUpdatedAt && current?.updated_at !== operation.baseUpdatedAt) {
          throw new Error("CONFLICT: este lançamento foi alterado em outro dispositivo.");
        }
      }

      const saved = [];
      const timestamp = new Date().toISOString();
      for (let index = 0; index < operations.length; index++) {
        const operation = operations[index];
        if (operation.type === "delete") {
          entriesById.delete(operation.id);
          document.tombstones = { ...(document.tombstones || {}), [operation.id]: timestamp };
        } else {
          const entry = { ...operation.entry, updated_at: timestamp };
          entriesById.set(entry.id, entry);
          if (document.tombstones?.[entry.id]) delete document.tombstones[entry.id];
          saved.push(entry);
        }
        onProgress({ completed: index + 1, total: operations.length, phase: "preparing" });
      }

      document.entries = [...entriesById.values()];
      document.compactedDeltas = Object.fromEntries(
        [...entryDeltaFiles.entries()].map(([id, file]) => [id, file.version]),
      );
      onProgress({ completed: 0, total: 1, phase: "sending" });
      try {
        await persist();
      } catch (error) {
        document = documentBeforeChanges;
        loaded = false;
        entryDeltaIndexFresh = false;
        throw error;
      }
      onProgress({ completed: 1, total: 1, phase: "sending" });
      return saved;
    }

    async function upsertEntries(entries) {
      return applyEntryOperations(entries.map((entry) => ({
        type: "upsert",
        entry,
        baseUpdatedAt: null,
      })));
    }

    return {
      load,
      beginSync() { requestsCancelled = false; },
      cancelPendingRequests() { requestsCancelled = true; activeControllers.forEach((controller) => controller.abort()); },
      reset() { fileId = null; remoteVersion = null; document = emptyDocument(); loaded = false; entryDeltaFiles.clear(); entryDeltaIndexLoaded = false; entryDeltaIndexFresh = false; loadPromise = null; writeChain = Promise.resolve(); activeControllers.forEach((controller) => controller.abort()); activeControllers.clear(); requestsCancelled = false; },
      async fetchEntries() { await ensureLoaded(); return structuredClone(document.entries); },
      async fetchLegacyEntries() { await ensureLoaded(); return structuredClone(legacyEntries); },
      async fetchEntryVersion(id) { await ensureLoaded(); return document.entries.find((item) => item.id === id) || null; },
      async deleteEntry(id, _userId, baseUpdatedAt = null) {
        await applyEntryOperations([{ type: "delete", id, baseUpdatedAt }]);
      },
      async upsertEntry(entry, _userId, baseUpdatedAt = null) {
        return (await applyEntryOperations([{ type: "upsert", entry, baseUpdatedAt }]))[0];
      },
      upsertEntries,
      applyEntryOperations,
      createDriveBackup,
      listDriveBackups,
      fetchDriveBackup,
      async fetchRecurrenceSeries() { await ensureLoaded(); return structuredClone(document.recurrenceSeries); },
      async replaceRecurrenceSeries(series) { await ensureLoaded(); document.recurrenceSeries = structuredClone(series || []); await persist(); },
      async upsertRecurrenceSeries(series) { return (await upsertCollection("recurrenceSeries", [series]))[0]; },
      async deleteRecurrenceSeries(id) { await deleteWhere("recurrenceSeries", (item) => item.id === id); },
      async deleteGeneratedEntries(seriesId, _userId, fromDate = null) { await deleteWhere("entries", (item) => item.series_id === seriesId && !item.detached_from_series && (!fromDate || item.scheduled_date >= fromDate)); },
      async deleteSeriesEntries(seriesId, _userId, fromDate = null) { await deleteWhere("entries", (item) => item.series_id === seriesId && (!fromDate || item.scheduled_date >= fromDate)); },
      async fetchSettings() { await ensureLoaded(); return structuredClone(document.settings); },
      async upsertSettings(_userId, settings, types, descriptions, customDescriptionOptionsByType = {}, hiddenTypes = [], hiddenDescriptionsByType = {}) {
        await ensureLoaded();
        document.settings = { ...settings, types, descriptions, customDescriptionOptionsByType, hiddenTypes, hiddenDescriptionsByType, updated_at: new Date().toISOString() };
        await persist();
      },
    };
  }

  global.MGGoogleDriveRepository = { create };
})(window);
