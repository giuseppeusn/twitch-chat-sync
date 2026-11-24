# Privacy policy — Twitch Chat Sync for YouTube

*Last updated: November 24, 2026*

**Twitch Chat Sync for YouTube** operates **100% client-side** inside your browser. This policy explains what data the extension accesses, how it is used, and how your privacy is protected.

---

## 1. Data collection

We do **not** collect, store, sell, or transmit any personal information, browsing history, watch history, analytics, or telemetry to any developer server or third-party analytics service.

---

## 2. Local storage

To provide a smooth experience, the extension stores the following data **locally in your browser (`localStorage`)** on `youtube.com`:

- **User preferences (`tcs_settings_v1`):** chat font size, emote provider toggles (Twitch, BTTV, 7TV), timestamp visibility, subscription message filter, and panel open/closed state.
- **VOD sync cache (`tcs_vod_cache_v1`):** the Twitch VOD URL/ID and manual fine-tuning offset linked to a YouTube video ID, automatically expiring after **7 days** (up to 200 entries).

This data never leaves your device and can be cleared at any time by clearing your browser's site data for YouTube.

---

## 3. External network requests

All network requests are initiated directly from your browser solely to perform the extension's core functionality:

- **YouTube (`youtube.com`, `ytimg.com`):** retrieves video storyboard sheets for visual alignment.
- **Twitch (`twitch.tv`, `gql.twitch.tv`, `cloudfront.net`, `jtvnw.net`, `ttvnw.net`):** retrieves public VOD metadata, storyboard sheets, VOD chat history, badges, and native emotes.
- **BetterTTV (`betterttv.net`) & 7TV (`7tv.io`, `7tv.app`):** retrieves public global and channel emotes for chat rendering.

No user credentials, cookies, or personal identifiers are sent by the extension to these services.

---

## 4. Contact

If you have any questions or concerns about this privacy policy, please open an issue on [GitHub Issues](https://github.com/giuseppeusn/twitch-chat-sync/issues).
