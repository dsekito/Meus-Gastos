const test = require("node:test");
const assert = require("node:assert/strict");

global.window = global;
require("../js/domain.js");
require("../js/entry-filters.js");

const filters = global.MGEntryFilters;
const { PAYMENT_NO_CARD, PAYMENT_ANY_CARD } = filters;

const entry = (overrides = {}) => ({
  id: "e", date: "2026-11-05", type: "ALIMENTAÇÃO", description: "RESTAURANTE", value: 10, paid: false, flow_type: "expense", ...overrides,
});
const nubank = entry({ id: "n", credit_card_id: "nubank" });
const itau = entry({ id: "i", credit_card_id: "itau" });
const pix = entry({ id: "p" });
const salary = entry({ id: "s", type: "RECEITAS", description: "SALÁRIO", flow_type: "income", value: 6000 });
const removed = entry({ id: "r", credit_card_id: "antigo" });
const all = [nubank, itau, pix, salary, removed];
const ids = (list) => list.map((item) => item.id);
const pick = (criteria) => ids(all.filter((item) => filters.matchesEntry(item, criteria)));

test("forma de pagamento: sem cartão só pega despesas; qualquer cartão, um cartão ou um cartão excluído", () => {
  assert.deepEqual(pick({}), ["n", "i", "p", "s", "r"]);
  assert.deepEqual(pick({ payment: PAYMENT_NO_CARD }), ["p"], "receita não tem forma de pagamento");
  assert.deepEqual(pick({ payment: PAYMENT_ANY_CARD }), ["n", "i", "r"]);
  assert.deepEqual(pick({ payment: "nubank" }), ["n"]);
  assert.deepEqual(pick({ payment: "antigo" }), ["r"]);
});

test("movimentação, status e os demais filtros se combinam", () => {
  assert.deepEqual(pick({ flow: "income" }), ["s"]);
  assert.deepEqual(pick({ flow: "expense", payment: PAYMENT_ANY_CARD }), ["n", "i", "r"]);
  const paidCard = entry({ id: "pc", paid: true, credit_card_id: "nubank" });
  const noPaidFlag = entry({ id: "np", paid: undefined });
  assert.equal(filters.matchesEntry(paidCard, { status: "paid", payment: "nubank" }), true);
  assert.equal(filters.matchesEntry(paidCard, { status: "pending" }), false);
  assert.equal(filters.matchesEntry(noPaidFlag, { status: "pending" }), true, "sem o campo paid conta como em aberto");
  assert.equal(filters.matchesEntry(salary, { type: "RECEITAS", description: "SALÁRIO", search: "salario" }), true);
  assert.equal(filters.matchesEntry(salary, { date: "2026-11-06" }), false);
});

test("opções de forma de pagamento: cartões cadastrados, excluídos ainda em uso e 'qualquer cartão' só com mais de um", () => {
  const cards = [{ id: "nubank", name: "Nubank" }, { id: "itau", name: "Itaú" }];
  assert.deepEqual(filters.paymentOptions(cards, all).map((option) => option.label),
    ["Pix, débito ou dinheiro", "Qualquer cartão de crédito", "Crédito: Nubank", "Crédito: Itaú", "Cartão excluído"]);
  assert.deepEqual(filters.paymentOptions([cards[0]], [pix]).map((option) => option.value), [PAYMENT_NO_CARD, "nubank"]);
  assert.deepEqual(filters.paymentOptions([], []).map((option) => option.value), [PAYMENT_NO_CARD]);
  assert.deepEqual(filters.paymentOptions([], [removed, entry({ credit_card_id: "outro" })]).map((option) => option.label),
    ["Pix, débito ou dinheiro", "Qualquer cartão de crédito", "Cartão excluído 1", "Cartão excluído 2"]);
});

test("nome do cartão no lançamento", () => {
  const cards = [{ id: "nubank", name: "Nubank" }];
  assert.equal(filters.cardLabel(nubank, cards), "Nubank");
  assert.equal(filters.cardLabel(removed, cards), "Cartão excluído");
  assert.equal(filters.cardLabel(pix, cards), "");
});

test("resumo mostra só os filtros ativos e quantos são", () => {
  assert.deepEqual(filters.activeFiltersSummary([null, "", undefined]), { count: 0, text: "Nenhum filtro ativo" });
  assert.deepEqual(filters.activeFiltersSummary(["Despesas", null, "Crédito: Nubank"]), { count: 2, text: "Despesas · Crédito: Nubank" });
});

