// "Editar selecionados": the dialog that changes several selected records at
// once. The rules of what changes where live in MGBulkEdit; this module
// fills the fields, asks for confirmation, saves and offers to undo.
(function attachBulkEditDialog(global) {
  const NO_CARD = "__no-card__";

  function create({ state, domain, bulkEdit, fill, entryTypeOptions, entryDescriptionOptions, confirmDialog,
    financialMutation, queueUpsert, render, show, pendingSyncMessage, exitSelectionMode }) {
    const dialog = document.querySelector("#bulkEditDialog");
    const form = document.querySelector("#bulkEditForm");
    const title = document.querySelector("#bulkEditTitle");
    const status = document.querySelector("#bulkStatus");
    const date = document.querySelector("#bulkDate");
    const type = document.querySelector("#bulkType");
    const description = document.querySelector("#bulkDescription");
    const paymentField = document.querySelector("#bulkPaymentField");
    const payment = document.querySelector("#bulkPayment");
    const error = document.querySelector("#bulkEditError");
    const submit = document.querySelector("#reviewBulkEdit");
    const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

    const cards = () => (Array.isArray(state.settings.credit_cards) ? state.settings.credit_cards : []);
    const selectedEntries = () => bulkEdit.describeSelection(state.entries, state.selectedEntries).selected;

    function setError(message) {
      error.textContent = message;
      error.hidden = !message;
    }

    // Descriptions of the new type or, without one, of the type every selected
    // record shares; mixed types offer every known description.
    function renderDescriptions() {
      const selected = description.value;
      const types = [...new Set(selectedEntries().map((entry) => entry.type))];
      const baseType = type.value || (types.length === 1 ? types[0] : "");
      const options = baseType
        ? entryDescriptionOptions(baseType)
        : [...new Set(state.entries.map((entry) => entry.description).filter(Boolean))];
      fill(description, options, "Não alterar");
      description.value = options.includes(selected) ? selected : "";
    }

    function renderPayment(entries) {
      const hasExpense = entries.some((entry) => domain.entryFlowType(entry) === "expense");
      const knownCards = cards();
      paymentField.hidden = !hasExpense || knownCards.length === 0;
      payment.replaceChildren(
        new Option("Não alterar", ""),
        new Option("Pix, débito ou dinheiro", NO_CARD),
        ...knownCards.map((card) => new Option(`Crédito: ${card.name}`, card.id)),
      );
      payment.disabled = paymentField.hidden;
    }

    function open() {
      const entries = selectedEntries();
      if (!entries.length) return;
      form.reset();
      setError("");
      title.textContent = `Editar ${entries.length} selecionado${entries.length === 1 ? "" : "s"}`;
      fill(type, entryTypeOptions(), "Não alterar");
      renderDescriptions();
      renderPayment(entries);
      dialog.showModal();
      status.focus();
    }

    function readChanges() {
      const changes = {};
      if (status.value) changes.paid = status.value === "paid";
      if (date.value) changes.date = date.value;
      if (type.value) changes.type = type.value;
      if (description.value) changes.description = description.value;
      if (!paymentField.hidden && payment.value) changes.creditCardId = payment.value === NO_CARD ? "" : payment.value;
      return changes;
    }

    function labelsFor(changes) {
      return {
        paid: status.selectedOptions[0]?.textContent,
        date: changes.date ? dateFormat.format(new Date(`${changes.date}T00:00:00Z`)) : "",
        payment: payment.selectedOptions[0]?.textContent,
      };
    }

    async function apply(event) {
      event.preventDefault();
      if (date.value && !date.checkValidity()) {
        setError("A data informada não é válida. Corrija ou deixe em branco para não alterar.");
        date.focus();
        return;
      }
      const changes = readChanges();
      if (!bulkEdit.hasChanges(changes)) {
        setError("Escolha pelo menos uma alteração. Campos em “Não alterar” ficam como estão.");
        status.focus();
        return;
      }
      setError("");
      const selectedIds = new Set(state.selectedEntries);
      const count = selectedEntries().length;
      const accepted = await confirmDialog.ask({
        title: `Alterar ${count} registro${count === 1 ? "" : "s"}?`,
        description: "Confira o que muda antes de aplicar. Você poderá desfazer logo depois.",
        details: bulkEdit.editSummary(state.entries, selectedIds, changes, labelsFor(changes)),
        confirmLabel: "Aplicar alterações",
      });
      if (!accepted) return;

      submit.disabled = true;
      submit.setAttribute("aria-busy", "true");
      try {
        await commit(selectedIds, changes);
      } finally {
        submit.disabled = false;
        submit.removeAttribute("aria-busy");
      }
    }

    // Saves the changes in one local commit. On failure nothing changes, the
    // dialog and the selection stay as they were and the person is told.
    async function commit(selectedIds, changes) {
      const session = state.user;
      let applied = [];
      let originals = [];
      const result = await financialMutation(() => {
          const plan = bulkEdit.planEdit(state.entries, selectedIds, changes);
          originals = plan.updates.map((updated) => structuredClone(state.entries.find((entry) => entry.id === updated.id)));
          plan.updates.forEach((updated) => {
            const index = state.entries.findIndex((entry) => entry.id === updated.id);
            state.entries[index] = updated;
            queueUpsert(updated);
          });
          applied = structuredClone(plan.updates);
          return plan.updates.length;
      });
      if (!result.ok) return result;
      if (dialog.open) dialog.close();
      exitSelectionMode();
      if (!result.value) {
        show("Nada mudou: os registros selecionados já tinham esses valores.");
        return result;
      }
      show(`${result.value} registro${result.value === 1 ? " atualizado" : "s atualizados"}. ${pendingSyncMessage()}`, {
        label: "Desfazer",
        onClick: () => undo(session, applied, originals),
      });
      return result;
    }

    // Undo only while the records are exactly as this edit left them.
    async function undo(session, applied, originals) {
      if (state.user !== session) return;
      const current = applied.map((updated) => state.entries.find((entry) => entry.id === updated.id));
      if (JSON.stringify(current) !== JSON.stringify(applied)) {
        show("Alteração não desfeita: os registros mudaram depois. Confira os dados atuais.");
        return;
      }
      const result = await financialMutation(() => {
        originals.forEach((original) => {
          const index = state.entries.findIndex((entry) => entry.id === original.id);
          state.entries[index] = structuredClone(original);
          queueUpsert(state.entries[index]);
        });
      });
      if (!result.ok) return;
      render();
      show("Alteração em lote desfeita.");
    }

    form.addEventListener("submit", apply);
    type.addEventListener("change", renderDescriptions);
    dialog.querySelectorAll("[data-close-bulk-edit]").forEach((button) => {
      button.addEventListener("click", () => dialog.close());
    });

    return { open, commit };
  }

  global.MGBulkEditDialog = { create };
})(window);
