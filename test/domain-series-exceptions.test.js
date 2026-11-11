const assert = require("node:assert/strict");
const { test } = require("node:test");

global.window = global;
require("../js/domain.js");
const { reconcileSeriesEntries, generateRecurringOccurrences } = global.MGDomain;

const series = {
  id: "original-series", start_date: "2026-01-10", frequency: "monthly",
  interval_value: 1, end_mode: "after_occurrences", occurrence_count: 1,
  business_day_adjustment: "none", value: 100, flow_type: "expense",
  type: "MORADIA", description: "ALUGUEL", detail: "Padrão da série",
};
const occurrence = (date) => ({ scheduled_date: date, date });
const normal = (id, date) => ({
  id, series_id: series.id, ...occurrence(date), value: 80,
  detached_from_series: false, excluded_from_series: false, paid: true,
});
const customized = (overrides = {}) => ({
  ...normal("customized", "2026-03-10"), date: "2026-03-12",
  detached_from_series: true, value: 999, flow_type: "income",
  type: "PERSONALIZADO", description: "Exceção", detail: "Não sobrescrever",
  created_at: "2026-01-01T12:00:00.000Z", ...overrides,
});

test("same scheduled date remains reserved by a moved detached occurrence without regeneration", () => {
  const detached = Object.freeze(customized());
  const original = { ...detached };
  const result = reconcileSeriesEntries(
    [detached], [occurrence(detached.scheduled_date)], series,
  );
  assert.deepEqual(result.upserts, [], "customizations must not be overwritten or reabsorbed");
  assert.deepEqual(result.missingOccurrences, [], "the original slot must not be regenerated");
  assert.deepEqual(result.staleEntries, []);
  assert.deepEqual(detached, original, "input remains untouched");
});

test("future split reparents exceptions even outside the new schedule, preserving identity and paid state", () => {
  const nextSeries = { ...series, id: "future-series", start_date: "2026-02-10" };
  const detached = Object.freeze(customized({ date: "2026-01-05" }));
  const excluded = Object.freeze(customized({
    id: "excluded", scheduled_date: "2026-04-10", excluded_from_series: true, paid: false,
  }));
  const beforeCut = normal("past", "2026-01-10");
  const atCut = normal("at-cut", "2026-02-10");
  // The actual caller selects the source series and scheduled-date cut, not display date.
  const stored = [beforeCut, atCut, detached, excluded];
  const selected = stored.filter(entry => entry.series_id === series.id
    && (entry.scheduled_date || entry.date) >= nextSeries.start_date);
  const result = reconcileSeriesEntries(selected,
    generateRecurringOccurrences(nextSeries, nextSeries.start_date, "2026-12-31"), nextSeries);
  assert.deepEqual(result.upserts.find(entry => entry.id === detached.id),
    { ...detached, series_id: nextSeries.id });
  assert.deepEqual(result.upserts.find(entry => entry.id === excluded.id),
    { ...excluded, series_id: nextSeries.id });
  assert.equal(result.upserts.find(entry => entry.id === atCut.id).paid, true);
  assert.deepEqual(result.staleEntries, []);
  assert.deepEqual(result.missingOccurrences, []);
  assert.equal(beforeCut.series_id, series.id);
  // Apply exactly the caller's upsert/delete/create contract, then reconcile again.
  const applied = stored.map(entry => result.upserts.find(update => update.id === entry.id) || entry);
  assert.equal(applied.find(entry => entry.id === beforeCut.id), beforeCut);
  const futureEntries = applied.filter(entry => entry.series_id === nextSeries.id);
  const repeated = reconcileSeriesEntries(futureEntries,
    [occurrence("2026-02-10"), occurrence("2026-03-10"), occurrence("2026-04-10")], nextSeries);
  assert.deepEqual(repeated.missingOccurrences, []);
  assert.deepEqual(repeated.staleEntries, []);
  assert.deepEqual(repeated.upserts.map(entry => entry.id), [atCut.id]);
});

test("normal reconciliation retains chronological ID/paid reuse when dates change, shrink, or expand", () => {
  const first = normal("first", "2026-01-10");
  const second = { ...normal("second", "2026-02-10"), paid: false };
  const shortened = reconcileSeriesEntries([second, first], [occurrence("2026-05-11")], series);
  assert.deepEqual(shortened.upserts, [{
    ...first, ...occurrence("2026-05-11"), flow_type: series.flow_type,
    value: series.value, type: series.type, description: series.description, detail: series.detail,
  }]);
  assert.deepEqual(shortened.staleEntries, [second]);
  assert.deepEqual(shortened.missingOccurrences, []);
  const dates = [occurrence("2026-05-11"), occurrence("2026-06-11"), occurrence("2026-07-11")];
  const expanded = reconcileSeriesEntries([second, first], dates, series);
  assert.deepEqual(expanded.upserts.map(entry => [entry.id, entry.paid, entry.scheduled_date]),
    [["first", true, dates[0].scheduled_date], ["second", false, dates[1].scheduled_date]]);
  assert.deepEqual(expanded.staleEntries, []);
  assert.deepEqual(expanded.missingOccurrences, [dates[2]]);
});

for (const flags of [
  { detached_from_series: true, excluded_from_series: false },
  { detached_from_series: false, excluded_from_series: true },
  { detached_from_series: true, excluded_from_series: true },
]) {
  test(`exceptions reserve legacy date fallback and survive empty schedules: ${JSON.stringify(flags)}`, () => {
    const exception = Object.freeze(customized({ ...flags, scheduled_date: null }));
    const matching = reconcileSeriesEntries([exception], [occurrence(exception.date)], series);
    assert.deepEqual(matching, { upserts: [], staleEntries: [], missingOccurrences: [] });
    const empty = reconcileSeriesEntries([exception], [], series);
    assert.deepEqual(empty, { upserts: [], staleEntries: [], missingOccurrences: [] });
  });
}

test("shortening deletes only obsolete normal entries, never detached or excluded exceptions", () => {
  const detached = Object.freeze(customized());
  const excluded = Object.freeze(customized({
    id: "excluded", scheduled_date: "2026-04-10", excluded_from_series: true,
  }));
  const obsolete = normal("obsolete", "2026-02-10");
  const result = reconcileSeriesEntries(
    [excluded, detached, obsolete, normal("first", "2026-01-10")],
    generateRecurringOccurrences(series, series.start_date, "2026-12-31"), series,
  );
  assert.deepEqual(result.staleEntries, [obsolete]);
  assert.deepEqual(result.upserts.map(entry => entry.id), ["first"]);
  assert.deepEqual(result.missingOccurrences, []);
});
