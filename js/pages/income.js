const IncomePage = (() => {

  let currentPage = 1;
  let pageSize = 20;
  let currentIncome = [];
  let searchTerm = '';
  let sortField = 'Timestamp';
  let sortDir = 'desc'; // 'asc' | 'desc'
  let searchDebounceTimer = null;

  function render(state) {
    currentIncome = Utils.filterByMonth(state.transactions, state.month)
      .filter(t => t.TransactionType === 'Income');

    // Group by Subcategory rather than Category, since every income
    // transaction shares the same "Proceeds" category.
    const bySub = Utils.sortMapDesc(
      Utils.sumBy(currentIncome, t => t.Subcategory || 'Other', t => Number(t.Amount) || 0)
    );
    Charts.pie('incomePieChart', bySub.map(x => x[0]), bySub.map(x => x[1]));

    const total = currentIncome.reduce((sum, t) => sum + (Number(t.Amount) || 0), 0);
    const totalBadge = document.getElementById('incomeTotalBadge');
    if (totalBadge) totalBadge.textContent = `Total: ${Utils.fmtMoney(total)}`;

    // Recurring income (salary, rent, etc.) — sits above the transactions table
    RecurringSection.render(
      { badgeId: 'incomeRecurringBadge', tableId: 'incomeRecurringTable' },
      state.recurring,
      'Income'
    );

    const topSource = bySub[0];
    const avgTx = currentIncome.length ? total / currentIncome.length : 0;

    document.getElementById('incomeStats').innerHTML = `
      <div class="stat-card">
        <div class="label">Total income</div>
        <div class="value positive">${Utils.fmtMoney(total)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Top subcategory</div>
        <div class="value">${topSource ? topSource[0] : '—'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Transactions</div>
        <div class="value">${currentIncome.length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Avg. per transaction</div>
        <div class="value">${Utils.fmtMoney(avgTx)}</div>
      </div>`;

    currentPage = 1;
    bindPageSizeControl();
    bindSearchControl();
    renderTable();
  }

  function bindPageSizeControl() {
    const sizeSelect = document.getElementById('incomePageSize');
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
    const input = document.getElementById('incomeSearchInput');
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

  function sortIncome(items) {
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
    const table = document.getElementById('incomeTable');

    const filtered = currentIncome.filter(matchesSearch);
    const sorted = sortIncome(filtered);
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
      </tr>`).join('') || `<tr><td colspan="6" class="muted">No income matches your filters.</td></tr>`;

    Utils.renderPagination(document.getElementById('incomePagination'), sorted.length, currentPage, pageSize, (p) => {
      currentPage = p;
      renderTable();
    });
  }

  return { render };
})();