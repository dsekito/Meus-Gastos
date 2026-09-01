const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const serviceWorker = fs.readFileSync(path.join(projectRoot, "sw.js"), "utf8");

test("usa viewport completo e respeita áreas seguras do celular", () => {
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.match(html, /padding-bottom: calc\(112px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(html, /bottom: calc\(16px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(html, /padding-top: max\(16px, env\(safe-area-inset-top\)\)/);
});

test("mantém formulários em uma coluna e controles com 48px no celular", () => {
  assert.match(
    html,
    /\.modal \.form-grid \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?scrollbar-gutter: stable;/,
  );
  assert.match(html, /\.auth-button,[\s\S]*?#signOut \{[\s\S]*?min-width: 48px;[\s\S]*?min-height: 48px;/);
  assert.match(html, /@media \(max-width: 359px\) \{[\s\S]*?\.summary \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(html, /\[role="button"\],[\s\S]*?summary \{ touch-action: manipulation; \}/);
});

test("evita estouro nas ações dos lançamentos e usa ícones vetoriais", () => {
  assert.match(html, /\.entries-panel \.panel-head \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(html, /class="ui-icon" aria-hidden="true"/);
  assert.doesNotMatch(html, /[⚙✏🗑📅↻⎋]/u);
});

test("invalida o cache anterior para distribuir a revisão mobile", () => {
  assert.match(serviceWorker, /const CACHE_NAME = "meus-gastos-v15";/);
  assert.match(html, /\.\/js\/app\.js\?v=2026083102/);
  assert.match(serviceWorker, /\.\/js\/app\.js\?v=2026083102/);
  assert.match(serviceWorker, /const cacheKey = new Request\(url\.href\);/);
});
