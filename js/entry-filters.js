// Filters of the records list: which entries match, the payment method
// options, the summary of active filters and the totals of what is shown.
// Pure: no DOM, no storage.
(function attachEntryFilters(global) {
  const domain = global.MGDomain;
  const PAYMENT_NO_CARD = "no-card";
  const PAYMENT_ANY_CARD = "any-card";

  // "Pix, débito ou dinheiro" means an expense paid without a card; income
  // has no payment method, so it only shows when no payment filter is set.
  function matchesPayment(entry, payment) {
    if (!payment) return true;
    const cardId = entry.credit_card_id || "";
    if (payment === PAYMENT_NO_CARD) return !cardId && domain.entryFlowType(entry) === "expense";
    if (payment === PAYMENT_ANY_CARD) return Boolean(cardId);
    return cardId === payment;
  }

  function matchesEntry(entry, filters = {}) {
    return (!filters.type || entry.type === filters.type)
      && (!filters.description || entry.description === filters.description)
      && (!filters.status || (filters.status === "paid") === Boolean(entry.paid))
      && (!filters.flow || domain.entryFlowType(entry) === filters.flow)
      && matchesPayment(entry, filters.payment)
      && (!filters.date || entry.date === filters.date)
      && domain.matchesEntrySearch(entry, filters.search || "");
  }

  // Registered cards, plus one "Cartão excluído" option per deleted card that
  // entries still carry, so those entries can still be found.
  function paymentOptions(cards = [], entries = []) {
    const known = new Set(cards.map((card) => card.id));
    const removed = [...new Set(entries.map((entry) => entry.credit_card_id).filter((id) => id && !known.has(id)))];
    return [
      { value: PAYMENT_NO_CARD, label: "Pix, débito ou dinheiro" },
      ...(cards.length + removed.length > 1 ? [{ value: PAYMENT_ANY_CARD, label: "Qualquer cartão de crédito" }] : []),
      ...cards.map((card) => ({ value: card.id, label: `Crédito: ${card.name}` })),
      ...removed.map((id, index) => ({ value: id, label: removed.length > 1 ? `Cartão excluído ${index + 1}` : "Cartão excluído" })),
    ];
  }

  // Name shown on an entry paid with a card; "" when there is none.
  function cardLabel(entry, cards = []) {
    if (!entry.credit_card_id) return "";
    return cards.find((card) => card.id === entry.credit_card_id)?.name || "Cartão excluído";
  }

  // Type and description options come from the records of the period on
  // screen. A value already chosen stays listed even when the period has none
  // of it, so a filter never disappears unnoticed; a description that does not
  // belong to the chosen type (in any record) is dropped.
  function typeAndDescriptionOptions(periodEntries = [], allEntries = [], { type = "", description = "" } = {}) {
    const sorted = (values) => [...new Set(values.filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
    const types = sorted([...periodEntries.map((entry) => entry.type), type]);
    const descriptionMatchesType = !description || !type
      || allEntries.some((entry) => entry.type === type && entry.description === description);
    const keptDescription = descriptionMatchesType ? description : "";
    const descriptions = sorted([
      ...periodEntries.filter((entry) => !type || entry.type === type).map((entry) => entry.description),
      keptDescription,
    ]);
    return { types, descriptions, description: keptDescription };
  }

  // Order of the records list: by date; within a date, by payment method
  // (no card first, then cards by name, then deleted cards); then by the time
  // the record was created, newest first.
  function listComparator(cards = []) {
    const names = new Map(cards.map((card) => [card.id, card.name]));
    const paymentKey = (entry) => {
      if (!entry.credit_card_id) return [0, ""];
      return names.has(entry.credit_card_id) ? [1, names.get(entry.credit_card_id)] : [2, entry.credit_card_id];
    };
    return (a, b) => {
      const [groupA, nameA] = paymentKey(a);
      const [groupB, nameB] = paymentKey(b);
      return String(a.date || "").localeCompare(String(b.date || ""))
        || groupA - groupB
        || nameA.localeCompare(nameB, "pt-BR")
        || String(b.created_at || "").localeCompare(String(a.created_at || ""))
        || String(a.id || "").localeCompare(String(b.id || ""));
    };
  }

  // `labels` holds the visible text of each active filter, in screen order.
  function activeFiltersSummary(labels) {
    const active = labels.filter(Boolean);
    return { count: active.length, text: active.length ? active.join(" · ") : "Nenhum filtro ativo" };
  }

  // Income, expenses (refunds subtract) and their balance, added in cents.
  function totals(entries) {
    let incomeCents = 0;
    let expenseCents = 0;
    for (const entry of entries) {
      const cents = Math.round(Number(entry.value) * 100);
      if (!Number.isFinite(cents)) continue;
      if (domain.entryFlowType(entry) === "income") incomeCents += cents;
      else expenseCents += cents;
    }
    return { incomeCents, expenseCents, balanceCents: incomeCents - expenseCents };
  }

  global.MGEntryFilters = {
    PAYMENT_NO_CARD,
    PAYMENT_ANY_CARD,
    matchesEntry,
    paymentOptions,
    typeAndDescriptionOptions,
    listComparator,
    cardLabel,
    activeFiltersSummary,
    totals,
  };
})(window);
