const assert = require("node:assert/strict");

global.window = global;
require("../js/domain.js");

const {
  addMonthsClamped,
  adjustBusinessDay,
  generateRecurringOccurrences,
  dailyEntryTotals,
  dailyEntryNet,
  recentEntries,
  recentEntryGroups,
  descriptionOptionsForType,
  typeColorMap,
  recurringEntryFormValues,
  reconcileSeriesEntries,
  projectedBalance,
  minimumProjectedBalance,
} = global.MGDomain;

function series(overrides = {}) {
  return {
    start_date: "2026-01-31",
    frequency: "monthly",
    interval_value: 1,
    end_mode: "never",
    end_date: null,
    occurrence_count: null,
    business_day_adjustment: "none",
    ...overrides,
  };
}

assert.equal(addMonthsClamped("2024-01-31", 1), "2024-02-29");
assert.equal(addMonthsClamped("2026-01-31", 1), "2026-02-28");
assert.equal(addMonthsClamped("2026-01-31", 2), "2026-03-31");

assert.equal(adjustBusinessDay("2026-08-01", "previous"), "2026-07-31");
assert.equal(adjustBusinessDay("2026-08-01", "next"), "2026-08-03");
assert.equal(adjustBusinessDay("2026-08-03", "next"), "2026-08-03");

assert.deepEqual(
  generateRecurringOccurrences(series(), "2026-01-01", "2026-04-30")
    .map(({ scheduled_date, date }) => ({ scheduled_date, date })),
  [
    { scheduled_date: "2026-01-31", date: "2026-01-31" },
    { scheduled_date: "2026-02-28", date: "2026-02-28" },
    { scheduled_date: "2026-03-31", date: "2026-03-31" },
    { scheduled_date: "2026-04-30", date: "2026-04-30" },
  ],
);

assert.deepEqual(
  generateRecurringOccurrences(
    series({
      start_date: "2026-08-01",
      frequency: "weekly",
      end_mode: "after_occurrences",
      occurrence_count: 3,
      business_day_adjustment: "next",
    }),
    "2026-08-01",
    "2026-12-31",
  ).map(({ scheduled_date, date }) => ({ scheduled_date, date })),
  [
    { scheduled_date: "2026-08-01", date: "2026-08-03" },
    { scheduled_date: "2026-08-08", date: "2026-08-10" },
    { scheduled_date: "2026-08-15", date: "2026-08-17" },
  ],
);

assert.deepEqual(
  generateRecurringOccurrences(
    series({ end_mode: "on_date", end_date: "2026-03-01" }),
    "2026-01-01",
    "2026-12-31",
  ).map((item) => item.scheduled_date),
  ["2026-01-31", "2026-02-28"],
);

assert.deepEqual(
  generateRecurringOccurrences(
    series({ start_date: "2024-02-29", frequency: "annual", occurrence_count: 3 }),
    "2024-01-01",
    "2027-12-31",
  ).map((item) => item.scheduled_date),
  ["2024-02-29", "2025-02-28", "2026-02-28"],
);

assert.deepEqual(
  generateRecurringOccurrences(
    series({ start_date: "2026-08-01", frequency: "custom", custom_unit: "day", interval_value: 10, occurrence_count: 3 }),
    "2026-08-01",
    "2026-12-31",
  ).map((item) => item.scheduled_date),
  ["2026-08-01", "2026-08-11", "2026-08-21"],
);

const entries = [
  { date: "2026-08-02", value: 100, flow_type: "expense" },
  { date: "2026-08-02", value: 25, flow_type: "income" },
  { date: "2026-08-03", value: -10 },
  { date: "2026-08-02", value: 999, flow_type: "expense", excluded_from_series: true },
];
assert.equal(dailyEntryTotals(entries).get("2026-08-02"), 100);
assert.equal(dailyEntryNet(entries).get("2026-08-02"), -75);
assert.equal(dailyEntryNet(entries).get("2026-08-03"), 10);

assert.deepEqual(
  recentEntries([
    { id: "older", date: "2026-09-01", created_at: "2026-08-01T10:00:00.000Z" },
    { id: "newer", date: "2026-01-01", created_at: "2026-08-10T10:00:00.000Z" },
    { id: "legacy", date: "2026-07-01" },
    { id: "excluded", date: "2026-12-01", excluded_from_series: true },
  ]).map((entry) => entry.id),
  ["newer", "older", "legacy"],
);

const groupedRecent = recentEntryGroups([
  { id: "single", date: "2026-08-10", created_at: "2026-08-10T12:00:00.000Z" },
  { id: "series-1", series_id: "rent", date: "2026-09-01", created_at: "2026-08-09T12:00:00.000Z" },
  { id: "series-2", series_id: "rent", date: "2026-10-01", created_at: "2026-08-09T12:00:01.000Z" },
  { id: "installment-1", description: "NOTEBOOK", type: "COMPRA", date: "2026-08-08", created_at: "2026-08-08T12:00:00.000Z", installment: { current: 1, total: 2 } },
  { id: "installment-2", description: "NOTEBOOK", type: "COMPRA", date: "2026-09-08", created_at: "2026-08-08T12:00:00.000Z", installment: { current: 2, total: 2 } },
]);
assert.equal(groupedRecent.length, 3);
assert.equal(groupedRecent[1].entries.length, 2);
assert.equal(groupedRecent[2].entries.length, 2);

