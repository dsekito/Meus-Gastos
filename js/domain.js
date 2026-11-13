(function attachDomain(global) {
  function todayISO() {
    const now = new Date();
    const timezoneOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 10);
  }

  // Calendar arithmetic is done in UTC so the result never depends on the
  // device time zone (local noon is the previous UTC day from UTC+12 onwards).
  // setUTCFullYear keeps years 0-99 literal, unlike Date.UTC.
  function utcDate(year, monthIndex, day) {
    const value = new Date(0);
    value.setUTCFullYear(year, monthIndex, day);
    return value;
  }

  function dateParts(date) {
    return String(date).split("-").map(Number);
  }

  function addDays(date, days) {
    const [year, month, day] = dateParts(date);
    return utcDate(year, month - 1, day + days).toISOString().slice(0, 10);
  }

  function addMonthsClamped(date, months) {
    const [year, month, day] = dateParts(date);
    const target = utcDate(year, month - 1 + months, 1);
    const lastDay = utcDate(target.getUTCFullYear(), target.getUTCMonth() + 1, 0).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay));
    return target.toISOString().slice(0, 10);
  }

  function weekday(date) {
    const [year, month, day] = dateParts(date);
    return utcDate(year, month - 1, day).getUTCDay();
  }

  function adjustBusinessDay(date, adjustment = "none") {
    if (adjustment === "none") return date;
    let cursor = date;
    const direction = adjustment === "previous" ? -1 : 1;
    while ([0, 6].includes(weekday(cursor))) {
      cursor = addDays(cursor, direction);
    }
    return cursor;
  }

  function recurrenceStepDate(series, index) {
    const interval = Math.max(1, Number(series.interval_value) || 1);
    switch (series.frequency) {
      case "weekly":
        return addDays(series.start_date, index * interval * 7);
      case "monthly":
        return addMonthsClamped(series.start_date, index * interval);
      case "annual":
        return addMonthsClamped(series.start_date, index * interval * 12);
      case "custom": {
        const unit = series.custom_unit || "day";
        if (unit === "week") return addDays(series.start_date, index * interval * 7);
        if (unit === "month") return addMonthsClamped(series.start_date, index * interval);
        if (unit === "year") return addMonthsClamped(series.start_date, index * interval * 12);
        return addDays(series.start_date, index * interval);
      }
      default:
        throw new Error(`Frequência inválida: ${series.frequency}`);
    }
  }

  function generateRecurringOccurrences(series, fromDate, toDate) {
    const occurrences = [];
    // Seek by the original calendar anchor, not by iterating lifetime slots.
    // The floor can land just before fromDate (month-end clamps, for example);
    // the ordinary scheduled-date filter below resolves that boundary.
    const interval = Math.max(1, Number(series.interval_value) || 1);
    const unit = series.frequency === "custom" ? series.custom_unit || "day"
      : { weekly: "week", monthly: "month", annual: "year" }[series.frequency];
    const monthBased = unit === "month" || unit === "year";
    const elapsed = monthBased
      ? (Number(fromDate.slice(0, 4)) - Number(series.start_date.slice(0, 4))) * 12
        + Number(fromDate.slice(5, 7)) - Number(series.start_date.slice(5, 7))
      : (Date.parse(`${fromDate}T00:00:00Z`) - Date.parse(`${series.start_date}T00:00:00Z`)) / 86400000;
    const step = interval * (unit === "year" ? 12 : unit === "week" ? 7 : 1);
    const firstIndex = Math.max(0, Math.floor(elapsed / step));
    // Retain explicit legacy count constraints, even when end_mode is never.
    const maxOccurrences = Number(series.occurrence_count) || Infinity;
    for (let index = firstIndex; index < maxOccurrences; index += 1) {
      const scheduledDate = recurrenceStepDate(series, index);
      if (series.end_mode === "on_date" && scheduledDate > series.end_date) break;
      if (scheduledDate > toDate) break;
      if (scheduledDate < fromDate) continue;
      occurrences.push({
        index: index + 1,
        scheduled_date: scheduledDate,
        date: adjustBusinessDay(
          scheduledDate,
          series.business_day_adjustment,
        ),
      });
    }
    return occurrences;
  }

  function entryFlowType(entry = {}) {
    const normalize = value => String(value || "").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
    // Historical receivables may have been stored with the expense default.
    // Resolve the exact classification without rewriting stored records.
    if (normalize(entry.type) === "a receber" || normalize(entry.status) === "a receber") return "income";
    return entry.flow_type === "income" ? "income" : "expense";
  }

  function entryStatusLabel(entry) {
    return entryFlowType(entry) === "income"
      ? entry.paid ? "Recebido" : "A receber"
      : entry.paid ? "Pago" : "Em aberto";
  }

  // Daily maps are accumulated in integer cents and converted to reais once,
  // so long lists never drift by floating-point error.
  function dailyCentsMap(entries, impactOf) {
    const cents = new Map();
    for (const entry of entries) {
      if (entry.excluded_from_series) continue;
      const impact = impactOf(entry);
      if (impact === null) continue;
      const value = Math.round(Number(entry.value) * 100);
      if (!Number.isFinite(value)) continue;
      cents.set(entry.date, (cents.get(entry.date) || 0) + impact * value);
    }
    return new Map([...cents].map(([date, total]) => [date, total / 100]));
  }

  function dailyEntryTotals(entries) {
    return dailyCentsMap(entries, entry => entryFlowType(entry) === "income" ? null : 1);
  }

  function dailyEntryNet(entries) {
    return dailyCentsMap(entries, entry => entryFlowType(entry) === "income" ? 1 : -1);
  }

  // Net of the entries still open (not paid/received) on each date.
  function dailyPendingNet(entries) {
    return dailyCentsMap(entries, entry => entry.paid ? null : entryFlowType(entry) === "income" ? 1 : -1);
  }

  function dailyIncomeTotals(entries) {
    return dailyCentsMap(entries, entry => entryFlowType(entry) === "income" ? 1 : null);
  }

  function sumEntryValues(entries, { signed = false } = {}) {
    let cents = 0;
    for (const entry of entries) {
      const value = Math.round(Number(entry.value) * 100);
      if (!Number.isFinite(value)) continue;
      cents += signed && entryFlowType(entry) !== "income" ? -value : value;
    }
    return cents / 100;
  }

  function recentEntries(entries) {
    return entries.filter((entry) => !entry.excluded_from_series).sort((a, b) => {
      const aCreatedAt = String(a.created_at || `${a.date || ""}T00:00:00`);
      const bCreatedAt = String(b.created_at || `${b.date || ""}T00:00:00`);
      return bCreatedAt.localeCompare(aCreatedAt) ||
        String(b.id || "").localeCompare(String(a.id || ""));
    });
  }

  function installmentGroupKey(entry = {}) {
    if (!entry.installment) return null;
    if (entry.installment_group_id) return `id:${entry.installment_group_id}`;
    return `legacy:${entry.created_at || ""}:${entry.description || ""}:${entry.type || ""}`;
  }

  function recentEntryGroups(entries) {
    const groups = new Map();
    for (const entry of recentEntries(entries)) {
      const key = entry.series_id
        ? `series:${entry.series_id}`
        : entry.installment
          ? `installment:${installmentGroupKey(entry)}`
          : `entry:${entry.id}`;
      if (!groups.has(key)) groups.set(key, { primary: entry, entries: [] });
      groups.get(key).entries.push(entry);
    }
    return [...groups.values()];
  }

  function descriptionOptionsForType({
    selectedType = "",
    selectedDescription = "",
    entries = [],
    defaultOptions = [],
    customOptions = [],
    hiddenOptions = [],
  } = {}) {
    defaultOptions = Array.isArray(defaultOptions) ? defaultOptions : [];
    customOptions = Array.isArray(customOptions) ? customOptions : [];
    hiddenOptions = Array.isArray(hiddenOptions) ? hiddenOptions : [];
    const descriptionsFromEntries = entries
      .filter((entry) => entry.type === selectedType)
      .map((entry) => entry.description)
      .filter(Boolean);

    return [...new Set([
      ...defaultOptions,
      ...customOptions,
      ...descriptionsFromEntries,
      selectedDescription,
    ].filter((option) =>
      option && (
        option === selectedDescription
        || !hiddenOptions.includes(option)
      ),
    ))];
  }

  function typeColorMap(types = []) {
    const orderedTypes = [...new Set(types.filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), "pt-BR"),
    );
    const usedHues = new Set();
    const colors = new Map();
    const minimumHueDistance = Math.max(8, Math.floor(300 / Math.max(orderedTypes.length, 1)));

    orderedTypes.forEach((type) => {
      let hash = 0;
      for (const character of String(type)) {
        hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
      }

      let hue = Math.abs(hash) % 360;
      let attempts = 0;
      const conflictsWithUsedHue = (candidate) => [...usedHues].some((usedHue) => {
        const distance = Math.abs(candidate - usedHue);
        return Math.min(distance, 360 - distance) < minimumHueDistance;
      });

      while (attempts < 360 && conflictsWithUsedHue(hue)) {
        hue = (hue + 137) % 360;
        attempts += 1;
      }
      while (usedHues.has(hue)) hue = (hue + 1) % 360;

      usedHues.add(hue);
      colors.set(type, `hsl(${hue} 72% 34%)`);
    });

    return colors;
  }

  function recurringEntryFormValues(entry, series = null) {
    if (!series || entry.detached_from_series) return entry;

    return {
      ...entry,
      value: series.value ?? entry.value,
      flow_type: series.flow_type ?? entry.flow_type,
      type: series.type ?? entry.type,
      description: series.description ?? entry.description,
      detail: series.detail ?? entry.detail,
    };
  }

  function reconcileSeriesEntries(entries = [], occurrences = [], series = {}) {
    const sortedEntries = [...entries].sort((a, b) =>
      String(a.scheduled_date || a.date || "").localeCompare(
        String(b.scheduled_date || b.date || ""),
      ),
    );
    const protectedEntries = sortedEntries.filter((entry) =>
      entry.excluded_from_series || entry.detached_from_series,
    );
    // A moved exception still owns its original scheduled slot.
    const protectedDates = new Set(
      protectedEntries.map((entry) => entry.scheduled_date || entry.date).filter(Boolean),
    );
    const activeEntries = sortedEntries.filter((entry) =>
      !entry.excluded_from_series && !entry.detached_from_series,
    );
    const availableOccurrences = occurrences.filter(
      (occurrence) => !protectedDates.has(occurrence.scheduled_date),
    );
    const reusableCount = Math.min(activeEntries.length, availableOccurrences.length);
    const upserts = [];

    for (let index = 0; index < reusableCount; index += 1) {
      const entry = activeEntries[index];
      const occurrence = availableOccurrences[index];
      upserts.push({
        ...entry,
        date: occurrence.date,
        scheduled_date: occurrence.scheduled_date,
        series_id: series.id,
        detached_from_series: false,
        excluded_from_series: false,
        flow_type: series.flow_type,
        value: Number(series.value),
        type: series.type,
        description: series.description,
        detail: series.detail || "",
      });
    }

    protectedEntries
      .filter((entry) => entry.series_id !== series.id)
      .forEach((entry) => upserts.push({ ...entry, series_id: series.id }));

    return {
      upserts,
      staleEntries: activeEntries.slice(reusableCount),
      missingOccurrences: availableOccurrences.slice(reusableCount),
    };
  }

  function reconcileInstallmentEntries(entries = [], plan = {}) {
    const quantity = Math.max(2, Number(plan.quantity) || 2);
    const totalValue = Number(plan.value);
    const totalCents = Math.round(totalValue * 100);
    const regularCents = Math.trunc(totalCents / quantity);
    const sortedEntries = [...entries].sort((a, b) =>
      Number(a.installment?.current || 0) - Number(b.installment?.current || 0)
      || String(a.date || "").localeCompare(String(b.date || "")),
    );
    const reusableCount = Math.min(sortedEntries.length, quantity);
    const sharedFields = {
      flow_type: plan.flow_type || "expense",
      type: plan.type,
      description: plan.description,
      detail: plan.detail || "",
      series_id: null,
      scheduled_date: null,
      detached_from_series: false,
      excluded_from_series: false,
      installment_group_id: plan.group_id || null,
    };
    const installmentAt = (index) => ({
      ...sharedFields,
      date: addMonthsClamped(plan.start_date, index),
      value: (index === quantity - 1
        ? totalCents - regularCents * (quantity - 1)
        : regularCents) / 100,
      installment: {
        current: index + 1,
        total: quantity,
        original: totalValue,
      },
    });

    return {
      upserts: sortedEntries.slice(0, reusableCount).map((entry, index) => ({
        ...entry,
        ...installmentAt(index),
      })),
      staleEntries: sortedEntries.slice(quantity),
      missingInstallments: Array.from(
        { length: Math.max(0, quantity - sortedEntries.length) },
        (_, offset) => installmentAt(sortedEntries.length + offset),
      ),
    };
  }

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
  const toCents = value => Math.round(Number(value) * 100);

  // The informed balance is the account balance on the reference date: it
  // already reflects what was paid that day, but not what is still open. So
  // the open entries of the reference date are always added on top of it.
  // Balance at the end of `date` = reference balance + open net of the
  // reference date + net of (reference, date], or minus the net of
  // (date, reference] for past dates. The cost is proportional to the dates
  // that have entries, not to the days elapsed, and the sum is in cents.
  function projectedBalance(date, settings, entryTotals, pendingTotals = new Map()) {
    const referenceDate = settings.balance_reference_date || todayISO();
    let cents = toCents(settings.current_balance) + toCents(pendingTotals.get(referenceDate) || 0);
    if (date === referenceDate) return cents / 100;
    const forward = date > referenceDate;
    const low = forward ? referenceDate : date;
    const high = forward ? date : referenceDate;
    for (const [day, net] of entryTotals) {
      if (!DATE_KEY.test(day) || day <= low || day > high) continue;
      cents += forward ? toCents(net) : -toCents(net);
    }
    return cents / 100;
  }

  // Consecutive days differ exactly by that day's net, in either direction.
  function minimumProjectedBalance(fromDate, toDate, settings, entryTotals, pendingTotals = new Map()) {
    let cents = toCents(projectedBalance(fromDate, settings, entryTotals, pendingTotals));
    let minimum = { date: fromDate, balance: cents / 100 };
    for (let cursor = addDays(fromDate, 1); cursor <= toDate; cursor = addDays(cursor, 1)) {
      cents += toCents(entryTotals.get(cursor) || 0);
      if (cents / 100 < minimum.balance) minimum = { date: cursor, balance: cents / 100 };
    }
    return minimum;
  }

  // End-of-day balances of a calendar month (YYYY-MM). It starts from the
  // balance at the end of the previous day and adds each day's net in cents,
  // so the cost is the month length plus the dates that have entries.
  function monthBalanceSeries(month, settings, entryTotals, pendingTotals = new Map()) {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month));
    if (!match) throw new RangeError("Mês inválido para a projeção.");
    const daysInMonth = utcDate(Number(match[1]), Number(match[2]), 0).getUTCDate();
    let cents = toCents(projectedBalance(addDays(`${month}-01`, -1), settings, entryTotals, pendingTotals));
    const opening = cents / 100;
    const days = [];
    let minimum = null;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      cents += toCents(entryTotals.get(date) || 0);
      const balance = cents / 100;
      days.push({ date, balance });
      if (!minimum || balance < minimum.balance) minimum = { date, balance };
    }
    return { month, opening, closing: cents / 100, minimum, days };
  }

  // An entry dated on the balance reference date counts in the projection
  // only while it is open. When it changes status, moving the informed
  // balance by its value keeps the projection unchanged and matches the bank.
  function referenceBalanceAdjustment(entry, paid, settings = {}) {
    if (!entry || entry.excluded_from_series || Boolean(entry.paid) === Boolean(paid)) return null;
    if (!settings.balance_reference_date || entry.date !== settings.balance_reference_date) return null;
    const value = toCents(entry.value);
    if (!Number.isFinite(value) || value === 0) return null;
    const direction = entryFlowType(entry) === "income" ? 1 : -1;
    const from = toCents(settings.current_balance);
    const to = from + (paid ? direction : -direction) * value;
    return { from: from / 100, to: to / 100 };
  }

  // Aggregate stored occurrences by their own date, never the original purchase
  // total. Integer cents preserve installment rounding and expense refunds.
  function monthlyCashFlow(entries, year, { status = "" } = {}) {
    const selectedYear = Number(year);
    if (!Number.isInteger(selectedYear) || selectedYear < 1900 || selectedYear > 9999) {
      throw new RangeError("Ano inválido para o consolidado mensal.");
    }
    if (!["", "paid", "pending"].includes(status)) throw new RangeError("Status inválido.");
    const buckets = Array.from({ length: 12 }, (_, index) => ({
      month: `${selectedYear}-${String(index + 1).padStart(2, "0")}`,
      income: 0, expense: 0, count: 0,
    }));
    for (const entry of entries) {
      if (entry.excluded_from_series || typeof entry.date !== "string") continue;
      const date = /^(\d{4})-(0[1-9]|1[0-2])-\d{2}$/.exec(entry.date);
      if (!date || Number(date[1]) !== selectedYear) continue;
      if (status && Boolean(entry.paid) !== (status === "paid")) continue;
      const value = Number(entry.value);
      if (!Number.isFinite(value)) continue;
      const bucket = buckets[Number(date[2]) - 1];
      bucket[entryFlowType(entry)] += Math.round(value * 100);
      bucket.count++;
    }
    let accumulated = 0;
    let income = 0, expense = 0, count = 0;
    const months = buckets.map(bucket => {
      const balance = bucket.income - bucket.expense;
      accumulated += balance;
      income += bucket.income;
      expense += bucket.expense;
      count += bucket.count;
      return { month: bucket.month, income: bucket.income / 100, expense: bucket.expense / 100,
        balance: balance / 100, accumulated: accumulated / 100, count: bucket.count };
    });
    return { year: selectedYear, status, months,
      totals: { income: income / 100, expense: expense / 100, balance: (income - expense) / 100, count } };
  }

  function matchesEntrySearch(entry, query) {
    const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
    const text = normalize([entry.type, entry.description, entry.detail, entry.notes, entry.note, entry.observation].filter(Boolean).join(" "));
    return normalize(query).trim().split(/\s+/).every(term => text.includes(term));
  }

  function comparePreviousMonth(entries, month, options = {}) {
    const [year, number] = month.split("-").map(Number);
    const current = monthlyCashFlow(entries, year, options).months[number - 1];
    const previous = number === 1 ? monthlyCashFlow(entries, year - 1, options).months[11] : monthlyCashFlow(entries, year, options).months[number - 2];
    const difference = Object.fromEntries(["income", "expense", "balance"].map(key => [key, (Math.round(current[key] * 100) - Math.round(previous[key] * 100)) / 100]));
    return { current, previous, difference };
  }

  global.MGDomain = {
    comparePreviousMonth,
    matchesEntrySearch,
    entryFlowType,
    entryStatusLabel,
    monthlyCashFlow,
    todayISO,
    addDays,
    addMonthsClamped,
    adjustBusinessDay,
    generateRecurringOccurrences,
    dailyEntryTotals,
    dailyEntryNet,
    dailyPendingNet,
    dailyIncomeTotals,
    sumEntryValues,
    recentEntries,
    recentEntryGroups,
    installmentGroupKey,
    descriptionOptionsForType,
    typeColorMap,
    recurringEntryFormValues,
    reconcileSeriesEntries,
    reconcileInstallmentEntries,
    projectedBalance,
    minimumProjectedBalance,
    monthBalanceSeries,
    referenceBalanceAdjustment,
  };
})(window);
