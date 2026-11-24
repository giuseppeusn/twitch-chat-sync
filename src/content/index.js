(() => {
  'use strict';

  if (window.__TWITCH_CHAT_SYNC_LOADED__) return;
  window.__TWITCH_CHAT_SYNC_LOADED__ = true;

  const TCS = (globalThis.TCS = globalThis.TCS || {});
  const {
    PANEL_ID,
    LOG_PREFIX,
    MAX_YT_STORYBOARD_FRAMES,
    ENABLE_VIDEO_SEEK_REFINEMENT,
    CHAT_PREFETCH_WINDOW_SEC,
  } = TCS.constants;
  const { t } = TCS.i18n;
  const {
    saveSettings,
    getCachedVodForYoutube,
    saveCachedVodForYoutube,
    updateCachedManualAdjustment,
  } = TCS.storage;
  const {
    sendBackgroundMessage,
    extractVodId,
    getYoutubeVideoId,
    formatTimestamp,
    getEffectiveTwitchTime,
  } = TCS.utils;
  const { computeEffectiveInterval, extractStoryboardSignatures } =
    TCS.sync.storyboard;
  const { alignStoryboardsGlobal } = TCS.sync.alignment;
  const {
    captureYoutubeTargetFrames,
    refineOffsetWithVideoScan,
    findCoarseOffsetViaStoryboards,
    refineOffsetWithHLS,
  } = TCS.sync.refinement;
  const { loadChatWindow, ensureChatLoadedForTime } = TCS.chat.loader;
  const { renderChatForCurrentTime } = TCS.chat.renderer;
  const { showPlayerSyncOverlay, hidePlayerSyncOverlay } = TCS.ui.overlay;
  const {
    setStatus,
    setProgress,
    setControlsDisabled,
    applySettingsToUI,
    syncPanelHeightToPlayer,
    observePlayerHeight,
    notifyYoutubePlayerResize,
    unmountPanelElement,
    buildPanelUI,
  } = TCS.ui.panel;
  const { attachVideoListeners, detachVideoListeners } = TCS.player;

  async function startSyncFlow(presetManualAdjustment = 0) {
    const state = TCS.state;
    if (!state.ui) return;

    const rawInput = state.ui.urlInput.value;
    const vodId = extractVodId(rawInput);
    if (!vodId) {
      setStatus(
        'error',
        t(
          'errorInvalidUrl',
          [],
          'Invalid URL. Paste a link like https://www.twitch.tv/videos/123456789'
        )
      );
      return;
    }

    const videoEl = document.querySelector('video.html5-main-video');
    if (!videoEl) {
      setStatus(
        'error',
        t('errorNoPlayer', [], 'YouTube player not found on this page.')
      );
      return;
    }

    state.syncAbortId += 1;
    const abortId = state.syncAbortId;

    state.isSyncing = true;
    state.isSynced = false;
    state.vodId = vodId;
    state.syncSegments = [];
    state.manualAdjustment = Number(presetManualAdjustment) || 0;
    state.chatMessages = [];
    state.chatMessageIds.clear();
    state.chatCursor = null;
    state.chatCursorOffset = 0;
    state.chatHasNextPage = false;
    state.loadedChatRanges = [];
    state.pendingChatSeekTime = null;
    state.badgesMap = {};
    state.emotesMap = {};
    state.lastRenderedIndex = -1;

    setControlsDisabled(true);
    let shouldResumeAfterSync = !videoEl.paused && !videoEl.ended;
    const onSyncPreventPlay = () => {
      if (!state.isSyncing || state.syncAbortId !== abortId) return;
      shouldResumeAfterSync = true;
      videoEl.pause();
    };
    videoEl.addEventListener('play', onSyncPreventPlay);
    videoEl.addEventListener('playing', onSyncPreventPlay);
    if (shouldResumeAfterSync) {
      videoEl.pause();
    }
    showPlayerSyncOverlay();
    setProgress(5);

    try {
      const ytId = getYoutubeVideoId();

      setStatus(
        'loading',
        t(
          'statusFetchingStoryboards',
          [],
          'Fetching Twitch and YouTube storyboards...'
        )
      );
      setProgress(10);

      const [{ vod, storyboard: twStoryboard }, ytSbResult] = await Promise.all(
        [
          sendBackgroundMessage({ type: 'GET_VOD_STORYBOARDS', vodId }),
          sendBackgroundMessage({
            type: 'GET_YT_STORYBOARDS',
            youtubeId: ytId,
            maxFrames: MAX_YT_STORYBOARD_FRAMES,
          }).catch(() => null),
        ]
      );
      if (state.syncAbortId !== abortId) return;
      state.vodMeta = vod;

      const assetsPromise = sendBackgroundMessage({
        type: 'GET_CHAT_ASSETS',
        channelId: vod.channelId,
      })
        .then((assets) => {
          if (state.syncAbortId === abortId && assets) {
            state.badgesMap = assets.badgesMap || {};
            state.emotesMap = assets.emotesMap || {};
          }
        })
        .catch((err) => {
          console.warn(
            `${LOG_PREFIX} Failed to load badges/emotes:`,
            err.message
          );
        });

      const effectiveTwInterval = computeEffectiveInterval(vod, twStoryboard);
      const ytSb = ytSbResult?.storyboard || null;
      const canUseGlobalStoryboardAlign = Boolean(
        ytSb &&
          ytSb.count >= 4 &&
          (ytSb.count - 1) * ytSb.interval >= effectiveTwInterval * 1.5
      );

      let coarseStartOffset = 0;
      let matchConfidence = 0;

      if (canUseGlobalStoryboardAlign) {
        setStatus(
          'loading',
          t(
            'statusDownloadingStoryboards',
            [
              String(twStoryboard.imageUrls.length),
              String(ytSb.imageUrls.length),
            ],
            `Downloading storyboards (${twStoryboard.imageUrls.length} Twitch + ${ytSb.imageUrls.length} YouTube)...`
          )
        );
        setProgress(22);

        const twExtracted = await extractStoryboardSignatures(
          twStoryboard,
          abortId,
          ({ pct }) => {
            setProgress(22 + Math.round(pct * 0.28));
          }
        );
        if (state.syncAbortId !== abortId) return;

        const ytExtracted = await extractStoryboardSignatures(
          ytSb,
          abortId,
          ({ pct }) => {
            setProgress(50 + Math.round(pct * 0.25));
          }
        );
        if (state.syncAbortId !== abortId) return;

        setStatus(
          'loading',
          t(
            'statusAligningTimeline',
            [],
            'Aligning full timeline (multi-frame)...'
          )
        );
        setProgress(70);

        const aligned = alignStoryboardsGlobal(
          ytExtracted.signatures,
          ytSb.interval,
          twExtracted.signatures,
          vod,
          twStoryboard
        );

        coarseStartOffset = aligned.winner.offset;
        matchConfidence = aligned.confidence;

        let fine = { refined: false, peakSim: 0, confirmedAnchors: 0 };

        if (ENABLE_VIDEO_SEEK_REFINEMENT) {
          setStatus(
            'loading',
            t(
              'statusRefiningPrecision',
              [],
              'Refining precision to ±1 second (multi-anchor)...'
            )
          );
          setProgress(76);

          fine = await refineOffsetWithVideoScan(
            videoEl,
            aligned,
            twExtracted.signatures,
            abortId
          );
          if (state.syncAbortId !== abortId) return;

          if (fine.refined) {
            coarseStartOffset = aligned.segments[0].offset;
            matchConfidence = Math.max(
              matchConfidence,
              Math.min(99, Math.round(fine.peakSim * 100))
            );
          }
        }

        state.syncSegments = aligned.segments.map((s) => ({
          ytStart: s.ytStart,
          ytEnd: s.ytEnd,
          offset: s.offset,
          strongFrames: s.strongFrames,
          sumZ: s.sumZ,
          meanSim: s.meanSim,
        }));

        console.info(`${LOG_PREFIX} Sync diagnostics (v2):`, {
          vodLengthSeconds: vod?.lengthSeconds,
          selectedTier: twStoryboard.quality,
          chosenTwInterval: Number(aligned.twInterval.toFixed(4)),
          rawInterval: twStoryboard.interval,
          overlappingFramesAligned: aligned.winner.validCount,
          zMargin: Number((aligned.margin || 0).toFixed(2)),
          coarseOffset: formatTimestamp(aligned.winner.offset),
          fineRefined: fine.refined,
          fineConfirmedAnchors: fine.confirmedAnchors || 0,
          finePeakSim: `${Math.round((fine.peakSim || 0) * 100)}%`,
          finalOffset: formatTimestamp(coarseStartOffset),
          segments: state.syncSegments.map((s) => ({
            ytRange: `${formatTimestamp(s.ytStart)}-${Number.isFinite(s.ytEnd) ? formatTimestamp(s.ytEnd) : 'end'}`,
            offset: formatTimestamp(s.offset),
            strongFrames: s.strongFrames,
          })),
          topDistinctOffsets: aligned.distinctTop.map((c) => ({
            startOffset: formatTimestamp(c.offset),
            overlappingFrames: c.validCount,
            zScore: Number(c.score.toFixed(2)),
          })),
        });
      } else {
        setStatus(
          'loading',
          t(
            'statusCapturingSamples',
            [],
            'Capturing YouTube frame samples...'
          )
        );
        setProgress(18);
        const targetFrames = await captureYoutubeTargetFrames(
          videoEl,
          effectiveTwInterval
        );
        if (state.syncAbortId !== abortId) return;

        setStatus(
          'loading',
          t(
            'statusComparingFrames',
            [String(twStoryboard.imageUrls.length)],
            `Comparing frames (${twStoryboard.imageUrls.length} sprites)...`
          )
        );
        const match = await findCoarseOffsetViaStoryboards(
          videoEl,
          targetFrames,
          vod,
          twStoryboard,
          effectiveTwInterval,
          abortId,
          ({ framesScanned, totalExpectedFrames, pct, totalMb }) => {
            setProgress(20 + Math.round(pct * 0.55));
            setStatus(
              'loading',
              t(
                'statusComparingProgress',
                [
                  String(framesScanned),
                  String(totalExpectedFrames),
                  String(totalMb),
                ],
                `Comparing frames (${framesScanned}/${totalExpectedFrames}) • ${totalMb} MB`
              )
            );
          }
        );
        if (state.syncAbortId !== abortId) return;

        coarseStartOffset = match.calculatedStartOffset;
        matchConfidence = match.confidence;
        state.syncSegments = [];
      }

      const refined = await refineOffsetWithHLS(vodId, coarseStartOffset, null);
      if (state.syncAbortId !== abortId) return;

      state.calculatedOffset = refined.offsetSeconds;
      if (refined.refined && state.syncSegments.length === 1) {
        state.syncSegments[0].offset = refined.offsetSeconds;
      }
      state.matchConfidence = matchConfidence;

      const currentTwitchTime = getEffectiveTwitchTime(
        videoEl.currentTime || 0
      );
      setStatus(
        'loading',
        t(
          'statusDownloadingChat',
          [formatTimestamp(currentTwitchTime)],
          `Downloading chat from ${formatTimestamp(currentTwitchTime)}...`
        )
      );
      setProgress(85);

      const initialFetchStart = Math.max(0, currentTwitchTime - 20);
      await Promise.all([
        loadChatWindow(initialFetchStart, CHAT_PREFETCH_WINDOW_SEC),
        assetsPromise,
      ]);
      if (state.syncAbortId !== abortId) return;

      state.isSynced = true;
      if (ytId) {
        saveCachedVodForYoutube(
          ytId,
          rawInput.trim(),
          vodId,
          state.manualAdjustment
        );
      }
      attachVideoListeners(videoEl);
      setProgress(100);
      setControlsDisabled(false);

      const syncedLabel = formatTimestamp(state.calculatedOffset);
      const segNote =
        state.syncSegments.length > 1
          ? t(
              'statusSyncedCutsSuffix',
              [String(state.syncSegments.length)],
              ` • ${state.syncSegments.length} cuts`
            )
          : '';
      setStatus(
        'synced',
        t(
          'statusSynced',
          [syncedLabel, segNote, String(state.matchConfidence)],
          `Synced at ${syncedLabel}${segNote} • (${state.matchConfidence}% match)`
        )
      );

      renderChatForCurrentTime(true);
    } catch (err) {
      if (state.syncAbortId !== abortId) return;
      console.error(LOG_PREFIX, err);
      setStatus(
        'error',
        err.message || t('errorSyncFailed', [], 'Failed to sync VOD.')
      );
      setProgress(0);
    } finally {
      videoEl.removeEventListener('play', onSyncPreventPlay);
      videoEl.removeEventListener('playing', onSyncPreventPlay);
      if (state.syncAbortId === abortId) {
        state.isSyncing = false;
        hidePlayerSyncOverlay();
        if (shouldResumeAfterSync && videoEl.isConnected && !videoEl.ended) {
          videoEl.play().catch(() => {});
        }
        if (state.ui) {
          state.ui.syncBtn.disabled = false;
          state.ui.syncBtn.textContent = t('syncBtn', [], 'Sync');
        }
      }
    }
  }

  async function applyManualAdjustment(deltaSeconds) {
    const state = TCS.state;
    if (!state.isSynced || !state.videoEl) return;
    state.manualAdjustment += deltaSeconds;
    if (state.currentYoutubeId) {
      updateCachedManualAdjustment(
        state.currentYoutubeId,
        state.manualAdjustment
      );
    }

    const newTwitchTime = getEffectiveTwitchTime(state.videoEl.currentTime);
    renderChatForCurrentTime(true);
    await ensureChatLoadedForTime(newTwitchTime);
  }

  function resetSessionState() {
    const state = TCS.state;
    state.syncAbortId += 1;
    state.isSyncing = false;
    state.isSynced = false;
    state.vodId = null;
    state.vodMeta = null;
    state.calculatedOffset = 0;
    state.syncSegments = [];
    state.manualAdjustment = 0;
    state.chatMessages = [];
    state.chatMessageIds.clear();
    state.chatCursor = null;
    state.chatCursorOffset = 0;
    state.chatHasNextPage = false;
    state.loadedChatRanges = [];
    state.pendingChatSeekTime = null;
    state.badgesMap = {};
    state.emotesMap = {};
    state.lastRenderedIndex = -1;
    state.isAutoScrollPaused = false;
    state.autoSyncedYoutubeId = null;
    hidePlayerSyncOverlay();
    detachVideoListeners();

    if (state.ui) {
      state.ui.urlInput.value = '';
      state.ui.chatList.innerHTML = `<div class="tcs-chat-placeholder">${t('chatPlaceholder', [], 'Synced chat will appear here.')}</div>`;
      state.ui.resumeScrollBtn.classList.add('hidden');
      state.ui.vodTimeLabel.textContent = '00:00:00';
      state.ui.adjustLabel.textContent = '0s';
      setStatus(
        'idle',
        t('statusIdle', [], 'Paste a Twitch VOD URL to start.')
      );
      setProgress(0);
      setControlsDisabled(true);
    }
  }

  function closeChatPanel() {
    const state = TCS.state;
    state.isPanelVisible = false;
    state.settings.panelVisible = false;
    saveSettings(state.settings);
    if (state.isSyncing) {
      state.syncAbortId += 1;
      state.isSyncing = false;
      hidePlayerSyncOverlay();
    }
    unmountPanelElement();
  }

  function toggleChatPanel() {
    if (window.location.pathname !== '/watch' || !getYoutubeVideoId()) return;
    if (TCS.state.isPanelVisible) {
      closeChatPanel();
    } else {
      TCS.state.isPanelVisible = true;
      TCS.state.settings.panelVisible = true;
      saveSettings(TCS.state.settings);
      mountPanelIfWatchPage();
    }
  }

  function exitTheaterModeIfNeeded() {
    const watchFlexy = document.querySelector('ytd-watch-flexy');
    if (!watchFlexy || !watchFlexy.hasAttribute('theater')) return;

    const sizeBtn = document.querySelector('#movie_player .ytp-size-button');
    if (sizeBtn) {
      sizeBtn.click();
    } else {
      watchFlexy.removeAttribute('theater');
    }
    notifyYoutubePlayerResize();
  }

  function tryAutoSyncFromCache(ytId) {
    const state = TCS.state;
    if (!ytId || !state.ui || state.isSynced || state.isSyncing) return;
    if (state.autoSyncedYoutubeId === ytId) return;

    const cached = getCachedVodForYoutube(ytId);
    if (!cached || !cached.vodUrl) return;

    state.autoSyncedYoutubeId = ytId;
    state.ui.urlInput.value = cached.vodUrl;
    const savedAdjust = Number(cached.manualAdjustment) || 0;

    if (document.querySelector('video.html5-main-video')) {
      startSyncFlow(savedAdjust);
    } else {
      setTimeout(() => {
        if (
          state.isPanelVisible &&
          !state.isSynced &&
          !state.isSyncing &&
          getYoutubeVideoId() === ytId
        ) {
          startSyncFlow(savedAdjust);
        }
      }, 400);
    }
  }

  function mountPanelIfWatchPage() {
    const state = TCS.state;
    const isWatchPage = window.location.pathname === '/watch';
    const ytId = getYoutubeVideoId();

    if (!isWatchPage || !ytId) {
      unmountPanelElement();
      state.currentYoutubeId = null;
      detachVideoListeners();
      return;
    }

    if (state.currentYoutubeId && state.currentYoutubeId !== ytId) {
      resetSessionState();
    }
    state.currentYoutubeId = ytId;

    if (!state.isPanelVisible) {
      unmountPanelElement();
      return;
    }

    exitTheaterModeIfNeeded();

    const secondaryContainer =
      document.querySelector('#secondary #secondary-inner') ||
      document.querySelector('#secondary');

    if (!secondaryContainer) return;

    if (!document.getElementById(PANEL_ID)) {
      if (!state.ui) {
        state.ui = buildPanelUI();
      }
      secondaryContainer.prepend(state.ui.root);
      applySettingsToUI();
      observePlayerHeight();
      notifyYoutubePlayerResize();
      tryAutoSyncFromCache(ytId);
    } else {
      syncPanelHeightToPlayer();
      tryAutoSyncFromCache(ytId);
    }
  }

  TCS.actions = {
    startSyncFlow,
    applyManualAdjustment,
    resetSessionState,
    closeChatPanel,
    toggleChatPanel,
  };

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.type === 'TOGGLE_CHAT_PANEL') {
      toggleChatPanel();
      sendResponse({ ok: true, visible: TCS.state.isPanelVisible });
    }
  });

  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(mountPanelIfWatchPage, 300);
  });

  const domObserver = new MutationObserver(() => {
    if (window.location.pathname === '/watch') {
      if (TCS.state.isPanelVisible && !document.getElementById(PANEL_ID)) {
        mountPanelIfWatchPage();
      }
      if (
        TCS.state.isSynced &&
        (!TCS.state.videoEl || !TCS.state.videoEl.isConnected)
      ) {
        const currentVideo = document.querySelector('video.html5-main-video');
        if (currentVideo) {
          attachVideoListeners(currentVideo);
          renderChatForCurrentTime(true);
        }
      }
    }
  });

  domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  mountPanelIfWatchPage();
})();
