const test = require("node:test");
const assert = require("node:assert/strict");

global.window = global;
require("../js/profile-defaults.js");

const { descriptionOptionsByType, defaultTypes, defaultDescriptions, createDefaultSettings, normalizeSettings, profileOptions } = global.MGProfileDefaults;

test("novo perfil começa com saldo zero, datado de hoje, e com onboarding pendente", () => {
  assert.deepEqual(createDefaultSettings("2026-11-13"), { current_balance: 0, balance_reference_date: "2026-11-13", onboarding_status: "pending" });
});

test("oferece categorias universais, cada uma com descrições, sem repetir descrições", () => {
  for (const category of ["ALIMENTAÇÃO", "MORADIA", "RECEITAS", "SAÚDE", "TRANSPORTE"]) {
    assert.ok(defaultTypes.includes(category), category);
    assert.ok(descriptionOptionsByType[category].length > 0, category);
  }
  assert.equal(new Set(defaultDescriptions).size, defaultDescriptions.length);
  assert.ok(defaultDescriptions.includes("MANUTENÇÃO"), "descrição comum a dois tipos aparece uma vez");
  assert.throws(() => { "use strict"; defaultTypes.push("X"); }, TypeError, "as listas padrão não podem ser alteradas");
});

test("lê configurações salvas com valores ausentes ou inválidos", () => {
  assert.deepEqual(normalizeSettings({}, "2026-01-31"), { current_balance: 0, balance_reference_date: "2026-01-31", onboarding_status: null });
  assert.deepEqual(normalizeSettings({ current_balance: "-12.5", balance_reference_date: "2025-12-31", onboarding_status: "completed" }, "2026-01-31"),
    { current_balance: -12.5, balance_reference_date: "2025-12-31", onboarding_status: "completed" });
  assert.equal(normalizeSettings({ onboarding_status: "talvez" }, "2026-01-31").onboarding_status, null);
});

test("perfil com lista própria mantém só a sua lista; sem lista, recebe uma cópia dos padrões", () => {
  assert.deepEqual(profileOptions(["B", "A", "B"], defaultTypes), ["A", "B"]);
  assert.deepEqual(profileOptions([], defaultTypes), []);
  const copy = profileOptions(undefined, defaultTypes);
  assert.deepEqual(copy, [...defaultTypes]);
  copy.push("NOVA");
  assert.ok(!defaultTypes.includes("NOVA"));
});
