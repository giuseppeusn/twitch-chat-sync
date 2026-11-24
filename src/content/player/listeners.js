(() => {
  'use strict';

  const TCS = (globalThis.TCS = globalThis.TCS || {});
  const { getEffectiveTwitchTime } = TCS.utils;

  function stopChatRenderLoop() {
    const state = TCS.state;
    if (state.renderRafId !== null) {
      cancelAnimationFrame(state.renderRafId);
      state.renderRafId = null;
    }
    if (state.scrollRafId !== null) {
      cancelAnimationFrame(state.scrollRafId);
      state.scrollRafId = null;
    }
  }

  function startChatRenderLoop() {
    const state = TCS.state;
    if (
      state.renderRafId !== null ||
      !state.videoEl ||
      state.videoEl.paused ||
      state.videoEl.ended
    ) {
      return;
    }
    const tick = (now) => {
      state.renderRafId = null;
      if (
        !state.isSynced ||
        !state.videoEl ||
        state.videoEl.paused ||
        state.videoEl.ended
      ) {
        return;
      }
      if (now - state.lastRenderTickAt >= 90) {
        state.lastRenderTickAt = now;
        TCS.chat.renderer.renderChatForCurrentTime(false);
      }
      state.renderRafId = requestAnimationFrame(tick);
    };
    state.renderRafId = requestAnimationFrame(tick);
  }

  function detachVideoListeners() {
    stopChatRenderLoop();
    const state = TCS.state;
    if (state.videoEl) {
      if (state.boundTimeUpdate) {
        state.videoEl.removeEventListener('timeupdate', state.boundTimeUpdate);
      }
      if (state.boundSeeked) {
        state.videoEl.removeEventListener('seeked', state.boundSeeked);
      }
      if (state.boundPlay) {
        state.videoEl.removeEventListener('play', state.boundPlay);
      }
      if (state.boundPause) {
        state.videoEl.removeEventListener('pause', state.boundPause);
        state.videoEl.removeEventListener('ended', state.boundPause);
      }
    }
    state.videoEl = null;
    state.boundTimeUpdate = null;
    state.boundSeeked = null;
    state.boundPlay = null;
    state.boundPause = null;
  }

  function attachVideoListeners(videoEl) {
    detachVideoListeners();
    const state = TCS.state;
    state.videoEl = videoEl;
    state.boundTimeUpdate = () =>
      TCS.chat.renderer.renderChatForCurrentTime(false);
    state.boundSeeked = () => {
      TCS.chat.renderer.renderChatForCurrentTime(true);
      if (state.isSynced && state.videoEl) {
        TCS.chat.loader.ensureChatLoadedForTime(
          getEffectiveTwitchTime(state.videoEl.currentTime)
        );
      }
    };
    state.boundPlay = () => startChatRenderLoop();
    state.boundPause = () => stopChatRenderLoop();

    videoEl.addEventListener('timeupdate', state.boundTimeUpdate);
    videoEl.addEventListener('seeked', state.boundSeeked);
    videoEl.addEventListener('play', state.boundPlay);
    videoEl.addEventListener('pause', state.boundPause);
    videoEl.addEventListener('ended', state.boundPause);

    if (!videoEl.paused && !videoEl.ended) {
      startChatRenderLoop();
    }
  }

  TCS.player = {
    stopChatRenderLoop,
    startChatRenderLoop,
    detachVideoListeners,
    attachVideoListeners,
  };
})();
