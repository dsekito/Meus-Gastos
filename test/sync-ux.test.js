const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
// Status texts and recovery actions in each situation: sync-notice.e2e.cjs.
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");

test("usa apenas o status compacto como região viva do sincronismo", () => {
  assert.match(
    html,
    /id="syncStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/,
  );
  assert.match(html, /class="sync-notice-copy">/);
  assert.doesNotMatch(html, /class="sync-notice-copy"[^>]*aria-live/);
  assert.doesNotMatch(html, /id="settingsSyncSummary"[^>]*aria-live/);
});

