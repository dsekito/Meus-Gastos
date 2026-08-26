const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const app = fs.readFileSync(path.join(projectRoot, "js", "app.js"), "utf8");

test("posiciona a projeção de saldo logo antes dos filtros de lançamentos", () => {
  const decisionIndex = html.indexOf('class="decision-overview"');
  const entriesIndex = html.indexOf('class="panel entries-panel"');
  const calendarIndex = html.indexOf('class="panel calendar-panel"');

  assert.ok(decisionIndex > -1);
  assert.ok(calendarIndex > decisionIndex);
  assert.ok(entriesIndex > calendarIndex);
  assert.match(html, /id="monthEndBalanceTotal"/);
  assert.match(html, /id="nextSevenDaysTotal"/);
  assert.match(html, /id="financialGuidance"[^>]*aria-labelledby="financialGuidanceTitle"/);
});

test("mantém filtros e confirmação de exclusão nomeados", () => {
  assert.match(html, /<label for="filterType">Tipo<\/label>/);
  assert.match(html, /<label for="filterDescription">Descrição<\/label>/);
  assert.match(html, /<label for="filterStatus">Status<\/label>/);
  assert.match(app, /\(!description \|\| e\.description === description\)/);
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

test("identifica o modal de lançamento e preserva descrição ao editar", () => {
  assert.match(app, /modalTitle = document\.querySelector\("#entryDialogTitle"\)/);
  assert.match(app, /modalTitle\.textContent = "Editar lançamento";\s*fillForm\(entry\);/);
  assert.match(app, /renderEntryOptions\(entry\.type, entry\.description\);/);
});

test("oferece no formulário as descrições já registradas para o tipo selecionado", () => {
  assert.match(app, /function entryDescriptionOptions\(selectedType, selectedDescription = ""\)/);
  assert.match(app, /domain\.descriptionOptionsForType\(\{/);
  assert.match(app, /selectedType,[\s\S]*?selectedDescription,[\s\S]*?entries: state\.entries/);
});

test("atribui uma cor distinta aos tipos registrados sem depender só da cor", () => {
  assert.match(app, /domain\.typeColorMap\(\[/);
  assert.match(app, /\.\.\.state\.types,[\s\S]*?state\.entries\.map\(\(entry\) => entry\.type\)/);
  assert.match(app, /aria-label="\$\{state\.selectionMode \? `Selecionar \$\{esc\(e\.description\)\}, tipo \$\{esc\(e\.type\)\}/);
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

test("revalida a data final da recorrência depois que o usuário corrige o campo", () => {
  assert.match(
    app,
    /function updateEntryFormValidity\(\)[\s\S]*?endDate\.setCustomValidity\([\s\S]*?invalidEndDate[\s\S]*?\);/,
  );
  assert.match(
    app,
    /\[dateInput, valueInput\]\.forEach\(\(control\) => \{\s*control\.onchange = updateEntryFormValidity;\s*control\.oninput = updateEntryFormValidity;/,
  );
  assert.match(
    app,
    /\[flowType, recurrence, recurrenceInterval, customUnit, endMode, endDate, occurrenceCount, businessDayAdjustment\][\s\S]*?control\.oninput = updateEntryFormVisibility;/,
  );
});
