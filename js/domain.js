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

  function dailyEntryTotals(entries) {
    return entries.reduce((totals, entry) => {
      if (entry.excluded_from_series) return totals;
      if ((entry.flow_type || "expense") === "income") return totals;
      totals.set(entry.date, (totals.get(entry.date) || 0) + Number(entry.value));
      return totals;
    }, new Map());
  }

  function dailyEntryNet(entries) {
    return entries.reduce((totals, entry) => {
      if (entry.excluded_from_series) return totals;
      const value = Number(entry.value);
      const impact = (entry.flow_type || "expense") === "income" ? value : -value;
      totals.set(entry.date, (totals.get(entry.date) || 0) + impact);
      return totals;
    }, new Map());
  }

  function dailyIncomeTotals(entries) {
    return entries.reduce((totals, entry) => {
      if (entry.excluded_from_series) return totals;
      if ((entry.flow_type || "expense") !== "income") return totals;
      totals.set(entry.date, (totals.get(entry.date) || 0) + Number(entry.value));
      return totals;
    }, new Map());
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

  global.MGDomain = {
    todayISO,
    addDays,
    addMonthsClamped,
    adjustBusinessDay,
    generateRecurringOccurrences,
    dailyEntryTotals,
    dailyEntryNet,
    dailyIncomeTotals,
    projectedBalance,
  };
})(window);
