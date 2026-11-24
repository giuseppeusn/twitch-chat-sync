# Architecture — Twitch Chat Sync for YouTube

## 1. Overview (Manifest V3, 100% client-side)

The extension operates without any intermediary server, splitting responsibilities between two isolated Chrome contexts:

- **`src/background/` (Service worker — ES modules):**
  - Executes all cross-origin requests allowed by `host_permissions` in `manifest.json`.
  - Converts sprite images (JPEG/WebP) into `data:<mime>;base64,...` URLs (`fetchSpriteBatch`) so the content script can draw them onto `<canvas>` and call `getImageData()` without tainted-canvas (CORS) errors.
- **`src/content/` (Content script on `*://*.youtube.com/*` — `globalThis.TCS` namespace):**
  - Manages the injected YouTube UI (`ui/`), visual signature computation and timeline alignment (`sync/`), chat loading and rendering (`chat/`), player event listeners (`player/`), local persistence (`storage.js`), and localization (`i18n.js`).

---

## 2. Message contract (`chrome.runtime.sendMessage`)

Every message between `src/content/` and `src/background/` resolves to `{ ok: true, data }` or `{ ok: false, error }`:

| `type` | Parameters | Return (`data`) | Purpose |
| :--- | :--- | :--- | :--- |
| `GET_VOD_STORYBOARDS` | `{ vodId }` | `{ vod, storyboard }` | VOD metadata + selected Twitch storyboard tier. |
| `GET_YT_STORYBOARDS` | `{ youtubeId, maxFrames }` | `{ durationSeconds, storyboard } \| null` | Extracts `playerStoryboardSpecRenderer` from the YouTube `/watch` page. |
| `FETCH_SPRITE_BATCH` | `{ urls: string[] }` | `Array<{ url, error, dataUrl, byteLength }>` | Downloads sprite sheets in parallel and converts them to data URLs. |
| `FETCH_CHAT_RANGE` | `{ vodId, startOffset, endOffset, cursor?, maxPages? }` | `{ messages, nextCursor, hasNextPage, lastOffset, pagesFetched }` | Paginates VOD chat comments via Twitch GraphQL. |
| `GET_CHAT_ASSETS` | `{ channelId }` | `{ badgesMap, emotesMap }` | Fetches Twitch global/channel badges and BTTV + 7TV emotes. |
| `FETCH_IMAGE_DATA_URL` | `{ url }` | `string \| null` (Data URL) | Downloads a badge/emote in the service worker with caching (avoids YouTube CSP/origin blocks). |
| `REFINE_OFFSET_HLS` | `{ vodId, coarseOffsetSeconds }` | `{ supported, vodId, offsetSeconds, message }` | Modular hook reserved for future `.m3u8`/`.ts` refinement. |

---

## 3. YouTube SPA lifecycle

YouTube navigates between videos without full page reloads (SPA):

1. `mountPanelIfWatchPage()` checks `window.location.pathname === '/watch'` and `getYoutubeVideoId()` (`?v=...`).
2. When switching to another video (`state.currentYoutubeId !== ytId`), `resetSessionState()` aborts in-flight syncs (`state.syncAbortId += 1`), clears messages/listeners, and resets the UI.
3. The `#tcs-root-panel` panel starts hidden by default on fresh installs (`state.settings.panelVisible = false`, persisted in `tcs_settings_v1`) and toggles when clicking the extension icon (`chrome.action.onClicked` → `TOGGLE_CHAT_PANEL`) or the close button (`✕`), automatically restoring its last open/closed state on page reload. When visible, it exits Theater Mode if active (`exitTheaterModeIfNeeded()`), prepends to `#secondary #secondary-inner` (or `#secondary`) with a max width of `340px`, and dynamically matches `#movie_player` height via `ResizeObserver`.
4. Observed events: `yt-navigate-finish` + a `MutationObserver` on `document.documentElement` to re-inject the panel if YouTube recreates the sidebar DOM.
5. Text inputs stop propagation of `keydown`/`keyup`/`keypress` (`e.stopPropagation()`) to avoid triggering YouTube player shortcuts (`k`, `f`, `j`, `l`, space).
6. During synchronization (`state.isSyncing`), a blurred overlay (`#tcs-player-overlay`) covers `#movie_player` to block mouse interactions and a capture-phase listener (`setKeyboardLock`) blocks YouTube keyboard shortcuts while displaying live progress.

---

## 4. Chat pipeline and rendering

- **In-memory structure:** `state.chatMessages` stores objects sorted by `offsetSeconds`:
  `{ id, offsetSeconds, createdAtMs, author, color, badges, fragments, isSubscription, text }`, deduplicated via `state.chatMessageIds` (`Set`).
- **Visual assets:** `state.badgesMap` and `state.emotesMap` store Twitch badges and BTTV/7TV emotes for inline rendering.
- **Settings menu (`state.settings`):** persisted in `localStorage` (`tcs_settings_v1`), allowing proportional font-size adjustment (`11px`–`20px`) with live preview, toggles for Twitch/BTTV/7TV emotes, message timestamps, hiding subscription notices (`hideSubscriptions`), and `panelVisible`.
- **Per-video VOD cache (`tcs_vod_cache_v1`):** upon a successful sync, the VOD URL/ID and `manualAdjustment` are stored in `localStorage` keyed by `youtubeId` with a **7-day** TTL (`VOD_CACHE_TTL_MS`, max 200 entries with automatic cleanup). Reopening the panel on the same video triggers `tryAutoSyncFromCache()` automatically.
- **Effective Twitch timestamp:**
  `twitchCurrentTime = getSegmentOffsetAt(youtubeVideo.currentTime) + state.manualAdjustment + youtubeVideo.currentTime`, where `getSegmentOffsetAt()` queries `state.syncSegments` (Viterbi-detected segments for edited cuts, falling back to `state.calculatedOffset`).
- **Player synchronization:**
  - `timeupdate` and a `requestAnimationFrame` loop while playing: incremental updates (`renderChatForCurrentTime(false)`).
  - `seeked`: immediate reconstruction of the visible window (`renderChatForCurrentTime(true)`).
- **Lookup and DOM windowing:**
  - `findLastMessageIndexAtOrBefore(twitchTime)` uses binary search $O(\log n)$.
  - Renders at most `MAX_RENDERED_MESSAGES = 150` DOM nodes to keep the page responsive in active chats.
- **Initial sync at any timestamp:** clicking **Sync** starts downloading chat from `currentTwitchTime - 20`, allowing mid-video synchronization.
- **Range tracking and on-demand loading (`loadedChatRanges`):** `state.loadedChatRanges` tracks downloaded `[start, end]` intervals. Seeking or using manual fine-tuning triggers `ensureChatLoadedForTime()` when moving outside cached ranges (with `pendingChatSeekTime` queuing consecutive jumps).
- **Continuous prefetch:** `prefetchMoreChatIfNeeded()` fetches the next `CHAT_PREFETCH_WINDOW_SEC = 600` seconds when fewer than `120s` remain in the active block.
- **Manual fine-tuning (`-30s`, `-5s`, `-1s`, `+1s`, `+5s`, `+30s`):** updates `state.manualAdjustment`, re-renders immediately, and loads the corresponding range if needed.
- **Smart auto-scroll:** pauses automatically when `scrollHeight - scrollTop - clientHeight > 32` and reveals the floating `.tcs-resume-scroll` button.
