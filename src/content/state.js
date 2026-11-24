(() => {
  'use strict';

  const TCS = (globalThis.TCS = globalThis.TCS || {});
  const initialSettings = TCS.storage.loadSettings();

  TCS.state = {
    currentYoutubeId: null,
    vodId: null,
    vodMeta: null,
    isSyncing: false,
    syncAbortId: 0,
    isSynced: false,
    isPanelVisible: Boolean(initialSettings.panelVisible),
    autoSyncedYoutubeId: null,

    calculatedOffset: 0,
    syncSegments: [],
    manualAdjustment: 0,
    matchConfidence: 0,

    chatMessages: [],
    chatMessageIds: new Set(),
    chatCursor: null,
    chatCursorOffset: 0,
    chatHasNextPage: false,
    loadedChatRanges: [],
    pendingChatSeekTime: null,
    isFetchingChat: false,

    badgesMap: {},
    emotesMap: {},
    settings: initialSettings,

    lastRenderedIndex: -1,
    isAutoScrollPaused: false,
    lastProgrammaticScrollAt: 0,
    scrollRafId: null,
    renderRafId: null,
    lastRenderTickAt: 0,

    videoEl: null,
    boundTimeUpdate: null,
    boundSeeked: null,
    boundPlay: null,
    boundPause: null,
    playerResizeObserver: null,
    ui: null,
  };
})();
