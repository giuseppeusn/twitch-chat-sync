(() => {
  'use strict';

  const TCS = (globalThis.TCS = globalThis.TCS || {});

  function t(key, substitutions, fallback = '') {
    try {
      const msg = chrome.i18n.getMessage(key, substitutions);
      return msg || fallback || key;
    } catch {
      return fallback || key;
    }
  }

  TCS.i18n = { t };
})();
