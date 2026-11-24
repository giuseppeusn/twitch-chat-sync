(() => {
  'use strict';

  const TCS = (globalThis.TCS = globalThis.TCS || {});
  const { MAX_RENDERED_MESSAGES } = TCS.constants;
  const { t } = TCS.i18n;
  const {
    sendBackgroundMessage,
    formatTimestamp,
    pickFallbackColor,
    getEffectiveTwitchTime,
  } = TCS.utils;

  const assetDataUrlCache = new Map();
  const assetPendingPromises = new Map();

  function resolveAssetDataUrl(url) {
    if (!url) return Promise.resolve(null);
    if (assetDataUrlCache.has(url)) {
      return Promise.resolve(assetDataUrlCache.get(url));
    }
    if (assetPendingPromises.has(url)) {
      return assetPendingPromises.get(url);
    }

    const promise = sendBackgroundMessage({ type: 'FETCH_IMAGE_DATA_URL', url })
      .then((dataUrl) => {
        assetPendingPromises.delete(url);
        if (dataUrl) {
          assetDataUrlCache.set(url, dataUrl);
        }
        return dataUrl || null;
      })
      .catch(() => {
        assetPendingPromises.delete(url);
        return null;
      });

    assetPendingPromises.set(url, promise);
    return promise;
  }

  function bindAssetImage(img, url, onLoaded) {
    if (assetDataUrlCache.has(url)) {
      const cached = assetDataUrlCache.get(url);
      if (cached) img.src = cached;
      return;
    }

    resolveAssetDataUrl(url).then((dataUrl) => {
      if (dataUrl && img.isConnected) {
        img.src = dataUrl;
        if (onLoaded) onLoaded();
      }
    });
  }

  function createMessageElement(msg) {
    const state = TCS.state;
    const row = document.createElement('div');
    row.className = msg.isSubscription
      ? 'tcs-chat-msg tcs-chat-sub'
      : 'tcs-chat-msg';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'tcs-chat-time';
    timeSpan.textContent = formatTimestamp(msg.offsetSeconds);
    row.appendChild(timeSpan);

    if (Array.isArray(msg.badges) && msg.badges.length > 0) {
      const badgesWrap = document.createElement('span');
      badgesWrap.className = 'tcs-chat-badges';
      let hasBadges = false;

      for (const b of msg.badges) {
        const key = `${b.setID}/${b.version}`;
        const badgeInfo = Object.prototype.hasOwnProperty.call(
          state.badgesMap,
          key
        )
          ? state.badgesMap[key]
          : null;
        if (!badgeInfo || !badgeInfo.url) continue;

        const img = document.createElement('img');
        img.className = 'tcs-chat-badge';
        img.width = 18;
        img.height = 18;
        img.alt = badgeInfo.title || b.setID;
        img.title = badgeInfo.title || b.setID;
        bindAssetImage(img, badgeInfo.url);
        badgesWrap.appendChild(img);
        hasBadges = true;
      }

      if (hasBadges) {
        row.appendChild(badgesWrap);
      }
    }

    const authorSpan = document.createElement('span');
    authorSpan.className = 'tcs-chat-author';
    authorSpan.style.color = msg.color || pickFallbackColor(msg.author);
    authorSpan.textContent = msg.author;

    const sepSpan = document.createElement('span');
    sepSpan.className = 'tcs-chat-sep';
    sepSpan.textContent = ': ';

    const textSpan = document.createElement('span');
    textSpan.className = 'tcs-chat-text';

    const fragments =
      Array.isArray(msg.fragments) && msg.fragments.length > 0
        ? msg.fragments
        : [{ text: msg.text || '', emoteId: null }];

    for (const frag of fragments) {
      if (frag.emoteId) {
        if (!state.settings.showTwitchEmotes) {
          textSpan.appendChild(document.createTextNode(frag.text || ''));
          continue;
        }
        const img = document.createElement('img');
        img.className = 'tcs-chat-emote';
        img.alt = frag.text || 'emote';
        img.title = frag.text || 'Twitch Emote';
        const twitchEmoteUrl = `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(
          frag.emoteId
        )}/default/dark/1.0`;
        bindAssetImage(img, twitchEmoteUrl, () => {
          if (!state.isAutoScrollPaused) scheduleScrollToBottom();
        });
        textSpan.appendChild(img);
        continue;
      }

      const rawText = frag.text || '';
      if (!rawText) continue;

      const tokens = rawText.split(/(\s+)/);
      for (const token of tokens) {
        if (!token) continue;
        if (/^\s+$/.test(token)) {
          textSpan.appendChild(document.createTextNode(token));
          continue;
        }

        const thirdParty = Object.prototype.hasOwnProperty.call(
          state.emotesMap,
          token
        )
          ? state.emotesMap[token]
          : null;

        const providerEnabled =
          thirdParty &&
          ((thirdParty.provider === 'BTTV' && state.settings.showBttvEmotes) ||
            (thirdParty.provider === '7TV' && state.settings.show7tvEmotes));

        if (providerEnabled && thirdParty.url) {
          const img = document.createElement('img');
          img.className = 'tcs-chat-emote';
          img.alt = token;
          img.title = `${token} (${thirdParty.provider})`;
          bindAssetImage(img, thirdParty.url, () => {
            if (!state.isAutoScrollPaused) scheduleScrollToBottom();
          });
          textSpan.appendChild(img);
        } else {
          textSpan.appendChild(document.createTextNode(token));
        }
      }
    }

    row.append(authorSpan, sepSpan, textSpan);
    return row;
  }

  function scrollChatToBottom() {
    const state = TCS.state;
    if (!state.ui) return;
    state.lastProgrammaticScrollAt = Date.now();
    state.ui.chatList.scrollTop = state.ui.chatList.scrollHeight;
  }

  function scheduleScrollToBottom() {
    const state = TCS.state;
    if (state.scrollRafId !== null) return;
    state.scrollRafId = requestAnimationFrame(() => {
      state.scrollRafId = null;
      if (!state.isAutoScrollPaused) {
        scrollChatToBottom();
      }
    });
  }

  function renderChatForCurrentTime(forceRebuild = false) {
    const state = TCS.state;
    if (!state.isSynced || !state.ui || !state.videoEl) return;

    const twitchTime = getEffectiveTwitchTime(state.videoEl.currentTime);
    TCS.ui.panel.updateOffsetIndicators(twitchTime);
    TCS.chat.loader.prefetchMoreChatIfNeeded(twitchTime);

    const targetIdx = TCS.chat.loader.findLastMessageIndexAtOrBefore(twitchTime);
    const listEl = state.ui.chatList;

    if (targetIdx === -1) {
      if (state.lastRenderedIndex !== -1 || forceRebuild) {
        listEl.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'tcs-chat-placeholder';
        empty.textContent = t(
          'waitingMessages',
          [formatTimestamp(twitchTime)],
          `Waiting for messages at ${formatTimestamp(twitchTime)}...`
        );
        listEl.appendChild(empty);
        state.lastRenderedIndex = -1;
      }
      return;
    }

    const jumpedBackward = targetIdx < state.lastRenderedIndex;
    const jumpedFarForward =
      targetIdx - state.lastRenderedIndex > MAX_RENDERED_MESSAGES;

    if (
      forceRebuild ||
      jumpedBackward ||
      jumpedFarForward ||
      state.lastRenderedIndex === -1
    ) {
      const startIdx = Math.max(0, targetIdx - MAX_RENDERED_MESSAGES + 1);
      const frag = document.createDocumentFragment();
      for (let i = startIdx; i <= targetIdx; i++) {
        frag.appendChild(createMessageElement(state.chatMessages[i]));
      }
      listEl.innerHTML = '';
      listEl.appendChild(frag);
      state.lastRenderedIndex = targetIdx;

      if (!state.isAutoScrollPaused) {
        scrollChatToBottom();
      }
      return;
    }

    if (targetIdx > state.lastRenderedIndex) {
      const placeholder = listEl.querySelector('.tcs-chat-placeholder');
      if (placeholder) placeholder.remove();

      const frag = document.createDocumentFragment();
      for (let i = state.lastRenderedIndex + 1; i <= targetIdx; i++) {
        frag.appendChild(createMessageElement(state.chatMessages[i]));
      }
      listEl.appendChild(frag);

      while (listEl.children.length > MAX_RENDERED_MESSAGES) {
        listEl.removeChild(listEl.firstElementChild);
      }

      state.lastRenderedIndex = targetIdx;

      if (!state.isAutoScrollPaused) {
        scrollChatToBottom();
      }
    }
  }

  TCS.chat = TCS.chat || {};
  TCS.chat.renderer = {
    resolveAssetDataUrl,
    bindAssetImage,
    createMessageElement,
    scrollChatToBottom,
    scheduleScrollToBottom,
    renderChatForCurrentTime,
  };
})();
