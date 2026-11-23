// Небольшие SVG-графики без зависимостей.
(() => {
  const ORDER = ['tiktok', 'youtube', 'instagram'];
  const NS = 'http://www.w3.org/2000/svg';

  let tipEl = null;
  function tip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'tip';
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function showTip(html, x, y) {
    const t = tip();
    t.innerHTML = html;
    t.classList.add('show');
    const r = t.getBoundingClientRect();
    let left = x + 12, top = y - r.height - 8;
    if (left + r.width > innerWidth - 4) left = x - r.width - 12;
    if (top < 4) top = y + 14;
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  }
  function hideTip() { tipEl?.classList.remove('show'); }

  // Все элементы графика по умолчанию прозрачны для мыши: события ловят только зоны наведения.
  const el = (name, attrs = {}) => {
    const n = document.createElementNS(NS, name);
    n.setAttribute('pointer-events', 'none');
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  // Путь столбика со скруглённым верхом, нижние углы прямые (опираются на ось).
  function topRounded(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  /**
   * Столбики с разбивкой по платформам.
   * items: [{ label, values: {tiktok, youtube, instagram}, tip: (item) => html }]
   * opts: { height, format(v) — подпись оси, labelEvery }
   */
  function stackedBars(container, items, opts = {}) {
    const width = container.clientWidth || 300;
    const height = opts.height ?? 120;
    const padL = opts.axis === false ? 0 : 36, padB = 18, padT = 6;
    const plotW = width - padL, plotH = height - padB - padT;

    const totals = items.map((it) => ORDER.reduce((s, p) => s + (it.values[p] || 0), 0));
    const max = Math.max(...totals, 0);
    const niceMax = opts.niceMax ? opts.niceMax(max) : max || 1;

    const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
    svg.style.display = 'block';
    if (opts.ariaLabel) svg.setAttribute('aria-label', opts.ariaLabel);

    if (opts.axis !== false) {
      for (const f of [0, 0.5, 1]) {
        const y = padT + plotH - plotH * f;
        svg.appendChild(el('line', { x1: padL, x2: width, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }));
        const t = el('text', { x: padL - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--text-3)' });
        t.textContent = opts.format ? opts.format(niceMax * f) : Math.round(niceMax * f);
        svg.appendChild(t);
      }
    }

    const n = items.length;
    const slot = plotW / Math.max(n, 1);
    const barW = Math.max(2, Math.min(28, slot * 0.7));
    const labelEvery = opts.labelEvery ?? 1;
    const GAP = 2;

    items.forEach((it, i) => {
      const cx = padL + slot * i + slot / 2;
      const x = cx - barW / 2;
      let yCursor = padT + plotH;
      const segs = ORDER.filter((p) => it.values[p] > 0);
      segs.forEach((p, si) => {
        const h = (it.values[p] / niceMax) * plotH;
        const isTop = si === segs.length - 1;
        const drawH = Math.max(0, h - (si > 0 ? GAP : 0));
        // Над нижним сегментом оставляем зазор 2px цвета фона.
        const y = yCursor - h;
        const shape = isTop
          ? el('path', { d: topRounded(x, y, barW, drawH, 4), fill: `var(--${p})` })
          : el('rect', { x, y, width: barW, height: drawH, fill: `var(--${p})` });
        svg.appendChild(shape);
        yCursor -= h;
      });

      if (i % labelEvery === 0 || i === n - 1) {
        const t = el('text', { x: cx, y: height - 4, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--text-3)' });
        t.textContent = it.label;
        svg.appendChild(t);
      }

      // Зона наведения: весь столбец целиком, включая подпись под осью.
      const hit = el('rect', { x: padL + slot * i, y: 0, width: slot, height, fill: 'transparent', 'pointer-events': 'all' });
      hit.addEventListener('mousemove', (e) => {
        hit.setAttribute('fill', 'var(--grid)');
        hit.setAttribute('fill-opacity', '0.5');
        showTip(it.tip ? it.tip(it) : it.label, e.clientX, e.clientY);
      });
      hit.addEventListener('mouseleave', () => { hit.setAttribute('fill', 'transparent'); hideTip(); });
      svg.insertBefore(hit, svg.firstChild);
    });

    container.replaceChildren(svg);
  }

  // Округление максимума оси до «красивого» числа минут.
  function niceSeconds(max) {
    const steps = [60, 120, 300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200, 10800, 14400, 21600, 28800, 43200];
    return steps.find((s) => s >= max) ?? Math.ceil(max / 3600) * 3600;
  }

  function axisMinutes(sec) {
    if (sec === 0) return '0';
    if (sec >= 3600 && sec % 1800 === 0) return `${+(sec / 3600).toFixed(1)}ч`;
    return `${Math.round(sec / 60)}м`;
  }

  self.SwipeyCharts = { ORDER, stackedBars, niceSeconds, axisMinutes, showTip, hideTip };
})();
