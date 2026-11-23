// Точка входа content script: связывает трекер, автопрокрутку, плашку и фон.
(async () => {
  const { mergeSettings } = self.Swipey;
  const adapter = self.SwipeyAdapters.pickAdapter();
  if (!adapter) return;
  if (window.top !== window) return; // только главный фрейм

  let settings = mergeSettings((await chrome.storage.local.get('settings')).settings);
  const getSettings = () => settings;

  const tracker = new self.SwipeyTracker(adapter, getSettings);
  const scroller = new self.SwipeyAutoScroller(adapter, tracker, getSettings);
  const overlay = new self.SwipeyOverlay(adapter.key, {
    onToggle: () => scroller.toggle(),
    onNext: () => scroller.next(),
  });
  await overlay.load();

  // Плашка и автопрокрутка нужны, только когда на экране есть ролик.
  const isLive = () => tracker.enabled && adapter.isActivePage() && !!(tracker.cur || tracker.pickActive());

  const applyPlatformSwitch = () => {
    tracker.enabled = settings.platforms[adapter.key] !== false;
    if (!tracker.enabled && scroller.enabled) scroller.disable();
  };
  applyPlatformSwitch();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    settings = mergeSettings(changes.settings.newValue);
    applyPlatformSwitch();
    render();
  });

  // --- отправка статистики в фон ---
  let dead = false;
  const flush = () => {
    if (dead) return;
    const delta = tracker.takePending();
    if (!delta.views && !delta.skips && !delta.completed && !delta.ads && delta.seconds < 0.05) return;
    try {
      chrome.runtime.sendMessage({ type: 'stats', platform: adapter.key, ts: Date.now(), delta })
        .catch(() => {});
    } catch {
      // Расширение перезагрузили, контекст этого скрипта больше не валиден.
      dead = true;
      clearInterval(flushTimer);
      clearInterval(uiTimer);
      tracker.enabled = false;
      scroller.disable();
      overlay.setPageActive(false);
    }
  };
  const flushTimer = setInterval(flush, 5000);
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', flush);

  // --- плашка ---
  let renderQueued = false;
  const render = () => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      overlay.setPageActive(isLive());
      overlay.render(tracker, scroller);
    });
  };
  tracker.on(render);
  scroller.on(render);
  // SPA: страница меняется без перезагрузки, поэтому раз в секунду проверяем,
  // на нужном ли мы разделе, и обновляем плашку.
  const uiTimer = setInterval(render, 1000);

  // --- ручное вмешательство ставит автопрокрутку на паузу ---
  const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']);
  const onUser = (e) => { if (e.isTrusted) scroller.userInput(); };
  addEventListener('wheel', onUser, { capture: true, passive: true });
  addEventListener('touchstart', onUser, { capture: true, passive: true });
  addEventListener('keydown', (e) => { if (NAV_KEYS.has(e.key)) onUser(e); }, true);

  // --- команды из попапа и горячих клавиш ---
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    switch (msg?.type) {
      case 'getState':
        reply({
          platform: adapter.key,
          active: isLive(),
          auto: scroller.enabled,
          paused: scroller.isPaused,
          stopReason: scroller.stopReason,
          tab: tracker.tab,
          overlayHidden: overlay.hidden,
        });
        return;
      case 'toggle-autoscroll':
        if (tracker.enabled) scroller.toggle();
        break;
      case 'set-autoscroll':
        if (tracker.enabled) msg.enabled ? scroller.enable() : scroller.disable();
        break;
      case 'next-video':
        scroller.next();
        break;
      case 'toggle-overlay':
        overlay.toggleHidden();
        break;
      default:
        return;
    }
    render();
    reply({ ok: true, auto: scroller.enabled });
  });

  tracker.start();
  render();
})();
