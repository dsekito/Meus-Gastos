const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const css = fs.readFileSync(path.join(projectRoot, "mobile.css"), "utf8");
const serviceWorker = fs.readFileSync(path.join(projectRoot, "sw.js"), "utf8");

// Geometry is checked for real in mobile-composition.e2e.cjs; these guard the
// declarations that carry it, in the single stylesheet.
test("usa viewport completo e respeita áreas seguras do celular", () => {
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.doesNotMatch(html, /<style[\s>]/, "estilos ficam em mobile.css");
  assert.match(css, /\.shell,\.shell\[data-view\] \{[^}]*padding:[^;}]*env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.app-navigation \{[^}]*env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.toast \{[^}]*bottom:calc\(84px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /padding-top: max\(16px, env\(safe-area-inset-top\)\)/);
});

test("mantém formulários em uma coluna e controles com 48px no celular", () => {
  assert.match(css, /\.modal \.form-grid,#entryForm > \.form-grid,#settingsDialog \.form-grid \{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.modal \.form-grid \{ scrollbar-gutter: stable; \}/);
  assert.match(css, /button,input:not\(\[type="checkbox"\]\),select,summary,\[role="button"\] \{ min-height:48px; \}/);
  assert.match(css, /button \{ min-width:48px;/);
  assert.match(css, /button, \[role="button"\], summary \{ touch-action: manipulation; \}/);
});

test("usa ícones vetoriais nas ações dos lançamentos", () => {
  assert.match(html, /class="ui-icon" aria-hidden="true"/);
  assert.doesNotMatch(html, /[⚙✏🗑📅↻⎋]/u);
});

test("invalida o cache anterior para distribuir a revisão mobile", () => {
  assert.ok(Number(serviceWorker.match(/const CACHE_NAME = "meus-gastos-v(\d+)";/)[1]) >= 23);
  for (const asset of ["js/app.js", "mobile.css"]) {
    const versionedPath = html.match(new RegExp(`\\./${asset.replaceAll(".", "\\.")}\\?v=\\d+`))?.[0];
    assert.ok(versionedPath, `${asset} precisa de uma versão`);
    assert.ok(serviceWorker.includes(`"${versionedPath}"`), `${asset} deve estar disponível offline na mesma versão`);
  }
  assert.match(serviceWorker, /const cacheKey = new Request\(url\.href\);/);
});
