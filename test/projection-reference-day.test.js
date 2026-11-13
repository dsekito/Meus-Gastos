const assert = require("node:assert/strict");

global.window = global;
require("../js/domain.js");

const {
  dailyEntryNet,
  dailyEntryTotals,
  dailyIncomeTotals,
  dailyPendingNet,
  minimumProjectedBalance,
  projectedBalance,
  sumEntryValues,
} = global.MGDomain;

function project(date, settings, entries) {
  return projectedBalance(date, settings, dailyEntryNet(entries), dailyPendingNet(entries));
}

const settings = { current_balance: 3240, balance_reference_date: "2026-11-12" };

// An open bill dated on the reference date is not in the informed balance yet:
// it must reduce today's projection, the month end and every later day.
{
  const entries = [
    { date: "2026-11-12", value: 186.5, flow_type: "expense", paid: false },
    { date: "2026-11-14", value: 5200, flow_type: "income", paid: false },
    { date: "2026-11-17", value: 250.33, flow_type: "expense", paid: false },
  ];
  assert.equal(project("2026-11-12", settings, entries), 3053.5);
  assert.equal(project("2026-11-30", settings, entries), 8003.17);
  assert.deepEqual(
    minimumProjectedBalance("2026-11-12", "2026-11-18", settings, dailyEntryNet(entries), dailyPendingNet(entries)),
    { date: "2026-11-12", balance: 3053.5 },
  );
}

// A paid entry on the reference date is already inside the informed balance.
{
  const entries = [{ date: "2026-11-12", value: 186.5, flow_type: "expense", paid: true }];
  assert.equal(project("2026-11-12", settings, entries), 3240);
  assert.equal(project("2026-11-30", settings, entries), 3240);
}

// An open receivable on the reference date is added; open refunds (negative
// expenses) increase the balance.
{
  const entries = [
    { date: "2026-11-12", value: 100, flow_type: "income", paid: false },
    { date: "2026-11-12", value: -20.01, flow_type: "expense", paid: false },
  ];
  assert.equal(project("2026-11-12", settings, entries), 3360.01);
}

// Past dates: the open entries of the reference date are still pending, so the
// end of the previous day is the informed balance minus only what was paid.
{
  const entries = [
    { date: "2026-11-12", value: 40, flow_type: "expense", paid: true },
    { date: "2026-11-12", value: 60, flow_type: "expense", paid: false },
  ];
  assert.equal(project("2026-11-11", settings, entries), 3280);
  assert.equal(project("2026-11-12", settings, entries), 3180);
}

// Month lengths and year turn: the reference-day offset applies to any date.
{
  const entries = [{ date: "2028-02-29", value: 10, flow_type: "expense", paid: false }];
  const leap = { current_balance: 100, balance_reference_date: "2028-02-29" };
  for (const date of ["2028-02-29", "2028-03-31", "2028-04-30", "2029-01-01"]) {
    assert.equal(project(date, leap, entries), 90);
  }
  const turn = { current_balance: 0, balance_reference_date: "2026-12-31" };
  const yearEnd = [
    { date: "2026-12-31", value: 0.01, flow_type: "expense", paid: false },
    { date: "2027-01-01", value: 0.02, flow_type: "income", paid: false },
  ];
  assert.equal(project("2027-01-01", turn, yearEnd), 0.01);
  assert.equal(project("2026-12-30", turn, yearEnd), 0);
}

// Without a pending map the projection keeps its former behaviour.
assert.equal(projectedBalance("2026-11-12", settings, new Map()), 3240);

// Empty lists.
assert.equal(project("2026-11-30", settings, []), 3240);
assert.equal(dailyPendingNet([]).size, 0);
assert.equal(sumEntryValues([]), 0);

// Daily maps and sums are exact in cents, even with many odd values.
{
  const dimes = Array.from({ length: 1000 }, () => ({ date: "2026-11-13", value: 0.1, flow_type: "expense" }));
  assert.equal(dailyEntryTotals(dimes).get("2026-11-13"), 100);
  assert.equal(dailyEntryNet(dimes).get("2026-11-13"), -100);
  assert.equal(sumEntryValues(dimes), 100);
  const mixed = [
    { date: "2026-11-13", value: 0.1, flow_type: "income" },
    { date: "2026-11-13", value: 0.2, flow_type: "income" },
    { date: "2026-11-13", value: 0.33, flow_type: "expense" },
  ];
  assert.equal(dailyIncomeTotals(mixed).get("2026-11-13"), 0.3);
  assert.equal(sumEntryValues(mixed, { signed: true }), -0.03);
  assert.equal(sumEntryValues([{ value: 33.33 }, { value: 33.33 }, { value: 33.34 }]), 100);
  // Excluded series slots never count.
  assert.equal(dailyEntryNet([{ date: "2026-11-13", value: 5, excluded_from_series: true }]).size, 0);
}

console.log("projection reference day tests: ok");
