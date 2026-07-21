const BudgetPage = (() => {

  // Client-side mirror of code.gs's getAllCategories(), minus Proceeds,
  // used only to power the autocomplete datalists in the add/edit modal,
  // and to control display order of category groups below (unlisted
  // categories that show up in the data still render, just appended at
  // the end, alphabetically).
  const CATEGORY_MAP = {
    'Food': ['Breakfast', 'Lunch', 'Dinner', 'Snacks & Drinks', 'Groceries', 'Social Outings'],
    'Shopping': ['Clothes & Shoes', 'Accessories', 'Health & Beauty', 'Electronics', 'Home & Garden', 'Books & Magazines', 'Gifts', 'Sports Equipment'],
    'Housing': ['Rent', 'Mortgage', 'Utilities', 'Property Tax', 'Home Insurance', 'Maintenance & Repairs', 'Furniture', 'Home Supplies'],
    'Transportation': ['Public Transport', 'Taxi & Ride Share', 'Fuel', 'Parking', 'Tolls', 'Vehicle Maintenance', 'Vehicle Insurance'],
    'Vehicle': ['Car Payment', 'Motorcycle Payment', 'Vehicle Registration', 'Vehicle Inspection', 'Car Wash', 'Vehicle Repairs', 'Vehicle Upgrades'],
    'Life': ['Family Support', 'Education & Courses', 'Memberships & Subscriptions', 'Salon & Grooming', 'Laundry & Cleaning Services', 'Donations & Charity'],
    'Entertainment': ['Movies & Cinema', 'Concerts & Events', 'Hobbies', 'Sports & Fitness', 'Vacation & Travel', 'Subscriptions'],
    'Communication & PC': ['Mobile Data', 'Internet', 'Cable TV', 'Software', 'Apps & Games', 'Computer Repairs', 'Hardware Purchase'],
    'Health & Medical': ['Doctor Visits', 'Dental Care', 'Prescriptions', 'Health Insurance', 'Vision Care', 'Therapy & Counseling', 'Emergency Expenses'],
    'Financial Expenses': ['Bank Fees', 'Interest Charges', 'Credit Card Fees', 'Late Fees', 'Tax Payment', 'Insurance Premium', 'Loan Payment'],
    'Company Spendings': ['Food', 'Travelling', 'Others']
  };

  const SAVINGS_CATEGORY = 'Savings & Investments';

  // Suggestions only (the datalist input still accepts anything you type).
  // Whatever you type just needs to START with the same word your bank
  // transfer's "To Account" uses in the Transfers sheet — see
  // prefixFromSubcategory() below for why that's enough, and why there's
  // no separate "account" field to keep in sync anymore.
  const SAVINGS_SUBCATEGORY_OPTIONS = ['KDI Save', 'Stashaway Gold', 'IBKR CSPX'];

  // Target allocation of monthly income, mirroring the spreadsheet's
  // "Ideal %" column. Tune these to taste — they don't have to sum
  // to something meaningful beyond 100%, but generally should.
  const TARGETS = { Needs: 0.4, Wants: 0.2, Savings: 0.4 };

  let currentState = null;      // reference to the shared app state (mutated optimistically on CRUD)
  let editingId = null;         // budgetId currently open in the modal, or null when adding

  // Tracks user overrides of category collapse/expand state across re-renders,
  // keyed by "type||category". If a key isn't present here, the category falls
  // back to its computed default (see defaultExpanded below).
  const categoryExpandState = new Map();

  const els = {};

  function cacheEls() {
    els.overlay = document.getElementById('budgetModalOverlay');
    els.modal = document.getElementById('budgetModal');
    els.title = document.getElementById('budgetModalTitle');
    els.formType = document.getElementById('budgetFormType');
    els.formCategory = document.getElementById('budgetFormCategory');
    els.categoryOptions = document.getElementById('budgetCategoryOptions');
    els.formSubcategory = document.getElementById('budgetFormSubcategory');
    els.subcategoryOptions = document.getElementById('budgetSubcategoryOptions');
    els.formAmount = document.getElementById('budgetFormAmount');
    els.error = document.getElementById('budgetModalError');
    els.deleteBtn = document.getElementById('budgetModalDelete');
    els.cancelBtn = document.getElementById('budgetModalCancel');
    els.saveBtn = document.getElementById('budgetModalSave');
  }

  function bindStaticListenersOnce() {
    if (els.overlay.dataset.bound) return;
    els.overlay.dataset.bound = 'true';

    document.querySelectorAll('.add-btn').forEach(btn => {
      btn.addEventListener('click', () => openModal(btn.dataset.type, null));
    });

    els.cancelBtn.addEventListener('click', closeModal);
    els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) closeModal(); });
    els.saveBtn.addEventListener('click', handleSave);
    els.deleteBtn.addEventListener('click', handleDelete);
    els.formType.addEventListener('change', updateModalFieldsForType);
    els.formCategory.addEventListener('input', updateSubcategoryOptions);
  }

  // ---------- Derived helpers ----------

  // A Savings/Investment row's Subcategory (e.g. "KDI Save", "Stashaway
  // Gold", "IBKR CSPX") IS the investment's name — and by the same
  // convention used in the spreadsheet's Accounts tab, its first word is
  // exactly the "To Account" value Transfers uses when money lands there
  // (KDI, STASHAWAY, IBKR). So the prefix needed to match actual transfer
  // contributions is derived here instead of stored as a separate column.
  function prefixFromSubcategory(subcategory) {
    return String(subcategory || '').trim().split(/\s+/)[0].toUpperCase();
  }

  // Reads a transfer row's destination account defensively. The Apps
  // Script backend is supposed to hand back a `ToAccount` key, but if the
  // sheet header it was normalized from ever comes through slightly
  // differently ("To Account", "toAccount", etc.) this still finds it
  // instead of silently matching nothing (which is what made every
  // Savings/Investment row show RM 0 contributed).
  function transferToAccount(t) {
    const raw = t.ToAccount ?? t['To Account'] ?? t.toAccount ?? t.To_Account ?? t.to_account ?? '';
    return String(raw).trim().toUpperCase();
  }

  // Returns the next 25%-step milestone still ahead of a savings goal's
  // current contribution, or null once the goal is fully funded.
  function nextMilestone(budgeted, actual) {
    if (!budgeted || budgeted <= 0) return null;
    const pct = actual / budgeted;
    const steps = [0.25, 0.5, 0.75, 1];
    const step = steps.find(s => pct < s - 1e-9);
    if (!step) return null;
    return { amount: budgeted * step, pct: Math.round(step * 100) };
  }

  function statusFor(budgeted, actual) {
    if (budgeted <= 0 && actual > 0) return { cls: 'no-budget', label: 'No budget set' };
    if (budgeted > 0 && actual > budgeted) return { cls: 'over', label: 'Over budget' };
    if (budgeted > 0 && actual >= budgeted * 0.85) return { cls: 'close', label: 'Near limit' };
    return { cls: 'under', label: 'On track' };
  }

  function orderedCategories(rows) {
    const present = new Set(rows.map(r => r.category));
    const ordered = Object.keys(CATEGORY_MAP).filter(c => present.has(c));
    const extras = [...present].filter(c => !ordered.includes(c)).sort();
    return ordered.concat(extras);
  }

  function groupByCategory(rows) {
    const map = new Map();
    rows.forEach(r => {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category).push(r);
    });
    return map;
  }

  // Finds spending this month in a category||subcategory combo that has
  // no corresponding row in state.budget at all — i.e. never budgeted,
  // as opposed to budgeted at RM0 (which already renders as a normal
  // card, see Doctor Visits-style items). Deliberately derived fresh from
  // transactions each render rather than written back as budget rows,
  // since the user may not want every subcategory tracked against a
  // target.
  function unbudgetedActuals(monthExpenses, budgetRows) {
    const budgetedKeys = new Set(budgetRows.map(b => `${b.category}||${b.subcategory}`));
    const sums = Utils.sumBy(
      monthExpenses.filter(t => !budgetedKeys.has(`${t.Category}||${t.Subcategory}`)),
      t => `${t.Category}||${t.Subcategory}`,
      t => Number(t.Amount) || 0
    );
    return [...sums.entries()]
      .map(([key, actual]) => {
        const [category, subcategory] = key.split('||');
        return { category, subcategory, actual };
      })
      .sort((a, b) => b.actual - a.actual);
  }

  // ---------- Main render ----------

  function render(state) {
    currentState = state;
    cacheEls();
    bindStaticListenersOnce();

    let effectiveMonth = state.month;
    let usingFallback = false;
    if (!effectiveMonth || effectiveMonth === 'all') {
      effectiveMonth = state.monthOptions[0] ? state.monthOptions[0].value : null;
      usingFallback = true;
    }

    const monthTransactions = effectiveMonth ? Utils.filterByMonth(state.transactions, effectiveMonth) : [];
    const monthExpenses = monthTransactions.filter(t => t.TransactionType === 'Expense');
    const monthIncome = monthTransactions.filter(t => t.TransactionType === 'Income');
    const totalIncome = monthIncome.reduce((s, t) => s + (Number(t.Amount) || 0), 0);

    const actualBySub = Utils.sumBy(
      monthExpenses,
      t => `${t.Category}||${t.Subcategory}`,
      t => Number(t.Amount) || 0
    );

    // Savings/Investments actuals come from the Transfers sheet, not
    // Transactions — a "spend" never happens here, a transfer into an
    // investment account does. Grouped by the literal "To Account" value.
    const monthTransfers = effectiveMonth ? Utils.filterByMonth(state.transfers, effectiveMonth) : [];
    const transferByPrefix = Utils.sumBy(
      monthTransfers,
      t => transferToAccount(t),
      t => Number(t.Amount) || 0
    );

    function actualFor(b) {
      if (b.type === 'Savings') {
        return transferByPrefix.get(prefixFromSubcategory(b.subcategory)) || 0;
      }
      return actualBySub.get(`${b.category}||${b.subcategory}`) || 0;
    }

    const needs = state.budget.filter(b => b.type === 'Needs');
    const wants = state.budget.filter(b => b.type === 'Wants');
    const savings = state.budget.filter(b => b.type === 'Savings');

    // Diagnostic aid: if there's money budgeted toward Savings/Investments
    // and transfers exist this month, but nothing matched at all, the
    // prefixes almost certainly disagree — e.g. a subcategory typed as
    // "Stashaway Gold" (prefix STASHAWAY) against a Transfers "To Account"
    // value of "SA" or "Stash". Logged instead of silently showing 0s.
    if (savings.length && monthTransfers.length && transferByPrefix.size === 0) {
      console.warn(
        '[Budget] No Transfers rows matched any Savings/Investment prefix for',
        effectiveMonth,
        '— check that each Transfer\'s "To Account" value starts with the same word as its budget Subcategory.',
        { savingsSubcategories: savings.map(b => b.subcategory), sampleTransfer: monthTransfers[0] }
      );
    } else if (savings.length && monthTransfers.length) {
      const unmatched = savings.filter(b => !transferByPrefix.has(prefixFromSubcategory(b.subcategory)));
      if (unmatched.length) {
        console.warn(
          '[Budget] These Savings/Investment items found no matching transfers this month:',
          unmatched.map(b => `${b.subcategory} (expects "To Account" starting with "${prefixFromSubcategory(b.subcategory)}")`),
          'Available "To Account" prefixes seen:', [...transferByPrefix.keys()]
        );
      }
    }

    // "Spent, no budget set" covers two different underlying situations
    // that should read the same way to the user: a category/subcategory
    // that was never given a budget row at all, and one that has a row
    // but sits at RM0. Both mean "nothing was allocated, but money moved".
    const zeroBudgetSpent = needs.concat(wants)
      .filter(b => b.budgeted <= 0 && actualFor(b) > 0)
      .map(b => ({ id: b.id, category: b.category, subcategory: b.subcategory, actual: actualFor(b), hasBudgetRow: true }));
    const noBudgetRowSpent = unbudgetedActuals(monthExpenses, state.budget)
      .map(u => ({ ...u, hasBudgetRow: false }));
    const unbudgeted = zeroBudgetSpent.concat(noBudgetRowSpent).sort((a, c) => c.actual - a.actual);

    renderAttention(needs.concat(wants), actualFor, unbudgeted);
    renderGroupedSection('Needs', needs, actualFor, totalIncome);
    renderGroupedSection('Wants', wants, actualFor, totalIncome);
    renderSavingsSection(savings, actualFor);

    renderAllocation(needs, wants, savings, actualFor, totalIncome, effectiveMonth, usingFallback);
    renderOverallStats(needs.concat(wants).concat(savings), actualFor, totalIncome, effectiveMonth, usingFallback, unbudgeted);
    populateCategoryOptions();
  }

  // ---------- Needs / Wants: grouped by category ----------

  function renderGroupedSection(type, rows, actualFor, totalIncome) {
    const containerId = { Needs: 'budgetCardsNeeds', Wants: 'budgetCardsWants' }[type];
    const totalsId = { Needs: 'budgetTotalsNeeds', Wants: 'budgetTotalsWants' }[type];
    const cardsEl = document.getElementById(containerId);
    const totalsEl = document.getElementById(totalsId);
    if (!cardsEl) return;

    if (!rows.length) {
      cardsEl.innerHTML = `<div class="muted">No items yet — click "+ Add" to set your first target.</div>`;
      if (totalsEl) totalsEl.innerHTML = '';
      return;
    }

    const grouped = groupByCategory(rows);
    const categories = orderedCategories(rows);

    cardsEl.innerHTML = categories.map(category => {
      const items = (grouped.get(category) || []).slice().sort((a, b) => actualFor(b) - actualFor(a));
      const catBudgeted = items.reduce((s, b) => s + (b.budgeted || 0), 0);
      const catActual = items.reduce((s, b) => s + actualFor(b), 0);
      const catAvailable = catBudgeted - catActual;
      const catIncomePct = totalIncome > 0 ? (catBudgeted / totalIncome) * 100 : null;
      const isEmpty = catBudgeted === 0 && catActual === 0;

      // Categories are collapsed by default — the user can still expand
      // any of them, and that choice is remembered (categoryExpandState)
      // across re-renders within the session.
      const key = `${type}||${category}`;
      const defaultExpanded = false;
      const expanded = categoryExpandState.has(key) ? categoryExpandState.get(key) : defaultExpanded;

      return `
        <div class="budget-category-group">
          <div class="budget-category-header ${isEmpty ? 'is-empty' : ''}">
            <button class="budget-category-toggle" type="button" data-type="${type}" data-category="${category.replace(/"/g, '&quot;')}" aria-expanded="${expanded}">
              <span class="chevron">▸</span>
              <span class="budget-category-name">${category}</span>
              ${isEmpty ? '<span class="muted">— no items funded yet</span>' : ''}
            </button>
            <div class="budget-category-totals">
              <span>Budgeted <b>${Utils.fmtMoney(catBudgeted)}</b></span>
              <span>Actual <b>${Utils.fmtMoney(catActual)}</b></span>
              <span>Available <b class="value ${catAvailable >= 0 ? 'positive' : 'negative'}">${Utils.fmtMoney(catAvailable)}</b></span>
              ${catIncomePct !== null ? `<span class="muted">${catIncomePct.toFixed(1)}% of income</span>` : ''}
              <span class="muted">${items.length} item${items.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div class="budget-cards ${expanded ? '' : 'is-collapsed'}">${items.map(b => budgetCardHtml(b, actualFor)).join('')}</div>
        </div>`;
    }).join('');

    bindCardListeners(cardsEl);
    bindCategoryToggles(cardsEl);

    const totalBudgeted = rows.reduce((s, b) => s + (b.budgeted || 0), 0);
    const totalActual = rows.reduce((s, b) => s + actualFor(b), 0);
    const overCount = rows.filter(b => b.budgeted > 0 && actualFor(b) > b.budgeted).length;

    if (totalsEl) {
      totalsEl.innerHTML = `
        <span>Budgeted: <b>${Utils.fmtMoney(totalBudgeted)}</b></span>
        <span>Actual: <b>${Utils.fmtMoney(totalActual)}</b></span>
        <span>Available: <b class="value ${totalBudgeted - totalActual >= 0 ? 'positive' : 'negative'}">${Utils.fmtMoney(totalBudgeted - totalActual)}</b></span>
        ${overCount > 0 ? `<span class="over-count">${overCount} over budget</span>` : ''}`;
    }
  }

  // ---------- Savings & Investments: flat list (one category already) ----------

  function renderSavingsSection(rows, actualFor) {
    const cardsEl = document.getElementById('budgetCardsSavings');
    const totalsEl = document.getElementById('budgetTotalsSavings');
    if (!cardsEl) return;

    if (!rows.length) {
      cardsEl.innerHTML = `<div class="muted">No items yet — click "+ Add" to set your first target.</div>`;
      if (totalsEl) totalsEl.innerHTML = '';
      return;
    }

    const sorted = rows.slice().sort((a, b) => actualFor(b) - actualFor(a));
    cardsEl.innerHTML = `<div class="budget-cards">${sorted.map(b => budgetCardHtml(b, actualFor)).join('')}</div>`;
    bindCardListeners(cardsEl);

    const totalBudgeted = rows.reduce((s, b) => s + (b.budgeted || 0), 0);
    const totalActual = rows.reduce((s, b) => s + actualFor(b), 0);
    const underCount = rows.filter(b => b.budgeted > 0 && actualFor(b) < b.budgeted).length;

    if (totalsEl) {
      totalsEl.innerHTML = `
        <span>Budgeted: <b>${Utils.fmtMoney(totalBudgeted)}</b></span>
        <span>Actual: <b>${Utils.fmtMoney(totalActual)}</b></span>
        <span>Available: <b class="value ${totalBudgeted - totalActual >= 0 ? 'positive' : 'negative'}">${Utils.fmtMoney(totalBudgeted - totalActual)}</b></span>
        ${underCount > 0 ? `<span class="over-count">${underCount} not fully funded</span>` : ''}`;
    }
  }

  function budgetCardHtml(b, actualFor) {
    const actual = actualFor(b);
    const available = b.budgeted - actual;
    const pct = b.budgeted > 0 ? Math.min(100, (actual / b.budgeted) * 100) : (actual > 0 ? 100 : 0);
    const isSavings = b.type === 'Savings';
    const status = isSavings
      ? (b.budgeted > 0 && actual >= b.budgeted ? { cls: 'under', label: 'Goal reached' } : { cls: 'close', label: 'In progress' })
      : statusFor(b.budgeted, actual);

    const labels = isSavings
      ? { budgeted: 'Target', actual: 'Contributed', available: 'Remaining' }
      : { budgeted: 'Budgeted', actual: 'Actual', available: 'Available' };

    const milestone = isSavings ? nextMilestone(b.budgeted, actual) : null;
    const milestoneHtml = isSavings
      ? (milestone
          ? `<div class="milestone-note muted">Next milestone: ${Utils.fmtMoney(milestone.amount)} (${milestone.pct}%)</div>`
          : (b.budgeted > 0 ? `<div class="milestone-note goal-reached">🎉 Goal reached</div>` : ''))
      : '';

    return `
      <div class="budget-card status-${status.cls}" data-id="${b.id}">
        <div class="budget-card-top">
          <div class="budget-card-title-wrap" data-action="edit" data-id="${b.id}" style="cursor:pointer;">
            <div class="budget-card-title">${b.subcategory}</div>
            <div class="budget-card-sub muted">${b.category}</div>
          </div>
          <div class="budget-card-top-right">
            <span class="badge ${status.cls}">${status.label}</span>
            <button class="card-delete-btn" data-action="delete" data-id="${b.id}" title="Delete this budget item">✕</button>
          </div>
        </div>
        <div class="budget-card-amounts">
          <div class="amount-block">
            <span class="label">${labels.budgeted}</span>
            <div class="editable-amount" data-id="${b.id}">
              <span class="currency-prefix">RM</span>
              <input type="number" class="budget-input" value="${b.budgeted}" step="0.01" min="0" inputmode="decimal" />
            </div>
          </div>
          <div class="amount-block">
            <span class="label">${labels.actual}</span>
            <span class="value">${Utils.fmtMoney(actual)}</span>
          </div>
          <div class="amount-block">
            <span class="label">${labels.available}</span>
            <span class="value ${available >= 0 ? 'positive' : 'negative'}">${Utils.fmtMoney(available)}</span>
          </div>
        </div>
        <div class="budget-card-footer">
          <div class="progress-track"><div class="progress-fill ${status.cls}" style="width:${pct}%"></div></div>
          <span class="pct-label">${pct.toFixed(0)}%</span>
        </div>
        ${milestoneHtml}
      </div>`;
  }

  function bindCategoryToggles(cardsEl) {
    cardsEl.querySelectorAll('.budget-category-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = `${btn.dataset.type}||${btn.dataset.category}`;
        const currentlyExpanded = btn.getAttribute('aria-expanded') === 'true';
        categoryExpandState.set(key, !currentlyExpanded);
        render(currentState);
      });
    });
  }

  function bindCardListeners(cardsEl) {
    cardsEl.querySelectorAll('[data-action="edit"]').forEach(el => {
      el.addEventListener('click', () => {
        const item = currentState.budget.find(b => String(b.id) === el.dataset.id);
        if (item) openModal(item.type, item);
      });
    });

    cardsEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = currentState.budget.find(b => String(b.id) === btn.dataset.id);
        if (item) confirmAndDelete(item);
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

        const item = currentState.budget.find(b => String(b.id) === wrap.dataset.id);
        if (!item) return;

        wrap.classList.add('saving');
        wrap.classList.remove('saved', 'save-error');

        try {
          await Api.updateBudget({ id: item.id, budgeted: newValue });
          item.budgeted = newValue;
          wrap.classList.remove('saving');
          wrap.classList.add('saved');
          setTimeout(() => wrap.classList.remove('saved'), 1000);
          render(currentState);
        } catch (err) {
          wrap.classList.remove('saving');
          wrap.classList.add('save-error');
          input.value = original;
          alert(`Couldn't save this change: ${err.message}`);
        }
      });
    });
  }

  // ---------- Allocation bar + income-proportional summary table ----------

  function renderAllocation(needs, wants, savings, actualFor, totalIncome, effectiveMonth, usingFallback) {
    const bar = document.getElementById('allocationBar');
    const legend = document.getElementById('allocationLegend');
    const note = document.getElementById('allocationIncomeNote');
    const table = document.getElementById('budgetSummaryTable');
    if (!bar) return;

    const groups = [
      { key: 'needs', label: 'Needs', target: TARGETS.Needs, rows: needs },
      { key: 'wants', label: 'Wants', target: TARGETS.Wants, rows: wants },
      { key: 'savings', label: 'Savings & Investments', target: TARGETS.Savings, rows: savings }
    ].map(g => ({
      ...g,
      budgeted: g.rows.reduce((s, b) => s + (b.budgeted || 0), 0),
      actual: g.rows.reduce((s, b) => s + actualFor(b), 0)
    }));

    // Bar shows each group's BUDGETED amount as a slice of total income —
    // i.e. "of every ringgit you earn this month, this much is earmarked
    // for X". Anything left unbudgeted shows as a muted "Unallocated"
    // sliver; if you've budgeted more than you earn, the bar simply fills
    // and the overage is called out in the note underneath.
    const totalBudgeted = groups.reduce((s, g) => s + g.budgeted, 0);

    if (totalIncome > 0) {
      const unallocated = Math.max(0, totalIncome - totalBudgeted);
      const denom = Math.max(totalIncome, totalBudgeted);
      bar.innerHTML = groups.map(g => {
        const pct = (g.budgeted / denom) * 100;
        return `<div class="allocation-seg seg-${g.key}" style="width:${pct}%">${pct >= 8 ? pct.toFixed(0) + '%' : ''}</div>`;
      }).join('') + (unallocated > 0 ? `<div class="allocation-seg seg-empty" style="width:${(unallocated / denom) * 100}%"></div>` : '');
    } else {
      bar.innerHTML = `<div class="allocation-seg seg-empty" style="width:100%"></div>`;
    }

    legend.innerHTML = groups.map(g => {
      const budgetedPct = totalIncome > 0 ? (g.budgeted / totalIncome) * 100 : 0;
      const offTarget = totalIncome > 0 && Math.abs(budgetedPct - g.target * 100) > 5;
      return `
        <div class="legend-item">
          <span class="legend-dot seg-${g.key}"></span>
          <span>${g.label}:</span>
          <b class="${offTarget ? 'off-target' : ''}">${Utils.fmtMoney(g.budgeted)}</b>
          <span>(${(g.target * 100).toFixed(0)}% target${totalIncome > 0 ? `, ${budgetedPct.toFixed(0)}% budgeted` : ''})</span>
        </div>`;
    }).join('');

    let monthLabel = '—';
    if (effectiveMonth) {
      const [y, m] = effectiveMonth.split('-').map(Number);
      monthLabel = Utils.monthLabel(y, m);
    }
    note.textContent = totalIncome > 0
      ? `Against ${Utils.fmtMoney(totalIncome)} income in ${monthLabel}${usingFallback ? ' (latest)' : ''}${totalBudgeted > totalIncome ? ' — budgeted total exceeds income' : ''}`
      : `${monthLabel}${usingFallback ? ' (latest)' : ''} — no income recorded yet`;

    if (table) renderSummaryTable(table, groups, totalIncome);
  }

  function summaryStatus(group, totalIncome) {
    if (group.budgeted <= 0) return { cls: '', label: 'No budget set' };
    if (group.key === 'savings') {
      return group.actual >= group.budgeted
        ? { cls: 'under', label: 'Fully funded' }
        : { cls: 'close', label: 'Not fully utilized' };
    }
    return group.actual > group.budgeted
      ? { cls: 'over', label: 'Over budget' }
      : { cls: 'under', label: 'Surplus' };
  }

  function renderSummaryTable(table, groups, totalIncome) {
    const pct = (n) => totalIncome > 0 ? `${((n / totalIncome) * 100).toFixed(1)}%` : '—';

    table.querySelector('thead').innerHTML = `
      <tr>
        <th>Group</th><th>Status</th>
        <th class="num">Actual</th><th class="num">Actual %</th>
        <th class="num">Budgeted</th><th class="num">Budgeted %</th>
        <th class="num">Ideal (target)</th><th class="num">Target %</th>
      </tr>`;

    const rows = groups.map(g => {
      const status = summaryStatus(g, totalIncome);
      const ideal = totalIncome * g.target;
      return `
        <tr>
          <td><span class="legend-dot seg-${g.key}"></span> ${g.label}</td>
          <td><span class="badge ${status.cls}">${status.label}</span></td>
          <td class="num">${Utils.fmtMoney(g.actual)}</td>
          <td class="num">${pct(g.actual)}</td>
          <td class="num">${Utils.fmtMoney(g.budgeted)}</td>
          <td class="num">${pct(g.budgeted)}</td>
          <td class="num">${Utils.fmtMoney(ideal)}</td>
          <td class="num">${(g.target * 100).toFixed(0)}%</td>
        </tr>`;
    }).join('');

    const totalActual = groups.reduce((s, g) => s + g.actual, 0);
    const totalBudgeted = groups.reduce((s, g) => s + g.budgeted, 0);
    const totalTarget = groups.reduce((s, g) => s + g.target, 0);

    const grandRow = `
      <tr class="summary-total-row">
        <td>Grand Total</td><td></td>
        <td class="num">${Utils.fmtMoney(totalActual)}</td>
        <td class="num">${pct(totalActual)}</td>
        <td class="num">${Utils.fmtMoney(totalBudgeted)}</td>
        <td class="num">${pct(totalBudgeted)}</td>
        <td class="num">${Utils.fmtMoney(totalIncome * totalTarget)}</td>
        <td class="num">${(totalTarget * 100).toFixed(0)}%</td>
      </tr>`;

    table.querySelector('tbody').innerHTML = rows + grandRow;
  }

  function renderOverallStats(all, actualFor, totalIncome, effectiveMonth, usingFallback, unbudgeted) {
    const totalBudgeted = all.reduce((s, b) => s + (b.budgeted || 0), 0);
    const unbudgetedTotal = (unbudgeted || []).reduce((s, u) => s + u.actual, 0);
    const totalActual = all.reduce((s, b) => s + actualFor(b), 0);
    const overCategories = all.filter(b => b.type !== 'Savings' && b.budgeted > 0 && actualFor(b) > b.budgeted).length;
    const available = totalBudgeted - totalActual;
    let monthLabel = '—';
    if (effectiveMonth) {
      const [y, m] = effectiveMonth.split('-').map(Number);
      monthLabel = Utils.monthLabel(y, m);
    }

    document.getElementById('budgetStats').innerHTML = `
      <div class="stat-card">
        <div class="label">Income (${monthLabel}${usingFallback ? ', latest' : ''})</div>
        <div class="value positive">${Utils.fmtMoney(totalIncome)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Total budgeted</div>
        <div class="value">${Utils.fmtMoney(totalBudgeted)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Total actual</div>
        <div class="value">${Utils.fmtMoney(totalActual)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Available</div>
        <div class="value ${available >= 0 ? 'positive' : 'negative'}">${Utils.fmtMoney(available)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Items over budget</div>
        <div class="value ${overCategories > 0 ? 'negative' : 'positive'}">${overCategories}</div>
      </div>
      ${unbudgetedTotal > 0 ? `
      <div class="stat-card">
        <div class="label">Spent, no budget set</div>
        <div class="value no-budget">${Utils.fmtMoney(unbudgetedTotal)}</div>
      </div>` : ''}`;
  }

  // ---------- Attention needed (Needs/Wants only — see note below) ----------

  // Deliberately excludes Savings: a savings goal sitting at 30% funded
  // mid-month isn't a problem, it's just... mid-month. Flagging it here
  // would cry wolf every month and train the user to ignore this panel.
  // Savings gets its own "goal progress" framing instead (see budgetCardHtml).
  //
  // Only items actually over budget are surfaced here — "near limit" items
  // are left off so this panel stays a clean, actionable list of real
  // overspending rather than a general-purpose watchlist.
  function renderAttention(rows, actualFor, unbudgeted) {
    const card = document.getElementById('attentionCard');
    const list = document.getElementById('attentionList');
    if (!card || !list) return;

    const over = rows
      .filter(b => b.budgeted > 0 && actualFor(b) > b.budgeted)
      .map(b => ({ b, overBy: actualFor(b) - b.budgeted }))
      .sort((a, c) => c.overBy - a.overBy);

    card.hidden = false;

    if (!over.length && !unbudgeted.length) {
      card.classList.add('is-clear');
      list.innerHTML = `<div class="attention-clear">✓ Nothing needs attention — everything's within budget.</div>`;
      return;
    }

    card.classList.remove('is-clear');

    const row = (b, right, extraCls) => `
      <div class="attention-row" data-action="edit" data-id="${b.id}">
        <span class="attention-item">${b.subcategory} <span class="muted">· ${b.category}</span></span>
        <span class="attention-amount ${extraCls}">${right}</span>
      </div>`;

    // Same row shape as `row` above, but points at "add a budget for this"
    // instead of "edit the existing budget" when there's no row to edit
    // yet — items that already have a RM0 row (hasBudgetRow) go through
    // the normal edit action instead. Kept as its own color (no-budget)
    // so it doesn't read as a severity escalation of "over budget"; it's
    // just "spent, unplanned".
    const unbudgetedRow = (u) => u.hasBudgetRow
      ? `
      <div class="attention-row" data-action="edit" data-id="${u.id}">
        <span class="attention-item">${u.subcategory} <span class="muted">· ${u.category}</span></span>
        <span class="attention-amount no-budget">${Utils.fmtMoney(u.actual)}</span>
      </div>`
      : `
      <div class="attention-row" data-action="add-budget" data-category="${u.category.replace(/"/g, '&quot;')}" data-subcategory="${u.subcategory.replace(/"/g, '&quot;')}">
        <span class="attention-item">${u.subcategory} <span class="muted">· ${u.category}</span></span>
        <span class="attention-amount no-budget">${Utils.fmtMoney(u.actual)}</span>
      </div>`;

    list.innerHTML = `
      ${over.length ? `
      <div class="attention-group">
        <div class="attention-group-title over">Over budget</div>
        ${over.map(({ b, overBy }) => row(b, `+${Utils.fmtMoney(overBy)}`, 'negative')).join('')}
      </div>` : ''}
      ${unbudgeted.length ? `
      <div class="attention-group">
        <div class="attention-group-title no-budget">Spent, no budget set</div>
        ${unbudgeted.map(unbudgetedRow).join('')}
      </div>` : ''}`;

    list.querySelectorAll('[data-action="edit"]').forEach(el => {
      el.addEventListener('click', () => {
        const item = currentState.budget.find(x => String(x.id) === el.dataset.id);
        if (item) openModal(item.type, item);
      });
    });

    list.querySelectorAll('[data-action="add-budget"]').forEach(el => {
      el.addEventListener('click', () => {
        openAddModalPrefilled(el.dataset.category, el.dataset.subcategory);
      });
    });
  }

  // ---------- Modal (add / edit / delete) ----------

  function openModal(type, item) {
    editingId = item ? item.id : null;
    els.title.textContent = item ? 'Edit budget item' : 'Add budget item';
    els.formType.value = type || 'Needs';
    els.formCategory.value = item ? item.category : (type === 'Savings' ? SAVINGS_CATEGORY : '');
    els.formSubcategory.value = item ? item.subcategory : '';
    els.formAmount.value = item ? item.budgeted : '';
    els.deleteBtn.hidden = !item;
    els.error.hidden = true;
    els.error.textContent = '';

    updateModalFieldsForType();

    els.overlay.hidden = false;
  }

  // Opens the modal in pure "add" mode with category/subcategory
  // pre-filled — used from the attention panel's "Spent, no budget set"
  // rows, where there's no existing budget item (and hence no delete
  // button) to edit.
  function openAddModalPrefilled(category, subcategory) {
    editingId = null;
    els.title.textContent = 'Add budget item';
    els.formType.value = 'Needs';
    els.formCategory.value = category;
    els.formSubcategory.value = subcategory;
    els.formAmount.value = '';
    els.deleteBtn.hidden = true;
    els.error.hidden = true;
    els.error.textContent = '';

    updateModalFieldsForType();

    els.overlay.hidden = false;
  }

  function closeModal() {
    els.overlay.hidden = true;
    editingId = null;
  }

  function updateModalFieldsForType() {
    const isSavings = els.formType.value === 'Savings';
    if (isSavings) {
      els.formCategory.value = SAVINGS_CATEGORY;
      els.formCategory.readOnly = true;
      els.formSubcategory.placeholder = 'e.g. KDI Save';
    } else {
      els.formCategory.readOnly = false;
      if (els.formCategory.value === SAVINGS_CATEGORY) els.formCategory.value = '';
      els.formSubcategory.placeholder = 'e.g. Rent';
    }
    updateSubcategoryOptions();
  }

  function populateCategoryOptions() {
    if (!els.categoryOptions) return;
    const cats = Object.keys(CATEGORY_MAP);
    els.categoryOptions.innerHTML = cats.map(c => `<option value="${c}"></option>`).join('');
  }

  function updateSubcategoryOptions() {
    const isSavings = els.formType.value === 'Savings';
    const subs = isSavings ? SAVINGS_SUBCATEGORY_OPTIONS : (CATEGORY_MAP[els.formCategory.value] || []);
    els.subcategoryOptions.innerHTML = subs.map(s => `<option value="${s}"></option>`).join('');
  }

  async function handleSave() {
    const type = els.formType.value;
    const category = els.formCategory.value.trim();
    const subcategory = els.formSubcategory.value.trim();
    const budgeted = Number(els.formAmount.value);

    if (!category || !subcategory) {
      showModalError('Category and subcategory are both required.');
      return;
    }
    if (isNaN(budgeted) || budgeted < 0) {
      showModalError('Enter a valid budgeted amount (0 or more).');
      return;
    }
    if (type === 'Savings' && !prefixFromSubcategory(subcategory)) {
      showModalError('Subcategory needs at least one word so it can be matched to a transfer destination.');
      return;
    }

    const payload = { type, category, subcategory, budgeted };
    els.saveBtn.disabled = true;

    try {
      if (editingId) {
        payload.id = editingId;
        await Api.updateBudget(payload);
        const item = currentState.budget.find(b => String(b.id) === String(editingId));
        if (item) Object.assign(item, payload);
      } else {
        const result = await Api.addBudget(payload);
        currentState.budget.push({ id: result.id, ...payload });
      }
      els.saveBtn.disabled = false;
      closeModal();
      render(currentState);
    } catch (err) {
      els.saveBtn.disabled = false;
      showModalError(`Couldn't save: ${err.message}`);
    }
  }

  function showModalError(message) {
    els.error.hidden = false;
    els.error.textContent = message;
  }

  function confirmAndDelete(item) {
    if (!confirm(`Remove the budget target for ${item.category} / ${item.subcategory}?`)) return;
    deleteItem(item);
  }

  async function handleDelete() {
    if (!editingId) return;
    const item = currentState.budget.find(b => String(b.id) === String(editingId));
    if (!item) return;
    if (!confirm(`Remove the budget target for ${item.category} / ${item.subcategory}?`)) return;
    await deleteItem(item);
    closeModal();
  }

  async function deleteItem(item) {
    try {
      await Api.deleteBudget(item.id);
      currentState.budget = currentState.budget.filter(b => String(b.id) !== String(item.id));
      render(currentState);
    } catch (err) {
      alert(`Couldn't delete this item: ${err.message}`);
    }
  }

  return { render };
})();