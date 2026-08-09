const Utils = (() => {

  const MONTH_NAMES = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];

  // Currency symbols to prefix amounts with, keyed by CONFIG.CURRENCY.
  // Deliberately NOT using Intl's style:'currency' formatting — in the
  // en-US locale Intl renders MYR as the literal string "MYR" rather than
  // "RM", which is noticeably wider than every card/table in this app was
  // designed around and was the main cause of amounts overflowing their
  // containers. Formatting the number ourselves and prepending a short,
  // fixed symbol keeps widths predictable everywhere.
  const CURRENCY_SYMBOLS = { MYR: 'RM', USD: '$', SGD: 'S$', EUR: '€', GBP: '£' };

  function currencySymbol() {
    return CURRENCY_SYMBOLS[CONFIG.CURRENCY] || CONFIG.CURRENCY + ' ';
  }

  function fmtMoney(n) {
    const val = Number(n) || 0;
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Math.abs(val));
    const sign = val < 0 ? '-' : '';
    return `${sign}${currencySymbol()}${formatted}`;
  }

  function fmtCompact(n) {
    const val = Number(n) || 0;
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(val);
  }

  // Parses a Timestamp string (ISO or sheet date) into {year, month(0-11)}
  function monthKeyOf(timestamp) {
    const d = new Date(timestamp);
    if (isNaN(d)) return null;
    return { year: d.getFullYear(), month: d.getMonth(), date: d };
  }

  function monthLabel(year, month) {
    return `${MONTH_NAMES[month]} ${year}`;
  }

  // yyyy-mm-dd for populating <input type="date"> when editing a transaction.
  function toDateInputValue(timestamp) {
    const d = new Date(timestamp);
    if (isNaN(d)) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Builds the list of distinct year-month options present in transactions,
  // most recent first, plus an "All months" option.
  function buildMonthOptions(transactions) {
    const seen = new Map();
    transactions.forEach(t => {
      const k = monthKeyOf(t.Timestamp);
      if (!k) return;
      const key = `${k.year}-${k.month}`;
      if (!seen.has(key)) seen.set(key, k);
    });
    const list = [...seen.values()].sort((a, b) => (b.year - a.year) || (b.month - a.month));
    return list.map(k => ({ value: `${k.year}-${k.month}`, label: monthLabel(k.year, k.month), year: k.year, month: k.month }));
  }

  function filterByMonth(transactions, monthValue) {
    if (!monthValue || monthValue === 'all') return transactions;
    const [year, month] = monthValue.split('-').map(Number);
    return transactions.filter(t => {
      const k = monthKeyOf(t.Timestamp);
      return k && k.year === year && k.month === month;
    });
  }

  function sumBy(items, keyFn, valueFn) {
    const map = new Map();
    items.forEach(item => {
      const key = keyFn(item);
      const val = valueFn(item);
      map.set(key, (map.get(key) || 0) + val);
    });
    return map;
  }

  function sortMapDesc(map) {
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  // Distinct, pleasant chart palette derived from the app's theme —
  // blue/cyan/purple family, echoing --accent, --accent-2, and --wants.
  const CHART_PALETTE = ['#0A84FF','#64D2FF','#BF5AF2','#5E9EFF','#8A7FFF',
    '#37C9E1','#A46EFF','#4FA8E0','#7C5CFF','#5ED1E8'];

  function colorFor(index) {
    return CHART_PALETTE[index % CHART_PALETTE.length];
  }

  // ---------- Recurring transactions ----------

  const FREQUENCY_LABELS = {
    daily: 'Daily',
    weekly: 'Weekly',
    biweekly: 'Every 2 weeks',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    yearly: 'Yearly',
    annually: 'Yearly'
  };

  // Small inline icon set for editable-table row actions (Expenses/Income).
  // Same stroke style as the existing #balanceVisibilityIcon in index.html
  // (viewBox 0 0 24 24, stroke=currentColor, stroke-width 1.8) so icon
  // buttons read as part of the same visual language.
  const ICONS = {
    edit: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    delete: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    save: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    cancel: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  function frequencyLabel(item) {
    const freq = String(item.Frequency || '').toLowerCase().trim();
    if (freq === 'custom') {
      const days = Number(item.CustomIntervalDays) || 0;
      return days ? `Every ${days} day${days === 1 ? '' : 's'}` : 'Custom';
    }
    return FREQUENCY_LABELS[freq] || (item.Frequency || 'Unknown');
  }

  // Advances a date by one occurrence of the given frequency.
  function addInterval(date, freq, customDays) {
    const d = new Date(date);
    switch (freq) {
      case 'daily': d.setDate(d.getDate() + 1); break;
      case 'weekly': d.setDate(d.getDate() + 7); break;
      case 'biweekly': d.setDate(d.getDate() + 14); break;
      case 'monthly': d.setMonth(d.getMonth() + 1); break;
      case 'quarterly': d.setMonth(d.getMonth() + 3); break;
      case 'yearly':
      case 'annually': d.setFullYear(d.getFullYear() + 1); break;
      case 'custom': d.setDate(d.getDate() + (Number(customDays) || 30)); break;
      default: d.setMonth(d.getMonth() + 1);
    }
    return d;
  }

  // Returns the next occurrence date on/after refDate, or null if the
  // recurrence has an End Date that has already passed.
  function computeNextOccurrence(item, refDate = new Date()) {
    const freq = String(item.Frequency || '').toLowerCase().trim();
    const start = new Date(item.StartDate);
    if (isNaN(start)) return null;
    const end = item.EndDate ? new Date(item.EndDate) : null;

    let cursor = new Date(start);
    // Fast-forward from Last Processed if it's later than Start Date.
    if (item.LastProcessed) {
      const last = new Date(item.LastProcessed);
      if (!isNaN(last) && last > cursor) {
        cursor = addInterval(last, freq, item.CustomIntervalDays);
      }
    }

    let guard = 0;
    while (cursor < refDate && guard < 1000) {
      cursor = addInterval(cursor, freq, item.CustomIntervalDays);
      guard++;
    }

    if (end && !isNaN(end) && cursor > end) return null;
    return cursor;
  }

  // Rough monthly-equivalent value for a recurring item, used to total up
  // a mix of weekly/monthly/yearly/etc. items into a single "per month" figure.
  function monthlyEquivalent(item) {
    const freq = String(item.Frequency || '').toLowerCase().trim();
    const amount = Number(item.Amount) || 0;
    switch (freq) {
      case 'daily': return amount * 30;
      case 'weekly': return amount * 4.33;
      case 'biweekly': return amount * 2.17;
      case 'monthly': return amount;
      case 'quarterly': return amount / 3;
      case 'yearly':
      case 'annually': return amount / 12;
      case 'custom': {
        const days = Number(item.CustomIntervalDays) || 30;
        return amount * (30 / days);
      }
      default: return amount;
    }
  }

  // ---------- Pagination ----------

  // pageSize may be a number, or the string 'all'
  function paginate(items, page, pageSize) {
    if (pageSize === 'all' || !pageSize) return items;
    const start = (Math.max(1, page) - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }

  // Renders "Showing X-Y of Z" + prev/next controls into `container`.
  // onPage(newPage) is called when the user clicks prev/next.
  function renderPagination(container, total, page, pageSize, onPage) {
    if (!container) return;

    if (pageSize === 'all') {
      container.innerHTML = `<span class="muted">Showing all ${total} transactions</span>`;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(total, currentPage * pageSize);

    container.innerHTML = `
      <span class="muted">Showing ${start}–${end} of ${total}</span>
      <div class="pagination-btns">
        <button class="page-btn" data-dir="prev" ${currentPage <= 1 ? 'disabled' : ''}>‹ Prev</button>
        <span class="page-indicator">Page ${currentPage} of ${totalPages}</span>
        <button class="page-btn" data-dir="next" ${currentPage >= totalPages ? 'disabled' : ''}>Next ›</button>
      </div>`;

    const prevBtn = container.querySelector('[data-dir="prev"]');
    const nextBtn = container.querySelector('[data-dir="next"]');
    if (prevBtn) prevBtn.addEventListener('click', () => onPage(currentPage - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => onPage(currentPage + 1));
  }

  return {
    MONTH_NAMES, fmtMoney, fmtCompact, monthKeyOf, monthLabel, toDateInputValue,
    buildMonthOptions, filterByMonth, sumBy, sortMapDesc, colorFor, ICONS,
    paginate, renderPagination,
    frequencyLabel, computeNextOccurrence, monthlyEquivalent
  };
})();