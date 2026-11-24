# Twitch Chat Sync for YouTube

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-9146FF?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![100% Client-Side](https://img.shields.io/badge/Architecture-100%25%20client--side-blue?style=flat-square)](#how-it-works)

**English** | [Português (BR)](README.pt-BR.md) | [Español](README.es.md)

A Chrome extension (Manifest V3) that automatically discovers the exact start timestamp of a YouTube clip/highlight inside a Twitch VOD and renders the synchronized Twitch chat right next to the YouTube player — **100% client-side with zero backend**.

---

## Features

- **Automatic visual synchronization:** compares YouTube and Twitch storyboards using a hybrid visual signature (NCC `16×16` + dHash `8×8` H+V + RGB L1) with double z-score normalization.
- **Edited cut detection:** uses sparse Viterbi dynamic programming to detect edited cuts in YouTube videos and keep the chat aligned across segments.
- **±1s multi-anchor refinement:** refines storyboard alignment against actual YouTube video frames for second-level accuracy.
- **Rich Twitch chat rendering:** supports Twitch global and channel badges, native Twitch emotes, **BetterTTV (BTTV)**, and **7TV** emotes.
- **Fine-tuning and playback controls:** manual offset adjustment (`-30s`, `-5s`, `-1s`, `+1s`, `+5s`, `+30s`), smart auto-scroll pause, and on-demand chat range loading.
- **Customizable UI:** Twitch-inspired dark mode panel with adjustable font size, live preview, timestamp toggle, and subscription notice filter.
- **7-day VOD cache:** automatically remembers the linked Twitch VOD and manual offset per YouTube video.
- **Multi-language support:** built-in Chrome i18n (`en`, `pt_BR`, `es`).

---

## Installation (developer mode / load unpacked)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/<your-username>/twtyt-chat.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the project root folder (`twtyt-chat`).

---

## How to use

1. Open any YouTube video (`/watch?v=...`).
2. Click the **Twitch Chat Sync** extension icon in the Chrome toolbar to open the chat panel.
3. Paste the Twitch VOD URL (e.g., `https://www.twitch.tv/videos/123456789`) or VOD ID.
4. Click **Sync** (or press `Enter`) and wait a few seconds while storyboards are aligned.
5. Enjoy the synchronized Twitch chat. Use the `-30s` / `+30s` buttons if you need minor manual adjustments.

---

## How it works

1. **Service worker (`src/background/`):** handles cross-origin requests to Twitch GraphQL (`gql.twitch.tv/gql`), YouTube watch pages, BTTV, and 7TV APIs, converting sprite sheets and emote/badge images into data URLs to avoid CORS/CSP issues.
2. **Content script (`src/content/`):** extracts anti-aliased visual signatures from storyboards, runs global Stouffer alignment + sparse Viterbi segmentation, refines the offset against `<video>` frames, and renders the chat window in sync with `timeupdate` and `seeked` events.

For technical details, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/SYNC_ALGORITHM.md](docs/SYNC_ALGORITHM.md).

---

## Project structure

```text
├── _locales/                  # Chrome i18n translations (en, pt_BR, es)
├── assets/icons/              # Extension icons (16, 32, 48, 128)
├── docs/                      # Architecture, sync algorithm, API & roadmap docs
├── src/
│   ├── background/            # MV3 service worker modules (ES modules)
│   ├── content/               # Content script modules (sync, chat, ui, player)
│   └── styles/                # Twitch-inspired dark mode stylesheet
├── manifest.json              # Chrome extension Manifest V3
├── LICENSE
└── README.md
```

---

## Privacy

This extension operates **100% client-side**. No user data, watch history, or analytics are collected or sent to any third-party server. Settings and per-video VOD cache are stored locally in your browser.

---

## License

Licensed under the [MIT License](LICENSE).
