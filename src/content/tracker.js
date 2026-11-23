// Определяет активный ролик и считает время по позиции воспроизведения.
//
// Время ролика = сколько прошло от начала видео: прирост currentTime.
// Перемотка вперёд тоже засчитывается, перемотка назад — нет.
// При зацикливании добавляется хвост до конца плюс новое начало.
// Работает и в фоновой вкладке: опрос идёт по медиа-событиям, а не только по таймеру.
(() => {
  const MEDIA_EVENTS = ['timeupdate', 'play', 'playing', 'pause', 'ended', 'loadedmetadata'];
  const RESET_EVENTS = ['emptied', 'loadstart'];

  class Tracker {
    constructor(adapter, getSettings) {
      this.adapter = adapter;
      this.getSettings = getSettings;
      this.cur = null;          // текущий просмотр
      this.seen = new Set();    // ID, уже засчитанные в этой вкладке
      this.pending = Tracker.zero();      // ещё не отправлено в фон
      this.tab = { views: 0, seconds: 0 }; // для плашки: с момента открытия вкладки
      this.listeners = new Set();
      this.enabled = true;
    }

    static zero() {
      return { views: 0, skips: 0, completed: 0, ads: 0, seconds: 0 };
    }

    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(type) { for (const fn of this.listeners) fn(type, this.cur); }

    start() {
      // Медиа-события не всплывают, поэтому ловим их в фазе перехвата на document.
      for (const t of MEDIA_EVENTS) {
        document.addEventListener(t, (e) => { if (e.target instanceof HTMLVideoElement) this.sample(); }, true);
      }
      for (const t of RESET_EVENTS) {
        document.addEventListener(t, (e) => {
          // Плеер сменил источник (Shorts переиспользует один <video>).
          // Следующий замер не должен принять это за перемотку или цикл.
          if (this.cur && e.target === this.cur.video) this.cur.reset = true;
        }, true);
      }
      this.timer = setInterval(() => this.sample(), 1000);
    }

    takePending() {
      const p = this.pending;
      this.pending = Tracker.zero();
      return p;
    }

    pickActive() {
      const vh = innerHeight, vw = innerWidth;
      const minArea = vw * vh * 0.15;
      let best = null, bestScore = 0;
      for (const v of document.querySelectorAll('video')) {
        const r = v.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
        const area = w * h;
        if (area < minArea) continue;
        const score = area + (v.paused ? 0 : 1e8);
        if (score > bestScore) { best = v; bestScore = score; }
      }
      return best;
    }

    sample() {
      if (!this.enabled || !this.adapter.isActivePage()) {
        if (this.cur) this.finish();
        return;
      }
      const v = this.pickActive();
      if (!v) return;
      const id = this.adapter.getId(v);
      if (!id) return;

      if (!this.cur || this.cur.id !== id) {
        if (this.cur) this.finish();
        this.begin(v, id);
      } else if (this.cur.video !== v) {
        this.cur.video = v;
        this.cur.last = v.currentTime;
      }
      this.progress();
    }

    begin(video, id) {
      const t = video.currentTime;
      this.cur = {
        id, video,
        // Свежий ролик считаем с нуля. Если он уже далеко (вкладку открыли
        // посреди ролика или плеер ещё не сменил источник), начинаем с текущей позиции.
        last: t < 3 ? 0 : t,
        played: 0,
        counted: false,
        isNew: false,     // засчитан как новый просмотр
        completed: false,
        loops: 0,
        ad: false,
        adChecks: 0,
        reset: false,
        startedAt: Date.now(),
      };
      this.checkAd();
      this.emit('start');
    }

    checkAd() {
      const c = this.cur;
      if (!c || c.ad || c.adChecks >= 4) return;
      c.adChecks++;
      c.ad = !!this.adapter.isAd(c.video);
    }

    progress() {
      const c = this.cur;
      const v = c.video;
      const t = v.currentTime;
      const d = v.duration;

      if (c.reset) {
        c.reset = false;
        c.last = t < 3 ? 0 : t;
        return;
      }
      if (v.paused) { c.last = t; return; }

      let add = 0;
      const delta = t - c.last;
      if (delta >= 0) {
        add = delta;
      } else if (Number.isFinite(d) && c.last > d - 1.5 && t < 1.5) {
        // Цикл: досмотрели до конца и начали заново.
        add = (d - c.last) + t;
        c.loops++;
        this.markComplete();
        this.emit('loop');
      }
      c.last = t;
      if (add <= 0) return;

      c.played += add;
      this.pending.seconds += add;
      this.tab.seconds += add;

      if (c.played < 2) this.checkAd();

      const s = this.getSettings();
      if (!c.counted && c.played >= s.viewThreshold) {
        c.counted = true;
        if (c.ad) {
          this.pending.ads++;
        } else if (!this.seen.has(c.id)) {
          this.seen.add(c.id);
          c.isNew = true;
          this.pending.views++;
          this.tab.views++;
        }
      }
      if (c.counted && !c.completed && Number.isFinite(d) && d > 0 && t >= d * s.completeRatio) {
        this.markComplete();
      }
      this.emit('progress');
    }

    markComplete() {
      const c = this.cur;
      if (c.completed) return;
      c.completed = true;
      // В «досмотрено» идут только новые просмотры, иначе доля может превысить 100%.
      if (c.isNew) this.pending.completed++;
    }

    finish() {
      const c = this.cur;
      // Пролистал, не дождавшись порога: это пропуск.
      // Мгновенные смены ID (< 300 мс) — дрожание плеера, их не считаем.
      if (!c.counted && !c.ad && !this.seen.has(c.id) && Date.now() - c.startedAt > 300) {
        this.pending.skips++;
      }
      this.emit('end');
      this.cur = null;
    }
  }

  self.SwipeyTracker = Tracker;
})();
