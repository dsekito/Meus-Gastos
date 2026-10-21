(function attachGoogleDriveRepository(global) {
  const FILE_NAME = "meus-gastos.json";
  const ENTRY_DELTA_PREFIX = "meus-gastos-entry-";
  const BACKUP_PREFIX = "meus-gastos-backup-";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
  const REQUEST_TIMEOUT_MS = 20000;
  const MAX_RETRY_ATTEMPTS = 2;
  const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
  const validator = global.MGDocumentValidator;

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

  function create({ getAccessToken, isAccessTokenExpired = () => false, requestTimeoutMs = REQUEST_TIMEOUT_MS }) {
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
    let mutationChain = Promise.resolve();
    let sessionGeneration = 0;
    const activeControllers = new Set();
    let requestsCancelled = false;
    let documentSizeBytes = 0;
    let lastValidatedAt = null;

    if (!validator) throw new Error("DOCUMENT_VALIDATOR_REQUIRED");

    function textSize(value) {
      return new TextEncoder().encode(value).byteLength;
    }

    async function readValidatedJson(response, validate) {
      const text = await response.text();
      let value;
      try {
        value = JSON.parse(text);
      } catch (error) {
        validate(null);
      }
      validate(value);
      return { value, sizeBytes: textSize(text) };
    }

    function retryDelay(attempt, retryAfter = null) {
      const retryAfterSeconds = retryAfter == null || retryAfter === "" ? NaN : Number(retryAfter);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
        return Math.min(retryAfterSeconds * 1000, 10000);
      }
      return (300 * (2 ** attempt)) + Math.floor(Math.random() * 250);
    }

    function wait(milliseconds) {
      if (requestsCancelled) return Promise.reject(new Error("GOOGLE_DRIVE_CANCELLED"));
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        activeControllers.add(controller);
        const cleanup = () => { clearTimeout(timer); activeControllers.delete(controller); };
        const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
        controller.signal.addEventListener("abort", () => {
          cleanup(); reject(new Error("GOOGLE_DRIVE_CANCELLED"));
        }, { once: true });
      });
    }

    async function request(url, options = {}) {
      const method = (options.method || "GET").toUpperCase();
      const generation = sessionGeneration;
      for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
        const token = getAccessToken();
        if (!token) throw new Error("GOOGLE_AUTH_REQUIRED");
        if (isAccessTokenExpired()) throw new Error("GOOGLE_AUTH_EXPIRED");
        if (requestsCancelled || generation !== sessionGeneration) throw new Error("GOOGLE_DRIVE_CANCELLED");

        const controller = new AbortController();
        activeControllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
        let failure = null;
        let retryAfter = null;
        try {
          const response = await fetch(url, { ...options, signal: controller.signal, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
          if (response.status === 401) throw new Error("GOOGLE_AUTH_EXPIRED");
          if (response.ok) {
            // Keep timeout/cancellation active until the complete body arrives.
            const body = await response.arrayBuffer();
            if (generation !== sessionGeneration) throw new Error("GOOGLE_DRIVE_CANCELLED");
            return new Response([204, 205].includes(response.status) ? null : body, {
              status: response.status, statusText: response.statusText, headers: response.headers,
            });
          }
          failure = new Error(`GOOGLE_DRIVE_${response.status}`);
          failure.retryable = RETRYABLE_STATUS.has(response.status) && method !== "POST";
          retryAfter = response.headers.get("Retry-After");
        } catch (error) {
          if (error?.name === "AbortError") {
            failure = new Error(requestsCancelled || generation !== sessionGeneration ? "GOOGLE_DRIVE_CANCELLED" : "GOOGLE_DRIVE_TIMEOUT");
            failure.retryable = !requestsCancelled && ["GET", "HEAD"].includes(method);
          } else {
            failure = error;
            // Uma falha de rede após POST/PATCH pode ter ocorrido depois de o
            // Drive gravar o conteúdo. Só GET/HEAD são repetidos nesse caso.
            failure.retryable = failure.retryable || (["GET", "HEAD"].includes(method) && error instanceof TypeError);
          }
        } finally {
          clearTimeout(timeout);
          activeControllers.delete(controller);
        }

        if (!failure?.retryable || attempt === MAX_RETRY_ATTEMPTS) throw failure;
        await wait(retryDelay(attempt, retryAfter));
      }
      throw new Error("GOOGLE_DRIVE_REQUEST_FAILED");
    }

    function escapedName(name) { return name.replace(/'/g, "\\\\'"); }

    async function listFiles(query) {
      const generation = sessionGeneration;
      const files = [];
      let pageToken = null;
      do {
        const params = new URLSearchParams({ spaces: "appDataFolder", q: query, fields: "files(id,name,version),nextPageToken", pageSize: "1000" });
        if (pageToken) params.set("pageToken", pageToken);
        const page = await (await request(`${API}/files?${params.toString()}`)).json();
        if (generation !== sessionGeneration) throw new Error("GOOGLE_DRIVE_CANCELLED");
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
      const generation = sessionGeneration;
      const { value: delta } = await readValidatedJson(
        await request(`${API}/files/${file.id}?alt=media`),
        validator.validateEntryDelta,
      );
      if (generation !== sessionGeneration) throw new Error("GOOGLE_DRIVE_CANCELLED");
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
      const generation = sessionGeneration;
      const files = await listFiles(`name = '${escapedName(FILE_NAME)}' and trashed = false`);
      let mainDocumentChanged = false;
      if (files.length) {
        const remoteFile = files[0];
        const nextFileId = remoteFile.id;
        const nextRemoteVersion = remoteFile.version || null;
        mainDocumentChanged = !loaded || fileId !== nextFileId || remoteVersion !== nextRemoteVersion;
        if (mainDocumentChanged) {
          const loadedDocument = await readValidatedJson(
            await request(`${API}/files/${nextFileId}?alt=media`),
            validator.validateDocument,
          );
          if (generation !== sessionGeneration) throw new Error("GOOGLE_DRIVE_CANCELLED");
          fileId = nextFileId;
          remoteVersion = nextRemoteVersion;
          document = { ...emptyDocument(), ...loadedDocument.value };
          documentSizeBytes = loadedDocument.sizeBytes;
          lastValidatedAt = new Date().toISOString();
          legacyEntries = structuredClone(document.entries);
        }
      } else {
        document = emptyDocument();
        await persist();
        legacyEntries = structuredClone(document.entries);
      }
      if (generation !== sessionGeneration) throw new Error("GOOGLE_DRIVE_CANCELLED");
      if (!loaded) await loadEntryDeltas();
      else {
        await refreshEntryDeltaIndex();
        // A base foi recarregada; as diferenças que não mudaram de versão
        // também precisam ser sobrepostas à nova cópia do documento.
        if (mainDocumentChanged) entryDeltaFiles.forEach(({ delta }) => applyEntryDelta(delta));
      }
      if (generation !== sessionGeneration) throw new Error("GOOGLE_DRIVE_CANCELLED");
      loaded = true;
      return document;
    }

    async function loadDocument() {
      if (loadPromise) return loadPromise;
      const pending = loadNow();
      loadPromise = pending;
      try {
        return await pending;
      } finally {
        if (loadPromise === pending) loadPromise = null;
      }
    }

    function load() { return mutate(loadDocument); }

    async function persistNow() {
      const generation = sessionGeneration;
      if (fileId && remoteVersion) {
        const currentVersion = (await (await request(`${API}/files/${fileId}?fields=version`)).json()).version || null;
        if (currentVersion !== remoteVersion) throw new Error("GOOGLE_DRIVE_CONFLICT");
      }
      document.revision = Number(document.revision || 0) + 1;
      document.updatedAt = new Date().toISOString();
      validator.validateDocument(document);
      const body = JSON.stringify(document);
      documentSizeBytes = textSize(body);
      lastValidatedAt = new Date().toISOString();
      if (fileId) {
        const response = await request(`${UPLOAD_API}/files/${fileId}?uploadType=media&fields=id,version`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
        const saved = await response.json();
        if (generation !== sessionGeneration) throw new Error("GOOGLE_DRIVE_CANCELLED");
        remoteVersion = saved.version || remoteVersion;
        return;
      }
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] })], { type: "application/json" }));
      form.append("file", new Blob([body], { type: "application/json" }));
      const created = await (await request(`${UPLOAD_API}/files?uploadType=multipart&fields=id,version`, { method: "POST", body: form })).json();
      if (generation !== sessionGeneration) throw new Error("GOOGLE_DRIVE_CANCELLED");
      fileId = created.id;
      remoteVersion = created.version || null;
    }

    function persist() { writeChain = writeChain.then(persistNow, persistNow); return writeChain; }
    function mutate(task) {
      const generation = sessionGeneration;
      const result = mutationChain.then(() => {
        if (generation !== sessionGeneration) throw new Error("GOOGLE_DRIVE_CANCELLED");
        return task();
      });
      mutationChain = result.catch(() => {});
      return result;
    }
    async function ensureLoaded() { if (!loaded) await loadDocument(); }
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
      validator.validateBackup(snapshot);
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
      const { value } = await readValidatedJson(
        await request(`${API}/files/${id}?alt=media`),
        validator.validateBackup,
      );
      return value;
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

    function sameContent(left, right) {
      const canonical = value => {
        if (Array.isArray(value)) return value.map(canonical);
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(Object.keys(value).filter(key => key !== "updated_at").sort()
          .map(key => [key, canonical(value[key])]));
      };
      return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
    }

    async function applyEntryOperationsNow(operations, _userId, onProgress = () => {}, collections = {}) {
      const generation = sessionGeneration;
      await ensureLoaded();
      onProgress({ completed: 0, total: operations.length, phase: "checking" });
      await refreshEntryDeltaIndex({ useFreshIndex: true });
      const entriesById = new Map(document.entries.map((entry) => [entry.id, entry]));

      const saved = [];
      const changes = [];
      for (const operation of operations) {
        const id = operation.type === "delete" ? operation.id : operation.entry.id;
        const current = entriesById.get(id);
        // A response may be lost after a successful upload. A later refresh
        // can acknowledge an identical result instead of creating a conflict.
        if (operation.type === "upsert" && current && sameContent(current, operation.entry)) {
          saved.push(current);
          continue;
        }
        if (operation.type === "delete" && !current && document.tombstones?.[id]) continue;
        if (operation.baseUpdatedAt && current?.updated_at !== operation.baseUpdatedAt) {
          throw new Error("CONFLICT: este lançamento foi alterado em outro dispositivo.");
        }
        changes.push(operation);
      }

      const settingsChanged = collections.settings && !sameContent(document.settings, collections.settings);
      const recurrenceChanged = collections.recurrenceSeries && !sameContent(document.recurrenceSeries, collections.recurrenceSeries);
      if (!changes.length && !settingsChanged && !recurrenceChanged) return saved;
      const documentBeforeChanges = structuredClone(document);
      const timestamp = new Date().toISOString();
      for (let index = 0; index < changes.length; index++) {
        const operation = changes[index];
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
      if (settingsChanged) document.settings = { ...structuredClone(collections.settings), updated_at: timestamp };
      if (recurrenceChanged) document.recurrenceSeries = structuredClone(collections.recurrenceSeries);
      document.compactedDeltas = Object.fromEntries(
        [...entryDeltaFiles.entries()].map(([id, file]) => [id, file.version]),
      );
      onProgress({ completed: 0, total: 1, phase: "sending" });
      try {
        await persist();
      } catch (error) {
        if (generation === sessionGeneration) {
          document = documentBeforeChanges;
          loaded = false;
          entryDeltaIndexFresh = false;
        }
        throw error;
      }
      onProgress({ completed: 1, total: 1, phase: "sending" });
      return saved;
    }

    function applyEntryOperations(operations, userId, onProgress = () => {}) {
      return mutate(() => applyEntryOperationsNow(operations, userId, onProgress));
    }

    function applySyncBatch(batch, userId, onProgress = () => {}) {
      const snapshot = structuredClone(batch);
      return mutate(() => applyEntryOperationsNow(snapshot.operations || [], userId, onProgress, snapshot));
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
      getDocumentStats() {
        return {
          sizeBytes: documentSizeBytes,
          schemaVersion: document.schemaVersion,
          entryCount: document.entries.length,
          lastValidatedAt,
        };
      },
      beginSync() { requestsCancelled = false; },
      cancelPendingRequests() { requestsCancelled = true; activeControllers.forEach((controller) => controller.abort()); },
      reset() { sessionGeneration++; mutationChain = Promise.resolve(); fileId = null; remoteVersion = null; document = emptyDocument(); loaded = false; documentSizeBytes = 0; lastValidatedAt = null; entryDeltaFiles.clear(); entryDeltaIndexLoaded = false; entryDeltaIndexFresh = false; loadPromise = null; writeChain = Promise.resolve(); activeControllers.forEach((controller) => controller.abort()); activeControllers.clear(); requestsCancelled = false; },
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
      applySyncBatch,
      createDriveBackup,
      listDriveBackups,
      fetchDriveBackup,
      async fetchRecurrenceSeries() { await ensureLoaded(); return structuredClone(document.recurrenceSeries); },
      async replaceRecurrenceSeries(series) { await applySyncBatch({ recurrenceSeries: series || [] }); },
      async upsertRecurrenceSeries(series) { return mutate(async () => (await upsertCollection("recurrenceSeries", [series]))[0]); },
      async deleteRecurrenceSeries(id) { return mutate(() => deleteWhere("recurrenceSeries", (item) => item.id === id)); },
      async deleteGeneratedEntries(seriesId, _userId, fromDate = null) { await deleteWhere("entries", (item) => item.series_id === seriesId && !item.detached_from_series && (!fromDate || item.scheduled_date >= fromDate)); },
      async deleteSeriesEntries(seriesId, _userId, fromDate = null) { await deleteWhere("entries", (item) => item.series_id === seriesId && (!fromDate || item.scheduled_date >= fromDate)); },
      async fetchSettings() { await ensureLoaded(); return structuredClone(document.settings); },
      async upsertSettings(_userId, settings, types, descriptions, customDescriptionOptionsByType = {}, hiddenTypes = [], hiddenDescriptionsByType = {}) {
        await applySyncBatch({ settings: { ...settings, types, descriptions, customDescriptionOptionsByType, hiddenTypes, hiddenDescriptionsByType } }, _userId);
      },
    };
  }

  global.MGGoogleDriveRepository = { create };
})(window);
