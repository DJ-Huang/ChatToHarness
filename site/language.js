'use strict';
(() => {
  const key = 'chatharness-language';
  const routes = { en: '/ChatToHarness/', 'zh-CN': '/ChatToHarness/zh-CN/', ja: '/ChatToHarness/ja/' };
  const isBase = location.pathname === routes.en || location.pathname === routes.en + 'index.html';
  try {
    const saved = localStorage.getItem(key);
    // The static root defaults to English. Explicit localized URLs always win.
    if (isBase && Object.hasOwn(routes, saved) && saved !== 'en') {
      location.replace(routes[saved] + location.search + location.hash);
      return;
    }
    if (!isBase) localStorage.setItem(key, document.documentElement.lang);
  } catch { /* All language pages and links work without browser storage or scripts. */ }
  document.querySelectorAll('[data-language]').forEach(link => link.addEventListener('click', () => {
    try { localStorage.setItem(key, link.dataset.language); } catch {}
    // Preserve the current section when switching language.
    if (location.hash) link.hash = location.hash;
  }));
})();
