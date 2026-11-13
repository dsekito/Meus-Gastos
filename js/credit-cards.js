// Credit cards: registered in the settings ("Opções") and offered in a new
// expense as the payment method. Choosing a card fills the entry date with
// the due date of the invoice the purchase falls into. The card is not saved
// on the entry: it only suggests the date, which stays editable.
(function attachCreditCards(global) {
  function create({ state, domain, todayISO, generateId, confirmDialog, financialMutation, show, pendingSyncMessage,
    dateInput, flowType, onDateChange }) {
    const list = document.querySelector("#creditCardList");
    const emptyMessage = document.querySelector("#creditCardEmpty");
    const nameInput = document.querySelector("#creditCardName");
    const closingDayInput = document.querySelector("#creditCardClosingDay");
    const dueDayInput = document.querySelector("#creditCardDueDay");
    const addButton = document.querySelector("#addCreditCard");
    const formError = document.querySelector("#creditCardError");
    const entryField = document.querySelector("#creditCardField");
    const entrySelect = document.querySelector("#creditCard");
    const entryHelp = document.querySelector("#creditCardHelp");
    const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
    // Date this module last wrote into the entry form. Going back to "Pix,
    // débito ou dinheiro" only restores today while the date is still ours.
    let suggestedDate = null;
    let busy = false;

    function cards() {
      return Array.isArray(state.settings.credit_cards) ? state.settings.credit_cards : [];
    }

    function cardSummary(card) {
      return `${card.name}: fecha no dia ${card.closing_day}, vence no dia ${card.due_day}`;
    }

    function renderSettings() {
      const items = cards().map((card) => {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = cardSummary(card);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary danger";
        remove.dataset.removeCreditCard = card.id;
        remove.textContent = "Excluir";
        remove.setAttribute("aria-label", `Excluir cartão ${card.name}`);
        item.append(label, remove);
        return item;
      });
      list.replaceChildren(...items);
      list.hidden = items.length === 0;
      emptyMessage.hidden = items.length > 0;
    }

    function showFormError(message, control) {
      formError.textContent = message;
      formError.hidden = !message;
      [nameInput, closingDayInput, dueDayInput].forEach((input) => {
        input.toggleAttribute("aria-invalid", input === control);
      });
      control?.focus();
    }

    function readDay(input) {
      const value = Number(input.value);
      return input.value.trim() && Number.isInteger(value) && value >= 1 && value <= 31 ? value : null;
    }

    function readCardForm() {
      const name = nameInput.value.trim();
      const closingDay = readDay(closingDayInput);
      const dueDay = readDay(dueDayInput);
      if (!name) return showFormError("Informe o nome do cartão, por exemplo Nubank.", nameInput);
      if (cards().some((card) => card.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
        return showFormError(`Já existe um cartão chamado “${name}”. Use outro nome.`, nameInput);
      }
      if (!closingDay) return showFormError("Informe o dia do fechamento da fatura, de 1 a 31.", closingDayInput);
      if (!dueDay) return showFormError("Informe o dia do vencimento da fatura, de 1 a 31.", dueDayInput);
      showFormError("", null);
      return { id: generateId(), name, closing_day: closingDay, due_day: dueDay };
    }

    async function changeCards(nextCards, savedMessage) {
      busy = true;
      addButton.disabled = true;
      list.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      try {
        const result = await financialMutation(() => {
          state.settings = { ...state.settings, credit_cards: nextCards };
          state.settingsDirty = true;
        });
        if (result.ok) show(`${savedMessage} ${pendingSyncMessage()}`);
        return result.ok;
      } finally {
        busy = false;
        addButton.disabled = false;
        renderSettings();
      }
    }

    async function addCard() {
      if (busy) return;
      const card = readCardForm();
      if (!card) return;
      addButton.setAttribute("aria-busy", "true");
      try {
        if (await changeCards([...cards(), card], `Cartão “${card.name}” adicionado.`)) {
          nameInput.value = "";
          closingDayInput.value = "";
          dueDayInput.value = "";
        }
      } finally {
        addButton.removeAttribute("aria-busy");
      }
    }

    async function removeCard(id) {
      const card = cards().find((item) => item.id === id);
      if (busy || !card || !await confirmDialog.ask({
        title: `Excluir o cartão “${card.name}”?`,
        description: "O cartão sai da forma de pagamento dos novos lançamentos.",
        details: ["Os lançamentos já feitos com ele não mudam."],
        confirmLabel: "Excluir cartão",
        tone: "danger",
      })) return;
      await changeCards(cards().filter((item) => item.id !== id), `Cartão “${card.name}” excluído.`);
    }

    function setEntryHelp(message) {
      entryHelp.textContent = message;
      entryHelp.hidden = !message;
    }

    function renderEntryOptions(selectedId = "") {
      const other = new Option("Pix, débito ou dinheiro", "");
      const group = document.createElement("optgroup");
      group.label = "Cartão de crédito";
      cards().forEach((card) => group.append(new Option(`Crédito: ${card.name}`, card.id)));
      entrySelect.replaceChildren(other, group);
      entrySelect.value = cards().some((card) => card.id === selectedId) ? selectedId : "";
    }

    // Called whenever the entry form opens or its movement changes.
    function updateEntryField({ reset = false } = {}) {
      const available = cards().length > 0 && !state.editingId && flowType.value === "expense";
      if (reset || !available) {
        suggestedDate = null;
        setEntryHelp("");
      }
      renderEntryOptions(reset || !available ? "" : entrySelect.value);
      entryField.hidden = !available;
      entrySelect.disabled = !available;
    }

    function applySelectedCard() {
      const card = cards().find((item) => item.id === entrySelect.value);
      if (!card) {
        if (suggestedDate && dateInput.value === suggestedDate) dateInput.value = todayISO();
        suggestedDate = null;
        setEntryHelp("");
        onDateChange();
        return;
      }
      suggestedDate = domain.creditCardDueDate(todayISO(), card);
      dateInput.value = suggestedDate;
      const formatted = dateFormat.format(new Date(`${suggestedDate}T00:00:00Z`));
      setEntryHelp(`Data preenchida com o vencimento da fatura do ${card.name}: ${formatted}. Você pode alterá-la.`);
      onDateChange();
    }

    addButton.onclick = addCard;
    [nameInput, closingDayInput, dueDayInput].forEach((input) => {
      // The fields live inside the settings form: Enter adds the card instead
      // of submitting the projection.
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        addCard();
      });
      input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
    });
    list.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-credit-card]");
      if (button) removeCard(button.dataset.removeCreditCard);
    });
    entrySelect.addEventListener("change", applySelectedCard);
    dateInput.addEventListener("input", () => {
      if (suggestedDate && dateInput.value !== suggestedDate) setEntryHelp("");
    });

    return { renderSettings, updateEntryField };
  }

  global.MGCreditCards = { create };
})(window);
