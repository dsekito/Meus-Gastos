const assert = require("node:assert/strict");
const { test } = require("node:test");

global.window = global;
require("../js/domain.js");
const domain = global.MGDomain;

function series(overrides = {}) {
  return {
    id: "audit-series", start_date: "2000-01-01", frequency: "custom",
    custom_unit: "day", interval_value: 1, end_mode: "never",
    occurrence_count: null, business_day_adjustment: "none", ...overrides,
  };
}

test("hidden historical descriptions do not return in fresh form choices", () => {
  const entries = Object.freeze([Object.freeze({ type: "HOME", description: "HIDDEN" })]);
  assert.deepEqual(domain.descriptionOptionsForType({
    selectedType: "HOME", entries, hiddenOptions: ["HIDDEN"],
  }), []);
  assert.equal(entries[0].description, "HIDDEN", "history remains unchanged for display");
});

test("editing retains only its selected hidden description without restoring other hidden choices", () => {
  assert.deepEqual(domain.descriptionOptionsForType({
    selectedType: "HOME", selectedDescription: "HIDDEN",
    entries: [{ type: "HOME", description: "HIDDEN" }, { type: "HOME", description: "OTHER HIDDEN" },
      { type: "HOME", description: "VISIBLE HISTORY" }, { type: "OTHER", description: "UNRELATED" }],
    defaultOptions: ["DEFAULT", "HIDDEN"], customOptions: ["CUSTOM", "DEFAULT"],
    hiddenOptions: ["HIDDEN", "OTHER HIDDEN"],
  }), ["DEFAULT", "HIDDEN", "CUSTOM", "VISIBLE HISTORY"]);
});

test("old never-ending daily series reaches 2026 with lifetime slot numbers", () => {
  const occurrences = domain.generateRecurringOccurrences(series(), "2026-01-01", "2026-01-03");
  assert.deepEqual(occurrences, [
    { index: 9498, scheduled_date: "2026-01-01", date: "2026-01-01" },
    { index: 9499, scheduled_date: "2026-01-02", date: "2026-01-02" },
    { index: 9500, scheduled_date: "2026-01-03", date: "2026-01-03" },
  ]);
});

test("audited full-year daily range returns every scheduled day in 2026", () => {
  const occurrences = domain.generateRecurringOccurrences(series(), "2026-01-01", "2026-12-31");
  assert.equal(occurrences.length, 365);
  assert.equal(occurrences[0].scheduled_date, "2026-01-01");
  assert.equal(occurrences.at(-1).scheduled_date, "2026-12-31");
  assert.ok(occurrences.every((item, offset) => item.index === occurrences[0].index + offset));
});

test("count end remains a lifetime limit beyond slot 5000 and is not reset by a later range", () => {
  const counted = series({ end_mode: "after_occurrences", occurrence_count: 9499 });
  assert.deepEqual(domain.generateRecurringOccurrences(counted, "2026-01-01", "2026-01-10")
    .map(item => item.index), [9498, 9499]);
  assert.deepEqual(domain.generateRecurringOccurrences(counted, "2026-01-03", "2026-02-01"), []);
  assert.deepEqual(domain.generateRecurringOccurrences(series({ occurrence_count: 3 }),
    "2026-01-01", "2026-01-03"), [], "retain legacy explicit count with never mode");
});

test("until date includes its scheduled slot and compares before weekend adjustment", () => {
  const dated = series({ end_mode: "on_date", end_date: "2026-08-02", business_day_adjustment: "next" });
  assert.deepEqual(domain.generateRecurringOccurrences(dated, "2026-08-01", "2026-08-05")
    .map(item => [item.scheduled_date, item.date]), [
    ["2026-08-01", "2026-08-03"], ["2026-08-02", "2026-08-03"],
  ]);
  assert.deepEqual(domain.generateRecurringOccurrences(dated, "2026-08-03", "2026-08-05"), []);
});

test("range inclusion is scheduled-date based even when weekend shifts cross either boundary", () => {
  for (const [adjustment, expected] of [["previous", "2026-07-31"], ["next", "2026-08-03"]]) {
    const shifted = series({ business_day_adjustment: adjustment });
    assert.equal(domain.generateRecurringOccurrences(shifted, "2026-08-01", "2026-08-01")[0].date, expected);
  }
});

