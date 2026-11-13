const test = require("node:test");
const assert = require("node:assert/strict");

global.window = global;
require("../js/domain.js");
require("../js/document-validator.js");

const {
  withCreditCard,
  recurringEntryFormValues,
  reconcileSeriesEntries,
  reconcileInstallmentEntries,
} = global.MGDomain;

test("lançamento sem cartão não ganha o campo; trocar ou remover o cartão substitui o anterior", () => {
  const entry = { id: "e1", value: 10 };
  assert.deepEqual(withCreditCard(entry, ""), { id: "e1", value: 10 });
  assert.deepEqual(withCreditCard(entry, null), { id: "e1", value: 10 });
  assert.deepEqual(withCreditCard(entry, "nubank"), { id: "e1", value: 10, credit_card_id: "nubank" });
  assert.deepEqual(withCreditCard({ ...entry, credit_card_id: "nubank" }, "itau"), { id: "e1", value: 10, credit_card_id: "itau" });
  assert.equal("credit_card_id" in withCreditCard({ ...entry, credit_card_id: "nubank" }, ""), false);
  assert.equal("credit_card_id" in entry, false, "não altera o original");
});

test("ocorrências de uma recorrência seguem o cartão da série", () => {
  const series = { id: "s1", flow_type: "expense", value: 50, type: "ASSINATURAS", description: "STREAMING", detail: "", credit_card_id: "nubank" };
  const entries = [
    { id: "a", series_id: "s1", scheduled_date: "2026-01-10", date: "2026-01-10" },
    { id: "b", series_id: "s1", scheduled_date: "2026-02-10", date: "2026-02-10", credit_card_id: "itau" },
  ];
  const occurrences = [
    { date: "2026-01-10", scheduled_date: "2026-01-10" },
    { date: "2026-02-10", scheduled_date: "2026-02-10" },
  ];
  const withCard = reconcileSeriesEntries(entries, occurrences, series).upserts;
  assert.deepEqual(withCard.map((entry) => entry.credit_card_id), ["nubank", "nubank"]);

  const { credit_card_id: _removed, ...withoutCardSeries } = series;
  const withoutCard = reconcileSeriesEntries(withCard, occurrences, withoutCardSeries).upserts;
  assert.ok(withoutCard.every((entry) => !("credit_card_id" in entry)), "série sem cartão tira o cartão das ocorrências");
});

test("o formulário de uma ocorrência mostra o cartão da série, e uma ocorrência destacada mantém o seu", () => {
  const series = { value: 50, type: "ASSINATURAS", description: "STREAMING", credit_card_id: "nubank" };
  assert.equal(recurringEntryFormValues({ id: "a" }, series).credit_card_id, "nubank");
  assert.equal(recurringEntryFormValues({ id: "a", detached_from_series: true, credit_card_id: "itau" }, series).credit_card_id, "itau");
  const { credit_card_id: _removed, ...withoutCard } = series;
  assert.equal("credit_card_id" in recurringEntryFormValues({ id: "a", credit_card_id: "itau" }, withoutCard), false);
});

test("todas as parcelas, antigas e novas, recebem o cartão do parcelamento", () => {
  const plan = { quantity: 3, group_id: "g1", start_date: "2026-01-31", value: 100, type: "COMPRAS", description: "CASA", credit_card_id: "nubank" };
  const created = reconcileInstallmentEntries([], plan).missingInstallments;
  assert.deepEqual(created.map((entry) => entry.credit_card_id), ["nubank", "nubank", "nubank"]);
  assert.equal(created.reduce((sum, entry) => sum + Math.round(entry.value * 100), 0), 10000, "a soma continua igual ao total");

  const existing = created.slice(0, 2).map((entry, index) => ({ ...entry, id: `p${index}` }));
  const changed = reconcileInstallmentEntries(existing, { ...plan, credit_card_id: "itau" });
  assert.deepEqual([...changed.upserts, ...changed.missingInstallments].map((entry) => entry.credit_card_id), ["itau", "itau", "itau"]);

  const removed = reconcileInstallmentEntries(existing, { ...plan, credit_card_id: "" });
  assert.ok([...removed.upserts, ...removed.missingInstallments].every((entry) => !("credit_card_id" in entry)));
});

test("documento do Drive e backup aceitam cartão válido no lançamento e na série e recusam valor inválido", () => {
  const { validateDocument, parseImport } = global.MGDocumentValidator;
  const entry = { id: "e1", value: 10, date: "2026-11-13", type: "COMPRAS", description: "CASA", paid: false };
  const document = (entryOverrides, seriesOverrides = {}) => ({
    schemaVersion: 2, entries: [{ ...entry, ...entryOverrides }],
    recurrenceSeries: [{ id: "s1", start_date: "2026-11-13", ...seriesOverrides }], settings: {},
  });
  assert.doesNotThrow(() => validateDocument(document({ credit_card_id: "nubank" }, { credit_card_id: "nubank" })));
  assert.doesNotThrow(() => validateDocument(document({})));
  for (const invalidId of ["", " ", 12, null, {}]) {
    assert.throws(() => validateDocument(document({ credit_card_id: invalidId })), /GOOGLE_DRIVE_INVALID_DOCUMENT/);
    assert.throws(() => validateDocument(document({}, { credit_card_id: invalidId })), /GOOGLE_DRIVE_INVALID_DOCUMENT/);
  }
  assert.equal(parseImport([{ ...entry, credit_card_id: "nubank" }]).entries[0].credit_card_id, "nubank");
  assert.throws(() => parseImport([{ ...entry, credit_card_id: 7 }]), /IMPORT_INVALID/);
});
