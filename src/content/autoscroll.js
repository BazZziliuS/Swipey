// Автопрокрутка. Решения принимаются на событиях трекера (а значит, на медиа-событиях),
// поэтому работает и в фоновой вкладке.
(() => {
  const { scrollContainerOf } = self.SwipeyAdapters;
  const { log } = self.Swipey;

  class AutoScroller {
    constructor(adapter, tracker, getSettings) {
      this.adapter = adapter;
      this.tracker = tracker;
      this.getSettings = getSettings;
      this.enabled = false;
      this.busy = false;
      this.pausedUntil = 0;
      this.switches = 0;
      this.failures = 0;
      this.secondsAtStart = 0;
      this.stopReason = null;
      this.lastMethod = null; // каким способом удалось пролистать в последний раз
      this.listeners = new Set();

      tracker.on((type, cur) => {
        if (type === 'start' && cur) cur.target = null;
        if (type === 'progress' || type === 'loop') this.check(cur);
      });
    }

    on(fn) { this.listeners.add(fn); }
    notify() { for (const fn of this.listeners) fn(this); }

    enable() {
      this.enabled = true;
      this.switches = 0;
      this.failures = 0;
      this.stopReason = null;
      this.secondsAtStart = this.tracker.tab.seconds;
      this.pausedUntil = 0;
      log('автопрокрутка включена', { режим: this.getSettings().autoMode });
      this.notify();
    }

    disable(reason = null) {
      if (this.enabled) log('автопрокрутка выключена', reason ?? 'вручную');
      this.enabled = false;
      this.stopReason = reason;
      this.notify();
    }

    toggle() { this.enabled ? this.disable() : this.enable(); }

    // Пользователь сам крутит ленту: не мешаем ему некоторое время.
    userInput() {
      if (!this.enabled) return;
      if (!this.isPaused) log('ручная прокрутка, пауза', this.getSettings().manualPause + ' с');
      this.pausedUntil = Date.now() + this.getSettings().manualPause * 1000;
      this.notify();
    }

    get isPaused() { return this.enabled && Date.now() < this.pausedUntil; }

    targetFor(cur) {
      const s = this.getSettings();
      if (s.autoMode === 'timer') return s.timerSec;
      if (s.autoMode === 'random') {
        const lo = Math.min(s.randomMin, s.randomMax);
        const hi = Math.max(s.randomMin, s.randomMax);
        return lo + Math.random() * (hi - lo);
      }
      return null;
    }

    check(cur) {
      if (!this.enabled || this.busy || !cur || this.isPaused) return;
      const s = this.getSettings();

      if (s.limitViews > 0 && this.switches >= s.limitViews) return this.disable('limit');
      if (s.limitMinutes > 0 && this.tracker.tab.seconds - this.secondsAtStart >= s.limitMinutes * 60) {
        return this.disable('limit');
      }

      if (cur.ad && s.skipAds && cur.played > 0.3) {
        log('пропускаю рекламу', cur.id);
        return void this.next();
      }

      if (s.autoMode === 'end') {
        const v = cur.video;
        const d = v.duration;
        // Переключаем чуть раньше конца, чтобы ролик не успел начаться заново.
        if (cur.loops > 0 || (Number.isFinite(d) && d > 0 && v.currentTime >= d - 0.4)) {
          this.next();
        }
        return;
      }

      if (cur.target == null) {
        cur.target = this.targetFor(cur);
        log('переключу через', +cur.target.toFixed(1) + ' с');
      }
      if (cur.played >= cur.target) this.next();
    }

    async next() {
      if (this.busy) return false;
      this.busy = true;
      const fromId = this.tracker.cur?.id ?? null;
      const video = this.tracker.cur?.video ?? this.tracker.pickActive();

      const strategies = [
        ['кнопка', () => { const b = this.adapter.nextButton(); if (!b) return false; b.click(); return true; }],
        ['стрелка вниз', () => { pressArrowDown(); return true; }],
        ['прокрутка ленты', () => { scrollFeed(video); return true; }],
      ];

      let ok = false;
      for (const [name, run] of strategies) {
        if (!run()) { log('способ недоступен:', name); continue; }
        const t0 = performance.now();
        if (await this.waitForChange(fromId, 1500)) {
          ok = true;
          this.lastMethod = name;
          log('перелистнул:', name, Math.round(performance.now() - t0) + ' мс');
          break;
        }
        log('не сработало:', name);
      }
      if (!ok) log('не удалось перелистнуть', fromId, 'попытка', this.failures + 1);

      this.busy = false;
      if (ok) {
        this.failures = 0;
        if (this.enabled) this.switches++;
      } else if (this.enabled && ++this.failures >= 3) {
        this.disable('stuck');
      }
      this.notify();
      return ok;
    }

    waitForChange(fromId, timeout) {
      return new Promise((resolve) => {
        const done = (ok) => { off(); clearTimeout(timer); clearInterval(poll); resolve(ok); };
        const changed = () => {
          this.tracker.sample();
          const id = this.tracker.cur?.id ?? null;
          return id !== null && id !== fromId;
        };
        const off = this.tracker.on((type, cur) => {
          if (type === 'start' && cur && cur.id !== fromId) done(true);
        });
        const poll = setInterval(() => { if (changed()) done(true); }, 200);
        const timer = setTimeout(() => done(changed()), timeout);
      });
    }
  }

  function pressArrowDown() {
    const target = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : document.body;
    for (const type of ['keydown', 'keyup']) {
      const e = new KeyboardEvent(type, {
        key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true, composed: true,
      });
      // Часть сайтов всё ещё смотрит на устаревшие keyCode/which.
      Object.defineProperty(e, 'keyCode', { get: () => 40 });
      Object.defineProperty(e, 'which', { get: () => 40 });
      target.dispatchEvent(e);
    }
  }

  function scrollFeed(video) {
    const box = scrollContainerOf(video);
    if (box) box.scrollBy({ top: box.clientHeight, behavior: 'smooth' });
    else window.scrollBy({ top: innerHeight, behavior: 'smooth' });
  }

  self.SwipeyAutoScroller = AutoScroller;
})();
