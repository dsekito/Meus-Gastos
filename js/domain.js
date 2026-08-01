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

  function lastBusinessDay(year, monthIndex) {
    const date = new Date(year, monthIndex + 1, 0, 12);
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  function recurringIncome(date, settings) {
    const [year, month, day] = date.split("-").map(Number);
    let income = day === 15 ? Number(settings.income_day_15) : 0;
    if (date === lastBusinessDay(year, month - 1)) income += Number(settings.income_last_business_day);
    return income;
  }

  function dailyEntryTotals(entries) {
    return entries.reduce((totals, entry) => {
      totals.set(entry.date, (totals.get(entry.date) || 0) + Number(entry.value));
      return totals;
    }, new Map());
  }

  function projectedBalance(date, settings, entryTotals) {
    const referenceDate = settings.balance_reference_date || todayISO();
    let balance = Number(settings.current_balance);
    const dailyNet = (value) => recurringIncome(value, settings) - (entryTotals.get(value) || 0);
    if (date > referenceDate) {
      for (let cursor = addDays(referenceDate, 1); cursor <= date; cursor = addDays(cursor, 1)) balance += dailyNet(cursor);
    } else if (date < referenceDate) {
      for (let cursor = addDays(date, 1); cursor <= referenceDate; cursor = addDays(cursor, 1)) balance -= dailyNet(cursor);
    }
    return balance;
  }

  function financialRadar(entries, settings, fromDate = todayISO(), horizonDays = 30) {
    const entryTotals = dailyEntryTotals(entries);
    const endDate = addDays(fromDate, Math.max(0, horizonDays - 1));
    let minimumBalance = Infinity;
    let minimumBalanceDate = fromDate;
    let firstRiskDate = null;

    for (let date = fromDate; date <= endDate; date = addDays(date, 1)) {
      const balance = projectedBalance(date, settings, entryTotals);
      if (balance < minimumBalance) {
        minimumBalance = balance;
        minimumBalanceDate = date;
      }
      if (!firstRiskDate && balance < 0) firstRiskDate = date;
    }

    return {
      fromDate,
      endDate,
      minimumBalance,
      minimumBalanceDate,
      firstRiskDate,
    };
  }

  global.MGDomain = {
    todayISO,
    addDays,
    lastBusinessDay,
    recurringIncome,
    dailyEntryTotals,
    projectedBalance,
    financialRadar,
  };
})(window);
