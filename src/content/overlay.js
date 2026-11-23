// Плашка поверх страницы. Shadow DOM, чтобы стили сайта её не трогали.
(() => {
  const { fmtClock } = self.Swipey;

  const ICONS = {
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z" fill="currentColor"/></svg>',
    next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l6 4-6 4z M11 4h1.6v8H11z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  };

  const MODE_LABEL = { end: 'до конца', timer: 'по таймеру', random: 'случайно' };

  const CSS = `
    :host { all: initial; }
    .bar {
      position: fixed; z-index: 2147483646;
      display: flex; align-items: center; gap: 10px;
      padding: 6px 6px 6px 12px;
      background: rgba(18, 18, 17, 0.82);
      color: #f0efec;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      font: 500 12px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-variant-numeric: tabular-nums;
      backdrop-filter: blur(8px);
      user-select: none;
      cursor: grab;
      touch-action: none;
    }
    .bar.dragging { cursor: grabbing; }
    .stats { display: flex; flex-direction: column; gap: 2px; min-width: 92px; }
    .main { font-size: 13px; font-weight: 600; }
    .sub { color: #a9a8a2; font-weight: 400; }
    .sub.on { color: #6fd3a8; }
    .sub.warn { color: #f0b35a; }
    .dbg {
      color: #8d8c85; font: 400 11px/1.3 ui-monospace, Consolas, monospace;
      max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .btns { display: flex; gap: 2px; }
    button {
      all: unset; box-sizing: border-box;
      width: 28px; height: 28px; border-radius: 7px;
      display: grid; place-items: center;
      color: #d8d7d2; cursor: pointer;
    }
    button:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
    button:focus-visible { outline: 2px solid #3987e5; outline-offset: 1px; }
    button svg { width: 14px; height: 14px; }
    button.close svg { width: 12px; height: 12px; }
  `;

  class Overlay {
    constructor(platform, handlers) {
      this.platform = platform;
      this.handlers = handlers;
      this.visible = false;
      this.hidden = false;   // скрыта пользователем на этом сайте
      this.pos = null;

      this.host = document.createElement('div');
      this.host.id = 'swipey-overlay';
      const root = this.host.attachShadow({ mode: 'closed' });
      root.innerHTML = `
        <style>${CSS}</style>
        <div class="bar" part="bar">
          <div class="stats">
            <div class="main"></div>
            <div class="sub"></div>
            <div class="dbg" hidden></div>
          </div>
          <div class="btns">
            <button class="toggle" title="Автопрокрутка (Alt+S)"></button>
            <button class="next" title="Следующий ролик (Alt+N)">${ICONS.next}</button>
            <button class="close" title="Скрыть плашку (Alt+H)">${ICONS.close}</button>
          </div>
        </div>`;
      this.bar = root.querySelector('.bar');
      this.mainEl = root.querySelector('.main');
      this.subEl = root.querySelector('.sub');
      this.dbgEl = root.querySelector('.dbg');
      this.toggleBtn = root.querySelector('.toggle');

      this.toggleBtn.addEventListener('click', () => handlers.onToggle());
      root.querySelector('.next').addEventListener('click', () => handlers.onNext());
      root.querySelector('.close').addEventListener('click', () => this.setHidden(true));
      // Клики по плашке не должны долетать до сайта.
      for (const t of ['click', 'pointerdown', 'wheel', 'keydown']) {
        this.bar.addEventListener(t, (e) => e.stopPropagation());
      }
      this.initDrag();
      addEventListener('resize', () => this.applyPos());
    }

    async load() {
      const { overlay } = await chrome.storage.local.get('overlay');
      this.hidden = !!overlay?.hidden?.[this.platform];
      this.pos = overlay?.pos?.[this.platform] ?? null;
      this.applyPos();
    }

    async save() {
      const { overlay = {} } = await chrome.storage.local.get('overlay');
      overlay.hidden = { ...(overlay.hidden || {}), [this.platform]: this.hidden };
      overlay.pos = { ...(overlay.pos || {}), [this.platform]: this.pos };
      await chrome.storage.local.set({ overlay });
    }

    setHidden(hidden) {
      this.hidden = hidden;
      this.sync();
      this.save();
    }

    toggleHidden() { this.setHidden(!this.hidden); }

    setPageActive(active) {
      this.visible = active;
      this.sync();
    }

    sync() {
      const show = this.visible && !this.hidden;
      if (show && !this.host.isConnected) document.documentElement.appendChild(this.host);
      if (!show && this.host.isConnected) this.host.remove();
    }

    render(tracker, scroller) {
      if (!this.host.isConnected) return;
      this.anchorTo(tracker.cur?.video ?? tracker.pickActive());
      const { views, seconds } = tracker.tab;
      this.mainEl.textContent = `${views} · ${fmtClock(seconds)}`;

      const mode = MODE_LABEL[scroller.getSettings().autoMode];
      let sub = 'Авто выкл', cls = '';
      if (scroller.enabled) {
        sub = scroller.isPaused ? 'Авто: пауза' : `Авто: ${mode}`;
        cls = scroller.isPaused ? 'warn' : 'on';
      } else if (scroller.stopReason === 'limit') {
        sub = 'Лимит достигнут'; cls = 'warn';
      } else if (scroller.stopReason === 'stuck') {
        sub = 'Не листается'; cls = 'warn';
      }
      this.subEl.textContent = sub;
      this.subEl.className = 'sub ' + cls;

      // Отладка: ID ролика, позиция и как сработало последнее перелистывание.
      this.dbgEl.hidden = !self.Swipey.debug;
      if (self.Swipey.debug) {
        const c = tracker.cur;
        const id = c ? (c.id.length > 18 ? '…' + c.id.slice(-16) : c.id) : 'нет ролика';
        const dur = c && Number.isFinite(c.video.duration) ? c.video.duration.toFixed(1) : '?';
        const pos = c ? `${c.played.toFixed(1)}/${dur}с${c.loops ? ' ↻' + c.loops : ''}${c.ad ? ' реклама' : ''}` : '';
        this.dbgEl.textContent = `${id} ${pos} · ${scroller.lastMethod ?? '—'}`;
        this.dbgEl.title = c ? c.id : '';
      }

      const icon = scroller.enabled ? 'pause' : 'play';
      if (this.toggleBtn.dataset.icon !== icon) {
        this.toggleBtn.innerHTML = ICONS[icon];
        this.toggleBtn.dataset.icon = icon;
      }
    }

    // По умолчанию плашка стоит справа от ролика, на уровне его верхнего края:
    // справа внизу у всех трёх сайтов колонка лайков и комментариев.
    anchorTo(video) {
      if (this.pos || !video) return;
      const r = video.getBoundingClientRect();
      const w = this.bar.offsetWidth || 220;
      const GAP = 12;
      let x = r.right + GAP;
      // Справа не помещается: прижимаем к правому краю внутри ролика.
      if (x + w > innerWidth - 8) x = Math.max(8, r.right - w - GAP);
      const y = Math.max(8, r.top + GAP);
      if (this.auto && Math.abs(this.auto.x - x) < 1 && Math.abs(this.auto.y - y) < 1) return;
      this.auto = { x, y };
      this.applyPos();
    }

    applyPos() {
      const s = this.bar.style;
      const p = this.pos ?? this.auto;
      if (!p) {
        s.right = '16px'; s.top = '80px'; s.left = 'auto'; s.bottom = 'auto';
        return;
      }
      const w = this.bar.offsetWidth || 220;
      const h = this.bar.offsetHeight || 44;
      const x = Math.min(Math.max(0, p.x), innerWidth - w);
      const y = Math.min(Math.max(0, p.y), innerHeight - h);
      s.left = x + 'px'; s.top = y + 'px'; s.right = 'auto'; s.bottom = 'auto';
    }

    initDrag() {
      let start = null;
      this.bar.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.composedPath().some((n) => n.tagName === 'BUTTON')) return;
        const r = this.bar.getBoundingClientRect();
        start = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        this.bar.setPointerCapture(e.pointerId);
        this.bar.classList.add('dragging');
      });
      this.bar.addEventListener('pointermove', (e) => {
        if (!start) return;
        this.pos = { x: e.clientX - start.dx, y: e.clientY - start.dy };
        this.applyPos();
      });
      const end = () => {
        if (!start) return;
        start = null;
        this.bar.classList.remove('dragging');
        this.save();
      };
      this.bar.addEventListener('pointerup', end);
      this.bar.addEventListener('pointercancel', end);
      // Двойной клик возвращает плашку на место у ролика.
      this.bar.addEventListener('dblclick', (e) => {
        if (e.composedPath().some((n) => n.tagName === 'BUTTON')) return;
        this.pos = null;
        this.auto = null;
        this.save();
      });
    }
  }

  self.SwipeyOverlay = Overlay;
})();
