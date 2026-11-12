(function attachDocumentValidator(global) {
  const SUPPORTED_SCHEMA_VERSIONS = new Set([1, 2]);

  function invalid(code = "GOOGLE_DRIVE_INVALID_DOCUMENT") {
    throw new Error(code);
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function isDateOnly(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function isTimestamp(value) {
    return typeof value === "string" && value.length >= 20 && !Number.isNaN(Date.parse(value));
  }

  function validateOptionalDate(value, type) {
    if (value == null || value === "") return;
    if (type === "date" ? !isDateOnly(value) : !isTimestamp(value)) invalid();
  }

  function validateUniqueRecords(records, validateRecord) {
    if (!Array.isArray(records)) invalid();
    const ids = new Set();
    records.forEach((record) => {
      if (!isObject(record) || typeof record.id !== "string" || !record.id.trim() || ids.has(record.id)) invalid();
      ids.add(record.id);
      validateRecord(record);
    });
  }

  function validateEntry(entry) {
    if (entry.value != null && !Number.isFinite(Number(entry.value))) invalid();
    validateOptionalDate(entry.date, "date");
    validateOptionalDate(entry.scheduled_date, "date");
    validateOptionalDate(entry.created_at, "timestamp");
    validateOptionalDate(entry.updated_at, "timestamp");
  }

  function validateRecurrence(series) {
    validateOptionalDate(series.start_date, "date");
    validateOptionalDate(series.end_date, "date");
    validateOptionalDate(series.created_at, "timestamp");
    validateOptionalDate(series.updated_at, "timestamp");
    if (series.value != null && !Number.isFinite(Number(series.value))) invalid();
  }

  function validateSettings(settings, { required = false } = {}) {
    if (settings == null && !required) return;
    if (!isObject(settings)) invalid(required ? "BACKUP_INVALID" : undefined);
    if (settings.current_balance != null && !Number.isFinite(Number(settings.current_balance))) invalid(required ? "BACKUP_INVALID" : undefined);
    if (settings.balance_reference_date != null && !isDateOnly(settings.balance_reference_date)) invalid(required ? "BACKUP_INVALID" : undefined);
    if (settings.onboarding_status != null && !["pending", "completed"].includes(settings.onboarding_status)) invalid(required ? "BACKUP_INVALID" : undefined);
  }

  function validateDocument(value) {
    if (!isObject(value)) invalid();
    if (!SUPPORTED_SCHEMA_VERSIONS.has(Number(value.schemaVersion))) {
      invalid(Number(value.schemaVersion) > Math.max(...SUPPORTED_SCHEMA_VERSIONS)
        ? "GOOGLE_DRIVE_UNSUPPORTED_SCHEMA"
        : "GOOGLE_DRIVE_INVALID_DOCUMENT");
    }
    if (value.revision != null && (!Number.isInteger(Number(value.revision)) || Number(value.revision) < 0)) invalid();
    validateOptionalDate(value.updatedAt, "timestamp");
    validateUniqueRecords(value.entries, validateEntry);
    validateUniqueRecords(value.recurrenceSeries, validateRecurrence);
    validateSettings(value.settings);
    if (value.tombstones != null && !isObject(value.tombstones)) invalid();
    if (value.compactedDeltas != null && !isObject(value.compactedDeltas)) invalid();
    Object.values(value.tombstones || {}).forEach((timestamp) => validateOptionalDate(timestamp, "timestamp"));
    Object.values(value.compactedDeltas || {}).forEach((version) => {
      if (!["string", "number"].includes(typeof version)) invalid();
    });
    return value;
  }

  function validateBackup(value) {
    if (!isObject(value) || Number(value.schemaVersion) !== 1) invalid("BACKUP_INVALID");
    try {
      validateOptionalDate(value.exportedAt, "timestamp");
      validateUniqueRecords(value.entries, validateEntry);
      validateUniqueRecords(value.recurrenceSeries || [], validateRecurrence);
      validateSettings(value.settings, { required: true });
    } catch (error) {
      invalid("BACKUP_INVALID");
    }
    return value;
  }

  function validateEntryDelta(value) {
    if (!isObject(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.deleted !== "boolean") invalid();
    validateOptionalDate(value.updated_at, "timestamp");
    if (!value.deleted) {
      if (!isObject(value.entry) || value.entry.id !== value.id) invalid();
      validateEntry(value.entry);
    }
    return value;
  }

  // Imports cross a trust boundary. Do not reuse permissive legacy coercions.
  function parseImport(input) {
    try {
      if (typeof input === "string" && input.length > 5 * 1024 * 1024) invalid("IMPORT_INVALID");
      const value = typeof input === "string" ? JSON.parse(input) : structuredClone(input);
      const forbidden = new Set(["__proto__", "prototype", "constructor"]);
      function checkTree(node, depth = 0) {
        if (depth > 30) invalid("IMPORT_INVALID");
        if (!node || typeof node !== "object") return;
        for (const key of Object.keys(node)) {
          if (forbidden.has(key)) invalid("IMPORT_INVALID");
          checkTree(node[key], depth + 1);
        }
      }
      checkTree(value);
      const snapshot = Array.isArray(value)
        ? { schemaVersion: 1, entries: value, recurrenceSeries: [], settings: {} }
        : value;
      validateBackup(snapshot);
      if (!snapshot.entries.length || snapshot.entries.length > 50000) invalid("IMPORT_INVALID");
      function strictRecord(record) {
        if (record.value != null && (typeof record.value !== "number" || !Number.isFinite(record.value))) invalid("IMPORT_INVALID");
        for (const key of ["paid", "active", "detached_from_series", "excluded_from_series", "import_local_only"]) {
          if (record[key] != null && typeof record[key] !== "boolean") invalid("IMPORT_INVALID");
        }
        if (record.flow_type != null && !["income", "expense"].includes(record.flow_type)) invalid("IMPORT_INVALID");
        if (record.installment != null && (!isObject(record.installment)
            || !Number.isInteger(record.installment.current) || record.installment.current < 1
            || !Number.isInteger(record.installment.total) || record.installment.total < record.installment.current)) invalid("IMPORT_INVALID");
        if (record.installments != null && (!Number.isInteger(record.installments) || record.installments < 1)) invalid("IMPORT_INVALID");
      }
      strictRecord(snapshot.settings);
      if (snapshot.settings.current_balance != null && typeof snapshot.settings.current_balance !== "number") invalid("IMPORT_INVALID");
      for (const key of ["types", "descriptions", "hiddenTypes"]) {
        const options = snapshot.settings[key];
        if (options != null && (!Array.isArray(options) || options.some(option => typeof option !== "string"))) invalid("IMPORT_INVALID");
      }
      (snapshot.recurrenceSeries || []).forEach(strictRecord);
      snapshot.entries.forEach((entry) => {
        strictRecord(entry);
        for (const key of ["type", "description"]) {
          if (typeof entry[key] !== "string" || !entry[key].trim()) invalid("IMPORT_INVALID");
        }
        // Legacy recovery fixtures omit paid. Migrate absence, never null/invalid flags.
        if (!Object.hasOwn(entry, "paid")) entry.paid = false;
        if (typeof entry.paid !== "boolean") invalid("IMPORT_INVALID");
        // Preserve legacy names and UUIDs verbatim; never repair imported identities.
        if (forbidden.has(entry.id) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(entry.id)
            || typeof entry.value !== "number" || !Number.isFinite(entry.value)
            || !isDateOnly(entry.date)) invalid("IMPORT_INVALID");
        for (const key of ["type", "description", "notes", "flow_type", "status", "series_id", "scheduled_date"]) {
          if (entry[key] != null && typeof entry[key] !== "string") invalid("IMPORT_INVALID");
        }
      });
      return snapshot;
    } catch (error) {
      invalid("IMPORT_INVALID");
    }
  }

  global.MGDocumentValidator = { validateDocument, validateBackup, validateEntryDelta, parseImport };
})(window);
