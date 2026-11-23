(() => {
  const { PLATFORMS, dayKey, fmtDuration, fmtClock, plural, mergeSettings } = self.Swipey;
  const { ORDER, stackedBars, niceSeconds, axisMinutes } = self.SwipeyCharts;
  const $ = (id) => document.getElementById(id);
  const VIEW_FORMS = ['ролик', 'ролика', 'роликов'];
  const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

  let tabId = null;
  let settings = null;

  async function renderStats() {
    const { days = {}, settings: stored } = await chrome.storage.local.get(['days', 'settings']);
    settings = mergeSettings(stored);

    const today = days[dayKey()] || {};
    let views = 0, seconds = 0;
    for (const b of Object.values(today)) { views += b.views; seconds += b.seconds; }
    $('todayViews').textContent = views;
    $('todayViewsWord').textContent = plural(views, VIEW_FORMS);
    $('todayTime').textContent = fmtDuration(seconds);

    $('platforms').replaceChildren(...ORDER.map((p) => {
      const b = today[p];
      const li = document.createElement('li');
      if (!b?.views && !b?.seconds) li.className = 'empty';
      li.innerHTML = `<span class="dot ${p}"></span><span>${PLATFORMS[p].name}</span>`
        + `<span class="num">${b?.views ?? 0}</span><span class="time">${fmtDuration(b?.seconds ?? 0)}</span>`;
      return li;
    }));

    const items = [];
    let weekSec = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = days[dayKey(d.getTime())] || {};
      const values = {};
      let v = 0;
      for (const p of ORDER) { values[p] = day[p]?.seconds || 0; v += day[p]?.views || 0; weekSec += values[p]; }
      items.push({
        label: i === 0 ? 'сег' : WEEKDAYS[d.getDay()],
        values,
        tip: () => {
          const total = ORDER.reduce((s, p) => s + values[p], 0);
          return `<b>${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</b><br>`
            + `${fmtDuration(total)} · ${v} ${plural(v, VIEW_FORMS)}`;
        },
      });
    }
    $('weekTotal').textContent = weekSec ? fmtDuration(weekSec) : '';
    stackedBars($('weekChart'), items, {
      height: 96, niceMax: niceSeconds, format: axisMinutes, ariaLabel: 'Время просмотра за 7 дней',
    });
  }

  async function getTabState() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
    if (tabId == null) return null;
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'getState' });
    } catch {
      return null; // не наш сайт или страницу открыли до установки расширения
    }
  }

  async function renderAuto() {
    const state = await getTabState();
    $('mode').value = settings.autoMode;
    const box = $('auto');
    const hint = $('autoHint');

    if (!state) {
      box.classList.add('disabled');
      $('autoStatus').textContent = '';
      hint.textContent = 'Откройте TikTok, YouTube Shorts или Instagram Reels. Если страница уже открыта, обновите её.';
      $('toggle').textContent = 'Включить';
      return;
    }
    if (!state.active) {
      box.classList.add('disabled');
      $('autoStatus').textContent = PLATFORMS[state.platform].name;
      hint.textContent = state.platform === 'youtube'
        ? 'Работает на страницах /shorts/.'
        : state.platform === 'instagram' ? 'Работает на страницах /reels/.' : 'Ролик на странице не найден.';
      return;
    }

    box.classList.remove('disabled');
    $('toggle').textContent = state.auto ? 'Выключить' : 'Включить';
    $('autoStatus').textContent = `в этой вкладке ${state.tab.views} · ${fmtClock(state.tab.seconds)}`;
    hint.textContent = state.auto && state.paused ? 'Пауза: вы листаете вручную.'
      : !state.auto && state.stopReason === 'limit' ? 'Остановлено: достигнут лимит.'
      : !state.auto && state.stopReason === 'stuck' ? 'Остановлено: не удалось перелистнуть. Сайт мог поменять вёрстку.'
      : '';
  }

  $('toggle').addEventListener('click', async () => {
    if (tabId == null) return;
    await chrome.tabs.sendMessage(tabId, { type: 'toggle-autoscroll' }).catch(() => {});
    renderAuto();
  });

  $('next').addEventListener('click', () => {
    if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'next-video' }).catch(() => {});
  });

  $('mode').addEventListener('change', async (e) => {
    settings = { ...settings, autoMode: e.target.value };
    await chrome.storage.local.set({ settings });
  });

  $('openStats').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/stats/stats.html') });
    window.close();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.days) renderStats();
  });

  renderStats().then(renderAuto);
  setInterval(renderAuto, 1000);
})();
