const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'mobile.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

test('explica a dependência junto ao tipo e associa a explicação à descrição', () => {
  assert.match(html, /id="description"[^>]*aria-describedby="descriptionHelp"/);
  assert.match(html, /id="descriptionHelp"[^>]*>[^<]*[Ee]scolha.*tipo[^<]*descri/);
});

test('ações móveis ocupam menos espaço mantendo alvos acessíveis', () => {
  assert.match(css, /#entryForm > \.modal-foot\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.mobile-new-entry\s*\{[^}]*width:\s*(?:auto|fit-content)/);
  assert.match(css, /#entryForm > \.modal-foot button\s*\{[^}]*min-height:\s*48px/);
});

test('aviso de sucesso não ocupa espaço sem alerta e nome de ação não fica obsoleto', () => {
  assert.match(app, /syncNoticeAction\.removeAttribute\("aria-label"\)/);
  assert.match(app, /if \(stateName === "synced"\)[\s\S]*?syncNotice\.hidden = !isRemoteDocumentLarge\(\)/);
});