test("month-end and leap-year anchors survive seeking without iterative clamp drift", () => {
  const monthly = series({ start_date: "1900-01-31", frequency: "monthly" });
  assert.deepEqual(domain.generateRecurringOccurrences(monthly, "2026-02-01", "2026-04-30")
    .map(item => item.scheduled_date), ["2026-02-28", "2026-03-31", "2026-04-30"]);
  const annual = series({ start_date: "2000-02-29", frequency: "annual" });
  assert.deepEqual(domain.generateRecurringOccurrences(annual, "2026-03-01", "2028-03-01")
    .map(item => item.scheduled_date), ["2027-02-28", "2028-02-29"]);
  assert.deepEqual(domain.generateRecurringOccurrences(monthly, "2026-03-01", "2026-02-28"), []);
  assert.deepEqual(domain.generateRecurringOccurrences(monthly, "1899-01-01", "1899-12-31"), []);
});

test("long-lived generated slots still reserve detached and excluded exceptions without changing ordinary ID reuse", () => {
  const current = series({ value: 100, type: "HOME", description: "RENT", flow_type: "expense" });
  const occurrences = domain.generateRecurringOccurrences(current, "2026-01-01", "2026-01-05");
  const detached = Object.freeze({ id: "moved", series_id: current.id, scheduled_date: "2026-01-02",
    date: "2025-12-01", detached_from_series: true, value: 999, paid: true, detail: "Keep me" });
  const excluded = Object.freeze({ id: "deleted", series_id: current.id, scheduled_date: "2026-01-04",
    date: "2026-01-04", excluded_from_series: true, paid: false });
  const result = domain.reconcileSeriesEntries([
    { id: "later", scheduled_date: "2026-01-05", paid: false }, excluded, detached,
    { id: "earlier", scheduled_date: "2026-01-01", paid: true },
  ], occurrences, current);
  assert.deepEqual(result.upserts.map(item => [item.id, item.scheduled_date, item.paid]),
    [["earlier", "2026-01-01", true], ["later", "2026-01-03", false]]);
  assert.deepEqual(result.missingOccurrences.map(item => [item.scheduled_date, item.index]), [["2026-01-05", 9502]]);
  assert.deepEqual(result.staleEntries, []);
  assert.equal(detached.value, 999);
  assert.equal(excluded.excluded_from_series, true);
});

test("seeking an ancient daily series does not walk millions of skipped positions", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  let dateConstructions = 0;
  class CountedDate extends Date {
    constructor(...args) { super(...args); dateConstructions++; }
  }
  const sandbox = { window: {}, Date: CountedDate };
  vm.runInNewContext(fs.readFileSync(require.resolve("../js/domain.js"), "utf8"), sandbox);
  const result = sandbox.window.MGDomain.generateRecurringOccurrences(
    series({ start_date: "1900-01-01" }), "9998-01-01", "9998-01-03");
  assert.equal(result.length, 3);
  assert.ok(dateConstructions < 20, `expected window-sized work, constructed ${dateConstructions} dates`);
});

// Slow, anchored oracle characterizes the existing schedule, independent of seeking.
function referenceOccurrences(schedule, from, to) {
  const result = [];
  const unit = schedule.frequency === "custom" ? schedule.custom_unit || "day"
    : { weekly: "week", monthly: "month", annual: "year" }[schedule.frequency];
  const interval = Math.max(1, Number(schedule.interval_value) || 1);
  for (let index = 0; index < (Number(schedule.occurrence_count) || 20000); index++) {
    const scheduled = unit === "month" || unit === "year"
      ? domain.addMonthsClamped(schedule.start_date, index * interval * (unit === "year" ? 12 : 1))
      : domain.addDays(schedule.start_date, index * interval * (unit === "week" ? 7 : 1));
    if (scheduled > to || (schedule.end_mode === "on_date" && scheduled > schedule.end_date)) break;
    if (scheduled >= from) result.push({ index: index + 1, scheduled_date: scheduled,
      date: domain.adjustBusinessDay(scheduled, schedule.business_day_adjustment) });
  }
  return result;
}

test("range-aware seeking matches anchored chronology across all supported frequencies and units", () => {
  const schedules = [
    { frequency: "weekly" }, { frequency: "monthly" }, { frequency: "annual" },
    ...["day", "week", "month", "year"].map(custom_unit => ({ frequency: "custom", custom_unit })),
  ];
  for (const frequency of schedules) for (const interval_value of [1, 2, 3]) {
    for (const business_day_adjustment of ["none", "previous", "next"]) {
      const schedule = series({ start_date: "2000-01-31", ...frequency, interval_value, business_day_adjustment });
      assert.deepEqual(domain.generateRecurringOccurrences(schedule, "2026-02-28", "2026-04-30"),
        referenceOccurrences(schedule, "2026-02-28", "2026-04-30"), JSON.stringify(schedule));
    }
  }
});
