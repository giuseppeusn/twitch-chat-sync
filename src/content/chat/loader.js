(() => {
  'use strict';

  const TCS = (globalThis.TCS = globalThis.TCS || {});
  const { LOG_PREFIX, CHAT_PREFETCH_WINDOW_SEC } = TCS.constants;
  const { t } = TCS.i18n;
  const {
    sendBackgroundMessage,
    formatTimestamp,
    getEffectiveTwitchTime,
  } = TCS.utils;

  function appendUniqueMessages(newMessages) {
    const state = TCS.state;
    let added = 0;
    let minAddedOffset = Infinity;
    for (const msg of newMessages) {
      if (!state.chatMessageIds.has(msg.id)) {
        state.chatMessageIds.add(msg.id);
        state.chatMessages.push(msg);
        if (msg.offsetSeconds < minAddedOffset) {
          minAddedOffset = msg.offsetSeconds;
        }
        added += 1;
      }
    }
    if (added > 0) {
      state.chatMessages.sort((a, b) => a.offsetSeconds - b.offsetSeconds);
      const currentLast =
        state.lastRenderedIndex >= 0
          ? state.chatMessages[state.lastRenderedIndex]
          : null;
      if (currentLast && minAddedOffset <= currentLast.offsetSeconds) {
        state.lastRenderedIndex = -1;
      }
    }
    return added;
  }

  function mergeLoadedRange(start, end) {
    if (end <= start) return;
    const state = TCS.state;
    state.loadedChatRanges.push({ start, end });
    state.loadedChatRanges.sort((a, b) => a.start - b.start);

    const merged = [];
    for (const r of state.loadedChatRanges) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end + 2) {
        last.end = Math.max(last.end, r.end);
      } else {
        merged.push({ start: r.start, end: r.end });
      }
    }
    state.loadedChatRanges = merged;
  }

  function findLoadedRangeAt(twitchTime) {
    for (const r of TCS.state.loadedChatRanges) {
      if (twitchTime >= r.start - 1 && twitchTime <= r.end + 1) {
        return r;
      }
    }
    return null;
  }

  function isChatCoveredAt(twitchTime) {
    return Boolean(findLoadedRangeAt(twitchTime));
  }

  async function loadChatWindow(startOffset, durationSec, cursor = null) {
    const state = TCS.state;
    if (!state.vodId || state.isFetchingChat) return;
    state.isFetchingChat = true;

    try {
      const actualStart = Math.max(0, Math.floor(startOffset));
      const targetEnd =
        actualStart + Math.max(durationSec, CHAT_PREFETCH_WINDOW_SEC);
      const result = await sendBackgroundMessage({
        type: 'FETCH_CHAT_RANGE',
        vodId: state.vodId,
        startOffset: actualStart,
        endOffset: Math.ceil(targetEnd),
        cursor,
        maxPages: 16,
      });

      appendUniqueMessages(result.messages || []);
      state.chatCursor = result.nextCursor;
      state.chatHasNextPage = result.hasNextPage;
      state.chatCursorOffset = result.lastOffset || actualStart;

      const vodEnd = Number(state.vodMeta?.lengthSeconds) || targetEnd;
      const hasMessages =
        Array.isArray(result.messages) && result.messages.length > 0;
      const reachedEndOfVod =
        !result.hasNextPage && hasMessages && result.lastOffset >= vodEnd - 60;
      const actualEnd = reachedEndOfVod
        ? Math.max(targetEnd, vodEnd)
        : hasMessages && result.lastOffset > actualStart
          ? result.lastOffset
          : actualStart + 15;

      mergeLoadedRange(actualStart, actualEnd);
    } finally {
      state.isFetchingChat = false;
    }
  }

  async function ensureChatLoadedForTime(twitchTime) {
    const state = TCS.state;
    if (!state.isSynced || !state.vodId) return;
    const safeTime = Math.max(0, twitchTime);
    if (isChatCoveredAt(safeTime)) return;

    if (state.isFetchingChat) {
      state.pendingChatSeekTime = safeTime;
      return;
    }

    TCS.ui.panel.setStatus(
      'loading',
      t(
        'statusLoadingChatAt',
        [formatTimestamp(safeTime)],
        `Loading chat at ${formatTimestamp(safeTime)}...`
      )
    );
    try {
      await loadChatWindow(
        Math.max(0, safeTime - 20),
        CHAT_PREFETCH_WINDOW_SEC,
        null
      );
      if (state.isSynced) {
        const segNote =
          state.syncSegments.length > 1
            ? t(
                'statusSyncedCutsSuffix',
                [String(state.syncSegments.length)],
                ` • ${state.syncSegments.length} cuts`
              )
            : '';
        TCS.ui.panel.setStatus(
          'synced',
          t(
            'statusSynced',
            [
              formatTimestamp(state.calculatedOffset),
              segNote,
              String(state.matchConfidence),
            ],
            `Synced at ${formatTimestamp(state.calculatedOffset)}${segNote} • (${state.matchConfidence}% match)`
          )
        );
      }
      TCS.chat.renderer.renderChatForCurrentTime(true);
    } catch (err) {
      console.warn(`${LOG_PREFIX} Error loading chat segment:`, err.message);
      TCS.ui.panel.setStatus(
        'error',
        err.message ||
          t(
            'errorChatLoadFailed',
            [],
            'Failed to load messages for this timestamp.'
          )
      );
    }

    if (state.pendingChatSeekTime !== null) {
      const nextTime = state.pendingChatSeekTime;
      state.pendingChatSeekTime = null;
      if (!isChatCoveredAt(nextTime)) {
        await ensureChatLoadedForTime(nextTime);
      }
    }
  }

  async function prefetchMoreChatIfNeeded(twitchTime) {
    const state = TCS.state;
    if (!state.isSynced || !state.vodId || state.isFetchingChat) {
      return;
    }

    const activeRange = findLoadedRangeAt(twitchTime);
    if (!activeRange) {
      ensureChatLoadedForTime(twitchTime);
      return;
    }

    const vodEnd = Number(state.vodMeta?.lengthSeconds) || Infinity;
    if (activeRange.end >= vodEnd - 2) return;

    if (twitchTime + 120 < activeRange.end) return;

    const canReuseCursor =
      state.chatHasNextPage &&
      state.chatCursor &&
      Math.abs(state.chatCursorOffset - activeRange.end) <= 5;

    state.isFetchingChat = true;
    try {
      const fetchStart = Math.floor(activeRange.end);
      const targetEnd = Math.ceil(activeRange.end + CHAT_PREFETCH_WINDOW_SEC);
      const result = await sendBackgroundMessage({
        type: 'FETCH_CHAT_RANGE',
        vodId: state.vodId,
        startOffset: fetchStart,
        endOffset: targetEnd,
        cursor: canReuseCursor ? state.chatCursor : null,
        maxPages: 16,
      });

      appendUniqueMessages(result.messages || []);
      state.chatCursor = result.nextCursor;
      state.chatHasNextPage = result.hasNextPage;
      state.chatCursorOffset = result.lastOffset || fetchStart;

      const hasMessages =
        Array.isArray(result.messages) && result.messages.length > 0;
      const reachedEndOfVod =
        !result.hasNextPage && hasMessages && result.lastOffset >= vodEnd - 60;
      const actualEnd = reachedEndOfVod
        ? Math.max(targetEnd, vodEnd)
        : hasMessages && result.lastOffset > fetchStart
          ? result.lastOffset
          : fetchStart + 15;

      mergeLoadedRange(fetchStart, actualEnd);
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} Failed to prefetch next messages:`,
        err.message
      );
    } finally {
      state.isFetchingChat = false;
      if (state.isSynced && state.videoEl) {
        const nowTwitch = getEffectiveTwitchTime(state.videoEl.currentTime);
        TCS.chat.renderer.renderChatForCurrentTime(false);
        const updatedRange = findLoadedRangeAt(nowTwitch);
        if (
          updatedRange &&
          updatedRange.end < vodEnd - 2 &&
          nowTwitch + 60 >= updatedRange.end
        ) {
          prefetchMoreChatIfNeeded(nowTwitch);
        }
      }
    }
  }

  function findLastMessageIndexAtOrBefore(targetTime) {
    const arr = TCS.state.chatMessages;
    let lo = 0;
    let hi = arr.length - 1;
    let ans = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid].offsetSeconds <= targetTime) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  TCS.chat = TCS.chat || {};
  TCS.chat.loader = {
    appendUniqueMessages,
    mergeLoadedRange,
    findLoadedRangeAt,
    isChatCoveredAt,
    loadChatWindow,
    ensureChatLoadedForTime,
    prefetchMoreChatIfNeeded,
    findLastMessageIndexAtOrBefore,
  };
})();
