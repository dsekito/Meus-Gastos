// Markup of the balance projection: a step chart of the end-of-day balance
// and a day-by-day list. Pure string builders; the caller escapes nothing
// else, because every user text goes through the `esc` it passes in.
(function attachProjectionView(global) {
  const domain = global.MGDomain;
  const WIDTH = 600;
  const HEIGHT = 180;
  const PADDING = 12;
  const axisMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  const dayLabel = (date, options) => new Date(`${date}T12:00`).toLocaleDateString("pt-BR", options);
  const percent = value => `${(Math.round(value * 1000) / 10).toFixed(1)}%`;

  // Ranges close to zero are anchored at zero so the drawing does not
  // exaggerate small movements; a flat month gets some breathing room.
  function valueRange(values) {
    let low = Math.min(...values);
    let high = Math.max(...values);
    if (low > 0 && low < high / 2) low = 0;
    if (high < 0 && high > low / 2) high = 0;
    if (high === low) {
      const pad = Math.max(Math.abs(high) * 0.1, 1);
      high += pad;
      low -= pad;
    }
    return { low, high };
  }

  function dayIndexAt(dayCount, ratio) {
    if (!(dayCount > 0) || !Number.isFinite(ratio)) return 0;
    return Math.min(dayCount - 1, Math.max(0, Math.floor(ratio * dayCount)));
  }

  function chartMarkup(series, { today, money }) {
    const values = series.days.map(day => day.balance);
    const count = values.length;
    const { low, high } = valueRange(values);
    const y = value => PADDING + ((high - value) / (high - low)) * (HEIGHT - 2 * PADDING);
    const x = index => (index / count) * WIDTH;
    let line = `M0 ${y(values[0]).toFixed(2)} H${x(1).toFixed(2)}`;
    for (let index = 1; index < count; index += 1) {
      line += ` V${y(values[index]).toFixed(2)} H${x(index + 1).toFixed(2)}`;
    }
    const zero = Math.min(Math.max(0, low), high);
    const zeroY = y(zero).toFixed(2);
    const area = `${line} V${zeroY} H0 Z`;
    const crossesZero = low < 0 && high > 0;
    const minimumIndex = series.days.findIndex(day => day.date === series.minimum.date);
    const todayIndex = series.days.findIndex(day => day.date === today);
    const label = `Gráfico do saldo previsto: começa o mês em ${money(series.opening)}, termina em ${money(series.closing)}; menor saldo de ${money(series.minimum.balance)} em ${dayLabel(series.minimum.date)}.`;
    const axis = [[high, "top"], ...(crossesZero ? [[0, "zero"]] : []), [low, "bottom"]]
      .map(([value, kind]) => `<span class="projection-axis-${kind}" style="top:${percent(y(value) / HEIGHT)}">${axisMoney.format(value)}</span>`)
      .join("");
    const middle = Math.ceil(count / 2);
    // The "Hoje" tag replaces the mid-month tick when they would collide.
    const showMiddle = todayIndex < 0 || Math.abs(todayIndex + 1 - middle) > count / 6;
    return `<div class="projection-chart-frame">
      <div class="projection-chart-axis" aria-hidden="true">${axis}</div>
      <div class="projection-chart-plot">
        <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" role="img" aria-label="${label}">
          <defs>
            <clipPath id="projectionAboveZero"><rect x="0" y="0" width="${WIDTH}" height="${zeroY}"/></clipPath>
            <clipPath id="projectionBelowZero"><rect x="0" y="${zeroY}" width="${WIDTH}" height="${HEIGHT}"/></clipPath>
          </defs>
          <path class="projection-area" d="${area}" clip-path="url(#projectionAboveZero)"/>
          <path class="projection-area negative" d="${area}" clip-path="url(#projectionBelowZero)"/>
          ${crossesZero ? `<line class="projection-zero" x1="0" x2="${WIDTH}" y1="${zeroY}" y2="${zeroY}"/>` : ""}
          ${todayIndex >= 0 ? `<line class="projection-today" x1="${x(todayIndex + 0.5).toFixed(2)}" x2="${x(todayIndex + 0.5).toFixed(2)}" y1="0" y2="${HEIGHT}"/>` : ""}
          <path class="projection-line" d="${line}" clip-path="url(#projectionAboveZero)"/>
          <path class="projection-line negative" d="${line}" clip-path="url(#projectionBelowZero)"/>
        </svg>
        <span class="projection-marker minimum" style="left:${percent((minimumIndex + 0.5) / count)};top:${percent(y(series.minimum.balance) / HEIGHT)}" aria-hidden="true"></span>
        <span class="projection-chart-cursor" aria-hidden="true" hidden></span>
      </div>
      <div class="projection-chart-days" aria-hidden="true">
        <span>1</span>${todayIndex >= 0 ? `<span class="projection-today-label" style="left:${percent((todayIndex + 0.5) / count)}">Hoje</span>` : ""}${showMiddle ? `<span>${middle}</span>` : ""}<span>${count}</span>
      </div>
    </div>`;
  }

  function entryMarkup(entry, { money, esc }) {
    const income = domain.entryFlowType(entry) === "income";
    return `<li><button type="button" class="projection-entry" data-projection-entry="${esc(entry.id)}">
      <span class="projection-entry-name">${esc(entry.description)}<small>${esc(entry.type)} · ${domain.entryStatusLabel(entry)}</small></span>
      <strong class="projection-entry-value${income ? " income" : ""}">${income ? "+" : "−"} ${money(entry.value)}</strong>
    </button></li>`;
  }

  function dayMarkup(date, entries, balance, isToday, helpers) {
    const { money } = helpers;
    const sorted = [...entries].sort((a, b) =>
      (domain.entryFlowType(a) === "income" ? 0 : 1) - (domain.entryFlowType(b) === "income" ? 0 : 1)
      || String(a.description).localeCompare(String(b.description), "pt-BR"));
    return `<li class="projection-day" data-negative="${balance < 0}"${isToday ? ' data-today="true"' : ""}>
      <div class="projection-day-head">
        <h4>${dayLabel(date, { weekday: "short", day: "numeric", month: "short" })}${isToday ? ' <span class="projection-today-badge">Hoje</span>' : ""}</h4>
        <span class="projection-day-balance">Saldo <strong>${money(balance)}</strong>${balance < 0 ? ' <em>negativo</em>' : ""}</span>
      </div>
      ${sorted.length
        ? `<ul class="projection-day-entries">${sorted.map(entry => entryMarkup(entry, helpers)).join("")}</ul>`
        : '<p class="projection-day-empty">Nenhum lançamento hoje.</p>'}
    </li>`;
  }

  // Days of the current month before today are folded away so the list
  // starts with what is still ahead.
  function timelineMarkup(series, entries, { today, money, esc }) {
    const helpers = { money, esc };
    const byDate = new Map();
    for (const entry of entries) {
      if (entry.excluded_from_series || !entry.date?.startsWith(`${series.month}-`)) continue;
      if (!byDate.has(entry.date)) byDate.set(entry.date, []);
      byDate.get(entry.date).push(entry);
    }
    if (!byDate.size) {
      return `<p class="empty">Nenhum lançamento neste mês. O saldo previsto fica em ${money(series.closing)}.</p>`;
    }
    const balances = new Map(series.days.map(day => [day.date, day.balance]));
    const includesToday = balances.has(today);
    const dates = [...new Set([...byDate.keys(), ...(includesToday ? [today] : [])])].sort();
    const item = date => dayMarkup(date, byDate.get(date) || [], balances.get(date), date === today, helpers);
    const past = includesToday ? dates.filter(date => date < today) : [];
    const ahead = dates.filter(date => !past.includes(date));
    return `${past.length ? `<details class="projection-past"><summary>Dias anteriores (${past.length})</summary><ol class="projection-days">${past.map(item).join("")}</ol></details>` : ""}
      <ol class="projection-days">${ahead.map(item).join("")}</ol>`;
  }

  global.MGProjectionView = { chartMarkup, timelineMarkup, dayIndexAt, valueRange };
})(window);
