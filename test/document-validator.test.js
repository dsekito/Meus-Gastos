const assert = require("node:assert/strict");

global.window = global;
require("../js/document-validator.js");

const validEntry = {
  id: "entry-1",
  value: 25.5,
  date: "2026-08-26",
  created_at: "2026-08-26T10:00:00.000Z",
  updated_at: "2026-08-26T10:00:00.000Z",
};

const validDocument = {
  schemaVersion: 2,
  revision: 3,
  updatedAt: "2026-08-26T10:00:00.000Z",
  entries: [validEntry],
  recurrenceSeries: [],
  settings: { current_balance: 100, balance_reference_date: "2026-08-26" },
  tombstones: {},
  compactedDeltas: {},
};

assert.equal(global.MGDocumentValidator.validateDocument(validDocument), validDocument);
assert.throws(
  () => global.MGDocumentValidator.validateDocument({ ...validDocument, entries: [validEntry, { ...validEntry }] }),
  /GOOGLE_DRIVE_INVALID_DOCUMENT/,
);
assert.throws(
  () => global.MGDocumentValidator.validateDocument({ ...validDocument, schemaVersion: 99 }),
  /GOOGLE_DRIVE_UNSUPPORTED_SCHEMA/,
);
assert.throws(
  () => global.MGDocumentValidator.validateDocument({ ...validDocument, entries: [{ ...validEntry, date: "2026-02-31" }] }),
  /GOOGLE_DRIVE_INVALID_DOCUMENT/,
);
assert.throws(
  () => global.MGDocumentValidator.validateBackup({ schemaVersion: 1, entries: [], recurrenceSeries: [], settings: null }),
  /BACKUP_INVALID/,
);

console.log("document validator tests: ok");
