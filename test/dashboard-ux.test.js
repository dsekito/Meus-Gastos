// Static markup contracts of the dashboard. Behaviour (filters, editing,
// undo, risk alerts, series and installments) is exercised in
// app-behavior.e2e.cjs against the running app.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");

test("prioriza resumo e lançamentos antes da projeção", () => {
  const decisionIndex = html.indexOf('class="decision-overview"');
  const entriesIndex = html.indexOf('class="panel entries-panel"');
  const projectionIndex = html.indexOf('class="projection-view"');

  assert.ok(decisionIndex > -1);
  assert.ok(entriesIndex > decisionIndex);
  assert.ok(projectionIndex > entriesIndex);
  assert.match(html, /id="monthEndBalanceTotal"/);
  assert.match(html, /id="nextSevenDaysTotal"/);
  assert.match(html, /id="financialGuidance"[^>]*aria-labelledby="financialGuidanceTitle"/);
});

test("mantém filtros e confirmação de exclusão nomeados", () => {
  assert.match(html, /<label for="filterType">Tipo<\/label>/);
  assert.match(html, /<label for="filterDescription">Descrição<\/label>/);
  assert.match(html, /<label for="filterStatus">Status<\/label>/);
  assert.match(
    html,
    /id="deleteConfirmDialog"[^>]*aria-labelledby="deleteConfirmTitle"[^>]*aria-describedby="deleteConfirmDescription"/,
  );
});

test("registros abrem com todos os status, sem esconder pagos", () => {
  assert.match(html, /<select id="filterStatus">\s*<option value="" selected>Todos os status<\/option>/);
  assert.doesNotMatch(html, /<option value="pending" selected>/);
});
