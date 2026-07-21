const YearlyPage = (() => {

  function render(state) {
    const year = currentYear(state);
    const inYear = state.transactions.filter(t => {
      const k = Utils.monthKeyOf(t.Timestamp);
      return k && k.year === year;
    });

    const monthlyIncome = new Array(12).fill(0);
    const monthlyExpense = new Array(12).fill(0);

    inYear.forEach(t => {
      const k = Utils.monthKeyOf(t.Timestamp);
      const amt = Number(t.Amount) || 0;
      if (t.TransactionType === 'Income') monthlyIncome[k.month] += amt;
      else if (t.TransactionType === 'Expense') monthlyExpense[k.month] += amt;
    });

    const monthlyNet = monthlyIncome.map((v, i) => v - monthlyExpense[i]);
    const labels = Utils.MONTH_NAMES.map(m => m.slice(0, 3));

    Charts.line('yearlyLineChart', labels, [
      { label: 'Income', data: monthlyIncome, color: '#4FAE7C' },
      { label: 'Expenses', data: monthlyExpense, color: '#E1614F' }
    ]);

    Charts.bar('yearlyBarChart', labels, monthlyNet, monthlyNet.map(v => v >= 0 ? '#4FAE7C' : '#E1614F'));

    const totalIncome = monthlyIncome.reduce((a, b) => a + b, 0);
    const totalExpense = monthlyExpense.reduce((a, b) => a + b, 0);
    const net = totalIncome - totalExpense;
    const savingsRate = totalIncome ? (net / totalIncome) * 100 : 0;

    document.getElementById('yearlyStats').innerHTML = `
      <div class="stat-card">
        <div class="label">${year} total income</div>
        <div class="value positive">${Utils.fmtMoney(totalIncome)}</div>
      </div>
      <div class="stat-card">
        <div class="label">${year} total expenses</div>
        <div class="value negative">${Utils.fmtMoney(totalExpense)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Net</div>
        <div class="value ${net >= 0 ? 'positive' : 'negative'}">${Utils.fmtMoney(net)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Savings rate</div>
        <div class="value">${savingsRate.toFixed(1)}%</div>
      </div>`;
  }

  function currentYear(state) {
    if (state.month && state.month !== 'all') return Number(state.month.split('-')[0]);
    const opt = state.monthOptions[0];
    return opt ? opt.year : new Date().getFullYear();
  }

  return { render };
})();