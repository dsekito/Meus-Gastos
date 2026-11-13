// Rules and texts of the entry form that do not depend on the DOM: which
// values are accepted, the recurrence summary and the installment preview.
(function attachEntryFormRules(global) {
  const domain = global.MGDomain;
  const RECURRING = ["weekly", "monthly", "annual", "custom"];
  const UNIT_LABELS = { day: ["dia", "dias"], week: ["semana", "semanas"], month: ["mês", "meses"], year: ["ano", "anos"] };

  const isRecurring = (frequency) => RECURRING.includes(frequency);

  // Zero is never a value; recurring entries and income must be positive
  // (a single negative expense is a refund).
  function valueError(rawValue, { recurring, income }) {
    if (rawValue === "") return "";
    const value = Number(rawValue);
    return value === 0 || ((recurring || income) && value < 0) ? "Informe um valor maior que zero." : "";
  }

  function endDateError({ recurring, endMode, endDate, startDate }) {
    return recurring && endMode === "on_date" && endDate !== "" && startDate !== "" && endDate < startDate
      ? "A data final deve ser igual ou posterior à data inicial."
      : "";
  }

  function recurrenceSummary({ frequency, customUnit, interval, endMode, endDate, occurrenceCount, businessDayAdjustment }) {
    const unit = frequency === "custom" ? customUnit : { weekly: "week", monthly: "month", annual: "year" }[frequency];
    const labels = UNIT_LABELS[unit] || ["período", "períodos"];
    const every = Math.max(1, Number(interval) || 1);
    let text = every === 1 ? `A cada ${labels[0]}` : `A cada ${every} ${labels[1]}`;
    if (endMode === "on_date" && endDate) {
      text += `, até ${new Date(`${endDate}T12:00`).toLocaleDateString("pt-BR")}`;
    } else if (endMode === "after_occurrences") {
      const total = Math.max(1, Number(occurrenceCount) || 1);
      text += `, por ${total} ocorrência${total === 1 ? "" : "s"}`;
    } else {
      text += ", sem data final";
    }
    if (businessDayAdjustment === "previous") text += ", movendo fins de semana para o dia útil anterior";
    if (businessDayAdjustment === "next") text += ", movendo fins de semana para o próximo dia útil";
    return `${text}.`;
  }

  // Uses the same split as the installments that will be saved.
  function installmentPreview({ rawAmount, rawQuantity, isNew, money }) {
    const quantity = Number(rawQuantity);
    const amount = Number(rawAmount);
    let text = "Informe o valor total da compra e a quantidade para conferir as parcelas.";
    if (quantity >= 2 && quantity <= 5000 && Number.isInteger(quantity) && Number.isFinite(amount) && rawAmount !== "") {
      const { regularCents, lastCents } = domain.installmentSplit(amount, quantity);
      text = lastCents === regularCents
        ? `${quantity} parcelas de ${money(regularCents / 100)} · Total da compra: ${money(amount)}.`
        : `${quantity - 1} parcelas de ${money(regularCents / 100)} e a última de ${money(lastCents / 100)} · Total da compra: ${money(amount)}.`;
    }
    return isNew ? `${text} As parcelas começam em aberto; marque o pagamento de cada uma nos registros.` : text;
  }

  global.MGEntryFormRules = { isRecurring, valueError, endDateError, recurrenceSummary, installmentPreview };
})(window);
