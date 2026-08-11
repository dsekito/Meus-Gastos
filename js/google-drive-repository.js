(function attachGoogleDriveRepository(global) {
  const FILE_NAME = "meus-gastos.json";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

  function emptyDocument() {
    return {
      schemaVersion: 1,
      revision: 0,
      updatedAt: new Date(0).toISOString(),
      entries: [],
      recurrenceSeries: [],
      settings: null,
    };
  }

  function create({ getAccessToken, isAccessTokenExpired = () => false }) {
    let fileId = null;
    let document = emptyDocument();
    let loaded = false;
    let remoteVersion = null;
    let writeChain = Promise.resolve();

    async function request(url, options = {}) {
      const token = getAccessToken();
      if (!token) throw new Error("GOOGLE_AUTH_REQUIRED");
      if (isAccessTokenExpired()) throw new Error("GOOGLE_AUTH_EXPIRED");
      const response = await fetch(url, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
      });
      if (response.status === 401) throw new Error("GOOGLE_AUTH_EXPIRED");
      if (!response.ok) throw new Error(`GOOGLE_DRIVE_${response.status}`);
      return response;
    }

    async function load() {
      const query = encodeURIComponent(`name = '${FILE_NAME}' and trashed = false`);
      const list = await request(`${API}/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime,version)&pageSize=10`);
      const files = (await list.json()).files || [];
      if (files.length) {
        fileId = files[0].id;
        remoteVersion = files[0].version || null;
        const content = await request(`${API}/files/${fileId}?alt=media`);
        const parsed = await content.json();
        document = { ...emptyDocument(), ...parsed };
      } else {
        document = emptyDocument();
        await persist();
      }
      loaded = true;
      return document;
    }

    async function persistNow() {
      if (fileId && remoteVersion) {
        const metadata = await request(`${API}/files/${fileId}?fields=version`);
        const currentVersion = (await metadata.json()).version || null;
        if (currentVersion !== remoteVersion) throw new Error("GOOGLE_DRIVE_CONFLICT");
      }
      document.revision = Number(document.revision || 0) + 1;
      document.updatedAt = new Date().toISOString();
      const body = JSON.stringify(document);
      if (fileId) {
        const response = await request(`${UPLOAD_API}/files/${fileId}?uploadType=media&fields=id,version`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
        });
        remoteVersion = (await response.json()).version || remoteVersion;
        return;
      }
      const form = new FormData();
      form.append("metadata", new Blob([
        JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] }),
      ], { type: "application/json" }));
      form.append("file", new Blob([body], { type: "application/json" }));
      const response = await request(`${UPLOAD_API}/files?uploadType=multipart&fields=id,version`, {
        method: "POST",
        body: form,
      });
      const created = await response.json();
      fileId = created.id;
      remoteVersion = created.version || null;
    }

    function persist() {
      writeChain = writeChain.then(persistNow, persistNow);
      return writeChain;
    }

    async function ensureLoaded() {
      if (!loaded) await load();
    }

    function stamped(value) {
      return { ...value, updated_at: new Date().toISOString() };
    }

    async function upsertCollection(key, values) {
      await ensureLoaded();
      const byId = new Map(document[key].map((item) => [item.id, item]));
      const saved = values.map((value) => stamped(value));
      saved.forEach((value) => byId.set(value.id, value));
      document[key] = [...byId.values()];
      await persist();
      return saved;
    }

    async function deleteWhere(key, predicate) {
      await ensureLoaded();
      document[key] = document[key].filter((item) => !predicate(item));
      await persist();
    }

    async function applyEntryOperations(operations) {
      // Uma única leitura e gravação preserva desempenho em alterações em massa.
      await load();
      const nextEntries = new Map(document.entries.map((item) => [item.id, item]));
      const saved = [];

      for (const operation of operations) {
        const id = operation.type === "delete" ? operation.id : operation.entry.id;
        const remote = nextEntries.get(id);
        if (operation.baseUpdatedAt && remote?.updated_at !== operation.baseUpdatedAt) {
          throw new Error("CONFLICT: este lançamento foi alterado em outro dispositivo.");
        }
        if (operation.type === "delete") {
          nextEntries.delete(id);
        } else {
          const value = stamped(operation.entry);
          nextEntries.set(id, value);
          saved.push(value);
        }
      }

      document.entries = [...nextEntries.values()];
      await persist();
      return saved;
    }

    return {
      load,
      reset() { fileId = null; remoteVersion = null; document = emptyDocument(); loaded = false; writeChain = Promise.resolve(); },
      async fetchEntries() { await ensureLoaded(); return structuredClone(document.entries); },
      async fetchEntryVersion(id) {
        // Releia o documento antes de gravar para detectar alterações de outro aparelho.
        await load();
        const entry = document.entries.find((item) => item.id === id);
        return entry ? { updated_at: entry.updated_at } : null;
      },
      async deleteEntry(id) { await deleteWhere("entries", (item) => item.id === id); },
      async upsertEntry(entry) { return (await upsertCollection("entries", [entry]))[0]; },
      async upsertEntries(entries) { return upsertCollection("entries", entries); },
      applyEntryOperations,
      async fetchRecurrenceSeries() { await ensureLoaded(); return structuredClone(document.recurrenceSeries); },
      async upsertRecurrenceSeries(series) { return (await upsertCollection("recurrenceSeries", [series]))[0]; },
      async deleteRecurrenceSeries(id) { await deleteWhere("recurrenceSeries", (item) => item.id === id); },
      async deleteGeneratedEntries(seriesId, _userId, fromDate = null) {
        await deleteWhere("entries", (item) => item.series_id === seriesId && !item.detached_from_series && (!fromDate || item.scheduled_date >= fromDate));
      },
      async deleteSeriesEntries(seriesId, _userId, fromDate = null) {
        await deleteWhere("entries", (item) => item.series_id === seriesId && (!fromDate || item.scheduled_date >= fromDate));
      },
      async fetchSettings() { await ensureLoaded(); return structuredClone(document.settings); },
      async upsertSettings(_userId, settings, types, descriptions) {
        await ensureLoaded();
        document.settings = { ...settings, types, descriptions, updated_at: new Date().toISOString() };
        await persist();
      },
    };
  }

  global.MGGoogleDriveRepository = { create };
})(window);
