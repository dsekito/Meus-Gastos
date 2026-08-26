const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(projectRoot, "js", "app.js"), "utf8");

test("inicia novos perfis sem saldo fictício", () => {
  assert.match(app, /current_balance:\s*0/);
  assert.doesNotMatch(app, /current_balance:\s*10000/);
  assert.doesNotMatch(app, /settings\.current_balance\s*\?\?\s*10000/);
});

test("oferece categorias financeiras universais", () => {
  for (const category of [
    "ALIMENTAÇÃO",
    "MORADIA",
    "RECEITAS",
    "SAÚDE",
    "TRANSPORTE",
  ]) {
    assert.match(app, new RegExp(`^\\s*${category}:`, "m"));
  }
});

test("não contém categorias ou regras pessoais antigas", () => {
  for (const personalDefault of ["NUBANK", "PERSON", "FRAN", "TICO", "CBD", "MEL", "BRUNA"]) {
    assert.doesNotMatch(app, new RegExp(`\\b${personalDefault}\\b`));
  }
  assert.doesNotMatch(app, /suggestedDateForType/);
});
