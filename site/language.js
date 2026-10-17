'use strict';
(() => {
  const key = 'chatharness-language';
  const routes = { 'zh-CN': '/ChatToHarness/', en: '/ChatToHarness/en/', ja: '/ChatToHarness/ja/' };
  try {
    const saved = localStorage.getItem(key);
    // Explicit localized URLs always win. Only the base entry restores a choice.
    if (location.pathname === routes['zh-CN'] && saved && routes[saved] && saved !== 'zh-CN') {
      location.replace(routes[saved] + location.search + location.hash);
      return;
    }
    if (location.pathname !== routes['zh-CN']) localStorage.setItem(key, document.documentElement.lang);
  } catch { /* All three pages and links work without browser storage or scripts. */ }
  document.querySelectorAll('[data-language]').forEach(link => link.addEventListener('click', () => {
    try { localStorage.setItem(key, link.dataset.language); } catch {}
    // Preserve the current section when switching language.
    if (location.hash) link.hash = location.hash;
  }));
})();
