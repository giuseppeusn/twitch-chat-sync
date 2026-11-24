# Twitch and YouTube APIs

This document describes the public endpoints, headers, and payload formats used by `src/background/`.

---

## 1. Twitch GraphQL (`https://gql.twitch.tv/gql`)

- **Required header:** `Client-ID: kimne78kx3ncx6brgo4mv6wki5h1ko` (public Twitch web client ID).
- **Content-Type:** `application/json`.
- **Limitations:** subscriber-only or expired VODs do not return data without a user `Authorization: OAuth <token>` header.

### 1.1 Metadata and storyboards (`VideoStoryboardMetadata`)
Queries `video(id: $id)` requesting `id`, `title`, `lengthSeconds`, `seekPreviewsURL`, `animatedPreviewURL`, and `owner { id login displayName }`.

- `seekPreviewsURL` points to a CloudFront JSON manifest (e.g., `.../storyboards/<vodId>-info.json`).
- The JSON is an array of tiers containing `{ quality, width, height, cols, rows, count, interval, images }`.
- Paths in `images` may be relative to `seekPreviewsURL` and are resolved against the manifest base URL.

### 1.2 Chat history (`VideoCommentsByOffsetOrCursor`)
- **Dual strategy in `fetchChatPageRaw`:**
  1. Attempts a **persisted query** first (`sha256Hash: b70a3591ff0f4e0313d126c6a15ed4d71c798f0127b155a161708c818a976618`).
  2. If `PersistedQueryNotFound` is returned or the request fails, caches `persistedChatQueryDisabled = true` and falls back to an **inline GraphQL query** using `contentOffsetSeconds` only (with last-second overlap and deduplication in `fetchChatRange`), because Twitch returns `IntegrityCheckFailed` when `after: $cursor` is used in inline queries without `Client-Integrity`. Also requests `createdAt` to distribute sub-second offsets smoothly within each whole second.

---

## 2. YouTube storyboards (`fetchYoutubeStoryboards`)

- Performs `GET https://www.youtube.com/watch?v=<youtubeId>` in the service worker.
- Extracts `"playerStoryboardSpecRenderer":{"spec":"..."}` and `"lengthSeconds":"..."` from the initial HTML.
- The `spec` string is pipe-delimited (`baseUrl | level0 | level1 | ...`), and each level is `#`-delimited:
  `width#height#count#cols#rows#intervalMs#name#sigh`.
- **Critical `sigh` encoding rule:** the `sigh` parameter contains special characters such as `$` and **must** be appended with `encodeURIComponent(sigh)`. Sending it unencoded causes **HTTP 403** responses from `i.ytimg.com`.
- YouTube storyboard sheets are served as `image/webp` from `https://*.ytimg.com/*`.

---

## 3. Required permissions (`manifest.json`)

```json
"host_permissions": [
  "*://*.youtube.com/*",
  "*://*.twitch.tv/*",
  "https://gql.twitch.tv/*",
  "https://*.cloudfront.net/*",
  "https://*.jtvnw.net/*",
  "https://*.ttvnw.net/*",
  "https://*.ytimg.com/*",
  "https://api.betterttv.net/*",
  "https://cdn.betterttv.net/*",
  "https://7tv.io/*",
  "https://cdn.7tv.app/*"
]
```

## 4. Badges and emotes (Twitch, BTTV, and 7TV)

- **Twitch badges:**
  - Global: GQL query `badges { setID version imageURL(size: NORMAL) title }`.
  - Channel: GQL query `user(id: $channelId) { broadcastBadges { setID version imageURL(size: NORMAL) title } }` (overrides global badges on matching `setID/version`).
- **Native Twitch emotes:** extracted from `message.fragments[].emote.emoteID` and rendered via `https://static-cdn.jtvnw.net/emoticons/v2/<emoteID>/default/dark/1.0`.
- **BetterTTV (BTTV):**
  - Global: `https://api.betterttv.net/3/cached/emotes/global`
  - Channel + shared: `https://api.betterttv.net/3/cached/users/twitch/<channelId>`
  - Images: `https://cdn.betterttv.net/emote/<id>/1x`
- **7TV:**
  - Global: `https://7tv.io/v3/emote-sets/global`
  - Channel: `https://7tv.io/v3/users/twitch/<channelId>` (`emote_set.emotes`)
  - Images: `https:<host.url>/1x.webp`

Any new CDN domain (e.g., `cdn.frankerfacez.com`) will require adding it to `host_permissions` in `manifest.json` if fetched through the service worker.