assert.deepEqual(
  descriptionOptionsForType({
    selectedType: "MORADIA",
    entries: [
      { type: "MORADIA", description: "ALUGUEL" },
      { type: "MORADIA", description: "CONDOMÍNIO ANTIGO" },
      { type: "TRANSPORTE", description: "COMBUSTÍVEL" },
      { type: "MORADIA", description: "" },
    ],
    defaultOptions: ["ALUGUEL", "ENERGIA"],
    customOptions: ["REFORMA", "OPÇÃO SEM USO"],
    hiddenOptions: ["CONDOMÍNIO ANTIGO", "OPÇÃO SEM USO"],
  }),
  ["ALUGUEL", "ENERGIA", "REFORMA", "CONDOMÍNIO ANTIGO"],
);

assert.deepEqual(
  descriptionOptionsForType({
    selectedType: "MORADIA",
    selectedDescription: "OPÇÃO EM EDIÇÃO",
    hiddenOptions: ["OPÇÃO EM EDIÇÃO"],
  }),
  ["OPÇÃO EM EDIÇÃO"],
);

const registeredTypes = Array.from({ length: 30 }, (_, index) => `TIPO ${index + 1}`);
const registeredTypeColors = typeColorMap(registeredTypes);
assert.equal(registeredTypeColors.size, registeredTypes.length);
assert.equal(new Set(registeredTypeColors.values()).size, registeredTypes.length);
assert.deepEqual(
  [...typeColorMap([...registeredTypes].reverse()).entries()],
  [...registeredTypeColors.entries()],
);

const recurringOccurrence = {
  id: "occurrence",
  date: "2026-08-10",
  value: 100,
  flow_type: "expense",
  type: "MORADIA",
  description: "ALUGUEL ANTIGO",
  detail: "Valor materializado",
  paid: true,
  detached_from_series: false,
};
const currentSeries = {
  value: 120,
  flow_type: "expense",
  type: "MORADIA",
  description: "ALUGUEL ATUALIZADO",
  detail: "Valor atual da série",
};
assert.deepEqual(
  recurringEntryFormValues(recurringOccurrence, currentSeries),
  {
    ...recurringOccurrence,
    value: 120,
    description: "ALUGUEL ATUALIZADO",
    detail: "Valor atual da série",
  },
);
assert.equal(
  recurringEntryFormValues(
    { ...recurringOccurrence, detached_from_series: true },
    currentSeries,
  ).description,
  "ALUGUEL ANTIGO",
);

const reconciledSeries = reconcileSeriesEntries(
  [
    {
      id: "paid",
      series_id: "old-series",
      scheduled_date: "2026-08-10",
      date: "2026-08-10",
      description: "ANTIGA",
      paid: true,
      detached_from_series: false,
    },
    {
      id: "detached",
      series_id: "old-series",
      scheduled_date: "2026-09-10",
      date: "2026-09-10",
      description: "EXCEÇÃO ANTIGA",
      paid: false,
      detached_from_series: true,
    },
    {
      id: "excluded",
      series_id: "old-series",
      scheduled_date: "2026-10-10",
      date: "2026-10-10",
      description: "EXCLUÍDA",
      detached_from_series: true,
      excluded_from_series: true,
    },
  ],
  [
    { scheduled_date: "2026-08-10", date: "2026-08-10" },
    { scheduled_date: "2026-09-10", date: "2026-09-10" },
    { scheduled_date: "2026-10-10", date: "2026-10-10" },
    { scheduled_date: "2026-11-10", date: "2026-11-10" },
  ],
  {
    id: "new-series",
    flow_type: "expense",
    value: 150,
    type: "MORADIA",
    description: "DESCRIÇÃO NOVA",
    detail: "DETALHE NOVO",
  },
);
assert.deepEqual(
  reconciledSeries.upserts.map((entry) => ({
    id: entry.id,
    series_id: entry.series_id,
    description: entry.description,
    detached: entry.detached_from_series,
    excluded: entry.excluded_from_series,
    paid: entry.paid,
  })),
  [
    { id: "paid", series_id: "new-series", description: "DESCRIÇÃO NOVA", detached: false, excluded: false, paid: true },
    { id: "detached", series_id: "new-series", description: "DESCRIÇÃO NOVA", detached: false, excluded: false, paid: false },
    { id: "excluded", series_id: "new-series", description: "EXCLUÍDA", detached: true, excluded: true, paid: undefined },
  ],
);
assert.deepEqual(reconciledSeries.missingOccurrences, [
  { scheduled_date: "2026-11-10", date: "2026-11-10" },
]);
assert.deepEqual(reconciledSeries.staleEntries, []);

assert.equal(
  projectedBalance(
    "2026-08-02",
    {
      current_balance: 1000,
      balance_reference_date: "2026-08-01",
    },
    dailyEntryNet(entries),
  ),
  925,
);

const incomeBeforeExpense = dailyEntryNet([
  { date: "2026-08-27", value: 700, flow_type: "income" },
  { date: "2026-08-28", value: 1000, flow_type: "expense" },
]);
assert.deepEqual(
  minimumProjectedBalance(
    "2026-08-26",
    "2026-08-28",
    { current_balance: 500, balance_reference_date: "2026-08-26" },
    incomeBeforeExpense,
  ),
  { date: "2026-08-28", balance: 200 },
);

const incomeAfterExpense = dailyEntryNet([
  { date: "2026-08-27", value: 1000, flow_type: "expense" },
  { date: "2026-08-28", value: 700, flow_type: "income" },
]);
assert.deepEqual(
  minimumProjectedBalance(
    "2026-08-26",
    "2026-08-28",
    { current_balance: 500, balance_reference_date: "2026-08-26" },
    incomeAfterExpense,
  ),
  { date: "2026-08-27", balance: -500 },
);

console.log("domain tests: ok");
