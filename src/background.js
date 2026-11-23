// Единственный, кто пишет статистику в хранилище: так вкладки не затирают счётчики друг друга.
importScripts('shared.js');

const { emptyBucket, dayKey, mergeSettings } = self.Swipey;
const FIELDS = ['views', 'skips', 'completed', 'ads', 'seconds'];
const MAX_SESSIONS = 500;
const FLUSH_SLACK_MS = 5000; // интервал отправки из вкладок

// Записи идут строго по очереди, чтобы параллельные сообщения не потеряли инкременты.
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn).catch((e) => console.error('[Swipey]', e)));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'stats') enqueue(() => applyStats(msg));
});

async function applyStats({ platform, ts, delta }) {
  const { days = {}, sessions = [], settings } = await chrome.storage.local.get(['days', 'sessions', 'settings']);
  const s = mergeSettings(settings);

  const key = dayKey(ts);
  const day = (days[key] ||= {});
  const b = (day[platform] ||= emptyBucket());
  for (const f of FIELDS) b[f] += delta[f] || 0;
  b.byHour[new Date(ts).getHours()] += delta.seconds || 0;

  if (delta.seconds > 0 || delta.views > 0) {
    const last = sessions[sessions.length - 1];
    if (last && ts - last.end <= s.sessionGap * 1000 + FLUSH_SLACK_MS) {
      last.end = ts;
      last.views += delta.views;
      last.seconds += delta.seconds;
      last.platforms[platform] = (last.platforms[platform] || 0) + delta.seconds;
    } else {
      sessions.push({
        start: ts - Math.min(delta.seconds * 1000, FLUSH_SLACK_MS),
        end: ts,
        views: delta.views,
        seconds: delta.seconds,
        platforms: { [platform]: delta.seconds },
      });
      if (sessions.length > MAX_SESSIONS) sessions.splice(0, sessions.length - MAX_SESSIONS);
    }
  }

  await chrome.storage.local.set({ days, sessions });
  updateBadge(days);
}

function updateBadge(days) {
  const today = days[dayKey()] || {};
  const views = Object.values(today).reduce((sum, b) => sum + b.views, 0);
  const text = views === 0 ? '' : views < 1000 ? String(views) : Math.floor(views / 1000) + 'k';
  chrome.action.setBadgeText({ text });
}

async function refreshBadge() {
  const { days = {} } = await chrome.storage.local.get('days');
  updateBadge(days);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#1a1a19' });
  chrome.action.setBadgeTextColor?.({ color: '#f0efec' });
  refreshBadge();
});
chrome.runtime.onStartup.addListener(refreshBadge);

// После сброса или импорта из страницы статистики.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.days) updateBadge(changes.days.newValue || {});
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: command }).catch(() => {});
});
