'use strict';
(function(root) {
  const messages = typeof module === 'object' && module.exports ? require('./locales.js') : root.CTHMessages;
  const languages = Object.freeze(['zh-CN', 'en', 'ja']);
  function normalize(value) {
    const tag = String(value || '').toLowerCase();
    return tag.startsWith('zh') ? 'zh-CN' : tag.startsWith('ja') ? 'ja' : 'en';
  }
  function translate(locale, message, values = {}) {
    const text = normalize(locale) === 'zh-CN' ? message : messages[message]?.[normalize(locale) === 'en' ? 0 : 1] || message;
    return String(text).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
  }
  // Capture only the original static nodes, before the renderer inserts user paths
  // or status text. Never translate credentials, code examples, or arbitrary content.
  function documentTranslator(document) {
    const texts = [], attributes = [];
    const walker = document.createTreeWalker(document.body, 4);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement.closest('script,style,pre,code,option')) continue;
      const key = node.nodeValue.trim();
      if (Object.hasOwn(messages, key)) texts.push([node, key, node.nodeValue.match(/^\s*/)[0], node.nodeValue.match(/\s*$/)[0]]);
    }
    for (const element of document.querySelectorAll('[aria-label],[placeholder],[title]')) {
      for (const name of ['aria-label', 'placeholder', 'title']) {
        const key = element.getAttribute(name);
        if (Object.hasOwn(messages, key)) attributes.push([element, name, key]);
      }
    }
    return locale => {
      document.documentElement.lang = normalize(locale);
      for (const [node, key, before, after] of texts) if (node.isConnected) node.nodeValue = before + translate(locale, key) + after;
      for (const [element, name, key] of attributes) if (element.isConnected) element.setAttribute(name, translate(locale, key));
    };
  }
  const api = Object.freeze({ languages, normalize, translate, documentTranslator });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CTHI18n = api;
})(typeof window === 'object' ? window : this);
