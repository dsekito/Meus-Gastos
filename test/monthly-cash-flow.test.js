const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../js/domain.js');
const { monthlyCashFlow } = MGDomain;

test('classifica A RECEBER como entrada em todos os cálculos, inclusive registros antigos', () => {
  const rows = [
    { date: '2026-01-01', value: 1000, type: ' A   RECEBER ', flow_type: 'expense', paid: false },
    { date: '2026-01-01', value: 20, status: 'a receber', paid: true },
    { date: '2026-01-01', value: 100, flow_type: 'expense' },
  ];
  assert.equal(MGDomain.entryFlowType(rows[0]), 'income');
  assert.equal(MGDomain.entryStatusLabel(rows[0]), 'A receber');
  assert.equal(MGDomain.entryStatusLabel(rows[1]), 'Recebido');
  assert.equal(MGDomain.dailyIncomeTotals(rows).get('2026-01-01'), 1020);
  assert.equal(MGDomain.dailyEntryTotals(rows).get('2026-01-01'), 100);
  assert.equal(MGDomain.dailyEntryNet(rows).get('2026-01-01'), 920);
  assert.deepEqual(monthlyCashFlow(rows, 2026).totals, { income: 1020, expense: 100, balance: 920, count: 3 });
  assert.equal(MGDomain.entryFlowType({ type: 'MORADIA', description: 'a receber de terceiro' }), 'expense');
});

const entries = [
  { date: '2026-01-10', value: 1000, flow_type: 'income', paid: true },
  { date: '2026-01-15', value: 200, paid: true },
  { date: '2026-01-20', value: 100, flow_type: 'expense', paid: false },
  { date: '2026-02-10', value: 50, flow_type: 'income', paid: false },
  { date: '2026-02-11', value: 120, flow_type: 'expense', paid: false },
  { date: '2026-02-12', value: -20, flow_type: 'expense', paid: true },
  { date: '2026-02-13', value: 9999, flow_type: 'income', excluded_from_series: true },
  { date: '2025-12-31', value: 9999, flow_type: 'income', paid: true },
];

test('consolida 12 meses e o acumulado sem incluir saldo inicial ou ocorrências excluídas', () => {
  const result = monthlyCashFlow(entries, 2026);
  assert.equal(result.months.length, 12);
  assert.deepEqual(result.months[0], { month: '2026-01', income: 1000, expense: 300, balance: 700, accumulated: 700, count: 3 });
  assert.deepEqual(result.months[1], { month: '2026-02', income: 50, expense: 100, balance: -50, accumulated: 650, count: 3 });
  assert.deepEqual(result.months[2], { month: '2026-03', income: 0, expense: 0, balance: 0, accumulated: 650, count: 0 });
  assert.deepEqual(result.totals, { income: 1050, expense: 400, balance: 650, count: 6 });
});

test('realizados e previstos reconciliam com o total do ano', () => {
  const paid = monthlyCashFlow(entries, 2026, { status: 'paid' });
  const pending = monthlyCashFlow(entries, 2026, { status: 'pending' });
  assert.deepEqual(paid.totals, { income: 1000, expense: 180, balance: 820, count: 3 });
  assert.deepEqual(pending.totals, { income: 50, expense: 220, balance: -170, count: 3 });
  assert.equal(paid.totals.balance + pending.totals.balance, monthlyCashFlow(entries, 2026).totals.balance);
});

test('soma centavos e parcelas por ocorrência sem repetir o valor original da compra', () => {
  const result = monthlyCashFlow([
    { date: '2026-01-10', value: .1, flow_type: 'income' },
    { date: '2026-01-10', value: .2, flow_type: 'income' },
    { date: '2026-01-15', value: 33.33, installment: { original: 100, total: 3, current: 1 } },
    { date: '2026-02-15', value: 33.33, installment: { original: 100, total: 3, current: 2 } },
    { date: '2026-03-15', value: 33.34, installment: { original: 100, total: 3, current: 3 } },
  ], 2026);
  assert.equal(result.months[0].income, .3);
  assert.equal(result.totals.expense, 100);
  assert.equal(result.totals.balance, -99.7);
});

test('anos sem registros ficam zerados e entradas inválidas não contaminam totais', () => {
  assert.equal(monthlyCashFlow(entries, 2027).totals.count, 0);
  assert.equal(monthlyCashFlow([{ date: null, value: 1 }, { date: '2026-13-01', value: 1 }, { date: '2026-01-01', value: Infinity }], 2026).totals.count, 0);
  assert.throws(() => monthlyCashFlow(entries, 0), RangeError);
  assert.throws(() => monthlyCashFlow(entries, 2026, { status: 'unknown' }), RangeError);
});
