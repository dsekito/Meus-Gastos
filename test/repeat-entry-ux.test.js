const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");

test("oferece fluxo para salvar e adicionar outro lançamento semelhante", () => {
  assert.match(html, /id="saveAndAddAnother"[\s\S]*?type="submit"/);
  assert.match(html, /aria-label="Salvar lançamento e adicionar outro mantendo os demais dados"/);
  assert.match(html, /id="entryFormStatus" role="status" aria-live="polite" hidden/);
  assert.match(app, /const keepAdding = !editing && e\.submitter === saveAndAddAnother/);
  assert.match(app, /if \(keepAdding\) \{[\s\S]*?valueInput\.value = "";[\s\S]*?detailInput\.value = "";[\s\S]*?valueInput\.focus\(\);/);
  assert.match(app, /Os demais dados foram mantidos; informe o próximo valor e detalhe/);
});

test("oculta a repetição ao editar e bloqueia os dois envios durante o salvamento", () => {
  assert.match(app, /state\.editingId = entry\.id;\s*saveAndAddAnother\.hidden = true;[\s\S]*?modalTitle\.textContent/);
  assert.match(app, /saveEntry\.disabled = true;\s*saveAndAddAnother\.disabled = true;/);
  assert.match(app, /saveEntry\.disabled = false;\s*saveAndAddAnother\.disabled = false;/);
});
