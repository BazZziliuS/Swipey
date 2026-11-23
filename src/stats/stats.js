(() => {
  const { PLATFORMS, dayKey, parseDayKey, fmtDuration, plural, mergeSettings, DEFAULT_SETTINGS } = self.Swipey;
  const { ORDER, stackedBars, niceSeconds, axisMinutes, showTip, hideTip } = self.SwipeyCharts;
  const $ = (id) => document.getElementById(id);
  const VIEW_FORMS = ['ролик', 'ролика', 'роликов'];
  const WD_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  let data = { days: {}, sessions: [], settings: mergeSettings() };
  let period = 'day';

  // ---------- вкладки ----------
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
    if (b.dataset.tab === 'stats') renderStats();
  }));

  $('period').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-period]');
    if (!b) return;
    period = b.dataset.period;
    document.querySelectorAll('#period button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    renderStats();
  });

  async function load() {
    const s = await chrome.storage.local.get(['days', 'sessions', 'settings']);
    data = { days: s.days || {}, sessions: s.sessions || [], settings: mergeSettings(s.settings) };
  }

  // ---------- период ----------
  function rangeDays() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let count;
    if (period === 'day') count = 1;
    else if (period === 'week') count = 7;
    else if (period === 'month') count = 30;
    else {
      const keys = Object.keys(data.days).sort();
      const first = keys.length ? parseDayKey(keys[0]) : today;
      count = Math.max(1, Math.round((today - first) / 86400000) + 1);
    }
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      out.push(d);
    }
    return out;
  }

  function sumBuckets(dates) {
    const per = {};
    for (const p of ORDER) per[p] = { views: 0, skips: 0, completed: 0, ads: 0, seconds: 0 };
    for (const d of dates) {
      const day = data.days[dayKey(d.getTime())];
      if (!day) continue;
      for (const p of ORDER) {
        const b = day[p];
        if (!b) continue;
        for (const f of Object.keys(per[p])) per[p][f] += b[f] || 0;
      }
    }
    const total = { views: 0, skips: 0, completed: 0, ads: 0, seconds: 0 };
    for (const p of ORDER) for (const f of Object.keys(total)) total[f] += per[p][f];
    return { per, total };
  }

  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + '%' : '—');
  const avg = (sec, n) => (n > 0 ? `${(sec / n).toFixed(1).replace('.', ',')} с` : '—');

  // ---------- отрисовка ----------
  function renderStats() {
    const dates = rangeDays();
    const { per, total } = sumBuckets(dates);

    renderKpis(total);
    renderMainChart(dates);
    renderPlatformTable(per);
    renderHeatmap(dates);
    renderSessions(dates[0]);
  }

  function renderKpis(t) {
    const tiles = [
      ['Просмотрено', t.views, t.ads ? `ещё ${t.ads} рекламы` : plural(t.views, VIEW_FORMS)],
      ['Время', fmtDuration(t.seconds), 'по позиции в ролике'],
      ['Среднее на ролик', avg(t.seconds, t.views), ''],
      ['Досмотрено', pct(t.completed, t.views), `${t.completed} из ${t.views}`],
      ['Пропущено', pct(t.skips, t.views + t.skips), `меньше ${String(data.settings.viewThreshold).replace('.', ',')} с`],
    ];
    $('kpis').innerHTML = tiles.map(([l, v, s]) =>
      `<div class="kpi"><div class="k-label">${l}</div><div class="k-value">${v}</div><div class="k-sub">${s}</div></div>`).join('');
  }

  function tipFor(title, values, views) {
    const total = ORDER.reduce((s, p) => s + (values[p] || 0), 0);
    let html = `<b>${title}</b> · ${fmtDuration(total)}`;
    if (views != null) html += ` · ${views} ${plural(views, VIEW_FORMS)}`;
    for (const p of ORDER) if (values[p] > 0) html += `<br>${PLATFORMS[p].name}: ${fmtDuration(values[p])}`;
    return html;
  }

  function renderMainChart(dates) {
    const box = $('mainChart');
    let items;

    if (period === 'day') {
      $('chartTitle').textContent = 'Время по часам';
      const day = data.days[dayKey(dates[0].getTime())] || {};
      items = Array.from({ length: 24 }, (_, h) => {
        const values = {};
        for (const p of ORDER) values[p] = day[p]?.byHour?.[h] || 0;
        return { label: String(h), values, tip: () => tipFor(`${h}:00–${h + 1}:00`, values) };
      });
      stackedBars(box, items, { height: 200, niceMax: niceSeconds, format: axisMinutes, labelEvery: 3, ariaLabel: 'Время по часам' });
      return;
    }

    if (dates.length > 62) {
      $('chartTitle').textContent = 'Время по месяцам';
      const map = new Map();
      for (const d of dates) {
        const k = `${d.getFullYear()}-${d.getMonth()}`;
        if (!map.has(k)) map.set(k, { d, values: { tiktok: 0, youtube: 0, instagram: 0 }, views: 0 });
        const m = map.get(k);
        const day = data.days[dayKey(d.getTime())] || {};
        for (const p of ORDER) { m.values[p] += day[p]?.seconds || 0; m.views += day[p]?.views || 0; }
      }
      items = [...map.values()].map((m) => ({
        label: MONTHS[m.d.getMonth()],
        values: m.values,
        tip: () => tipFor(`${MONTHS[m.d.getMonth()]} ${m.d.getFullYear()}`, m.values, m.views),
      }));
    } else {
      $('chartTitle').textContent = 'Время по дням';
      items = dates.map((d) => {
        const day = data.days[dayKey(d.getTime())] || {};
        const values = {};
        let views = 0;
        for (const p of ORDER) { values[p] = day[p]?.seconds || 0; views += day[p]?.views || 0; }
        const label = dates.length <= 7 ? WD_SHORT[(d.getDay() + 6) % 7] : String(d.getDate());
        const title = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
        return { label, values, tip: () => tipFor(title, values, views) };
      });
    }
    stackedBars(box, items, {
      height: 200, niceMax: niceSeconds, format: axisMinutes,
      labelEvery: items.length > 14 ? Math.ceil(items.length / 10) : 1,
      ariaLabel: $('chartTitle').textContent,
    });
  }

  function renderPlatformTable(per) {
    const rows = ORDER.map((p) => {
      const b = per[p];
      return `<tr>
        <td><span class="name"><i class="dot ${p}"></i>${PLATFORMS[p].name}</span></td>
        <td class="r">${b.views}</td>
        <td class="r">${fmtDuration(b.seconds)}</td>
        <td class="r">${avg(b.seconds, b.views)}</td>
        <td class="r">${pct(b.completed, b.views)}</td>
      </tr>`;
    }).join('');
    $('platformTable').innerHTML = `<thead><tr><th></th><th class="r">Роликов</th><th class="r">Время</th><th class="r">Среднее</th><th class="r">Досмотрено</th></tr></thead><tbody>${rows}</tbody>`;
  }

  function renderHeatmap(dates) {
    const card = $('heatCard');
    card.hidden = period === 'day';
    if (card.hidden) return;

    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const d of dates) {
      const day = data.days[dayKey(d.getTime())];
      if (!day) continue;
      const wd = (d.getDay() + 6) % 7;
      for (const p of ORDER) {
        const bh = day[p]?.byHour;
        if (bh) for (let h = 0; h < 24; h++) grid[wd][h] += bh[h] || 0;
      }
    }
    const max = Math.max(...grid.flat());

    const box = $('heatmap');
    box.replaceChildren();
    const add = (cls, text = '') => {
      const e = document.createElement('div');
      e.className = cls; e.textContent = text;
      box.appendChild(e);
      return e;
    };
    add('');
    for (let h = 0; h < 24; h++) add('cl', h % 6 === 0 ? String(h) : '');
    for (let wd = 0; wd < 7; wd++) {
      add('rl', WD_SHORT[wd]);
      for (let h = 0; h < 24; h++) {
        const v = grid[wd][h];
        const lvl = v <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((v / max) * 4));
        const c = add('cell');
        c.style.background = `var(--heat-${lvl})`;
        c.addEventListener('mousemove', (e) => showTip(`<b>${WD_SHORT[wd]}, ${h}:00–${h + 1}:00</b><br>${fmtDuration(v)}`, e.clientX, e.clientY));
        c.addEventListener('mouseleave', hideTip);
      }
    }
  }

  function renderSessions(fromDate) {
    const from = fromDate.getTime();
    const list = data.sessions.filter((s) => s.end >= from).slice(-50).reverse();
    $('gapLabel').textContent = fmtDuration(data.settings.sessionGap);
    if (!list.length) {
      $('sessionTable').innerHTML = '<tbody><tr><td class="faint">Пока нет сессий за этот период.</td></tr></tbody>';
      return;
    }
    const rows = list.map((s) => {
      const start = new Date(s.start);
      const when = start.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const dots = ORDER.filter((p) => s.platforms[p] > 0).map((p) => `<i class="dot ${p}" title="${PLATFORMS[p].name}"></i>`).join(' ');
      return `<tr>
        <td>${when}</td>
        <td>${dots}</td>
        <td class="r">${fmtDuration((s.end - s.start) / 1000)}</td>
        <td class="r">${s.views}</td>
        <td class="r">${fmtDuration(s.seconds)}</td>
      </tr>`;
    }).join('');
    $('sessionTable').innerHTML = `<thead><tr><th>Начало</th><th></th><th class="r">Длилась</th><th class="r">Роликов</th><th class="r">Время роликов</th></tr></thead><tbody>${rows}</tbody>`;
  }

  // ---------- настройки ----------
  const form = $('settingsForm');

  function fillForm() {
    const s = data.settings;
    const f = form.elements;
    for (const k of ['autoMode', 'timerSec', 'randomMin', 'randomMax', 'limitViews', 'limitMinutes', 'manualPause', 'viewThreshold']) {
      f[k].value = s[k];
    }
    f.skipAds.checked = s.skipAds;
    f.debug.checked = s.debug;
    f.completePct.value = Math.round(s.completeRatio * 100);
    f.sessionGapMin.value = Math.round(s.sessionGap / 60);
    for (const p of ORDER) f['p_' + p].checked = s.platforms[p] !== false;
    syncModeFields();
  }

  function syncModeFields() {
    const mode = form.elements.autoMode.value;
    form.querySelectorAll('[data-show]').forEach((el) => { el.hidden = el.dataset.show !== mode; });
  }

  const num = (v, fallback, min, max) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  let saveTimer = null;
  form.addEventListener('input', () => {
    syncModeFields();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveForm, 300);
  });

  async function saveForm() {
    const f = form.elements;
    const D = DEFAULT_SETTINGS;
    const settings = {
      ...data.settings,
      autoMode: f.autoMode.value,
      timerSec: num(f.timerSec.value, D.timerSec, 1, 600),
      randomMin: num(f.randomMin.value, D.randomMin, 1, 600),
      randomMax: num(f.randomMax.value, D.randomMax, 1, 600),
      limitViews: Math.round(num(f.limitViews.value, 0, 0, 10000)),
      limitMinutes: Math.round(num(f.limitMinutes.value, 0, 0, 1440)),
      manualPause: num(f.manualPause.value, D.manualPause, 0, 120),
      skipAds: f.skipAds.checked,
      debug: f.debug.checked,
      viewThreshold: num(f.viewThreshold.value, D.viewThreshold, 0.5, 30),
      completeRatio: num(f.completePct.value, 90, 50, 100) / 100,
      sessionGap: Math.round(num(f.sessionGapMin.value, 5, 1, 120)) * 60,
      platforms: Object.fromEntries(ORDER.map((p) => [p, f['p_' + p].checked])),
    };
    data.settings = settings;
    await chrome.storage.local.set({ settings });
    $('saved').textContent = 'Сохранено';
    setTimeout(() => { $('saved').textContent = ''; }, 1500);
  }

  $('showOverlays').addEventListener('click', async () => {
    const { overlay = {} } = await chrome.storage.local.get('overlay');
    overlay.hidden = {};
    await chrome.storage.local.set({ overlay });
    $('saved').textContent = 'Плашки вернутся после обновления вкладок';
  });

  // ---------- данные ----------
  const msg = (t) => { $('dataMsg').textContent = t; };

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('exportJson').addEventListener('click', async () => {
    await load();
    const payload = { app: 'swipey', version: 1, exportedAt: new Date().toISOString(), ...data };
    download(`swipey-${dayKey()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  });

  $('exportCsv').addEventListener('click', async () => {
    await load();
    const lines = ['date,platform,views,skips,completed,ads,seconds'];
    for (const key of Object.keys(data.days).sort()) {
      for (const p of ORDER) {
        const b = data.days[key][p];
        if (b) lines.push([key, p, b.views, b.skips, b.completed, b.ads, Math.round(b.seconds)].join(','));
      }
    }
    download(`swipey-${dayKey()}.csv`, lines.join('\n'), 'text/csv');
  });

  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (!json || typeof json.days !== 'object' || Array.isArray(json.days)) throw new Error('нет поля days');
      const next = { days: json.days, sessions: Array.isArray(json.sessions) ? json.sessions : [] };
      if (json.settings) next.settings = mergeSettings(json.settings);
      await chrome.storage.local.set(next);
      await load();
      fillForm();
      renderStats();
      msg(`Импортировано дней: ${Object.keys(json.days).length}.`);
    } catch (err) {
      msg(`Не удалось импортировать: ${err.message}`);
    }
  });

  // Сброс в два нажатия, без системного диалога.
  let resetArmed = null;
  $('resetBtn').addEventListener('click', async () => {
    const b = $('resetBtn');
    if (!resetArmed) {
      b.textContent = 'Точно сбросить? Нажмите ещё раз';
      resetArmed = setTimeout(() => { resetArmed = null; b.textContent = 'Сбросить статистику'; }, 4000);
      return;
    }
    clearTimeout(resetArmed);
    resetArmed = null;
    b.textContent = 'Сбросить статистику';
    await chrome.storage.local.set({ days: {}, sessions: [] });
    await load();
    renderStats();
    msg('Статистика сброшена. Настройки остались.');
  });

  // ---------- старт ----------
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || (!changes.days && !changes.sessions)) return;
    await load();
    if (!document.querySelector('[data-panel="stats"]').hidden) renderStats();
  });

  let resizeTimer;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderStats, 150); });

  load().then(() => { fillForm(); renderStats(); });
})();
