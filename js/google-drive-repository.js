(function attachGoogleDriveRepository(global) {
  const FILE_NAME = "meus-gastos.json";
  const ENTRY_DELTA_PREFIX = "meus-gastos-entry-";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
  const REQUEST_TIMEOUT_MS = 20000;

  function emptyDocument() {
    return { schemaVersion: 1, revision: 0, updatedAt: new Date(0).toISOString(), entries: [], recurrenceSeries: [], settings: null };
  }

  function create({ getAccessToken, isAccessTokenExpired = () => false }) {
    let fileId = null;
    let document = emptyDocument();
    let loaded = false;
    let remoteVersion = null;
    const entryDeltaFiles = new Map();
    let writeChain = Promise.resolve();

    async function request(url, options = {}) {
      const token = getAccessToken();
      if (!token) throw new Error("GOOGLE_AUTH_REQUIRED");
      if (isAccessTokenExpired()) throw new Error("GOOGLE_AUTH_EXPIRED");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
        if (response.status === 401) throw new Error("GOOGLE_AUTH_EXPIRED");
        if (!response.ok) throw new Error(`GOOGLE_DRIVE_${response.status}`);
        return response;
      } catch (error) {
        if (error?.name === "AbortError") throw new Error("GOOGLE_DRIVE_TIMEOUT");
        throw error;
      } finally {
        clearTimeout(timeout);
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
      const index = document.entries.findIndex((entry) => entry.id === delta.id);
      if (delta.deleted) {
        if (index >= 0) document.entries.splice(index, 1);
      } else if (index >= 0) document.entries[index] = delta.entry;
      else document.entries.push(delta.entry);
    }

    async function readEntryDelta(file) {
      const delta = await (await request(`${API}/files/${file.id}?alt=media`)).json();
      entryDeltaFiles.set(delta.id, { ...file, delta });
      applyEntryDelta(delta);
    }

    async function loadEntryDeltas() {
      const files = (await listFiles(`name contains '${ENTRY_DELTA_PREFIX}' and trashed = false`))
        .filter((file) => file.name?.startsWith(ENTRY_DELTA_PREFIX));
      for (let index = 0; index < files.length; index += 6) await Promise.all(files.slice(index, index + 6).map(readEntryDelta));
    }

    async function load() {
      const files = await listFiles(`name = '${escapedName(FILE_NAME)}' and trashed = false`);
      if (files.length) {
        fileId = files[0].id;
        remoteVersion = files[0].version || null;
        document = { ...emptyDocument(), ...(await (await request(`${API}/files/${fileId}?alt=media`)).json()) };
      } else {
        document = emptyDocument();
        await persist();
      }
      await loadEntryDeltas();
      loaded = true;
      return document;
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
      const files = await listFiles(`name = '${escapedName(entryDeltaName(id))}' and trashed = false`);
      const file = files[0];
      if (!file) return null;
      const cached = entryDeltaFiles.get(id);
      if (cached?.version === file.version) return cached;
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
        for (const entry of document.entries.filter(predicate)) await saveEntryDelta(entry.id, null, true, entry.updated_at);
        return;
      }
      document[key] = document[key].filter((item) => !predicate(item));
      await persist();
    }

    async function upsertEntries(entries) {
      const saved = [];
      for (let index = 0; index < entries.length; index += 6) saved.push(...await Promise.all(entries.slice(index, index + 6).map((entry) => saveEntryDelta(entry.id, entry, false, null))));
      return saved;
    }

    async function applyEntryOperations(operations) {
      const saved = [];
      for (const operation of operations) {
        if (operation.type === "delete") await saveEntryDelta(operation.id, null, true, operation.baseUpdatedAt);
        else saved.push(await saveEntryDelta(operation.entry.id, operation.entry, false, operation.baseUpdatedAt));
      }
      return saved;
    }

    return {
      load,
      reset() { fileId = null; remoteVersion = null; document = emptyDocument(); loaded = false; entryDeltaFiles.clear(); writeChain = Promise.resolve(); },
      async fetchEntries() { await ensureLoaded(); return structuredClone(document.entries); },
      async fetchEntryVersion(id) { await ensureLoaded(); return document.entries.find((item) => item.id === id) || null; },
      async deleteEntry(id, _userId, baseUpdatedAt = null) { await saveEntryDelta(id, null, true, baseUpdatedAt); },
      async upsertEntry(entry, _userId, baseUpdatedAt = null) { return saveEntryDelta(entry.id, entry, false, baseUpdatedAt); },
      upsertEntries,
      applyEntryOperations,
      async fetchRecurrenceSeries() { await ensureLoaded(); return structuredClone(document.recurrenceSeries); },
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
