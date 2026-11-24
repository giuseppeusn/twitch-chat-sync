# Future roadmap

All improvements below should be implemented **without modifying the synchronization core** documented in [SYNC_ALGORITHM.md](SYNC_ALGORITHM.md).

---

## High priority (low risk / high impact)

1. **Per-video session cache (`tcs_vod_cache_v1`):** *(completed)*
   - Saves the linked `vodUrl`, `vodId`, and `manualAdjustment` per `youtubeId` in `localStorage` with a 7-day TTL and automatically restores/syncs on revisit.
   - *Optional future enhancement:* migrate to `chrome.storage.local` if cross-origin storage sharing is needed.

2. **Emote and badge rendering in chat:** *(completed)*
   - Supports Twitch global/channel badges, native Twitch emotes (`static-cdn.jtvnw.net`), and BTTV/7TV emotes.
   - *Optional pending:* FrankerFaceZ (FFZ) emote support.

3. **Panel UX improvements (`src/content/ui/` + `src/styles/panel.css`):**
   - Button to clear/switch VODs and a recent VOD history dropdown.
   - Display the synced VOD title and channel (`state.vodMeta`) below the status bar.
   - Direct timestamp link (`https://www.twitch.tv/videos/<vodId>?t=XXhYYmZZs`) for quick verification.

---

## Medium priority

4. **Theater mode and fullscreen support:**
   - Currently the extension exits Theater Mode when opening the panel; consider a floating/dockable panel option for Theater Mode or fullscreen.

5. **Internationalization and chat preferences:** *(partially completed — `_locales` added for `en`, `pt_BR`, `es`; font size and timestamp/sub toggles implemented)*
   - Add message density options and a configurable default stream delay offset.

---

## Low priority / experimental (touches sync — use caution)

6. **Sub-second HLS refinement (`.m3u8` / `.ts`):**
   - Implement `fetchHlsRefinementStub` in `src/background/twitchApi.js` using `PlaybackAccessToken` + `usher.ttvnw.net` + `WebCodecs VideoDecoder` only if `< 1s` precision is needed, gated behind an explicit feature flag.
