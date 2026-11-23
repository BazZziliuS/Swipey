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

      const icon = scroller.enabled ? 'pause' : 'play';
      if (this.toggleBtn.dataset.icon !== icon) {
        this.toggleBtn.innerHTML = ICONS[icon];
        this.toggleBtn.dataset.icon = icon;
      }
    }

    applyPos() {
      const s = this.bar.style;
      if (!this.pos) {
        s.left = '16px'; s.bottom = '16px'; s.top = 'auto';
        return;
      }
      const w = this.bar.offsetWidth || 220;
      const h = this.bar.offsetHeight || 44;
      const x = Math.min(Math.max(0, this.pos.x), innerWidth - w);
      const y = Math.min(Math.max(0, this.pos.y), innerHeight - h);
      s.left = x + 'px'; s.top = y + 'px'; s.bottom = 'auto';
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
    }
  }

  self.SwipeyOverlay = Overlay;
})();
