const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
// When onboarding opens and which categories a profile keeps: app-behavior.e2e.cjs.
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");

test("onboarding coleta saldo, data e categorias com saída opcional", () => {
  assert.match(html, /id="onboardingDialog"[^>]*aria-labelledby="onboardingTitle"[^>]*aria-describedby="onboardingDescription"/);
  assert.match(html, /<label for="onboardingBalance">/);
  assert.match(html, /<label for="onboardingReferenceDate">/);
  assert.match(html, /id="onboardingCategoryError"[^>]*role="alert"/);
  assert.match(html, /id="skipOnboarding"[^>]*type="button">Agora não<\/button>/);
  assert.match(html, /id="saveOnboarding"[^>]*type="submit">Preparar minha projeção<\/button>/);
});

test("controles do onboarding respeitam área mínima de toque", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "mobile.css"), "utf8");
  assert.match(html, /<form class="modal onboarding-modal"[\s\S]*?<div class="modal-foot">/);
  assert.match(css, /\.modal-foot button \{[^}]*min-height:48px/);
  assert.match(css, /\.onboarding-category-option \{[^}]*min-height: 48px/);
});
