(function () {

  const state = {
    transactions: [],
    transfers: [],
    budget: [],
    accounts: [],
    portfolio: [],
    recurring: [],
    monthOptions: [],
    month: 'all',
    page: 'accounts'
  };

  const PAGE_META = {
    accounts: { title: 'Accounts', subtitle: 'Balances across your cash and bank accounts', render: AccountsPage.render },
    investments: { title: 'Investments', subtitle: 'Portfolio value, allocation, and performance', render: InvestmentsPage.render },
    expenses: { title: 'Expense Breakdown', subtitle: 'Where your money went, by category', render: ExpensesPage.render },
    income: { title: 'Income Breakdown', subtitle: 'Where your money came from', render: IncomePage.render },
    yearly: { title: 'Yearly Overview', subtitle: 'Income vs. expenses across the year', render: YearlyPage.render },
    budget: { title: 'Budgeting', subtitle: 'Actual spend against your monthly targets', render: BudgetPage.render }
  };

  const els = {
    navLinks: document.querySelectorAll('.nav-link'),
    pages: document.querySelectorAll('.page'),
    pageTitle: document.getElementById('pageTitle'),
    pageSubtitle: document.getElementById('pageSubtitle'),
    monthSelect: document.getElementById('monthSelect'),
    refreshBtn: document.getElementById('refreshBtn'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    errorBanner: document.getElementById('errorBanner')
  };

  function setStatus(kind, text) {
    els.statusDot.className = 'dot ' + kind;
    els.statusText.textContent = text;
    if (mobileStatusDot) mobileStatusDot.className = 'mobile-status-dot ' + kind;
  }

  function showError(message) {
    els.errorBanner.hidden = false;
    els.errorBanner.textContent = message;
  }

  function clearError() {
    els.errorBanner.hidden = true;
  }

  function populateMonthSelect() {
    els.monthSelect.innerHTML = '<option value="all">All months</option>' +
      state.monthOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    els.monthSelect.value = state.month;
  }

  const menuToggle = document.getElementById('menuToggle');
  const navDrawer = document.getElementById('navDrawer');
  const navOverlay = document.getElementById('navOverlay');
  const mobileStatusDot = document.getElementById('mobileStatusDot');

  function closeMenu() {
    navDrawer.classList.remove('open');
    navOverlay.hidden = true;
  }

  menuToggle.addEventListener('click', () => {
    navDrawer.classList.toggle('open');
    navOverlay.hidden = !navDrawer.classList.contains('open');
  });
  navOverlay.addEventListener('click', closeMenu);

  document.querySelectorAll('.nav-link').forEach(function(link) {
    link.addEventListener('click', closeMenu);
  });

  function renderCurrentPage() {
    const meta = PAGE_META[state.page];
    els.pageTitle.textContent = meta.title;
    els.pageSubtitle.textContent = meta.subtitle;
    meta.render(state);
  }

  function switchPage(page) {
    state.page = page;
    els.navLinks.forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
    els.pages.forEach(sec => sec.classList.toggle('active', sec.id === `page-${page}`));
    try {
      renderCurrentPage();
      clearError();
    } catch (err) {
      console.error(err);
      showError(`This page failed to render: ${err.message}. Check the browser console for details.`);
    }
  }

  async function loadData(forceRefresh) {
    const startedAt = performance.now();
    console.log(`[loadData] start (forceRefresh=${forceRefresh}) @ ${new Date().toLocaleTimeString()}`);

    els.refreshBtn.disabled = true;
    const originalRefreshLabel = els.refreshBtn.textContent;
    if (forceRefresh) els.refreshBtn.innerHTML = '<span class="spinner"></span>Refreshing…';
    setStatus('', forceRefresh ? 'Refreshing…' : 'Loading…');
    clearError();

    if (mobileRefreshBtn) {
      mobileRefreshBtn.disabled = true;
      mobileRefreshBtn.classList.add('spinning');
    }

    let data, fromCache;
    try {
      ({ data, fromCache } = await Api.getAll(forceRefresh));
      console.log(`[loadData] Api.getAll resolved after ${(performance.now() - startedAt).toFixed(0)}ms, fromCache=${fromCache}`);
    } catch (err) {
      console.error(`[loadData] Api.getAll failed after ${(performance.now() - startedAt).toFixed(0)}ms:`, err);
      setStatus('err', 'Connection failed');
      showError(
        `Couldn't load data from your Apps Script API: ${err.message}. ` +
        `Check that CONFIG.API_URL in js/config.js is your deployed /exec URL, ` +
        `and that the Web App is deployed with access set to "Anyone".`
      );
      els.refreshBtn.disabled = false;
      els.refreshBtn.textContent = originalRefreshLabel;
      return;
    }

    state.transactions = data.transactions || [];
    state.transfers = data.transfers || [];
    state.budget = data.budget || [];
    state.accounts = data.accounts || [];
    state.portfolio = data.portfolio || [];
    state.recurring = data.recurring || [];
    state.monthOptions = Utils.buildMonthOptions(state.transactions);

    if (!els.monthSelect.dataset.populated) {
      populateMonthSelect();
      els.monthSelect.dataset.populated = 'true';
    }

    setStatus('ok', fromCache ? 'Loaded (cached)' : 'Up to date');

    try {
      renderCurrentPage();
    } catch (err) {
      console.error(err);
      showError(
        `Data loaded fine, but rendering this page failed: ${err.message}. ` +
        `Check the browser console for details — this usually means a script ` +
        `file failed to load (e.g. the Chart.js CDN) rather than an API problem.`
      );
    } finally {
      els.refreshBtn.disabled = false;
      els.refreshBtn.textContent = originalRefreshLabel;
      console.log(`[loadData] finished after ${(performance.now() - startedAt).toFixed(0)}ms total`);

      if (mobileRefreshBtn) {
        mobileRefreshBtn.disabled = false;
        mobileRefreshBtn.classList.remove('spinning');
      }
    }
  }

  els.navLinks.forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });

  els.monthSelect.addEventListener('change', (e) => {
    state.month = e.target.value;
    renderCurrentPage();
  });

  els.refreshBtn.addEventListener('click', () => loadData(true));

  const mobileRefreshBtn = document.getElementById('mobileRefreshBtn');
  mobileRefreshBtn.addEventListener('click', () => loadData(true));

  // Don't fetch financial data until the PIN lock (if configured) is passed.
  AppLock.ready.then(() => loadData(false));
})();