// Общие константы и утилиты. Подключается классическим скриптом везде:
// в content scripts, в service worker (importScripts) и на страницах расширения.
(() => {
  const PLATFORMS = {
    tiktok: { name: 'TikTok' },
    youtube: { name: 'Shorts' },
    instagram: { name: 'Reels' },
  };

  const DEFAULT_SETTINGS = {
    viewThreshold: 1.5,   // сек проигрывания, после которых ролик считается просмотренным
    completeRatio: 0.9,   // доля длительности для «досмотрен»
    sessionGap: 300,      // сек тишины, после которых начинается новая сессия

    autoMode: 'end',      // end | timer | random
    timerSec: 15,
    randomMin: 5,
    randomMax: 20,
    limitViews: 0,        // 0 = без лимита
    limitMinutes: 0,
    manualPause: 8,       // сек паузы автопрокрутки после ручного вмешательства
    skipAds: true,

    platforms: { tiktok: true, youtube: true, instagram: true },
  };

  const emptyBucket = () => ({
    views: 0, skips: 0, completed: 0, ads: 0, seconds: 0,
    byHour: new Array(24).fill(0),
  });

  const pad = (n) => String(n).padStart(2, '0');

  const dayKey = (ts = Date.now()) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const parseDayKey = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  // «1 ч 12 мин», «7 мин», «42 с»
  const fmtDuration = (sec) => {
    sec = Math.round(sec);
    if (sec < 60) return `${sec} с`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m} мин`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm ? `${h} ч ${rm} мин` : `${h} ч`;
  };

  // «18:42», «1:05:09»
  const fmtClock = (sec) => {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };

  // Склонение: plural(5, ['ролик', 'ролика', 'роликов'])
  const plural = (n, forms) => {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  };

  const mergeSettings = (stored) => ({
    ...DEFAULT_SETTINGS,
    ...(stored || {}),
    platforms: { ...DEFAULT_SETTINGS.platforms, ...(stored?.platforms || {}) },
  });

  self.Swipey = {
    PLATFORMS, DEFAULT_SETTINGS, emptyBucket, dayKey, parseDayKey,
    fmtDuration, fmtClock, plural, mergeSettings,
  };
})();
