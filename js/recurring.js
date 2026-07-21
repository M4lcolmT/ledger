// Renders the "Recurring" table shared by the Expense and Income pages.
// Usage (see expenses.js / income.js):
//
//   RecurringSection.render(
//     { badgeId: 'expenseRecurringBadge', tableId: 'expenseRecurringTable' },
//     state.recurring,
//     'Expense'
//   );

const RecurringSection = (() => {

  function isActive(item) {
    return String(item.Active || '').trim().toLowerCase() === 'yes';
  }

  function render(ids, recurringItems, transactionType) {
    const table = document.getElementById(ids.tableId);
    if (!table) return;
    const badge = document.getElementById(ids.badgeId);

    const rows = (recurringItems || [])
      .filter(r => (r.TransactionType || '') === transactionType)
      .filter(isActive)
      .map(item => ({ item, next: Utils.computeNextOccurrence(item) }))
      .filter(r => r.next) // drop recurrences whose End Date has passed
      .sort((a, b) => a.next - b.next);

    if (badge) {
      const monthly = rows.reduce((sum, r) => sum + Utils.monthlyEquivalent(r.item), 0);
      badge.textContent = rows.length
        ? `~${Utils.fmtMoney(monthly)}/mo across ${rows.length} item${rows.length === 1 ? '' : 's'}`
        : '';
    }

    table.querySelector('thead').innerHTML = `
      <tr>
        <th>Description</th>
        <th>Category</th>
        <th>Account</th>
        <th>Frequency</th>
        <th>Next due</th>
        <th class="num">Amount</th>
      </tr>`;

    table.querySelector('tbody').innerHTML = rows.map(({ item, next }) => `
      <tr>
        <td>${item.Notes || item.Subcategory || item.Category || ''}</td>
        <td>${item.Category || ''}${item.Subcategory ? ' / ' + item.Subcategory : ''}</td>
        <td>${item.Account || ''}</td>
        <td>${Utils.frequencyLabel(item)}</td>
        <td>${next.toLocaleDateString()}</td>
        <td class="num">${Utils.fmtMoney(item.Amount)}</td>
      </tr>`).join('') ||
      `<tr><td colspan="6" class="muted">No recurring ${transactionType.toLowerCase()}s set up.</td></tr>`;
  }

  return { render };
})();