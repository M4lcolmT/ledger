const InvestmentsPage = (() => {

  // All account/portfolio CRUD, balance math, and the shared modals live in
  // AccountsPage — this module is a view over the same state, delegating
  // any mutation (add/edit/delete investment, log a value) back to it so
  // there's a single source of truth and only one set of modal listeners.
  const A = AccountsPage;

  function render(state) {
    const accounts = state.accounts || [];
    const investments = accounts.filter(a => a.type === 'Investment');
    const month = A.effectiveMonth(state);

    renderOverview(state, investments, month);
    renderCards(state, investments, month);
    renderPortfolioChart(state, investments);
    renderAllocationChart(state, investments, month);
  }

  // ---------- Overview stats ----------

  function renderOverview(state, investments, month) {
    const el = document.getElementById('investmentsOverviewStats');
    if (!el) return;

    if (!investments.length) {
      el.innerHTML = `
        <div class="stat-card">
          <div class="label">Portfolio value</div>
          <div class="value">—</div>
          <div class="value-sub">No investments yet</div>
        </div>`;
      return;
    }

    let totalContributed = 0;
    let totalValue = 0;
    let hasAnyValue = false;
    let best = null; // { name, pct }

    investments.forEach(a => {
      const contributed = A.runningBalance(state, a);
      totalContributed += contributed;

      const entry = A.portfolioValueUpto(state, a.prefix, month) || A.portfolioValueUpto(state, a.prefix);
      const value = entry ? entry.value : contributed;
      totalValue += value;

      if (entry) {
        hasAnyValue = true;
        const gainPct = contributed > 0 ? ((value - contributed) / contributed) * 100 : null;
        if (gainPct !== null && (!best || gainPct > best.pct)) {
          best = { name: a.name, pct: gainPct };
        }
      }
    });

    const gain = totalValue - totalContributed;
    const gainPct = totalContributed > 0 ? (gain / totalContributed) * 100 : null;

    el.innerHTML = `
      <div class="stat-card">
        <div class="label">Net contributed</div>
        <div class="value">${Utils.fmtMoney(totalContributed)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Portfolio value</div>
        <div class="value">${Utils.fmtMoney(totalValue)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Gain / loss</div>
        <div class="value ${gain >= 0 ? 'positive' : 'negative'}">${hasAnyValue ? `${gain >= 0 ? '+' : ''}${Utils.fmtMoney(gain)}` : '—'}</div>
        <div class="value-sub">${hasAnyValue && gainPct !== null ? `${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%` : 'Log a value to track'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Best performer</div>
        <div class="value ${best ? (best.pct >= 0 ? 'positive' : 'negative') : ''}">${best ? `${best.pct >= 0 ? '+' : ''}${best.pct.toFixed(1)}%` : '—'}</div>
        <div class="value-sub">${best ? best.name : 'No values logged yet'}</div>
      </div>`;
  }

  // ---------- Investment cards ----------

  function renderCards(state, accounts, month) {
    const cardsEl = document.getElementById('accountCardsInvestments');
    const totalsEl = document.getElementById('accountsTotalsInvestments');
    if (!cardsEl) return;

    if (!accounts.length) {
      cardsEl.innerHTML = `<div class="muted">No investments yet — click "+ Add investment" to set one up.</div>`;
      if (totalsEl) totalsEl.innerHTML = '';
      return;
    }

    const sorted = accounts.slice().sort((a, b) => A.runningBalance(state, b) - A.runningBalance(state, a));
    cardsEl.innerHTML = sorted.map(a => investmentCardHtml(state, a, month)).join('');
    A.bindCardListeners(cardsEl);
    A.bindPortfolioButtons(cardsEl);

    const totalContributed = accounts.reduce((s, a) => s + A.runningBalance(state, a), 0);
    let totalValue = 0;
    accounts.forEach(a => {
      const entry = A.portfolioValueUpto(state, a.prefix, month) || A.portfolioValueUpto(state, a.prefix);
      totalValue += entry ? entry.value : A.runningBalance(state, a);
    });

    if (totalsEl) {
      totalsEl.innerHTML = `
        <span>Contributed: <b>${Utils.fmtMoney(totalContributed)}</b></span>
        <span>Value: <b>${Utils.fmtMoney(totalValue)}</b></span>`;
    }
  }

  function investmentCardHtml(state, a, month) {
    const contributed = A.runningBalance(state, a);
    const entry = A.portfolioValueUpto(state, a.prefix, month);
    const latestEntry = entry || A.portfolioValueUpto(state, a.prefix);
    const value = latestEntry ? latestEntry.value : null;

    const hasValue = value !== null;
    const gain = hasValue ? value - contributed : 0;
    const gainPct = hasValue && contributed > 0 ? (gain / contributed) * 100 : null;
    const badgeCls = !hasValue ? 'flat' : (gain > 0 ? 'gain' : (gain < 0 ? 'loss' : 'flat'));
    const badgeLabel = !hasValue ? 'No value logged' : (gain > 0 ? 'Gain' : (gain < 0 ? 'Loss' : 'Flat'));

    let monthSuffix = '';
    if (entry) {
      const k = A.parseMonthKey(entry.month);
      monthSuffix = ` (${Utils.monthLabel(k.year, k.month).slice(0, 3)})`;
    } else if (latestEntry) {
      const k = A.parseMonthKey(latestEntry.month);
      monthSuffix = ` (latest: ${Utils.monthLabel(k.year, k.month).slice(0, 3)})`;
    }

    return `
      <div class="budget-card" data-id="${a.id}">
        <div class="budget-card-top">
          <div class="budget-card-title-wrap" data-action="edit-account" data-id="${a.id}" style="cursor:pointer;">
            <div class="budget-card-title">${a.name}</div>
            <div class="budget-card-sub muted">${a.prefix}</div>
          </div>
          <div class="budget-card-top-right">
            <span class="badge ${badgeCls}">${badgeLabel}</span>
            <button class="card-delete-btn" data-action="delete-account" data-id="${a.id}" title="Delete this investment">✕</button>
          </div>
        </div>
        <div class="budget-card-amounts">
          <div class="amount-block">
            <span class="label">Initial balance</span>
            <div class="editable-amount" data-id="${a.id}">
              <span class="currency-prefix">RM</span>
              <input type="number" class="budget-input" value="${a.initialBalance}" step="0.01" min="0" inputmode="decimal" />
            </div>
          </div>
          <div class="amount-block">
            <span class="label">Net contributed</span>
            <span class="value">${Utils.fmtMoney(contributed)}</span>
          </div>
          <div class="amount-block">
            <span class="label">Portfolio value${monthSuffix}</span>
            <span class="value">${hasValue ? Utils.fmtMoney(value) : '—'}</span>
          </div>
        </div>
        <div class="budget-card-footer investment-footer">
          <span class="value ${gain >= 0 ? 'positive' : 'negative'}">${hasValue ? `${gain >= 0 ? '+' : ''}${Utils.fmtMoney(gain)}${gainPct !== null ? ` (${gainPct.toFixed(1)}%)` : ''}` : 'Log a value to track gain/loss'}</span>
          <button class="modal-btn log-value-btn" data-action="log-portfolio" data-prefix="${a.prefix}">Log value</button>
        </div>
      </div>`;
  }

  // ---------- Portfolio value line chart ----------

  function renderPortfolioChart(state, investments) {
    const note = document.getElementById('portfolioChartNote');

    // Key every month off the *parsed* year/month rather than the raw
    // stored string — entries can come from different save paths (e.g. the
    // synthesized "current month" fallback vs. months sourced from
    // Transactions) and don't always agree on zero-padding/whitespace, so
    // comparing raw strings silently drops matches. Normalizing here also
    // lets us filter out any entry with a malformed/missing month instead
    // of letting it corrupt the sort or render as an "undefined" label.
    const allMonths = new Map(); // normalized key -> {year, month}
    investments.forEach(a => A.portfolioEntriesFor(state, a.prefix).forEach(e => {
      const k = A.parseMonthKey(e.month);
      if (!k || !Number.isFinite(k.year) || !Number.isFinite(k.month)) return;
      allMonths.set(`${k.year}-${k.month}`, k);
    }));

    if (!allMonths.size) {
      Charts.line('portfolioLineChart', [], []);
      if (note) note.textContent = 'No portfolio values logged yet';
      return;
    }

    const months = [...allMonths.values()].sort((a, b) => (a.year - b.year) || (a.month - b.month));
    const labels = months.map(k => Utils.monthLabel(k.year, k.month).slice(0, 3) + ' ' + String(k.year).slice(2));

    const datasets = investments.map((a, i) => {
      const entries = A.portfolioEntriesFor(state, a.prefix);
      const byMonth = new Map();
      entries.forEach(e => {
        const k = A.parseMonthKey(e.month);
        if (!k || !Number.isFinite(k.year) || !Number.isFinite(k.month)) return;
        byMonth.set(`${k.year}-${k.month}`, e.value);
      });
      let lastKnown = null;
      const data = months.map(k => {
        const key = `${k.year}-${k.month}`;
        if (byMonth.has(key)) { lastKnown = byMonth.get(key); }
        return lastKnown; // forward-fill so gaps between manual entries don't break the line
      });
      return { label: a.name, data, color: Utils.colorFor(i) };
    });

    Charts.line('portfolioLineChart', labels, datasets);
    if (note) note.textContent = `${months.length} month${months.length !== 1 ? 's' : ''} logged`;
  }

  // ---------- Allocation chart (how the portfolio is currently split) ----------

  function renderAllocationChart(state, investments, month) {
    const badge = document.getElementById('investmentsAllocationBadge');

    if (!investments.length) {
      Charts.pie('investmentsAllocationChart', [], []);
      if (badge) badge.textContent = '';
      return;
    }

    const rows = investments.map(a => {
      const entry = A.portfolioValueUpto(state, a.prefix, month) || A.portfolioValueUpto(state, a.prefix);
      const value = entry ? entry.value : A.runningBalance(state, a);
      return { name: a.name, value: Math.max(0, value) };
    }).sort((x, y) => y.value - x.value);

    const total = rows.reduce((s, r) => s + r.value, 0);

    Charts.pie('investmentsAllocationChart', rows.map(r => r.name), rows.map(r => r.value));
    if (badge) badge.textContent = `Total: ${Utils.fmtMoney(total)}`;
  }

  return { render };
})();