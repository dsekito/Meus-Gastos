const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const app = fs.readFileSync(path.join(projectRoot, "js", "app.js"), "utf8");

test("usa apenas o status compacto como região viva do sincronismo", () => {
  assert.match(
    html,
    /id="syncStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/,
  );
  assert.match(html, /class="sync-notice-copy">/);
  assert.doesNotMatch(html, /class="sync-notice-copy"[^>]*aria-live/);
  assert.doesNotMatch(html, /id="settingsSyncSummary"[^>]*aria-live/);
});

test("diferencia alterações salvas localmente do envio ao Drive", () => {
  assert.match(app, /setSyncStatus\("queued", "Alterações salvas neste aparelho\. Aguardando envio ao Google Drive\."\)/);
  assert.match(app, /if \(stateName === "queued"\)/);
  assert.match(app, /syncStatus\.textContent = "Salvo neste aparelho"/);
});

test("oferece recuperação específica para erros estruturais do Drive", () => {
  assert.match(app, /GOOGLE_DRIVE_INVALID_DOCUMENT[\s\S]*?dataset\.action = "restore-backup"/);
  assert.match(app, /GOOGLE_DRIVE_UNSUPPORTED_SCHEMA[\s\S]*?dataset\.action = "update-app"/);
  assert.match(app, /action === "restore-backup"[\s\S]*?openBackupRecovery\(\)/);
  assert.match(app, /action === "update-app"[\s\S]*?verifyApplicationUpdate\(syncNoticeAction\)/);
});
