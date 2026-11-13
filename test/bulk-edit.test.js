const test = require("node:test");
const assert = require("node:assert/strict");

global.window = global;
require("../js/domain.js");
require("../js/bulk-edit.js");

const bulk = global.MGBulkEdit;

const base = { type: "ALIMENTAÇÃO", description: "RESTAURANTE", value: 10, paid: false, flow_type: "expense" };
const single = { ...base, id: "s1", date: "2026-11-05" };
const income = { ...base, id: "in", date: "2026-11-06", type: "RECEITAS", description: "SALÁRIO", flow_type: "income" };
const installment = (n) => ({
  ...base, id: `p${n}`, type: "COMPRAS", description: "CASA", date: `2026-${String(10 + n).padStart(2, "0")}-10`,
  installment_group_id: "g1", installment: { current: n, total: 3, original: 30 }, credit_card_id: "nubank",
});
const occurrence = (n) => ({
  ...base, id: `o${n}`, type: "ASSINATURAS", description: "STREAMING", date: `2026-1${n}-15`, scheduled_date: `2026-1${n}-15`,
  series_id: "series", detached_from_series: false, excluded_from_series: false,
});
const entries = [single, income, installment(1), installment(2), installment(3), occurrence(0), occurrence(1)];
const byId = (list) => Object.fromEntries(list.map((entry) => [entry.id, entry]));
const ids = (...list) => new Set(list);

test("avulsos: status, data, tipo, descrição e forma de pagamento mudam só nos selecionados", () => {
  const { updates, selectedCount } = bulk.planEdit(entries, ids("s1"), { paid: true, date: "2026-11-20", type: "LAZER", description: "PASSEIOS", creditCardId: "itau" });
  assert.equal(selectedCount, 1);
  assert.deepEqual(updates, [{ ...single, paid: true, date: "2026-11-20", type: "LAZER", description: "PASSEIOS", credit_card_id: "itau" }]);
});

test("descrição pode mudar sozinha; receitas não recebem forma de pagamento", () => {
  const onlyDescription = byId(bulk.planEdit(entries, ids("s1", "in"), { description: "DELIVERY" }).updates);
  assert.equal(onlyDescription.s1.description, "DELIVERY");
  assert.equal(onlyDescription.s1.type, "ALIMENTAÇÃO");
  const payment = byId(bulk.planEdit(entries, ids("s1", "in"), { creditCardId: "nubank" }).updates);
  assert.equal(payment.s1.credit_card_id, "nubank");
  assert.equal(payment.in, undefined, "a receita não muda");
  const removeCard = byId(bulk.planEdit([{ ...single, credit_card_id: "nubank" }], ids("s1"), { creditCardId: "" }).updates);
  assert.equal("credit_card_id" in removeCard.s1, false, "Pix tira o cartão sem deixar o campo vazio");
});

test("parcelas: status e data só nas selecionadas; tipo, descrição e cartão em todas as parcelas da compra", () => {
  const statusAndDate = byId(bulk.planEdit(entries, ids("p2"), { paid: true, date: "2026-12-01" }).updates);
  assert.deepEqual(Object.keys(statusAndDate), ["p2"]);
  assert.equal(statusAndDate.p2.paid, true);
  assert.equal(statusAndDate.p2.date, "2026-12-01");

  const classification = byId(bulk.planEdit(entries, ids("p2"), { type: "CASA", description: "MÓVEIS", creditCardId: "", paid: true }).updates);
  assert.deepEqual(Object.keys(classification).sort(), ["p1", "p2", "p3"]);
  assert.ok(Object.values(classification).every((entry) => entry.type === "CASA" && entry.description === "MÓVEIS" && !("credit_card_id" in entry)));
  assert.equal(classification.p2.paid, true);
  assert.equal(classification.p1.paid, false, "status só na selecionada");
  assert.equal(classification.p3.paid, false);
  assert.ok(Object.values(classification).every((entry) => entry.installment.original === 30), "valores e plano não mudam");
});

test("recorrências: status não tira da série; outras mudanças viram exceção só nas selecionadas", () => {
  const status = byId(bulk.planEdit(entries, ids("o0"), { paid: true }).updates);
  assert.equal(status.o0.detached_from_series, false);
  const type = byId(bulk.planEdit(entries, ids("o0"), { type: "LAZER" }).updates);
  assert.deepEqual(Object.keys(type), ["o0"]);
  assert.equal(type.o0.detached_from_series, true);
  assert.equal(type.o0.series_id, "series");
});

test("nada muda quando os valores já são os escolhidos; ocorrências excluídas são ignoradas", () => {
  assert.deepEqual(bulk.planEdit(entries, ids("s1"), { paid: false, type: "ALIMENTAÇÃO" }).updates, []);
  const excluded = { ...occurrence(2), excluded_from_series: true };
  assert.deepEqual(bulk.planEdit([excluded], ids(excluded.id), { paid: true }), { updates: [], selectedCount: 0 });
  assert.equal(bulk.hasChanges({}), false);
  assert.equal(bulk.hasChanges({ creditCardId: "" }), true, "escolher Pix também é uma mudança");
});

test("resumo da confirmação explica o efeito em cada tipo de registro", () => {
  const lines = bulk.editSummary(entries, ids("s1", "p1", "p2", "o0"), { date: "2026-12-01", type: "LAZER" }, { date: "01/12/2026" });
  assert.deepEqual(lines, [
    "Data: 01/12/2026",
    "Tipo: LAZER",
    "1 lançamento avulso",
    "2 parcelas de “CASA”: status e data mudam só nas selecionadas; tipo, descrição e forma de pagamento mudam nas 3 parcelas da compra",
    "As 2 parcelas selecionadas de “CASA” ficarão na mesma data.",
    "1 ocorrência de recorrência: vira exceção da série; as próximas continuam como estavam",
  ]);
  assert.deepEqual(bulk.editSummary(entries, ids("o0", "o1"), { paid: true }, { paid: "Pago ou recebido" }),
    ["Status: Pago ou recebido", "2 ocorrências de recorrência"]);
  assert.match(bulk.editSummary(entries, ids("o0", "o1"), { type: "LAZER" }).at(-1), /2 ocorrências de recorrência: viram exceções da série/);
});

test("excluir: parcelas sozinhas ou a compra inteira; ocorrências saem da série sem apagar a série", () => {
  const onlySelected = bulk.planDelete(entries, ids("s1", "p2", "o1"));
  assert.deepEqual([...onlySelected.deleteIds].sort(), ["p2", "s1"]);
  assert.deepEqual([...onlySelected.excludeIds], ["o1"]);
  assert.equal(onlySelected.total, 3);
  assert.equal(onlySelected.purchaseCount, 1);
  assert.equal(onlySelected.purchaseInstallments, 3);
  const wholePurchase = bulk.planDelete(entries, ids("p2"), { wholePurchase: true });
  assert.deepEqual([...wholePurchase.deleteIds].sort(), ["p1", "p2", "p3"]);
  assert.equal(wholePurchase.total, 3);
});
