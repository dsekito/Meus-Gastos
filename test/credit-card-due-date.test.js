const test = require("node:test");
const assert = require("node:assert/strict");

global.window = global;
require("../js/domain.js");

const { creditCardDueDate } = global.MGDomain;

const card = (closing_day, due_day) => ({ closing_day, due_day });

test("compra antes do fechamento vai para a fatura do mês", () => {
  assert.equal(creditCardDueDate("2026-11-02", card(3, 10)), "2026-11-10");
});

test("compra no dia do fechamento ou depois vai para a fatura seguinte", () => {
  assert.equal(creditCardDueDate("2026-11-03", card(3, 10)), "2026-12-10");
  assert.equal(creditCardDueDate("2026-11-13", card(3, 10)), "2026-12-10");
});

test("vencimento no mesmo dia ou antes do fechamento cai no mês seguinte ao fechamento", () => {
  assert.equal(creditCardDueDate("2026-11-10", card(25, 5)), "2026-12-05");
  assert.equal(creditCardDueDate("2026-11-26", card(25, 5)), "2027-01-05");
  assert.equal(creditCardDueDate("2026-11-10", card(20, 20)), "2026-12-20");
});

test("vira o ano", () => {
  assert.equal(creditCardDueDate("2026-12-05", card(3, 10)), "2027-01-10");
  assert.equal(creditCardDueDate("2026-12-31", card(28, 7)), "2027-02-07");
});

test("dias que não existem no mês usam o último dia do mês", () => {
  // Fechamento no dia 31: em fevereiro fecha no dia 28 (29 em ano bissexto).
  assert.equal(creditCardDueDate("2026-02-27", card(31, 10)), "2026-03-10");
  assert.equal(creditCardDueDate("2026-02-28", card(31, 10)), "2026-04-10");
  assert.equal(creditCardDueDate("2028-02-28", card(31, 10)), "2028-03-10");
  assert.equal(creditCardDueDate("2028-02-29", card(31, 10)), "2028-04-10");
  // Vencimento no dia 31 em meses de 30, 29 e 28 dias.
  assert.equal(creditCardDueDate("2026-04-01", card(20, 31)), "2026-04-30");
  assert.equal(creditCardDueDate("2028-02-01", card(20, 31)), "2028-02-29");
  assert.equal(creditCardDueDate("2026-01-25", card(20, 31)), "2026-02-28");
});

test("o resultado não depende do fuso do aparelho", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["America/Sao_Paulo", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      process.env.TZ = zone;
      assert.equal(creditCardDueDate("2026-12-31", card(28, 7)), "2027-02-07", zone);
    }
  } finally {
    process.env.TZ = original;
  }
});
