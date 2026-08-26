const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const app = fs.readFileSync(path.join(projectRoot, "js", "app.js"), "utf8");

test("prioriza decisões e lançamentos antes do calendário", () => {
  const decisionIndex = html.indexOf('class="decision-overview"');
  const entriesIndex = html.indexOf('class="panel entries-panel"');
  const calendarIndex = html.indexOf('class="panel calendar-panel"');

  assert.ok(decisionIndex > -1);
  assert.ok(entriesIndex > decisionIndex);
  assert.ok(calendarIndex > entriesIndex);
  assert.match(html, /id="monthEndBalanceTotal"/);
  assert.match(html, /id="nextSevenDaysTotal"/);
  assert.match(html, /id="financialGuidance"[^>]*aria-labelledby="financialGuidanceTitle"/);
});

test("mantém filtros e confirmação de exclusão nomeados", () => {
  assert.match(html, /<label for="filterType">Tipo<\/label>/);
  assert.match(html, /<label for="filterStatus">Status<\/label>/);
  assert.match(
    html,
    /id="deleteConfirmDialog"[^>]*aria-labelledby="deleteConfirmTitle"[^>]*aria-describedby="deleteConfirmDescription"/,
  );
});

test("abre edição pelo card e restringe mudança de status ao botão dedicado", () => {
  assert.match(app, /if \(status\) \{[\s\S]*?toggleEntryStatus\(\);[\s\S]*?return;[\s\S]*?const menu/);
  assert.match(app, /const entry = state\.entries\.find\(\(item\) => item\.id === card\.dataset\.entry\);\s*if \(entry\) editEntry\(entry\);/);
  assert.doesNotMatch(app, /state\.activeEntry = card\.dataset\.entry;\s*toggleEntryStatus\(\);/);
});

test("oferece desfazer para status e exclusões", () => {
  assert.match(app, /successMessage, \{\s*label: "Desfazer"/);
  assert.match(app, /show\("Lançamento excluído\.", \{\s*label: "Desfazer"/);
  assert.match(app, /"Exclusão da recorrência desfeita\."/);
  assert.match(app, /"Exclusão desfeita\."/);
});

test("considera receitas e a ordem das datas no alerta de saldo", () => {
  assert.match(app, /domain\.minimumProjectedBalance\(/);
  assert.match(app, /upcomingIncomeTotal/);
  assert.match(app, /receitas a receber já foram consideradas na projeção/);
  assert.doesNotMatch(app, /upcomingTotal > Math\.max\(currentBalance, 0\)/);
});
