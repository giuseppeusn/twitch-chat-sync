(() => {
  'use strict';

  const TCS = (globalThis.TCS = globalThis.TCS || {});
  const { PANEL_ID, PLAYER_OVERLAY_ID } = TCS.constants;
  const { t } = TCS.i18n;
  const { saveSettings } = TCS.storage;
  const { formatTimestamp } = TCS.utils;

  function setStatus(kind, text) {
    const state = TCS.state;
    if (!state.ui) return;
    state.ui.statusDot.className = `tcs-status-dot tcs-dot-${kind}`;
    state.ui.statusText.textContent = text;

    if (state.isSyncing && kind === 'loading') {
      const overlayStatus = document.querySelector(
        `#${PLAYER_OVERLAY_ID} .tcs-overlay-status`
      );
      if (overlayStatus) overlayStatus.textContent = text;
    }
  }

  function setProgress(percent) {
    const state = TCS.state;
    if (!state.ui) return;
    const clamped = Math.max(0, Math.min(100, percent));
    state.ui.progressBar.style.width = `${clamped}%`;
    state.ui.progressWrap.style.opacity =
      clamped > 0 && clamped < 100 ? '1' : '0';

    if (state.isSyncing) {
      const overlayBar = document.querySelector(
        `#${PLAYER_OVERLAY_ID} .tcs-overlay-progress-bar`
      );
      if (overlayBar) overlayBar.style.width = `${clamped}%`;
    }
  }

  function setControlsDisabled(disabled) {
    const state = TCS.state;
    if (!state.ui) return;
    state.ui.syncBtn.disabled = state.isSyncing;
    state.ui.syncBtn.textContent = state.isSyncing
      ? t('syncingBtn', [], 'Syncing...')
      : t('syncBtn', [], 'Sync');
    state.ui.nudgeButtons.forEach((btn) => {
      btn.disabled = disabled;
    });
  }

  function updateOffsetIndicators(twitchTime) {
    const state = TCS.state;
    if (!state.ui) return;
    state.ui.vodTimeLabel.textContent = formatTimestamp(twitchTime);
    const sign = state.manualAdjustment > 0 ? '+' : '';
    state.ui.adjustLabel.textContent = `${sign}${state.manualAdjustment}s`;
  }

  function applySettingsToUI() {
    const state = TCS.state;
    if (!state.ui) return;
    const s = state.settings;
    const fontSize = Math.min(20, Math.max(11, Number(s.fontSize) || 14));
    const timeSize = Math.max(9, Math.round(fontSize * (12 / 14)));
    const emoteSize = Math.round(fontSize * (22 / 14));
    const badgeSize = Math.round(fontSize * (18 / 14));

    const root = state.ui.root;
    root.style.setProperty('--tcs-chat-font-size', `${fontSize}px`);
    root.style.setProperty('--tcs-chat-time-size', `${timeSize}px`);
    root.style.setProperty('--tcs-chat-emote-size', `${emoteSize}px`);
    root.style.setProperty('--tcs-chat-badge-size', `${badgeSize}px`);
    root.classList.toggle('tcs-hide-timestamps', !s.showTimestamps);
    root.classList.toggle('tcs-hide-subs', Boolean(s.hideSubscriptions));

    if (state.ui.fontSizeValue) {
      state.ui.fontSizeValue.textContent = `${fontSize}px`;
    }
    if (state.ui.fontSlider) {
      state.ui.fontSlider.value = String(fontSize);
    }
    if (state.ui.optTwitchEmotes) {
      state.ui.optTwitchEmotes.checked = s.showTwitchEmotes;
    }
    if (state.ui.optBttvEmotes) {
      state.ui.optBttvEmotes.checked = s.showBttvEmotes;
    }
    if (state.ui.opt7tvEmotes) {
      state.ui.opt7tvEmotes.checked = s.show7tvEmotes;
    }
    if (state.ui.optTimestamps) {
      state.ui.optTimestamps.checked = s.showTimestamps;
    }
    if (state.ui.optHideSubs) {
      state.ui.optHideSubs.checked = Boolean(s.hideSubscriptions);
    }

    if (state.ui.previewTwitchEmote) {
      state.ui.previewTwitchEmote.textContent = s.showTwitchEmotes
        ? ''
        : 'Kappa';
      state.ui.previewTwitchEmote.classList.toggle(
        'tcs-preview-is-text',
        !s.showTwitchEmotes
      );
    }
    if (state.ui.previewBttvEmote) {
      state.ui.previewBttvEmote.textContent = s.showBttvEmotes ? '' : 'KEKW';
      state.ui.previewBttvEmote.classList.toggle(
        'tcs-preview-is-text',
        !s.showBttvEmotes
      );
    }
    if (state.ui.preview7tvEmote) {
      state.ui.preview7tvEmote.textContent = s.show7tvEmotes ? '' : 'CatJam';
      state.ui.preview7tvEmote.classList.toggle(
        'tcs-preview-is-text',
        !s.show7tvEmotes
      );
    }
  }

  function syncPanelHeightToPlayer() {
    const state = TCS.state;
    if (!state.ui) return;
    const root = state.ui.root;
    if (root.classList.contains('tcs-collapsed')) {
      root.style.height = '';
      return;
    }

    const playerEl =
      document.querySelector('#movie_player') ||
      document.querySelector('#player-container-outer .html5-video-player');
    if (!playerEl) return;

    const rect = playerEl.getBoundingClientRect();
    if (rect.height >= 200) {
      const targetHeight = Math.max(320, Math.round(rect.height));
      if (root.style.height !== `${targetHeight}px`) {
        state.lastProgrammaticScrollAt = Date.now();
        root.style.height = `${targetHeight}px`;
        if (state.isSynced && !state.isAutoScrollPaused) {
          TCS.chat.renderer.scheduleScrollToBottom();
        }
      }
    }
  }

  function observePlayerHeight() {
    const state = TCS.state;
    if (state.playerResizeObserver) {
      state.playerResizeObserver.disconnect();
      state.playerResizeObserver = null;
    }

    const playerEl =
      document.querySelector('#movie_player') ||
      document.querySelector('#player-container-outer .html5-video-player');
    if (!playerEl) return;

    syncPanelHeightToPlayer();
    state.playerResizeObserver = new ResizeObserver(() => {
      syncPanelHeightToPlayer();
    });
    state.playerResizeObserver.observe(playerEl);
  }

  function notifyYoutubePlayerResize() {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      syncPanelHeightToPlayer();
    });
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      syncPanelHeightToPlayer();
    }, 180);
  }

  function unmountPanelElement() {
    const state = TCS.state;
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      existing.remove();
      window.dispatchEvent(new Event('resize'));
    }
    if (state.playerResizeObserver) {
      state.playerResizeObserver.disconnect();
      state.playerResizeObserver = null;
    }
  }

  function buildPanelUI() {
    const state = TCS.state;
    const root = document.createElement('section');
    root.id = PANEL_ID;
    root.className = 'tcs-panel';

    root.innerHTML = `
      <div class="tcs-header">
        <div class="tcs-brand">
          <span class="tcs-twitch-badge" aria-hidden="true"></span>
          <span class="tcs-title">${t('panelTitle', [], 'Twitch Chat Sync')}</span>
        </div>
        <div class="tcs-header-actions">
          <button type="button" class="tcs-icon-btn tcs-settings-btn" title="${t('settingsBtnTitle', [], 'Chat Settings')}">⚙</button>
          <button type="button" class="tcs-collapse-btn" title="${t('collapseBtnTitle', [], 'Collapse / Expand')}">−</button>
          <button type="button" class="tcs-close-btn" title="${t('closeBtnTitle', [], 'Close chat')}">✕</button>
        </div>
      </div>

      <div class="tcs-body">
        <div class="tcs-input-row">
          <input
            type="text"
            class="tcs-url-input"
            placeholder="${t('urlPlaceholder', [], 'Paste Twitch VOD link...')}"
            autocomplete="off"
            spellcheck="false"
          />
          <button type="button" class="tcs-sync-btn">${t('syncBtn', [], 'Sync')}</button>
        </div>

        <div class="tcs-status-bar">
          <span class="tcs-status-dot tcs-dot-idle"></span>
          <span class="tcs-status-text">${t('statusIdle', [], 'Paste a Twitch VOD URL to start.')}</span>
        </div>
        <div class="tcs-progress-wrap">
          <div class="tcs-progress-bar"></div>
        </div>

        <div class="tcs-controls-bar">
          <div class="tcs-offset-info">
            <span class="tcs-meta-label">${t('vodLabel', [], 'VOD')}</span>
            <strong class="tcs-vod-time">00:00:00</strong>
            <span class="tcs-adjust-pill" title="${t('manualAdjustTitle', [], 'Manual fine-tuning')}">0s</span>
          </div>
          <div class="tcs-nudge-group">
            <button type="button" class="tcs-nudge-btn" data-delta="-30" disabled>-30s</button>
            <button type="button" class="tcs-nudge-btn" data-delta="-5" disabled>-5s</button>
            <button type="button" class="tcs-nudge-btn" data-delta="-1" disabled>-1s</button>
            <button type="button" class="tcs-nudge-btn" data-delta="1" disabled>+1s</button>
            <button type="button" class="tcs-nudge-btn" data-delta="5" disabled>+5s</button>
            <button type="button" class="tcs-nudge-btn" data-delta="30" disabled>+30s</button>
          </div>
        </div>

        <div class="tcs-chat-wrapper">
          <div class="tcs-chat-list">
            <div class="tcs-chat-placeholder">
              ${t('chatPlaceholder', [], 'Synced chat will appear here.')}
            </div>
          </div>
          <button type="button" class="tcs-resume-scroll hidden">
            ${t('resumeScroll', [], 'Chat paused • Resume scrolling')}
          </button>

          <div class="tcs-settings-panel hidden">
            <div class="tcs-settings-header">
              <span>${t('settingsTitle', [], 'Chat Settings')}</span>
              <button type="button" class="tcs-settings-close" title="${t('closeLabel', [], 'Close')}">✕</button>
            </div>

            <div class="tcs-setting-group">
              <div class="tcs-setting-row">
                <label for="tcs-font-slider">${t('fontSizeLabel', [], 'Text size')}</label>
                <span class="tcs-font-size-val">14px</span>
              </div>
              <input
                id="tcs-font-slider"
                type="range"
                class="tcs-font-slider"
                min="11"
                max="20"
                step="1"
                value="14"
              />
            </div>

            <div class="tcs-settings-preview">
              <div class="tcs-preview-label">${t('previewLabel', [], 'Preview')}</div>
              <div class="tcs-chat-msg tcs-preview-msg">
                <span class="tcs-chat-time">01:24:10</span>
                <span class="tcs-chat-author" style="color: #bf94ff;">Streamer</span>
                <span class="tcs-chat-sep">: </span>
                <span class="tcs-chat-text">
                  ${t('previewSampleText', [], 'Hey chat!')}
                  <span class="tcs-preview-emote tcs-preview-twitch" title="Twitch Emote"></span>
                  <span class="tcs-preview-emote tcs-preview-bttv" title="BTTV Emote"></span>
                  <span class="tcs-preview-emote tcs-preview-7tv" title="7TV Emote"></span>
                </span>
              </div>
            </div>

            <div class="tcs-setting-checks">
              <label class="tcs-check-item">
                <input type="checkbox" class="tcs-opt-twitch-emotes" checked />
                <span>${t('optTwitchEmotes', [], 'Twitch Emotes')}</span>
              </label>
              <label class="tcs-check-item">
                <input type="checkbox" class="tcs-opt-bttv-emotes" checked />
                <span>${t('optBttvEmotes', [], 'BTTV Emotes')}</span>
              </label>
              <label class="tcs-check-item">
                <input type="checkbox" class="tcs-opt-7tv-emotes" checked />
                <span>${t('opt7tvEmotes', [], '7TV Emotes')}</span>
              </label>
              <label class="tcs-check-item">
                <input type="checkbox" class="tcs-opt-timestamps" checked />
                <span>${t('optTimestamps', [], 'Message timestamps')}</span>
              </label>
              <label class="tcs-check-item">
                <input type="checkbox" class="tcs-opt-hide-subs" />
                <span>${t('optHideSubs', [], 'Hide subscription messages')}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    `;

    const ui = {
      root,
      body: root.querySelector('.tcs-body'),
      collapseBtn: root.querySelector('.tcs-collapse-btn'),
      closeBtn: root.querySelector('.tcs-close-btn'),
      urlInput: root.querySelector('.tcs-url-input'),
      syncBtn: root.querySelector('.tcs-sync-btn'),
      statusDot: root.querySelector('.tcs-status-dot'),
      statusText: root.querySelector('.tcs-status-text'),
      progressWrap: root.querySelector('.tcs-progress-wrap'),
      progressBar: root.querySelector('.tcs-progress-bar'),
      vodTimeLabel: root.querySelector('.tcs-vod-time'),
      adjustLabel: root.querySelector('.tcs-adjust-pill'),
      nudgeButtons: Array.from(root.querySelectorAll('.tcs-nudge-btn')),
      chatList: root.querySelector('.tcs-chat-list'),
      resumeScrollBtn: root.querySelector('.tcs-resume-scroll'),
      settingsBtn: root.querySelector('.tcs-settings-btn'),
      settingsPanel: root.querySelector('.tcs-settings-panel'),
      settingsCloseBtn: root.querySelector('.tcs-settings-close'),
      fontSlider: root.querySelector('.tcs-font-slider'),
      fontSizeValue: root.querySelector('.tcs-font-size-val'),
      optTwitchEmotes: root.querySelector('.tcs-opt-twitch-emotes'),
      optBttvEmotes: root.querySelector('.tcs-opt-bttv-emotes'),
      opt7tvEmotes: root.querySelector('.tcs-opt-7tv-emotes'),
      optTimestamps: root.querySelector('.tcs-opt-timestamps'),
      optHideSubs: root.querySelector('.tcs-opt-hide-subs'),
      previewTwitchEmote: root.querySelector('.tcs-preview-twitch'),
      previewBttvEmote: root.querySelector('.tcs-preview-bttv'),
      preview7tvEmote: root.querySelector('.tcs-preview-7tv'),
    };

    ui.settingsBtn.addEventListener('click', () => {
      ui.settingsPanel.classList.toggle('hidden');
      ui.settingsBtn.classList.toggle(
        'active',
        !ui.settingsPanel.classList.contains('hidden')
      );
      if (!ui.settingsPanel.classList.contains('hidden')) {
        const previewMap = [
          [
            ui.previewTwitchEmote,
            'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0',
          ],
          [
            ui.previewBttvEmote,
            'https://cdn.betterttv.net/emote/5e9c6c187e090362f8b0b9e8/1x',
          ],
          [
            ui.preview7tvEmote,
            'https://cdn.7tv.app/emote/01FCY771D800007PQ2DF3GDTN6/1x.webp',
          ],
        ];
        for (const [el, url] of previewMap) {
          if (el && !el.dataset.loaded) {
            TCS.chat.renderer.resolveAssetDataUrl(url).then((dataUrl) => {
              if (dataUrl) {
                el.style.backgroundImage = `url("${dataUrl}")`;
                el.dataset.loaded = '1';
              }
            });
          }
        }
      }
    });

    ui.settingsCloseBtn.addEventListener('click', () => {
      ui.settingsPanel.classList.add('hidden');
      ui.settingsBtn.classList.remove('active');
    });

    ui.fontSlider.addEventListener('input', () => {
      state.settings.fontSize = Number(ui.fontSlider.value) || 14;
      saveSettings(state.settings);
      applySettingsToUI();
      if (!state.isAutoScrollPaused) TCS.chat.renderer.scrollChatToBottom();
    });

    const bindEmoteCheckbox = (el, key) => {
      el.addEventListener('change', () => {
        state.settings[key] = el.checked;
        saveSettings(state.settings);
        applySettingsToUI();
        if (state.isSynced) TCS.chat.renderer.renderChatForCurrentTime(true);
      });
    };

    bindEmoteCheckbox(ui.optTwitchEmotes, 'showTwitchEmotes');
    bindEmoteCheckbox(ui.optBttvEmotes, 'showBttvEmotes');
    bindEmoteCheckbox(ui.opt7tvEmotes, 'show7tvEmotes');

    ui.optTimestamps.addEventListener('change', () => {
      state.settings.showTimestamps = ui.optTimestamps.checked;
      saveSettings(state.settings);
      applySettingsToUI();
    });

    ui.optHideSubs.addEventListener('change', () => {
      state.settings.hideSubscriptions = ui.optHideSubs.checked;
      saveSettings(state.settings);
      applySettingsToUI();
      if (!state.isAutoScrollPaused) TCS.chat.renderer.scrollChatToBottom();
    });

    ui.collapseBtn.addEventListener('click', () => {
      const collapsed = root.classList.toggle('tcs-collapsed');
      ui.collapseBtn.textContent = collapsed ? '+' : '−';
      syncPanelHeightToPlayer();
    });

    ui.closeBtn.addEventListener('click', () => {
      TCS.actions.closeChatPanel();
    });

    ui.syncBtn.addEventListener('click', () => TCS.actions.startSyncFlow(0));
    ui.urlInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        TCS.actions.startSyncFlow(0);
      }
    });
    ui.urlInput.addEventListener('keyup', (e) => e.stopPropagation());
    ui.urlInput.addEventListener('keypress', (e) => e.stopPropagation());

    ui.nudgeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = Number(btn.dataset.delta) || 0;
        TCS.actions.applyManualAdjustment(delta);
      });
    });

    ui.chatList.addEventListener('scroll', () => {
      if (Date.now() - state.lastProgrammaticScrollAt < 180) return;
      const distanceFromBottom =
        ui.chatList.scrollHeight -
        ui.chatList.scrollTop -
        ui.chatList.clientHeight;
      const shouldPause = distanceFromBottom > 32;
      if (shouldPause !== state.isAutoScrollPaused) {
        state.isAutoScrollPaused = shouldPause;
        ui.resumeScrollBtn.classList.toggle('hidden', !shouldPause);
      }
    });

    ui.resumeScrollBtn.addEventListener('click', () => {
      state.isAutoScrollPaused = false;
      ui.resumeScrollBtn.classList.add('hidden');
      TCS.chat.renderer.scrollChatToBottom();
    });

    return ui;
  }

  TCS.ui = TCS.ui || {};
  TCS.ui.panel = {
    setStatus,
    setProgress,
    setControlsDisabled,
    updateOffsetIndicators,
    applySettingsToUI,
    syncPanelHeightToPlayer,
    observePlayerHeight,
    notifyYoutubePlayerResize,
    unmountPanelElement,
    buildPanelUI,
  };
})();
