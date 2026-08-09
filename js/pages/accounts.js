const AccountsPage = (() => {

  let currentState = null;
  let currentCashAccounts = [];
  let currentCreditCards = [];
  let currentInvestments = [];
  let editingAccountId = null;   // account id currently open in the account modal, or null when adding
  let addingAccountType = null;  // 'Account' | 'Investment' — which section's "+ Add" was clicked
  let portfolioPrefix = null;    // investment prefix currently open in the portfolio-value modal
  const ACCOUNT_TYPE_META = {
    Cash:            { label: 'cash',         icon: '💵' },
    eWallet:         { label: 'eWallet',      icon: '🪙' },
    'Debit Card':    { label: 'debit card',   icon: '🏧' },
    'Credit Card':   { label: 'credit card',  icon: '💳' },
    'Physical Card': { label: 'card',         icon: '🎟️' },
    Investment:      { label: 'investment',   icon: '📈' },
    Account:         { label: 'account',      icon: '🏛️' }, // fallback
  };

  function accountTypeMeta(type) {
    return ACCOUNT_TYPE_META[type] || ACCOUNT_TYPE_META.Account;
  }

  const els = {};

  function cacheEls() {
    els.accountOverlay = document.getElementById('accountModalOverlay');
    els.accountTitle = document.getElementById('accountModalTitle');
    els.accountFormType = document.getElementById('accountFormType');
    els.accountFormName = document.getElementById('accountFormName');
    els.accountFormPrefix = document.getElementById('accountFormPrefix');
    els.accountFormInitialBalance = document.getElementById('accountFormInitialBalance');
    els.accountError = document.getElementById('accountModalError');
    els.accountDeleteBtn = document.getElementById('accountModalDelete');
    els.accountCancelBtn = document.getElementById('accountModalCancel');
    els.accountSaveBtn = document.getElementById('accountModalSave');

    els.portfolioOverlay = document.getElementById('portfolioModalOverlay');
    els.portfolioTitle = document.getElementById('portfolioModalTitle');
    els.portfolioFormMonth = document.getElementById('portfolioFormMonth');
    els.portfolioFormValue = document.getElementById('portfolioFormValue');
    els.portfolioError = document.getElementById('portfolioModalError');
    els.portfolioCancelBtn = document.getElementById('portfolioModalCancel');
    els.portfolioSaveBtn = document.getElementById('portfolioModalSave');
  }

  // This binds the account modal, portfolio modal, and every "+ Add
  // account" / "+ Add investment" button in the document — including the
  // one on the Investments page — since AccountsPage.render() always runs
  // at least once on initial load (Accounts is the default page) and
  // querySelectorAll('[data-account-type]') finds every matching button
  // in the DOM regardless of which page section currently contains it.
  // Investments page cards call back into this module's exposed
  // openAccountModal / openPortfolioModal rather than re-binding these
  // shared modal elements themselves, so there's only ever one set of
  // Save/Cancel/Delete listeners on the shared modal.
  function bindStaticListenersOnce() {
    if (els.accountOverlay.dataset.bound) return;
    els.accountOverlay.dataset.bound = 'true';

    document.querySelectorAll('[data-account-type]').forEach(btn => {
      btn.addEventListener('click', () => openAccountModal(btn.dataset.accountType, null));
    });

    els.accountFormType.addEventListener('change', updateInitialBalanceConstraint);
    els.accountCancelBtn.addEventListener('click', closeAccountModal);
    els.accountOverlay.addEventListener('click', (e) => { if (e.target === els.accountOverlay) closeAccountModal(); });
    els.accountSaveBtn.addEventListener('click', handleSaveAccount);
    els.accountDeleteBtn.addEventListener('click', handleDeleteAccount);

    els.portfolioOverlay.dataset.bound = 'true';
    els.portfolioCancelBtn.addEventListener('click', closePortfolioModal);
    els.portfolioOverlay.addEventListener('click', (e) => { if (e.target === els.portfolioOverlay) closePortfolioModal(); });
    els.portfolioSaveBtn.addEventListener('click', handleSavePortfolio);
  }

  // Re-renders whichever pages depend on account/portfolio data. Both are
  // refreshed on every mutation (not just the currently-visible one) so
  // that switching tabs never shows stale cards — Chart.js (v4, via
  // ResizeObserver) correctly re-measures canvases that were updated while
  // their page was hidden, so this is safe even for the charts.
  function refreshDependentPages() {
    render(currentState);
    if (typeof InvestmentsPage !== 'undefined') InvestmentsPage.render(currentState);
  }

  // ---------- Balance visibility (mask cash balance / net worth by default) ----------

  const BALANCE_VISIBILITY_KEY = 'showBalances';
  const MASK = '••••••';

  // Inner <path>/<circle> markup for the two icon states — swapped directly
  // into the single <svg id="balanceVisibilityIcon"> so there's only ever
  // one element to keep in sync (no separate show/hide elements to drift
  // out of sync with each other).
  const EYE_ICON = '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>';
  const EYE_OFF_ICON = '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.3 20.3 0 0 1 4.22-5.06M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a20.3 20.3 0 0 1-2.34 3.27M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>';

  function balancesVisible() {
    return localStorage.getItem(BALANCE_VISIBILITY_KEY) === 'true';
  }

  function displayMoney(amount) {
    return balancesVisible() ? Utils.fmtMoney(amount) : MASK;
  }

  function bindVisibilityToggleOnce() {
    const btn = document.getElementById('balanceVisibilityToggle');
    if (!btn) return;
    updateVisibilityToggleUI();
    if (btn.dataset.bound) return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => {
      localStorage.setItem(BALANCE_VISIBILITY_KEY, balancesVisible() ? 'false' : 'true');
      updateVisibilityToggleUI();
      renderOverview(currentState, currentCashAccounts, currentCreditCards, currentInvestments, effectiveMonth(currentState));
    });
  }

  function updateVisibilityToggleUI() {
    const btn = document.getElementById('balanceVisibilityToggle');
    const icon = document.getElementById('balanceVisibilityIcon');
    if (!btn || !icon) return;
    const visible = balancesVisible();
    icon.innerHTML = visible ? EYE_OFF_ICON : EYE_ICON;
    const label = btn.querySelector('.visibility-toggle-label');
    if (label) label.textContent = visible ? 'Hide balances' : 'Show balances';
    btn.title = visible ? 'Hide balances' : 'Show balances';
    btn.setAttribute('aria-pressed', String(visible));
  }

  // ---------- Balance helpers ----------

  function keyOf(v) {
    return String(v || '').trim().toUpperCase();
  }

  // Defensive readers, same idiom as budget.js's transferToAccount() — the
  // Apps Script backend normalizes "From Account" / "To Account" headers
  // to FromAccount / ToAccount, but this still finds the value even if a
  // sheet header ever comes through spelled slightly differently.
  function transferFromAccount(t) {
    const raw = t.FromAccount ?? t['From Account'] ?? t.fromAccount ?? t.From_Account ?? t.from_account ?? '';
    return keyOf(raw);
  }

  function transferToAccount(t) {
    const raw = t.ToAccount ?? t['To Account'] ?? t.toAccount ?? t.To_Account ?? t.to_account ?? '';
    return keyOf(raw);
  }

  // Net movement into an account/investment from Transactions (Income
  // adds, Expense subtracts) plus Transfers (money leaving via "From"
  // subtracts, money arriving via "To" adds). Works the same way for both
  // cash accounts and investments — an investment can pick up
  // fees/dividends as ordinary transactions too, on top of transfers.
  function netForPrefix(state, prefix) {
    const p = keyOf(prefix);
    if (!p) return 0;
    let net = 0;

    state.transactions.forEach(t => {
      if (keyOf(t.Account) !== p) return;
      const amt = Number(t.Amount) || 0;
      net += t.TransactionType === 'Income' ? amt : -amt;
    });

    state.transfers.forEach(t => {
      const amt = Number(t.Amount) || 0;
      if (transferFromAccount(t) === p) net -= amt;
      if (transferToAccount(t) === p) net += amt;
    });

    return net;
  }

  function runningBalance(state, account) {
    return (Number(account.initialBalance) || 0) + netForPrefix(state, account.prefix);
  }

  // ---------- Month helpers ----------

  function parseMonthKey(key) {
    const [year, month] = String(key).split('-').map(Number);
    return { year, month };
  }

  function effectiveMonth(state) {
    if (state.month && state.month !== 'all') return state.month;
    return state.monthOptions[0] ? state.monthOptions[0].value : null;
  }

  // The dropdown in the portfolio modal reuses the app's month options
  // (derived from Transactions), plus the current calendar month in case
  // there's no transaction data for it yet.
  function buildPortfolioMonthOptions(state) {
    const map = new Map();
    (state.monthOptions || []).forEach(o => map.set(o.value, o));

    const now = new Date();
    const curKey = `${now.getFullYear()}-${now.getMonth()}`;
    if (!map.has(curKey)) {
      map.set(curKey, { value: curKey, label: Utils.monthLabel(now.getFullYear(), now.getMonth()), year: now.getFullYear(), month: now.getMonth() });
    }

    return [...map.values()].sort((a, b) => (b.year - a.year) || (b.month - a.month));
  }

  function portfolioEntriesFor(state, prefix) {
    const p = keyOf(prefix);
    return (state.portfolio || [])
      .filter(e => keyOf(e.prefix) === p)
      .slice()
      .sort((a, b) => {
        const ak = parseMonthKey(a.month), bk = parseMonthKey(b.month);
        return (ak.year - bk.year) || (ak.month - bk.month);
      });
  }

  // Most recent logged value at or before `uptoMonth` (or the latest
  // logged value overall, if uptoMonth is omitted).
  function portfolioValueUpto(state, prefix, uptoMonth) {
    const entries = portfolioEntriesFor(state, prefix);
    if (!entries.length) return null;
    if (!uptoMonth) return entries[entries.length - 1];

    const target = parseMonthKey(uptoMonth);
    let best = null;
    entries.forEach(e => {
      const k = parseMonthKey(e.month);
      if (k.year < target.year || (k.year === target.year && k.month <= target.month)) best = e;
    });
    return best;
  }

  // ---------- Main render ----------

  function render(state) {
    currentState = state;
    cacheEls();
    bindStaticListenersOnce();

    const accounts = state.accounts || [];
    const cashAccounts = accounts.filter(a => a.type !== 'Investment' && a.type !== 'Credit Card');
    const creditCards = accounts.filter(a => a.type === 'Credit Card');
    const investments = accounts.filter(a => a.type === 'Investment');
    currentCashAccounts = cashAccounts;
    currentCreditCards = creditCards;
    currentInvestments = investments;
    const month = effectiveMonth(state);

    bindVisibilityToggleOnce();
    renderOverview(state, cashAccounts, creditCards, investments, month);
    renderCashCards(state, cashAccounts);
    renderCreditCards(state, creditCards);
    renderBalanceChart(state, cashAccounts);
  }

  // ---------- Overview stats ----------

  function renderOverview(state, cashAccounts, creditCards, investments, month) {
    const el = document.getElementById('accountsOverviewStats');
    if (!el) return;

    const totalCash = cashAccounts.reduce((s, a) => s + runningBalance(state, a), 0);

    // A credit card's running balance goes negative as purchases accrue and
    // back toward zero as repayment transfers land (see transferToAccount()
    // in netForPrefix) — so "amount owed" is just the negative part of that,
    // flipped positive for display. Nothing here mutates the original
    // purchase transactions; the debt total is purely computed each render.
    const totalOwed = creditCards.reduce((s, a) => s + Math.max(0, -runningBalance(state, a)), 0);

    let totalPortfolioValue = 0;
    investments.forEach(a => {
      const entry = portfolioValueUpto(state, a.prefix, month) || portfolioValueUpto(state, a.prefix);
      totalPortfolioValue += entry ? entry.value : runningBalance(state, a);
    });

    const netWorth = totalCash + totalPortfolioValue - totalOwed;
    const visible = balancesVisible();

    el.innerHTML = `
      <div class="stat-card">
        <div class="label">Cash &amp; bank balance</div>
        <div class="value ${visible ? '' : 'masked'}">${displayMoney(totalCash)}</div>
      </div>
      ${creditCards.length ? `
      <div class="stat-card">
        <div class="label">Credit card debt</div>
        <div class="value ${visible ? 'negative' : 'masked'}">${displayMoney(totalOwed)}</div>
      </div>` : ''}
      <div class="stat-card">
        <div class="label">Net worth</div>
        <div class="value ${visible ? 'positive' : 'masked'}">${displayMoney(netWorth)}</div>
        <div class="value-sub">Cash + investments − credit card debt</div>
      </div>
      <div class="stat-card">
        <div class="label">Accounts</div>
        <div class="value">${cashAccounts.length}</div>
      </div>`;
  }

  // ---------- Balance by account chart ----------

  function renderBalanceChart(state, accounts) {
    const note = document.getElementById('accountsBalanceChartNote');
    if (!accounts.length) {
      Charts.bar('accountsBalanceChart', [], []);
      if (note) note.textContent = '';
      return;
    }

    const sorted = accounts
      .map(a => ({ a, balance: runningBalance(state, a) }))
      .sort((x, y) => y.balance - x.balance);

    const labels = sorted.map(x => x.a.name);
    const values = sorted.map(x => x.balance);
    const colors = sorted.map((_, i) => Utils.colorFor(i));

    Charts.bar('accountsBalanceChart', labels, values, colors, true);
    if (note) note.textContent = '';
  }

  // ---------- Cash & bank account cards ----------

  function renderCashCards(state, accounts) {
    const cardsEl = document.getElementById('accountCardsCash');
    const totalsEl = document.getElementById('accountsTotalsCash');
    if (!cardsEl) return;

    if (!accounts.length) {
      cardsEl.innerHTML = `<div class="muted">No accounts yet — click "+ Add account" to set one up.</div>`;
      if (totalsEl) totalsEl.innerHTML = '';
      return;
    }

    const sorted = accounts.slice().sort((a, b) => runningBalance(state, b) - runningBalance(state, a));
    cardsEl.innerHTML = sorted.map(a => accountCardHtml(state, a)).join('');
    bindCardListeners(cardsEl);

    const totalInitial = accounts.reduce((s, a) => s + (Number(a.initialBalance) || 0), 0);
    const totalBalance = accounts.reduce((s, a) => s + runningBalance(state, a), 0);
    if (totalsEl) {
      totalsEl.innerHTML = `
        <span>Initial: <b>${Utils.fmtMoney(totalInitial)}</b></span>
        <span>Current: <b>${Utils.fmtMoney(totalBalance)}</b></span>`;
    }
  }

  function accountCardHtml(state, a) {
    const balance = runningBalance(state, a);
    const delta = balance - (Number(a.initialBalance) || 0);
    const meta = accountTypeMeta(a.type); // CHANGED: new

    return `
      <div class="budget-card" data-id="${a.id}">
        <div class="budget-card-top">
          <div class="budget-card-title-wrap" data-action="edit-account" data-id="${a.id}" style="cursor:pointer;">
            <div class="budget-card-title">${meta.icon} ${a.name}</div>            <!-- CHANGED: was plain a.name -->
            <div class="budget-card-sub muted">${a.prefix} · ${meta.label}</div>   <!-- CHANGED: added meta.label -->
          </div>
          <div class="budget-card-top-right">
            <button class="card-delete-btn" data-action="delete-account" data-id="${a.id}" title="Delete this account">✕</button>
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
            <span class="label">Current balance</span>
            <span class="value">${Utils.fmtMoney(balance)}</span>
          </div>
          <div class="amount-block">
            <span class="label">Change</span>
            <span class="value ${delta >= 0 ? 'positive' : 'negative'}">${delta >= 0 ? '+' : ''}${Utils.fmtMoney(delta)}</span>
          </div>
        </div>
      </div>`;
  }

  // ---------- Credit card cards ----------
  //
  // A repayment is just a Transfer with To Account = this card's prefix
  // (see budget/expense entry app) — it's netted by runningBalance() the
  // same way a normal transfer is, via transferToAccount(). Purchases are
  // ordinary Expense transactions against the card's prefix, so they're
  // never deleted or modified; "amount owed" is a computed view over both,
  // which is why it naturally drops to zero once repayments catch up.

  function renderCreditCards(state, creditCards) {
    const cardsEl = document.getElementById('accountCardsCredit');
    const totalsEl = document.getElementById('accountsTotalsCredit');
    if (!cardsEl) return;

    if (!creditCards.length) {
      cardsEl.innerHTML = `<div class="muted">No credit cards yet — click "+ Add credit card" to set one up.</div>`;
      if (totalsEl) totalsEl.innerHTML = '';
      return;
    }

    const sorted = creditCards.slice().sort((a, b) =>
      Math.max(0, -runningBalance(state, b)) - Math.max(0, -runningBalance(state, a))
    );
    cardsEl.innerHTML = sorted.map(a => creditCardHtml(state, a)).join('');
    bindCardListeners(cardsEl);

    const totalOwed = creditCards.reduce((s, a) => s + Math.max(0, -runningBalance(state, a)), 0);
    if (totalsEl) totalsEl.innerHTML = `<span>Total owed: <b>${Utils.fmtMoney(totalOwed)}</b></span>`;
  }

  function creditCardHtml(state, a) {
    const balance = runningBalance(state, a);
    const owed = Math.max(0, -balance);
    const meta = accountTypeMeta(a.type);

    return `
      <div class="budget-card" data-id="${a.id}">
        <div class="budget-card-top">
          <div class="budget-card-title-wrap" data-action="edit-account" data-id="${a.id}" style="cursor:pointer;">
            <div class="budget-card-title">${meta.icon} ${a.name}</div>
            <div class="budget-card-sub muted">${a.prefix}</div>
          </div>
          <div class="budget-card-top-right">
            <button class="card-delete-btn" data-action="delete-account" data-id="${a.id}" title="Delete this card">✕</button>
          </div>
        </div>
        <div class="budget-card-amounts">
          <div class="amount-block">
            <span class="label">Amount owed</span>
            <span class="value ${owed > 0 ? 'negative' : 'positive'}">${Utils.fmtMoney(owed)}</span>
          </div>
        </div>
      </div>`;
  }

  // ---------- Shared card listeners (used by both Accounts and Investments cards) ----------

  function bindCardListeners(cardsEl) {
    cardsEl.querySelectorAll('[data-action="edit-account"]').forEach(el => {
      el.addEventListener('click', () => {
        const item = currentState.accounts.find(a => String(a.id) === el.dataset.id);
        if (item) openAccountModal(item.type, item);
      });
    });

    cardsEl.querySelectorAll('[data-action="delete-account"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = currentState.accounts.find(a => String(a.id) === btn.dataset.id);
        if (item) confirmAndDeleteAccount(item);
      });
    });

    cardsEl.querySelectorAll('.editable-amount').forEach(wrap => {
      const input = wrap.querySelector('.budget-input');
      const original = input.value;

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.value = original; input.blur(); }
      });

      input.addEventListener('blur', async () => {
        const newValue = Number(input.value);
        if (isNaN(newValue) || newValue < 0) { input.value = original; return; }
        if (newValue === Number(original)) return;

        const item = currentState.accounts.find(a => String(a.id) === wrap.dataset.id);
        if (!item) return;

        wrap.classList.add('saving');
        wrap.classList.remove('saved', 'save-error');

        try {
          await Api.updateAccount({ id: item.id, initialBalance: newValue });
          item.initialBalance = newValue;
          wrap.classList.remove('saving');
          wrap.classList.add('saved');
          setTimeout(() => wrap.classList.remove('saved'), 1000);
          refreshDependentPages();
        } catch (err) {
          wrap.classList.remove('saving');
          wrap.classList.add('save-error');
          input.value = original;
          alert(`Couldn't save this change: ${err.message}`);
        }
      });
    });
  }

  function bindPortfolioButtons(cardsEl) {
    cardsEl.querySelectorAll('[data-action="log-portfolio"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPortfolioModal(btn.dataset.prefix);
      });
    });
  }

  // ---------- Account modal (add / edit / delete) ----------

  function openAccountModal(type, item) {
    editingAccountId = item ? item.id : null;
    addingAccountType = item ? item.type : type;

    const resolvedType = item ? item.type : type;
    // CHANGED: was `type === 'Investment' ? 'investment' : (type === 'Credit Card' ? 'credit card' : 'account')`
    const typeLabel = accountTypeMeta(resolvedType).label;

    els.accountTitle.textContent = item ? `Edit ${typeLabel}` : `Add ${typeLabel}`;
    els.accountFormType.value = resolvedType || 'Account';
    els.accountFormName.value = item ? item.name : '';
    els.accountFormPrefix.value = item ? item.prefix : '';
    els.accountFormInitialBalance.value = item ? item.initialBalance : '';
    els.accountDeleteBtn.hidden = !item;
    els.accountError.hidden = true;
    els.accountError.textContent = '';

    updateInitialBalanceConstraint();
    els.accountOverlay.hidden = false;
  }

  // Credit cards are the one account type allowed to start with a negative
  // initial balance — that's how existing debt (money already owed before
  // you started tracking it) is represented, since runningBalance() treats
  // purchases as subtracting and repayments as adding back. Every other
  // account type keeps the "can't start negative" rule.
  function updateInitialBalanceConstraint() {
    const isCreditCard = els.accountFormType.value === 'Credit Card';
    els.accountFormInitialBalance.min = isCreditCard ? '' : '0';
    const note = document.querySelector('.account-modal-note');
    if (note) {
      note.textContent = isCreditCard
        ? 'Prefix must match the exact "Account" value used in Transactions, or "From/To Account" in Transfers. If you already owe money on this card, enter that amount as negative (e.g. -500).'
        : 'Prefix must match the exact "Account" value used in Transactions, or "From/To Account" in Transfers, so balances update automatically.';
    }
  }

  function closeAccountModal() {
    els.accountOverlay.hidden = true;
    editingAccountId = null;
  }

  async function handleSaveAccount() {
    const type = els.accountFormType.value;
    const name = els.accountFormName.value.trim();
    const prefix = els.accountFormPrefix.value.trim();
    const initialBalance = Number(els.accountFormInitialBalance.value) || 0;

    if (!name || !prefix) {
      showAccountModalError('Name and prefix are both required.');
      return;
    }
    if (initialBalance < 0 && type !== 'Credit Card') {
      showAccountModalError('Initial balance can\'t be negative.');
      return;
    }

    const payload = { type, name, prefix, initialBalance };
    els.accountSaveBtn.disabled = true;

    try {
      if (editingAccountId) {
        payload.id = editingAccountId;
        await Api.updateAccount(payload);
        const item = currentState.accounts.find(a => String(a.id) === String(editingAccountId));
        if (item) Object.assign(item, payload);
      } else {
        const result = await Api.addAccount(payload);
        currentState.accounts.push({ id: result.id, ...payload });
      }
      els.accountSaveBtn.disabled = false;
      closeAccountModal();
      refreshDependentPages();
    } catch (err) {
      els.accountSaveBtn.disabled = false;
      showAccountModalError(`Couldn't save: ${err.message}`);
    }
  }

  function showAccountModalError(message) {
    els.accountError.hidden = false;
    els.accountError.textContent = message;
  }

  function confirmAndDeleteAccount(item) {
    if (!confirm(`Remove ${item.name}? This won't delete any past transactions or transfers.`)) return;
    deleteAccount(item);
  }

  async function handleDeleteAccount() {
    if (!editingAccountId) return;
    const item = currentState.accounts.find(a => String(a.id) === String(editingAccountId));
    if (!item) return;
    if (!confirm(`Remove ${item.name}? This won't delete any past transactions or transfers.`)) return;
    await deleteAccount(item);
    closeAccountModal();
  }

  async function deleteAccount(item) {
    try {
      await Api.deleteAccount(item.id);
      currentState.accounts = currentState.accounts.filter(a => String(a.id) !== String(item.id));
      refreshDependentPages();
    } catch (err) {
      alert(`Couldn't delete this account: ${err.message}`);
    }
  }

  // ---------- Portfolio value modal ----------

  function openPortfolioModal(prefix) {
    portfolioPrefix = prefix;
    const account = currentState.accounts.find(a => keyOf(a.prefix) === keyOf(prefix));
    els.portfolioTitle.textContent = account ? `Log portfolio value — ${account.name}` : 'Log portfolio value';

    const options = buildPortfolioMonthOptions(currentState);
    const defaultMonth = effectiveMonth(currentState) || options[0].value;
    els.portfolioFormMonth.innerHTML = options.map(o => `<option value="${o.value}" ${o.value === defaultMonth ? 'selected' : ''}>${o.label}</option>`).join('');

    const existing = portfolioValueUpto(currentState, prefix, defaultMonth);
    const exactEntry = portfolioEntriesFor(currentState, prefix).find(e => e.month === defaultMonth);
    els.portfolioFormValue.value = exactEntry ? exactEntry.value : (existing ? existing.value : '');

    els.portfolioFormMonth.onchange = () => {
      const m = els.portfolioFormMonth.value;
      const exact = portfolioEntriesFor(currentState, prefix).find(e => e.month === m);
      els.portfolioFormValue.value = exact ? exact.value : '';
    };

    els.portfolioError.hidden = true;
    els.portfolioError.textContent = '';
    els.portfolioOverlay.hidden = false;
  }

  function closePortfolioModal() {
    els.portfolioOverlay.hidden = true;
    portfolioPrefix = null;
  }

  async function handleSavePortfolio() {
    const month = els.portfolioFormMonth.value;
    const value = Number(els.portfolioFormValue.value);

    if (!month) { showPortfolioModalError('Pick a month.'); return; }
    if (isNaN(value) || value < 0) { showPortfolioModalError('Enter a valid value (0 or more).'); return; }

    els.portfolioSaveBtn.disabled = true;
    try {
      const result = await Api.savePortfolioEntry({ prefix: portfolioPrefix, month, value });
      const existingIdx = currentState.portfolio.findIndex(e => keyOf(e.prefix) === keyOf(portfolioPrefix) && e.month === month);
      if (existingIdx >= 0) {
        currentState.portfolio[existingIdx].value = value;
      } else {
        currentState.portfolio.push({ id: result.id, prefix: portfolioPrefix, month, value });
      }
      els.portfolioSaveBtn.disabled = false;
      closePortfolioModal();
      refreshDependentPages();
    } catch (err) {
      els.portfolioSaveBtn.disabled = false;
      showPortfolioModalError(`Couldn't save: ${err.message}`);
    }
  }

  function showPortfolioModalError(message) {
    els.portfolioError.hidden = false;
    els.portfolioError.textContent = message;
  }

  return {
    render,
    // Shared helpers/actions reused by InvestmentsPage
    runningBalance, netForPrefix, portfolioValueUpto, portfolioEntriesFor,
    parseMonthKey, effectiveMonth, buildPortfolioMonthOptions, keyOf,
    openAccountModal, openPortfolioModal, bindCardListeners, bindPortfolioButtons,
    confirmAndDeleteAccount
  };
})();