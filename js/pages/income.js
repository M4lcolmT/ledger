const IncomePage = (() => {

  let currentPage = 1;
  let pageSize = 20;
  let currentIncome = [];
  let searchTerm = '';
  let sortField = 'Timestamp';
  let sortDir = 'desc'; // 'asc' | 'desc'
  let searchDebounceTimer = null;
  let editingId = null;   // TransactionID currently in edit mode, or null
  let rowBusy = null;     // TransactionID currently mid save/delete request

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
        <th class="actions-col">Actions</th>
      </tr>`;
    bindSortHeaders(table);

    table.querySelector('tbody').innerHTML = pageItems.map(rowHtml).join('')
      || `<tr><td colspan="7" class="muted">No income matches your filters.</td></tr>`;

    bindRowActions(table);

    Utils.renderPagination(document.getElementById('incomePagination'), sorted.length, currentPage, pageSize, (p) => {
      currentPage = p;
      renderTable();
    });
  }

  function rowHtml(t) {
    const id = t.TransactionID;
    const busy = id === rowBusy;

    if (id === editingId) {
      return `
        <tr data-id="${id}" class="editing-row">
          <td><input type="date" class="edit-input" data-field="Timestamp" value="${Utils.toDateInputValue(t.Timestamp)}" ${busy ? 'disabled' : ''}></td>
          <td><input type="text" class="edit-input" data-field="Category" value="${escAttr(t.Category)}" ${busy ? 'disabled' : ''}></td>
          <td><input type="text" class="edit-input" data-field="Subcategory" value="${escAttr(t.Subcategory)}" ${busy ? 'disabled' : ''}></td>
          <td><input type="text" class="edit-input" data-field="Account" value="${escAttr(t.Account)}" ${busy ? 'disabled' : ''}></td>
          <td><input type="text" class="edit-input" data-field="Notes" value="${escAttr(t.Notes)}" ${busy ? 'disabled' : ''}></td>
          <td class="num"><input type="number" step="0.01" class="edit-input num-input" data-field="Amount" value="${Number(t.Amount) || 0}" ${busy ? 'disabled' : ''}></td>
          <td class="actions-col">
            <button class="row-save-btn" data-id="${id}" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Save'}</button>
            <button class="row-cancel-btn" data-id="${id}" ${busy ? 'disabled' : ''}>Cancel</button>
          </td>
        </tr>`;
    }

    return `
      <tr data-id="${id}">
        <td>${new Date(t.Timestamp).toLocaleDateString()}</td>
        <td>${t.Category || ''}</td>
        <td>${t.Subcategory || ''}</td>
        <td>${t.Account || ''}</td>
        <td>${t.Notes || ''}</td>
        <td class="num">${Utils.fmtMoney(t.Amount)}</td>
        <td class="actions-col">
          <button class="row-edit-btn" data-id="${id}" ${busy ? 'disabled' : ''}>Edit</button>
          <button class="row-delete-btn" data-id="${id}" ${busy ? 'disabled' : ''}>${busy ? 'Deleting…' : 'Delete'}</button>
        </td>
      </tr>`;
  }

  function escAttr(v) {
    return String(v == null ? '' : v).replace(/"/g, '&quot;');
  }

  function bindRowActions(table) {
    table.querySelectorAll('.row-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        editingId = btn.dataset.id;
        renderTable();
      });
    });

    table.querySelectorAll('.row-cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        editingId = null;
        renderTable();
      });
    });

    table.querySelectorAll('.row-save-btn').forEach(btn => {
      btn.addEventListener('click', () => saveRow(btn.dataset.id, btn.closest('tr')));
    });

    table.querySelectorAll('.row-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteRow(btn.dataset.id));
    });
  }

  async function saveRow(id, rowEl) {
    const payload = { id, transactionType: 'Income' };
    rowEl.querySelectorAll('[data-field]').forEach(input => {
      const field = input.dataset.field;
      if (field === 'Amount') payload.amount = Number(input.value) || 0;
      else if (field === 'Timestamp') payload.timestamp = input.value; // yyyy-mm-dd
      else payload[field.charAt(0).toLowerCase() + field.slice(1)] = input.value;
    });

    rowBusy = id;
    renderTable();
    try {
      await Api.updateTransaction(payload);
      editingId = null;
      rowBusy = null;
      await window.App.refreshData(); // transaction changes affect other pages too
    } catch (err) {
      rowBusy = null;
      renderTable();
      alert('Failed to save changes: ' + err.message);
    }
  }

  async function deleteRow(id) {
    if (!confirm('Delete this income entry? This cannot be undone.')) return;

    rowBusy = id;
    renderTable();
    try {
      await Api.deleteTransaction(id);
      rowBusy = null;
      await window.App.refreshData();
    } catch (err) {
      rowBusy = null;
      renderTable();
      alert('Failed to delete: ' + err.message);
    }
  }

  return { render };
})();