// Markup of the monthly statement (Mensal). Pure string builders over the
// result of MGDomain.monthlyCashFlow; the caller supplies `money`.
(function attachMonthlyView(global) {
  const MODES = { "": "realizados e previstos", paid: "realizados", pending: "em aberto" };
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const monthName = (month, options) => new Date(`${month}-01T12:00`).toLocaleDateString("pt-BR", options);
  const centsDifference = (current, previous) => (Math.round(current * 100) - Math.round(previous * 100)) / 100;

  // Each month is compared with the one before it; January with December of
  // the previous year (`previousDecember`, null when there is none).
  function comparisons(summary, previousDecember) {
    return summary.months.map((month, index) => {
      const previous = index ? summary.months[index - 1] : previousDecember;
      if (!previous) return null;
      return {
        previous,
        difference: {
          income: centsDifference(month.income, previous.income),
          expense: centsDifference(month.expense, previous.expense),
          balance: centsDifference(month.balance, previous.balance),
        },
      };
    });
  }

  function annualMarkup(summary, { money }) {
    return [["Entradas no ano", summary.totals.income, "income"], ["Saídas no ano", summary.totals.expense, "expense"], ["Saldo do ano", summary.totals.balance, "balance"]]
      .map(([label, value, kind]) => `<article class="monthly-total ${kind}"><span>${label}</span><strong data-negative="${value < 0}">${money(value)}</strong></article>`)
      .join("");
  }

  function statusText(summary) {
    const { count } = summary.totals;
    return `${summary.year} · ${plural(count, "lançamento")} ${MODES[summary.status]}.${count ? "" : " Nenhum lançamento neste ano com a situação selecionada."}`;
  }

  function monthsMarkup(summary, previousDecember, { money }) {
    const mode = MODES[summary.status];
    const delta = value => `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value))}`;
    const compared = comparisons(summary, previousDecember);
    return summary.months.map((month, index) => {
      const name = monthName(month.month, { month: "long" });
      const comparison = compared[index];
      const titleId = `cashFlowMonth-${month.month}`;
      const comparisonText = comparison
        ? `<p>Comparação com ${monthName(comparison.previous.month, { month: "long", year: "numeric" })} (${comparison.previous.count ? `${comparison.previous.count} lançamentos` : "sem lançamentos"}): entradas ${delta(comparison.difference.income)}, saídas ${delta(comparison.difference.expense)}, saldo ${delta(comparison.difference.balance)}.</p>`
        : "";
      return `<article class="panel monthly-cash-flow-card" aria-labelledby="${titleId}" data-cash-flow-month="${month.month}">
            <div class="monthly-card-heading"><h3 id="${titleId}">${name}</h3><span>${month.count ? plural(month.count, "lançamento") : "Sem lançamentos"}</span></div>
            <dl><div><dt>Entradas</dt><dd class="monthly-income">${money(month.income)}</dd></div>
              <div><dt>Saídas</dt><dd>${money(month.expense)}</dd></div>
              <div class="monthly-net"><dt>Saldo do mês</dt><dd data-negative="${month.balance < 0}">${money(month.balance)}</dd></div>
              <div><dt>Acumulado no ano</dt><dd data-negative="${month.accumulated < 0}">${money(month.accumulated)}</dd></div></dl>
              ${comparisonText}
            <p>${month.balance < 0 ? "Saídas acima das entradas." : month.balance > 0 ? "Entradas acima das saídas." : ""}</p>
            <button class="secondary" type="button" data-open-cash-flow-month="${month.month}" aria-label="Ver lançamentos de ${name} de ${summary.year}, ${mode}" ${month.count ? "" : "disabled"}>Ver lançamentos</button>
          </article>`;
    }).join("");
  }

  function yearOptions(years, selected) {
    return [...years].sort((a, b) => b - a)
      .map(year => `<option value="${year}" ${year === selected ? "selected" : ""}>${year}</option>`).join("");
  }

  global.MGMonthlyView = { comparisons, annualMarkup, statusText, monthsMarkup, yearOptions };
})(window);
