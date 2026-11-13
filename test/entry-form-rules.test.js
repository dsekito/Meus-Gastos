const test = require("node:test");
const assert = require("node:assert/strict");

global.window = global;
require("../js/domain.js");
require("../js/entry-form-rules.js");

const rules = global.MGEntryFormRules;
const { installmentSplit, reconcileInstallmentEntries } = global.MGDomain;
const money = value => `R$ ${value.toFixed(2)}`;

test("valor zero nunca vale; negativo só em despesa única (estorno)", () => {
  assert.equal(rules.valueError("", { recurring: false, income: false }), "");
  assert.equal(rules.valueError("0", { recurring: false, income: false }), "Informe um valor maior que zero.");
  assert.equal(rules.valueError("-10.5", { recurring: false, income: false }), "");
  assert.equal(rules.valueError("-10.5", { recurring: true, income: false }), "Informe um valor maior que zero.");
  assert.equal(rules.valueError("-10.5", { recurring: false, income: true }), "Informe um valor maior que zero.");
  assert.equal(rules.valueError("0.01", { recurring: true, income: true }), "");
});

test("data final de recorrência não pode ser anterior ao início", () => {
  const base = { recurring: true, endMode: "on_date", startDate: "2026-02-28" };
  assert.match(rules.endDateError({ ...base, endDate: "2026-02-27" }), /posterior à data inicial/);
  assert.equal(rules.endDateError({ ...base, endDate: "2026-02-28" }), "");
  assert.equal(rules.endDateError({ ...base, endDate: "" }), "");
  assert.equal(rules.endDateError({ ...base, recurring: false, endDate: "2025-01-01" }), "");
  assert.equal(rules.endDateError({ ...base, endMode: "never", endDate: "2025-01-01" }), "");
});

test("resume a recorrência em português, com término e ajuste de fim de semana", () => {
  const summary = fields => rules.recurrenceSummary({ customUnit: "day", interval: "1", endMode: "never", endDate: "", occurrenceCount: "12", businessDayAdjustment: "none", ...fields });
  assert.equal(summary({ frequency: "monthly" }), "A cada mês, sem data final.");
  assert.equal(summary({ frequency: "weekly", interval: "2", endMode: "after_occurrences", occurrenceCount: "1" }), "A cada 2 semanas, por 1 ocorrência.");
  assert.equal(summary({ frequency: "custom", customUnit: "year", interval: "0", endMode: "after_occurrences", occurrenceCount: "3", businessDayAdjustment: "next" }),
    "A cada ano, por 3 ocorrências, movendo fins de semana para o próximo dia útil.");
  assert.match(summary({ frequency: "annual", endMode: "on_date", endDate: "2027-12-31", businessDayAdjustment: "previous" }), /^A cada ano, até 31\/12\/2027, movendo fins de semana para o dia útil anterior\.$/);
});

test("prévia das parcelas usa a mesma divisão que será gravada, com o resto na última", () => {
  for (const [total, quantity] of [[100, 3], [0.05, 2], [999.99, 7], [-30.01, 4], [1, 5000]]) {
    const { regularCents, lastCents } = installmentSplit(total, quantity);
    assert.equal(regularCents * (quantity - 1) + lastCents, Math.round(total * 100), `${total}/${quantity}`);
    const saved = reconcileInstallmentEntries([], { quantity, value: total, start_date: "2026-01-31", type: "T", description: "D" }).missingInstallments;
    assert.equal(saved[0].value, regularCents / 100);
    assert.equal(saved.at(-1).value, lastCents / 100);
  }
  assert.equal(rules.installmentPreview({ rawAmount: "100", rawQuantity: "3", isNew: false, money }),
    "2 parcelas de R$ 33.33 e a última de R$ 33.34 · Total da compra: R$ 100.00.");
  assert.equal(rules.installmentPreview({ rawAmount: "90", rawQuantity: "3", isNew: true, money }),
    "3 parcelas de R$ 30.00 · Total da compra: R$ 90.00. As parcelas começam em aberto; marque o pagamento de cada uma nos registros.");
  for (const rawQuantity of ["1", "5001", "2.5", ""]) {
    assert.match(rules.installmentPreview({ rawAmount: "90", rawQuantity, isNew: false, money }), /^Informe o valor total/);
  }
  assert.match(rules.installmentPreview({ rawAmount: "", rawQuantity: "3", isNew: false, money }), /^Informe o valor total/);
});
