const Charts = (() => {

  if (typeof Chart === 'undefined') {
    console.error('Chart.js failed to load — check the <script> tag in index.html and your network connection.');
    // Return no-op stubs so pages don't throw ReferenceErrors; charts just won't render.
    const noop = () => null;
    return { pie: noop, bar: noop, line: noop };
  }

  // Datalabels plugin is optional — if the CDN failed, charts still work,
  // they just fall back to hover-only tooltips.
  const hasDataLabels = typeof ChartDataLabels !== 'undefined';
  if (hasDataLabels) Chart.register(ChartDataLabels);

  Chart.defaults.color = '#8B93A8'; // matches --text-muted
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.09)'; // matches --border

  const instances = new Map();

  function destroy(canvasId) {
    const existing = instances.get(canvasId);
    if (existing) existing.destroy();
  }

  function pie(canvasId, labels, values) {
    destroy(canvasId);
    const el = document.getElementById(canvasId);
    if (!el) return null;
    const ctx = el.getContext('2d');
    const colors = labels.map((_, i) => Utils.colorFor(i));
    const total = values.reduce((a, b) => a + b, 0);

    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: '#10131d', borderWidth: 2 }] },
      plugins: hasDataLabels ? [ChartDataLabels] : [],
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => `${c.label}: ${Utils.fmtMoney(c.raw)}` } },
          datalabels: hasDataLabels ? {
            color: '#F2F4F9',
            font: { size: 11, weight: '600' },
            textAlign: 'center',
            formatter: (value) => {
              if (!total) return '';
              const pct = (value / total) * 100;
              if (pct < 4) return ''; // avoid clutter on tiny slices
              return `${pct.toFixed(1)}%\n${Utils.fmtCompact(value)}`;
            }
          } : false
        },
        cutout: '60%'
      }
    });
    instances.set(canvasId, chart);
    return chart;
  }

  function bar(canvasId, labels, values, color = '#0A84FF', horizontal = false) {
    destroy(canvasId);
    const el = document.getElementById(canvasId);
    if (!el) return null;
    const ctx = el.getContext('2d');
    const colors = Array.isArray(color) ? color : labels.map(() => color);

    const chart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4, maxBarThickness: 28 }] },
      plugins: hasDataLabels ? [ChartDataLabels] : [],
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => Utils.fmtMoney(c.raw) } },
          datalabels: hasDataLabels ? {
            color: '#8B93A8',
            font: { size: 10, weight: '600' },
            anchor: horizontal ? 'end' : 'end',
            align: horizontal ? 'end' : 'top',
            formatter: (value) => Utils.fmtCompact(value)
          } : false
        },
        scales: {
          x: { grid: { display: horizontal }, ticks: { font: { size: 11 } } },
          y: { grid: { display: !horizontal }, ticks: { font: { size: 11 }, callback: (v) => horizontal ? undefined : Utils.fmtCompact(v) } }
        }
      }
    });
    instances.set(canvasId, chart);
    return chart;
  }

  function line(canvasId, labels, datasets) {
    destroy(canvasId);
    const el = document.getElementById(canvasId);
    if (!el) return null;
    const ctx = el.getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: datasets.map(d => ({
          label: d.label, data: d.data, borderColor: d.color, backgroundColor: d.color,
          tension: 0.3, pointRadius: 3, pointHoverRadius: 5, fill: false, borderWidth: 2
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', align: 'end', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${Utils.fmtMoney(c.raw)}` } },
          datalabels: false
        },
        scales: {
          x: { ticks: { font: { size: 11 } } },
          y: { ticks: { font: { size: 11 }, callback: (v) => Utils.fmtCompact(v) } }
        }
      }
    });
    instances.set(canvasId, chart);
    return chart;
  }

  return { pie, bar, line };
})();