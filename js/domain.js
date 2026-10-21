(function attachDomain(global) {
  function todayISO() {
    const now = new Date();
    const timezoneOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 10);
  }

  function addDays(date, days) {
    const value = new Date(`${date}T12:00`);
    value.setDate(value.getDate() + days);
    return value.toISOString().slice(0, 10);
  }

  function addMonthsClamped(date, months) {
    const [year, month, day] = date.split("-").map(Number);
    const target = new Date(year, month - 1 + months, 1, 12);
    const lastDay = new Date(
      target.getFullYear(),
      target.getMonth() + 1,
      0,
      12,
    ).getDate();
    target.setDate(Math.min(day, lastDay));
    return target.toISOString().slice(0, 10);
  }

  function adjustBusinessDay(date, adjustment = "none") {
    if (adjustment === "none") return date;
    let cursor = date;
    const direction = adjustment === "previous" ? -1 : 1;
    while ([0, 6].includes(new Date(`${cursor}T12:00`).getDay())) {
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
    const maxOccurrences = Math.min(
      Number(series.occurrence_count) || 5000,
      5000,
    );
    for (let index = 0; index < maxOccurrences; index += 1) {
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

  function dailyEntryTotals(entries) {
    return entries.reduce((totals, entry) => {
      if (entry.excluded_from_series) return totals;
      if (entryFlowType(entry) === "income") return totals;
      totals.set(entry.date, (totals.get(entry.date) || 0) + Number(entry.value));
      return totals;
    }, new Map());
  }

  function dailyEntryNet(entries) {
    return entries.reduce((totals, entry) => {
      if (entry.excluded_from_series) return totals;
      const value = Number(entry.value);
      const impact = entryFlowType(entry) === "income" ? value : -value;
      totals.set(entry.date, (totals.get(entry.date) || 0) + impact);
      return totals;
    }, new Map());
  }

  function dailyIncomeTotals(entries) {
    return entries.reduce((totals, entry) => {
      if (entry.excluded_from_series) return totals;
      if (entryFlowType(entry) !== "income") return totals;
      totals.set(entry.date, (totals.get(entry.date) || 0) + Number(entry.value));
      return totals;
    }, new Map());
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
    const descriptionsFromEntries = entries
      .filter((entry) => entry.type === selectedType)
      .map((entry) => entry.description)
      .filter(Boolean);
    const registeredDescriptions = new Set(descriptionsFromEntries);

    return [...new Set([
      ...defaultOptions,
      ...customOptions,
      ...descriptionsFromEntries,
      selectedDescription,
    ].filter((option) =>
      option && (
        registeredDescriptions.has(option)
        || option === selectedDescription
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
    const excludedEntries = sortedEntries.filter((entry) => entry.excluded_from_series);
    const excludedDates = new Set(
      excludedEntries.map((entry) => entry.scheduled_date || entry.date).filter(Boolean),
    );
    const activeEntries = sortedEntries.filter((entry) => !entry.excluded_from_series);
    const availableOccurrences = occurrences.filter(
      (occurrence) => !excludedDates.has(occurrence.scheduled_date),
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

    excludedEntries
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

  function projectedBalance(date, settings, entryTotals) {
    const referenceDate = settings.balance_reference_date || todayISO();
    let balance = Number(settings.current_balance);
    const dailyNet = (value) => entryTotals.get(value) || 0;
    if (date > referenceDate) {
      for (let cursor = addDays(referenceDate, 1); cursor <= date; cursor = addDays(cursor, 1)) balance += dailyNet(cursor);
    } else if (date < referenceDate) {
      for (let cursor = addDays(date, 1); cursor <= referenceDate; cursor = addDays(cursor, 1)) balance -= dailyNet(cursor);
    }
    return balance;
  }

  function minimumProjectedBalance(fromDate, toDate, settings, entryTotals) {
    let minimum = {
      date: fromDate,
      balance: projectedBalance(fromDate, settings, entryTotals),
    };
    for (let cursor = addDays(fromDate, 1); cursor <= toDate; cursor = addDays(cursor, 1)) {
      const balance = projectedBalance(cursor, settings, entryTotals);
      if (balance < minimum.balance) minimum = { date: cursor, balance };
    }
    return minimum;
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

  global.MGDomain = {
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
    dailyIncomeTotals,
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
  };
})(window);
