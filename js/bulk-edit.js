// Editing and deleting several selected records at once. Pure: no DOM, no
// storage. The rules depend on what each record is:
// - single entries: every change applies to the selected entries;
// - installments: status and date apply to the selected installments, while
//   type, description and payment method describe the purchase and apply to
//   every installment of it;
// - recurrence occurrences: changes apply to the selected occurrences; any
//   change other than the status turns them into exceptions of the series.
// The payment method only applies to expenses: income has none.
(function attachBulkEdit(global) {
  const domain = global.MGDomain;

  function kindOf(entry) {
    if (entry.series_id && !entry.excluded_from_series) return "occurrence";
    if (entry.installment && domain.installmentGroupKey(entry)) return "installment";
    return "single";
  }

  function plural(count, singular, pluralForm) {
    return `${count} ${count === 1 ? singular : pluralForm}`;
  }

  // Groups the selection and the purchases its installments belong to.
  function describeSelection(entries, selectedIds) {
    const selected = entries.filter((entry) => selectedIds.has(entry.id) && !entry.excluded_from_series);
    const purchases = new Map();
    const counts = { single: 0, installment: 0, occurrence: 0 };
    selected.forEach((entry) => {
      const kind = kindOf(entry);
      counts[kind] += 1;
      if (kind !== "installment") return;
      const key = domain.installmentGroupKey(entry);
      if (!purchases.has(key)) {
        purchases.set(key, {
          description: entry.description,
          selected: [],
          all: entries.filter((item) => domain.installmentGroupKey(item) === key && !item.excluded_from_series),
        });
      }
      purchases.get(key).selected.push(entry);
    });
    return { selected, counts, purchases };
  }

  function hasChanges(changes = {}) {
    return changes.paid !== undefined || Boolean(changes.date) || Boolean(changes.type)
      || Boolean(changes.description) || changes.creditCardId !== undefined;
  }

  // Changes that describe what was bought, as opposed to when it is paid.
  function classifyingChange(changes) {
    return Boolean(changes.type) || Boolean(changes.description) || changes.creditCardId !== undefined;
  }

  function applyClassification(entry, changes) {
    let next = { ...entry };
    if (changes.type) next.type = changes.type;
    if (changes.description) next.description = changes.description;
    if (changes.creditCardId !== undefined && domain.entryFlowType(next) === "expense") {
      next = domain.withCreditCard(next, changes.creditCardId);
    }
    return next;
  }

  const sameRecord = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Returns the entries to save (only those that really change) and the
  // number of selected records.
  function planEdit(entries, selectedIds, changes = {}) {
    const { selected, purchases } = describeSelection(entries, selectedIds);
    const next = new Map();
    const current = (entry) => next.get(entry.id) || entry;

    selected.forEach((entry) => {
      let updated = { ...current(entry) };
      if (changes.paid !== undefined) updated.paid = changes.paid;
      if (changes.date) updated.date = changes.date;
      if (kindOf(entry) !== "installment") updated = applyClassification(updated, changes);
      if (kindOf(entry) === "occurrence" && (changes.date || classifyingChange(changes))) {
        updated.detached_from_series = true;
      }
      next.set(entry.id, updated);
    });

    if (classifyingChange(changes)) {
      purchases.forEach((purchase) => {
        purchase.all.forEach((entry) => next.set(entry.id, applyClassification(current(entry), changes)));
      });
    }

    const updates = [...next.values()].filter((updated) => {
      const original = entries.find((entry) => entry.id === updated.id);
      return !sameRecord(original, updated);
    });
    return { updates, selectedCount: selected.length };
  }

  // Lines of the confirmation: what changes and how each kind of record is
  // affected. `labels` holds the visible text of the chosen values.
  function editSummary(entries, selectedIds, changes = {}, labels = {}) {
    const { counts, purchases } = describeSelection(entries, selectedIds);
    const lines = [];
    if (changes.paid !== undefined) lines.push(`Status: ${labels.paid}`);
    if (changes.date) lines.push(`Data: ${labels.date}`);
    if (changes.type) lines.push(`Tipo: ${changes.type}`);
    if (changes.description) lines.push(`Descrição: ${changes.description}`);
    if (changes.creditCardId !== undefined) lines.push(`Forma de pagamento: ${labels.payment} (só nas despesas)`);

    if (counts.single) lines.push(plural(counts.single, "lançamento avulso", "lançamentos avulsos"));
    purchases.forEach((purchase) => {
      const header = `${plural(purchase.selected.length, "parcela", "parcelas")} de “${purchase.description}”`;
      const parts = [];
      if (changes.paid !== undefined || changes.date) parts.push("status e data mudam só nas selecionadas");
      if (classifyingChange(changes)) parts.push(`tipo, descrição e forma de pagamento mudam nas ${purchase.all.length} parcelas da compra`);
      lines.push(parts.length ? `${header}: ${parts.join("; ")}` : header);
      if (changes.date && purchase.selected.length > 1) {
        lines.push(`As ${purchase.selected.length} parcelas selecionadas de “${purchase.description}” ficarão na mesma data.`);
      }
    });
    if (counts.occurrence) {
      const detaches = changes.date || classifyingChange(changes);
      lines.push(`${plural(counts.occurrence, "ocorrência de recorrência", "ocorrências de recorrência")}${detaches
        ? `: ${counts.occurrence === 1 ? "vira exceção" : "viram exceções"} da série; as próximas continuam como estavam`
        : ""}`);
    }
    return lines;
  }

  // Installments go away alone or with the whole purchase; recurrence
  // occurrences are excluded from their series (the series keeps going);
  // everything else is deleted.
  function planDelete(entries, selectedIds, { wholePurchase = false } = {}) {
    const { selected, counts, purchases } = describeSelection(entries, selectedIds);
    const deleteIds = new Set();
    const excludeIds = new Set();
    selected.forEach((entry) => {
      if (kindOf(entry) === "occurrence") excludeIds.add(entry.id);
      else deleteIds.add(entry.id);
    });
    if (wholePurchase) purchases.forEach((purchase) => purchase.all.forEach((entry) => deleteIds.add(entry.id)));
    const purchaseInstallments = [...purchases.values()].reduce((sum, purchase) => sum + purchase.all.length, 0);
    return { deleteIds, excludeIds, counts, purchaseCount: purchases.size, purchaseInstallments, total: deleteIds.size + excludeIds.size };
  }

  global.MGBulkEdit = { kindOf, describeSelection, hasChanges, planEdit, editSummary, planDelete };
})(window);
