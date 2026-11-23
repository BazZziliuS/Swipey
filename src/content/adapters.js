// Адаптеры платформ. Всё, что зависит от вёрстки конкретного сайта, живёт здесь.
// Когда сайт что-то поменяет, править нужно только этот файл.
(() => {
  const AD_LABELS = new Set([
    'sponsored', 'реклама', 'спонсировано', 'спонсорский контент', 'ad', 'ads',
  ]);

  // Поднимаемся от <video> до карточки ролика: первого предка,
  // который занимает заметную часть экрана по высоте.
  function findCard(video, maxUp = 12) {
    let el = video;
    for (let i = 0; i < maxUp && el.parentElement; i++) {
      el = el.parentElement;
      const r = el.getBoundingClientRect();
      if (r.height >= innerHeight * 0.6 && el.querySelector('a[href]')) return el;
    }
    return el;
  }

  // Ищет текстовый узел, который целиком равен рекламной метке.
  // Сравнение по целой строке, чтобы слово «реклама» в описании не давало ложных срабатываний.
  function hasAdLabel(root) {
    if (!root) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n = 0;
    while (walker.nextNode() && n++ < 600) {
      const t = walker.currentNode.nodeValue.trim().toLowerCase();
      if (t && t.length <= 24 && AD_LABELS.has(t)) return true;
    }
    return false;
  }

  // Запасной ID, если у ролика нет ни ссылки, ни ID в URL.
  const elementIds = new WeakMap();
  let elementSeq = 0;
  function fallbackId(video) {
    if (video.currentSrc) return 'src:' + video.currentSrc;
    if (!elementIds.has(video)) elementIds.set(video, 'el:' + ++elementSeq);
    return elementIds.get(video);
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }

  function firstVisible(selectors) {
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el) && !el.disabled) return el;
      }
    }
    return null;
  }

  const youtube = {
    key: 'youtube',
    isActivePage: () => location.pathname.startsWith('/shorts/'),
    getId: () => location.pathname.match(/^\/shorts\/([\w-]+)/)?.[1] ?? null,
    isAd(video) {
      const active = document.querySelector('ytd-reel-video-renderer[is-active]');
      if (active?.querySelector('ytd-ad-slot-renderer, ad-slot-renderer')) return true;
      return hasAdLabel(active || findCard(video));
    },
    nextButton: () => firstVisible([
      '#navigation-button-down button',
      'button[aria-label="Next video"]',
      'button[aria-label="Следующее видео"]',
    ]),
  };

  // Карточка ролика в ленте TikTok: <article data-e2e="recommend-list-item-container">.
  const tiktokCard = (video) =>
    video.closest('article, [data-e2e="recommend-list-item-container"]') ?? findCard(video);

  const tiktok = {
    key: 'tiktok',
    isActivePage: () => true,
    getId(video) {
      // Обёртка плеера: <div id="xgwrapper-{индекс}-{id ролика}">. В ленте ссылок /video/ нет.
      const wrap = video.closest('[id^="xgwrapper-"]')?.id.match(/^xgwrapper-\d+-(\d+)/)?.[1];
      if (wrap) return wrap;
      const card = tiktokCard(video);
      const href = card.querySelector('a[href*="/video/"]')?.getAttribute('href');
      return href?.match(/\/video\/(\d+)/)?.[1]
        ?? location.pathname.match(/\/video\/(\d+)/)?.[1]
        ?? fallbackId(video);
    },
    isAd: (video) => hasAdLabel(tiktokCard(video)),
    nextButton: () => firstVisible([
      'button[data-e2e="feed-navigation-next"]',
      'button[data-e2e="arrow-right"]',
      'button[aria-label="Go to next video"]',
      'button[aria-label="Следующее видео"]',
    ]),
  };

  const instagram = {
    key: 'instagram',
    isActivePage: () => /^\/reels?\//.test(location.pathname),
    getId(video) {
      const fromUrl = location.pathname.match(/^\/reels?\/([\w-]+)/)?.[1];
      if (fromUrl) return fromUrl;
      const href = findCard(video).querySelector('a[href*="/reel/"]')?.getAttribute('href');
      return href?.match(/\/reel\/([\w-]+)/)?.[1] ?? fallbackId(video);
    },
    isAd: (video) => hasAdLabel(findCard(video)),
    // «К следующему видео Reels» / «Next Reel». Стрелку ↓ Instagram не принимает.
    nextButton: () => {
      for (const el of document.querySelectorAll('button[aria-label], [role="button"][aria-label]')) {
        const label = el.getAttribute('aria-label');
        if (/след|next/i.test(label) && /reel/i.test(label) && isVisible(el)) return el;
      }
      return null;
    },
  };

  function pickAdapter() {
    const h = location.hostname;
    if (h.endsWith('tiktok.com')) return tiktok;
    if (h.endsWith('youtube.com')) return youtube;
    if (h.endsWith('instagram.com')) return instagram;
    return null;
  }

  // Ближайший прокручиваемый предок: запасной способ пролистать ленту.
  function scrollContainerOf(video) {
    let el = video?.parentElement;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 10) return el;
      el = el.parentElement;
    }
    return null;
  }

  self.SwipeyAdapters = { pickAdapter, scrollContainerOf };
})();
