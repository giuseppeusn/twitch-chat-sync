(() => {
  'use strict';

  const TCS = (globalThis.TCS = globalThis.TCS || {});
  const { FALLBACK_TWITCH_COLORS } = TCS.constants;
  const { t } = TCS.i18n;

  function sendBackgroundMessage(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(
            new Error(
              response?.error || t('errorUnknownWorker', [], 'Unknown Service Worker error.')
            )
          );
          return;
        }
        resolve(response.data);
      });
    });
  }

  function extractVodId(input) {
    if (!input) return null;
    const trimmed = input.trim();
    if (/^\d{6,15}$/.test(trimmed)) return trimmed;

    const match = trimmed.match(/twitch\.tv\/videos\/(\d+)/i);
    return match ? match[1] : null;
  }

  function getYoutubeVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v');
  }

  function formatTimestamp(totalSeconds) {
    const safe = Math.max(0, Math.floor(totalSeconds || 0));
    const hrs = Math.floor(safe / 3600);
    const mins = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }

  function pickFallbackColor(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = (hash * 31 + username.charCodeAt(i)) | 0;
    }
    return FALLBACK_TWITCH_COLORS[
      Math.abs(hash) % FALLBACK_TWITCH_COLORS.length
    ];
  }

  function getSegmentOffsetAt(youtubeTime) {
    const segs = TCS.state.syncSegments;
    if (Array.isArray(segs) && segs.length > 0) {
      for (let i = 0; i < segs.length; i++) {
        if (youtubeTime >= segs[i].ytStart && youtubeTime < segs[i].ytEnd) {
          return segs[i].offset;
        }
      }
      return segs[segs.length - 1].offset;
    }
    return TCS.state.calculatedOffset;
  }

  function getEffectiveTwitchTime(youtubeTime) {
    return (
      getSegmentOffsetAt(youtubeTime) + TCS.state.manualAdjustment + youtubeTime
    );
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error(t('errorImageDecode', [], 'Failed to decode storyboard image.')));
      img.src = dataUrl;
    });
  }

  TCS.utils = {
    sendBackgroundMessage,
    extractVodId,
    getYoutubeVideoId,
    formatTimestamp,
    pickFallbackColor,
    getSegmentOffsetAt,
    getEffectiveTwitchTime,
    loadImageFromDataUrl,
  };
})();
