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

  function nextIncomeDate(fromDate, settings, maxDays = 370) {
    for (let offset = 1; offset <= maxDays; offset += 1) {
      const date = addDays(fromDate, offset);
      if (recurringIncome(date, settings) > 0) return date;
    }
    return null;
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

    const nextIncome = nextIncomeDate(fromDate, settings);
    const openUntilIncome = entries.filter(
      (entry) =>
        !entry.paid &&
        entry.date >= fromDate &&
        entry.date <= (nextIncome || endDate),
    );
    const openTotal = openUntilIncome.reduce(
      (total, entry) => total + Number(entry.value),
      0,
    );
    const currentBalance = projectedBalance(fromDate, settings, entryTotals);
    const nextIncomeAmount = nextIncome
      ? recurringIncome(nextIncome, settings)
      : 0;

    return {
      fromDate,
      endDate,
      minimumBalance,
      minimumBalanceDate,
      firstRiskDate,
      nextIncomeDate: nextIncome,
      nextIncomeAmount,
      balanceAfterIncome: currentBalance + nextIncomeAmount - openTotal,
      openCount: openUntilIncome.length,
      openTotal,
    };
  }

  global.MGDomain = {
    todayISO,
    addDays,
    lastBusinessDay,
    recurringIncome,
    dailyEntryTotals,
    projectedBalance,
    nextIncomeDate,
    financialRadar,
  };
})(window);
