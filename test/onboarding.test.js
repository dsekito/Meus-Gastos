const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const app = fs.readFileSync(path.join(projectRoot, "js", "app.js"), "utf8");

test("onboarding coleta saldo, data e categorias com saída opcional", () => {
  assert.match(html, /id="onboardingDialog"[^>]*aria-labelledby="onboardingTitle"[^>]*aria-describedby="onboardingDescription"/);
  assert.match(html, /<label for="onboardingBalance">/);
  assert.match(html, /<label for="onboardingReferenceDate">/);
  assert.match(html, /id="onboardingCategoryError"[^>]*role="alert"/);
  assert.match(html, /id="skipOnboarding"[^>]*type="button">Agora não<\/button>/);
  assert.match(html, /id="saveOnboarding"[^>]*type="submit">Preparar minha projeção<\/button>/);
});

test("onboarding aparece somente para perfil novo e vazio", () => {
  assert.match(app, /state\.settings\.onboarding_status === "pending"[\s\S]*?state\.entries\.length === 0[\s\S]*?state\.recurrenceSeries\.length === 0/);
  assert.match(app, /onboarding_status: "completed"/);
});

test("categorias salvas de usuários existentes não recebem padrões novos", () => {
  assert.match(app, /state\.types = profileOptions\(cached\.types, defaultTypes\)/);
  assert.match(app, /state\.types = profileOptions\(data\.types, defaultTypes\)/);
  assert.doesNotMatch(app, /return \[\.\.\.state\.types, \.\.\.defaultTypes, selectedType\]/);
});

test("controles do onboarding respeitam área mínima de toque", () => {
  assert.match(html, /\.onboarding-modal \.modal-foot button \{[\s\S]*?min-height: 48px/);
  assert.match(html, /\.onboarding-category-option \{[\s\S]*?min-height: 48px/);
});