test("totais em centavos: entradas, saídas (estorno subtrai) e saldo", () => {
  assert.deepEqual(filters.totals([]), { incomeCents: 0, expenseCents: 0, balanceCents: 0 });
  const list = [
    entry({ value: 0.1 }), entry({ value: 0.2 }), entry({ value: -0.05 }),
    entry({ flow_type: "income", value: 1000.01 }), entry({ value: "x" }),
  ];
  assert.deepEqual(filters.totals(list), { incomeCents: 100001, expenseCents: 25, balanceCents: 99976 });
  assert.deepEqual(filters.totals([entry({ value: 50 })]), { incomeCents: 0, expenseCents: 5000, balanceCents: -5000 });
});

test("tipo e descrição oferecem só o que existe no período exibido", () => {
  const november = [
    entry({ type: "MORADIA", description: "ALUGUEL" }),
    entry({ type: "ALIMENTAÇÃO", description: "RESTAURANTE" }),
    entry({ type: "ALIMENTAÇÃO", description: "SUPERMERCADO" }),
  ];
  const december = [entry({ type: "LAZER", description: "CINEMA" })];
  const everything = [...november, ...december];
  assert.deepEqual(filters.typeAndDescriptionOptions(november, everything), {
    types: ["ALIMENTAÇÃO", "MORADIA"],
    descriptions: ["ALUGUEL", "RESTAURANTE", "SUPERMERCADO"],
    description: "",
  });
  assert.deepEqual(filters.typeAndDescriptionOptions(november, everything, { type: "ALIMENTAÇÃO" }).descriptions,
    ["RESTAURANTE", "SUPERMERCADO"], "a descrição segue o tipo escolhido");
  assert.deepEqual(filters.typeAndDescriptionOptions([], []), { types: [], descriptions: [], description: "" });
});

test("um filtro já escolhido continua na lista mesmo sem registros no período", () => {
  const november = [entry({ type: "MORADIA", description: "ALUGUEL" })];
  const everything = [...november, entry({ type: "LAZER", description: "CINEMA" })];
  const kept = filters.typeAndDescriptionOptions(november, everything, { type: "LAZER", description: "CINEMA" });
  assert.deepEqual(kept, { types: ["LAZER", "MORADIA"], descriptions: ["CINEMA"], description: "CINEMA" });
  const mismatched = filters.typeAndDescriptionOptions(november, everything, { type: "MORADIA", description: "CINEMA" });
  assert.equal(mismatched.description, "", "descrição de outro tipo é limpa");
  assert.deepEqual(mismatched.descriptions, ["ALUGUEL"]);
});

test("na mesma data, ordena por forma de pagamento e, dentro dela, o último registrado primeiro", () => {
  const cards = [{ id: "nubank", name: "Nubank" }, { id: "itau", name: "Itaú" }];
  const at = (hour) => `2026-11-05T${String(hour).padStart(2, "0")}:00:00.000Z`;
  const list = [
    entry({ id: "nubank-tarde", date: "2026-11-05", credit_card_id: "nubank", created_at: at(15) }),
    entry({ id: "pix-tarde", date: "2026-11-05", created_at: at(14) }),
    entry({ id: "excluido", date: "2026-11-05", credit_card_id: "antigo", created_at: at(8) }),
    entry({ id: "itau", date: "2026-11-05", credit_card_id: "itau", created_at: at(20) }),
    entry({ id: "nubank-manha", date: "2026-11-05", credit_card_id: "nubank", created_at: at(9) }),
    entry({ id: "salario", date: "2026-11-05", flow_type: "income", created_at: at(10) }),
    entry({ id: "dia-anterior", date: "2026-11-04", credit_card_id: "nubank", created_at: at(23) }),
    entry({ id: "sem-registro", date: "2026-11-05" }),
  ];
  assert.deepEqual(ids([...list].sort(filters.listComparator(cards))), [
    "dia-anterior",
    "pix-tarde", "salario", "sem-registro",
    "itau",
    "nubank-tarde", "nubank-manha",
    "excluido",
  ]);
  assert.deepEqual(ids([...list].reverse().sort(filters.listComparator(cards))),
    ids([...list].sort(filters.listComparator(cards))), "a ordem não depende da ordem de entrada");
});
