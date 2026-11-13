const test = require("node:test");
const assert = require("node:assert/strict");

global.window = global;
require("../js/domain.js");
require("../js/monthly-view.js");

const { monthlyCashFlow, comparePreviousMonth } = global.MGDomain;
const view = global.MGMonthlyView;
const money = value => `R$ ${value.toFixed(2)}`;
const entries = [
  { date: "2025-12-15", value: 100.1, flow_type: "income", paid: true },
  { date: "2025-12-20", value: 40.05, paid: false },
  { date: "2026-01-05", value: 250.33, flow_type: "income", paid: true },
  { date: "2026-01-09", value: -10.01, paid: true },
  { date: "2026-02-28", value: 99.99, paid: false },
  { date: "2026-03-31", value: 0.01, flow_type: "income", paid: false },
  { date: "2026-12-31", value: 12, paid: true },
];

test("compara cada mês com o anterior como comparePreviousMonth, inclusive janeiro com dezembro", () => {
  for (const status of ["", "paid", "pending"]) {
    const summary = monthlyCashFlow(entries, 2026, { status });
    const december = monthlyCashFlow(entries, 2025, { status }).months[11];
    view.comparisons(summary, december).forEach((comparison, index) => {
      const expected = comparePreviousMonth(entries, summary.months[index].month, { status });
      assert.deepEqual(comparison.previous, expected.previous, `${status} ${index}`);
      assert.deepEqual(comparison.difference, expected.difference, `${status} ${index}`);
    });
  }
});

test("sem dezembro anterior, janeiro fica sem comparação e os demais meses continuam comparados", () => {
  const compared = view.comparisons(monthlyCashFlow([], 1900), null);
  assert.equal(compared[0], null);
  assert.ok(compared.slice(1).every(Boolean));
});

test("resumo do ano e meses descrevem situação, sinais e lançamentos de cada mês", () => {
  const summary = monthlyCashFlow(entries, 2026, { status: "paid" });
  assert.equal(view.statusText(summary), "2026 · 3 lançamentos realizados.");
  assert.equal(view.statusText(monthlyCashFlow([], 2030)), "2030 · 0 lançamentos realizados e previstos. Nenhum lançamento neste ano com a situação selecionada.");
  const months = view.monthsMarkup(summary, null, { money });
  assert.equal((months.match(/data-cash-flow-month=/g) || []).length, 12);
  assert.match(months, /data-cash-flow-month="2026-02"[\s\S]*?Sem lançamentos[\s\S]*?disabled>Ver lançamentos/);
  assert.match(view.annualMarkup(summary, { money }), /Saldo do ano<\/span><strong data-negative="false">R\$ 248\.34/);
  assert.equal(view.yearOptions(new Set([2024, 2026, 2025]), 2025), '<option value="2026" >2026</option><option value="2025" selected>2025</option><option value="2024" >2024</option>');
});
