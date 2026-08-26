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

  global.MGDocumentValidator = { validateDocument, validateBackup, validateEntryDelta };
})(window);
