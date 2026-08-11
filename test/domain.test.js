const assert = require("node:assert/strict");

global.window = global;
require("../js/domain.js");

const {
  addMonthsClamped,
  adjustBusinessDay,
  generateRecurringOccurrences,
  dailyEntryTotals,
  dailyEntryNet,
  projectedBalance,
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

console.log("domain tests: ok");
