(() => {
  'use strict';

  const TCS = (globalThis.TCS = globalThis.TCS || {});
  const { PLAYER_OVERLAY_ID } = TCS.constants;
  const { t } = TCS.i18n;

  function onSyncKeyBlock(e) {
    if (!TCS.state.isSyncing) return;
    if (e.target === TCS.state.ui?.urlInput) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function setKeyboardLock(locked) {
    for (const evt of ['keydown', 'keyup', 'keypress']) {
      window.removeEventListener(evt, onSyncKeyBlock, true);
      if (locked) {
        window.addEventListener(evt, onSyncKeyBlock, true);
      }
    }
  }

  function showPlayerSyncOverlay() {
    setKeyboardLock(true);
    const playerEl =
      document.querySelector('#movie_player') ||
      document.querySelector('#player-container-outer .html5-video-player');
    if (!playerEl) return;

    let overlay = document.getElementById(PLAYER_OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = PLAYER_OVERLAY_ID;
      overlay.className = 'tcs-player-overlay';
      overlay.innerHTML = `
        <div class="tcs-overlay-card">
          <div class="tcs-overlay-spinner" aria-hidden="true"></div>
          <div class="tcs-overlay-title">${t('overlayTitle', [], 'Syncing Twitch chat')}</div>
          <div class="tcs-overlay-status">${t('overlayPreparing', [], 'Preparing sync...')}</div>
          <div class="tcs-overlay-progress-wrap">
            <div class="tcs-overlay-progress-bar"></div>
          </div>
          <div class="tcs-overlay-hint">${t('overlayHint', [], 'Player controls locked during sync')}</div>
        </div>
      `;
      for (const evt of [
        'mousedown',
        'mouseup',
        'click',
        'dblclick',
        'wheel',
        'touchstart',
        'contextmenu',
      ]) {
        overlay.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
      }
      playerEl.appendChild(overlay);
    }
  }

  function hidePlayerSyncOverlay() {
    setKeyboardLock(false);
    const overlay = document.getElementById(PLAYER_OVERLAY_ID);
    if (overlay) overlay.remove();
  }

  TCS.ui = TCS.ui || {};
  TCS.ui.overlay = {
    onSyncKeyBlock,
    setKeyboardLock,
    showPlayerSyncOverlay,
    hidePlayerSyncOverlay,
  };
})();
