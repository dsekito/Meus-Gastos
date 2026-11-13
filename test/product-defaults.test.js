const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
// Zero starting balance and the universal categories: app-behavior.e2e.cjs.
// This keeps personal names from an old version out of the shipped code.
const app = fs.readdirSync(path.join(projectRoot, "js")).filter((file) => file.endsWith(".js"))
  .map((file) => fs.readFileSync(path.join(projectRoot, "js", file), "utf8")).join(" ");

test("não contém categorias ou regras pessoais antigas", () => {
  for (const personalDefault of ["NUBANK", "PERSON", "FRAN", "TICO", "CBD", "MEL", "BRUNA"]) {
    assert.doesNotMatch(app, new RegExp(`\\b${personalDefault}\\b`));
  }
});
