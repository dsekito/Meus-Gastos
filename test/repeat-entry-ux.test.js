const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// What the flow does (kept fields, cleared value, focus, locked buttons): app-behavior.e2e.cjs.
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("oferece fluxo para salvar e adicionar outro lançamento semelhante", () => {
  assert.match(html, /id="saveAndAddAnother"[\s\S]*?type="submit"/);
  assert.match(html, /aria-label="Salvar lançamento e adicionar outro mantendo os demais dados"/);
  assert.match(html, /id="entryFormStatus" role="status" aria-live="polite" hidden/);
});

