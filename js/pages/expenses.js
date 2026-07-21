const ExpensesPage = (() => {

  let selectedCategory = null;
  let currentPage = 1;
  let pageSize = 20;
  let currentExpenses = [];
  let searchTerm = '';
  let sortField = 'Timestamp';
  let sortDir = 'desc'; // 'asc' | 'desc'
  let searchDebounceTimer = null;

  function render(state) {
    currentExpenses = Utils.filterByMonth(state.transactions, state.month)
      .filter(t => t.TransactionType === 'Expense');

    // By category (pie) — percentages + amounts shown directly on the chart
    const byCategory = Utils.sortMapDesc(
      Utils.sumBy(currentExpenses, t => t.Category || 'Uncategorized', t => Number(t.Amount) || 0)
    );
    Charts.pie('expensePieChart', byCategory.map(x => x[0]), byCategory.map(x => x[1]));

    const total = currentExpenses.reduce((s, t) => s + (Number(t.Amount) || 0), 0);
    const totalBadge = document.getElementById('expenseTotalBadge');
    if (totalBadge) totalBadge.textContent = `Total: ${Utils.fmtMoney(total)}`;

    // Recurring bills / subscriptions (sits above the transactions table)
    RecurringSection.render(
      { badgeId: 'expenseRecurringBadge', tableId: 'expenseRecurringTable' },
      state.recurring,
      'Expense'
    );

    // Subcategory breakdown for a selectable category
    populateCategorySelect(byCategory.map(x => x[0]));
    renderSubcategoryChart();

    // Table (reset to page 1 whenever the underlying data set changes)
    currentPage = 1;
    bindPageSizeControl();
    bindSearchControl();
    renderTable();
  }

  function populateCategorySelect(categories) {
    const select = document.getElementById('expenseCategorySelect');
    if (!select) return;

    if (!selectedCategory || !categories.includes(selectedCategory)) {
      selectedCategory = categories[0] || null;
    }

    select.innerHTML = categories.length
      ? categories.map(c => `<option value="${c}" ${c === selectedCategory ? 'selected' : ''}>${c}</option>`).join('')
      : '<option value="">No categories</option>';

    if (!select.dataset.bound) {
      select.addEventListener('change', (e) => {
        selectedCategory = e.target.value;
        renderSubcategoryChart();
      });
      select.dataset.bound = 'true';
    }
  }

  function renderSubcategoryChart() {
    if (!selectedCategory) { Charts.bar('expenseSubBarChart', [], []); return; }

    const inCategory = currentExpenses.filter(t => (t.Category || 'Uncategorized') === selectedCategory);
    const bySub = Utils.sortMapDesc(
      Utils.sumBy(inCategory, t => t.Subcategory || 'Other', t => Number(t.Amount) || 0)
    );
    const colors = bySub.map((_, i) => Utils.colorFor(i));

    Charts.bar('expenseSubBarChart', bySub.map(x => x[0]), bySub.map(x => x[1]), colors, true);
  }

  function bindPageSizeControl() {
    const sizeSelect = document.getElementById('expensePageSize');
    if (!sizeSelect || sizeSelect.dataset.bound) return;
    sizeSelect.value = String(pageSize);
    sizeSelect.addEventListener('change', (e) => {
      pageSize = e.target.value === 'all' ? 'all' : Number(e.target.value);
      currentPage = 1;
      renderTable();
    });
    sizeSelect.dataset.bound = 'true';
  }

  function bindSearchControl() {
    const input = document.getElementById('expenseSearchInput');
    if (!input || input.dataset.bound) return;
    input.value = searchTerm;
    input.addEventListener('input', (e) => {
      const value = e.target.value;
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        searchTerm = value.trim().toLowerCase();
        currentPage = 1;
        renderTable();
      }, 200);
    });
    input.dataset.bound = 'true';
  }

  function matchesSearch(t) {
    if (!searchTerm) return true;
    const haystack = [t.Category, t.Subcategory, t.Account, t.Notes]
      .map(v => String(v || '').toLowerCase())
      .join(' ');
    return haystack.includes(searchTerm);
  }

  function sortExpenses(items) {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      let av, bv;
      if (sortField === 'Timestamp') {
        av = new Date(a.Timestamp).getTime() || 0;
        bv = new Date(b.Timestamp).getTime() || 0;
      } else if (sortField === 'Amount') {
        av = Number(a.Amount) || 0;
        bv = Number(b.Amount) || 0;
      } else {
        av = String(a[sortField] || '').toLowerCase();
        bv = String(b[sortField] || '').toLowerCase();
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  function sortIndicator(field) {
    if (field !== sortField) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  function bindSortHeaders(table) {
    table.querySelectorAll('th[data-field]').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.field;
        if (sortField === field) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortField = field;
          sortDir = (field === 'Amount' || field === 'Timestamp') ? 'desc' : 'asc';
        }
        currentPage = 1;
        renderTable();
      });
    });
  }

  function renderTable() {
    const table = document.getElementById('expenseTable');

    const filtered = currentExpenses.filter(matchesSearch);
    const sorted = sortExpenses(filtered);
    const pageItems = Utils.paginate(sorted, currentPage, pageSize);

    table.querySelector('thead').innerHTML = `
      <tr>
        <th data-field="Timestamp">Date${sortIndicator('Timestamp')}</th>
        <th data-field="Category">Category${sortIndicator('Category')}</th>
        <th data-field="Subcategory">Subcategory${sortIndicator('Subcategory')}</th>
        <th data-field="Account">Account${sortIndicator('Account')}</th>
        <th>Notes</th>
        <th class="num" data-field="Amount">Amount${sortIndicator('Amount')}</th>
      </tr>`;
    bindSortHeaders(table);

    table.querySelector('tbody').innerHTML = pageItems.map(t => `
      <tr>
        <td>${new Date(t.Timestamp).toLocaleDateString()}</td>
        <td>${t.Category || ''}</td>
        <td>${t.Subcategory || ''}</td>
        <td>${t.Account || ''}</td>
        <td>${t.Notes || ''}</td>
        <td class="num">${Utils.fmtMoney(t.Amount)}</td>
      </tr>`).join('') || `<tr><td colspan="6" class="muted">No expenses match your filters.</td></tr>`;

    Utils.renderPagination(document.getElementById('expensePagination'), sorted.length, currentPage, pageSize, (p) => {
      currentPage = p;
      renderTable();
    });
  }

  return { render };
})();