const test = require("node:test");
const assert = require("node:assert/strict");

global.window = global;
require("../js/domain.js");

const { monthBalanceSeries, projectedBalance, dailyEntryNet, dailyPendingNet } = global.MGDomain;

const entry = (date, value, flow_type = "expense", paid = false) => ({ date, value, flow_type, paid });
const series = (month, settings, entries) =>
  monthBalanceSeries(month, settings, dailyEntryNet(entries), dailyPendingNet(entries));

test("cobre cada dia do mês, inclusive meses de 28, 29, 30 e 31 dias", () => {
  const settings = { current_balance: 0, balance_reference_date: "2026-01-01" };
  assert.equal(series("2026-02", settings, []).days.length, 28);
  assert.equal(series("2028-02", settings, []).days.length, 29);
  assert.equal(series("2026-04", settings, []).days.length, 30);
  assert.equal(series("2026-12", settings, []).days.length, 31);
  assert.deepEqual(series("2026-02", settings, []).days.at(-1), { date: "2026-02-28", balance: 0 });
});

test("cada dia coincide com o saldo projetado, antes e depois da data-base", () => {
  const settings = { current_balance: 1000, balance_reference_date: "2026-03-10" };
  const entries = [
    entry("2026-02-27", 40.01), entry("2026-03-01", 300, "income", true), entry("2026-03-05", 99.99),
    entry("2026-03-10", 50), entry("2026-03-10", 20, "expense", true), entry("2026-03-31", 0.03, "income"),
    entry("2026-03-15", -25.5), entry("2026-04-01", 10),
  ];
  const net = dailyEntryNet(entries);
  const pending = dailyPendingNet(entries);
  const result = monthBalanceSeries("2026-03", settings, net, pending);
  assert.equal(result.opening, projectedBalance("2026-02-28", settings, net, pending));
  for (const day of result.days) {
    assert.equal(day.balance, projectedBalance(day.date, settings, net, pending), day.date);
  }
  assert.equal(result.closing, result.days.at(-1).balance);
});

test("vira o ano: dezembro começa do saldo de 30/11 e janeiro, do de 31/12", () => {
  const settings = { current_balance: 500, balance_reference_date: "2026-12-31" };
  const entries = [entry("2026-12-31", 100), entry("2027-01-01", 0.01)];
  const january = series("2027-01", settings, entries);
  assert.equal(january.opening, 400);
  assert.equal(january.days[0].balance, 399.99);
  const december = series("2026-12", settings, entries);
  assert.equal(december.opening, 500);
  assert.equal(december.closing, 400);
});

test("soma em centavos e acha o menor saldo, mesmo negativo, no primeiro dia em que ocorre", () => {
  const settings = { current_balance: 0.1, balance_reference_date: "2026-05-01" };
  const entries = [entry("2026-05-02", 0.2), entry("2026-05-03", 0.1, "income"), entry("2026-05-04", 0.1),
    entry("2026-05-20", -0.3)];
  const result = series("2026-05", settings, entries);
  assert.equal(result.days[1].balance, -0.1);
  assert.deepEqual(result.minimum, { date: "2026-05-02", balance: -0.1 });
  assert.equal(result.closing, 0.2,"estorno (despesa negativa) aumenta o saldo");
});

test("lista vazia mantém o saldo informado e o menor saldo no primeiro dia", () => {
  const result = series("2026-07", { current_balance: 12.34, balance_reference_date: "2026-01-01" }, []);
  assert.equal(result.opening, 12.34);
  assert.equal(result.closing, 12.34);
  assert.deepEqual(result.minimum, { date: "2026-07-01", balance: 12.34 });
});

test("rejeita mês inválido", () => {
  assert.throws(() => monthBalanceSeries("2026-13", {}, new Map()), RangeError);
  assert.throws(() => monthBalanceSeries("", {}, new Map()), RangeError);
});
