const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.window = global;
require("../js/domain.js");

const { referenceBalanceAdjustment, projectedBalance, dailyEntryNet, dailyPendingNet } = global.MGDomain;
const root = path.resolve(__dirname, "..");
const settings = { current_balance: 3240, balance_reference_date: "2026-11-12" };
const bill = { date: "2026-11-12", value: 186.5, flow_type: "expense", paid: false, description: "SUPERMERCADO" };

// Paying an open bill of the reference date lowers the informed balance.
assert.deepEqual(referenceBalanceAdjustment(bill, true, settings), { from: 3240, to: 3053.5 });

// Reopening it gives the value back.
assert.deepEqual(referenceBalanceAdjustment({ ...bill, paid: true }, false, settings), { from: 3240, to: 3426.5 });

// Receiving income raises it; reopening income lowers it.
const salary = { date: "2026-11-12", value: 5200, flow_type: "income", paid: false };
assert.deepEqual(referenceBalanceAdjustment(salary, true, settings), { from: 3240, to: 8440 });
assert.deepEqual(referenceBalanceAdjustment({ ...salary, paid: true }, false, settings), { from: 3240, to: -1960 });

// A refund stored as a negative expense raises the balance when paid.
assert.deepEqual(referenceBalanceAdjustment({ ...bill, value: -20.01 }, true, settings), { from: 3240, to: 3260.01 });

// Odd cents stay exact.
assert.deepEqual(
  referenceBalanceAdjustment({ ...bill, value: 0.1 }, true, { current_balance: 0.2, balance_reference_date: "2026-11-12" }),
  { from: 0.2, to: 0.1 },
);

// No offer outside the reference date, without a status change, for excluded
// occurrences, zero values or missing settings.
assert.equal(referenceBalanceAdjustment({ ...bill, date: "2026-11-13" }, true, settings), null);
assert.equal(referenceBalanceAdjustment({ ...bill, paid: true }, true, settings), null);
assert.equal(referenceBalanceAdjustment({ ...bill, excluded_from_series: true }, true, settings), null);
assert.equal(referenceBalanceAdjustment({ ...bill, value: 0 }, true, settings), null);
assert.equal(referenceBalanceAdjustment(bill, true, {}), null);
assert.equal(referenceBalanceAdjustment(null, true, settings), null);

// Accepting the adjustment keeps the projection exactly where it was, for
// month ends of 28, 29, 30 and 31 days and across the year turn.
for (const referenceDate of ["2027-02-28", "2028-02-29", "2026-11-30", "2026-12-31"]) {
  const before = [{ ...bill, date: referenceDate }];
  const base = { current_balance: 1000, balance_reference_date: referenceDate };
  const adjustment = referenceBalanceAdjustment(before[0], true, base);
  const after = [{ ...before[0], paid: true }];
  const adjusted = { ...base, current_balance: adjustment.to };
  for (const date of [referenceDate, "2029-01-01"]) {
    assert.equal(
      projectedBalance(date, adjusted, dailyEntryNet(after), dailyPendingNet(after)),
      projectedBalance(date, base, dailyEntryNet(before), dailyPendingNet(before)),
    );
  }
}

// Interface: no native confirm() left, and control borders reach 3:1.
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
assert.doesNotMatch(app, /(^|[^.\w])confirm\(/m, "window.confirm must not be used");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.match(html, /<dialog id="confirmDialog" aria-labelledby="confirmDialogTitle" aria-describedby="confirmDialogDescription">/);
assert.ok(html.indexOf("confirm-dialog.js") < html.indexOf("js/app.js"));
// Only the footer button carries the cancel label; the × keeps its own name.
assert.match(html, /<button class="close" type="button" data-confirm-cancel aria-label="Fechar sem confirmar">&times;<\/button>/);
assert.match(fs.readFileSync(path.join(root, "js/confirm-dialog.js"), "utf8"), /querySelector\("\[data-confirm-cancel-label\]"\)/);

const css = fs.readFileSync(path.join(root, "mobile.css"), "utf8");
const token = name => css.match(new RegExp(`--${name}:(#[0-9a-f]{6}|#[0-9a-f]{3})(?![0-9a-f])`, "i"))[1];
const luminance = hex => {
  const digits = hex.slice(1);
  const value = parseInt(digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits, 16);
  const [r, g, b] = [value >> 16, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
const control = token("control-line");
for (const background of [token("paper"), token("bg"), token("soft")]) {
  assert.ok(contrast(control, background) >= 3, `${control} on ${background}`);
}
assert.doesNotMatch(css, /#b9c9c0/i);
assert.match(css, /input,select,textarea \{[^}]*border-color:var\(--control-line\)/);
assert.match(css, /\.secondary,\.auth-button,\.google-button \{[^}]*border:1px solid var\(--control-line\)/);

console.log("reference balance adjustment tests: ok");
