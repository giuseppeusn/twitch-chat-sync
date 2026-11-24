(() => {
  'use strict';

  const TCS = (globalThis.TCS = globalThis.TCS || {});
  const {
    SETTINGS_STORAGE_KEY,
    DEFAULT_SETTINGS,
    VOD_CACHE_STORAGE_KEY,
    VOD_CACHE_TTL_MS,
    VOD_CACHE_MAX_ENTRIES,
  } = TCS.constants;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return {
        fontSize: Math.min(
          20,
          Math.max(11, Number(parsed.fontSize) || DEFAULT_SETTINGS.fontSize)
        ),
        showTwitchEmotes: parsed.showTwitchEmotes !== false,
        showBttvEmotes: parsed.showBttvEmotes !== false,
        show7tvEmotes: parsed.show7tvEmotes !== false,
        showTimestamps: parsed.showTimestamps !== false,
        hideSubscriptions: Boolean(parsed.hideSubscriptions),
        panelVisible: Boolean(parsed.panelVisible),
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
    }
  }

  function readVodCache() {
    try {
      const raw = localStorage.getItem(VOD_CACHE_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};

      const now = Date.now();
      let changed = false;
      const clean = {};

      for (const [ytId, entry] of Object.entries(parsed)) {
        if (
          entry &&
          typeof entry.vodUrl === 'string' &&
          typeof entry.updatedAt === 'number' &&
          now - entry.updatedAt <= VOD_CACHE_TTL_MS
        ) {
          clean[ytId] = entry;
        } else {
          changed = true;
        }
      }

      if (changed) {
        localStorage.setItem(VOD_CACHE_STORAGE_KEY, JSON.stringify(clean));
      }
      return clean;
    } catch {
      return {};
    }
  }

  function getCachedVodForYoutube(ytId) {
    if (!ytId) return null;
    const cache = readVodCache();
    return Object.prototype.hasOwnProperty.call(cache, ytId)
      ? cache[ytId]
      : null;
  }

  function saveCachedVodForYoutube(ytId, vodUrl, vodId, manualAdjustment = 0) {
    if (!ytId || !vodUrl) return;
    try {
      const cache = readVodCache();
      cache[ytId] = {
        vodUrl,
        vodId,
        manualAdjustment: Number(manualAdjustment) || 0,
        updatedAt: Date.now(),
      };

      const entries = Object.entries(cache);
      if (entries.length > VOD_CACHE_MAX_ENTRIES) {
        entries.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
        const trimmed = Object.fromEntries(
          entries.slice(0, VOD_CACHE_MAX_ENTRIES)
        );
        localStorage.setItem(VOD_CACHE_STORAGE_KEY, JSON.stringify(trimmed));
      } else {
        localStorage.setItem(VOD_CACHE_STORAGE_KEY, JSON.stringify(cache));
      }
    } catch {
    }
  }

  function updateCachedManualAdjustment(ytId, manualAdjustment) {
    if (!ytId) return;
    try {
      const cache = readVodCache();
      if (!Object.prototype.hasOwnProperty.call(cache, ytId)) return;
      cache[ytId].manualAdjustment = Number(manualAdjustment) || 0;
      cache[ytId].updatedAt = Date.now();
      localStorage.setItem(VOD_CACHE_STORAGE_KEY, JSON.stringify(cache));
    } catch {
    }
  }

  TCS.storage = {
    loadSettings,
    saveSettings,
    readVodCache,
    getCachedVodForYoutube,
    saveCachedVodForYoutube,
    updateCachedManualAdjustment,
  };
})();
