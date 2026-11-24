# Synchronization algorithm — Twitch Chat Sync

This document describes the visual and temporal synchronization strategy implemented in `src/content/sync/` and `src/background/`, along with the rationale behind each design decision.

---

## 1. Problem solved

Medium and long YouTube highlights (e.g., 30m–2h30m gameplay cuts) are often extracted from 6h+ Twitch VODs. Comparing a single `<video>` frame against the Twitch storyboard fails on long VODs for two reasons:

1. **200-frame cap on Twitch storyboards:** on a ~6h20m VOD (`22842s`), Twitch generates only 200 thumbnails (`count: 200`), which yields **1 frame every ~115 seconds**. In fast-paced games, being 5 seconds away from a snapshot already changes the camera or scene, dropping isolated hashes to ~55–73% and causing false ties with other parts of the stream.
2. **Twitch `interval` rounding:** Twitch populates `interval` in the manifest using `Math.ceil(lengthSeconds / (count - 1))` (e.g., `22842 / 199 = 114.7839` → `115`). Around 3h45m (frame ~120), that `0.216s/frame` difference accumulates **`+26 seconds`** of linear drift.

---

## 2. Multi-stage pipeline (v2)

### Stage 1: anti-aliasing extraction (`computeSignatureFromRgba` / `extractStoryboardSignatures`)
When the YouTube video provides its own storyboard (`GET_YT_STORYBOARDS`, typically 1 frame every `10s`):

1. Downloads all Twitch storyboard thumbnails (preferring `high` when `<= 12` sheets) and up to `MAX_YT_STORYBOARD_FRAMES = 900` YouTube frames (~2h30m of video, up to 15 sheets in `fetchYoutubeStoryboards`, ~250–450 KB).
2. Calls `getImageData` **once per sprite sheet** and downscales each thumbnail to `16×16` using **area averaging (box filter)** with `EDGE_CROP_RATIO = 0.04`, eliminating aliasing from direct `drawImage` scaling across different resolutions (Twitch `220×124`, YouTube `80×45`/`160×90`, and `<video>` via an intermediate `128×72` buffer). Black frames (`avgLum < 6`) are discarded.

### Stage 2: double z-score global alignment + cut segmentation (`alignStoryboardsGlobal`)
1. **Double z-score matrix (`buildZScoreMatrix`):** converts the raw `twLen × ytLen` similarity matrix into row+column mean z-scores (clamped to `[-1.5, 6.0]`). Static overlays (webcams, HUDs, dark screens) inflate all similarities equally and are cancelled out, highlighting true matches.
2. **Interval auto-detection (`getCandidateTwIntervals`):** tests `[lengthSeconds / (count - 1), lengthSeconds / count, rawInterval]` (deduplicated) to prevent linear drift on long VODs.
3. **Stouffer global scan (`scanGlobalOffsets`):** scans offsets with step `SYNC_GLOBAL_STEP_SEC = 2s` and linear interpolation across YouTube frames (`sampleMatrixRow`), scoring each offset via `sumZ / sqrt(n)` to avoid false peaks from short overlaps.
4. **Segment alignment — sparse Viterbi (`collectSparseCandidateOffsets` + `viterbiSparseOffsetPath` + `buildSegmentsFromPath`):**
   - Selects up to `80` candidate offsets from global peaks and a `z`-weighted histogram, running Viterbi dynamic programming in ~15ms (`O(ytLen × M)`).
   - Automatically detects **edited cuts** in the YouTube video, producing `state.syncSegments` (`[{ ytStart, ytEnd, offset }]`) and snapping boundaries to the sharpest scene cut (`findCutBoundary`). Continuous videos yield a single segment.
5. **Sub-sample parabolic refinement (`refineSegmentOffset`):** refines each segment offset using the weighted median of parabolic peaks from strong-evidence frames (`z >= 1.5`), bringing storyboard-to-storyboard precision to `±1–3s`.

### Stage 3: multi-anchor player refinement (`refineOffsetWithVideoScan`)
With `ENABLE_VIDEO_SEEK_REFINEMENT = true`, while the YouTube `<video>` is paused under `#tcs-player-overlay` (with original position and playback state restored in `finally`):

1. Selects up to **3 well-spaced anchor frames** (`>= 60s` apart) with the highest z-scores in the primary segment (and in the player's current segment if different).
2. **Anchor 1** scans `±10s` (step `2s`) + `±1s` using `captureVideoFrameSignature` (`128×72` → `16×16` box filter); **Anchors 2 and 3** confirm within a narrow `±2s` window (step `1s`) around the detected delta, taking the **median** of confirmed offsets (`sim >= 0.78`, consistency `<= 4s`).
3. **False-positive rescue:** if the #1 global peak fails confirmation on `<video>`, the next 2 distinct peaks (`aligned.distinctTop`) are tested automatically.
4. Automatically skipped if an ad is playing (`ad-showing`) or if the player is not ready, falling back to Stage 2.

### Fallback for short clips (`captureYoutubeTargetFrames` + `findCoarseOffsetViaStoryboards`)
If YouTube returns no usable storyboard or the clip is too short (`< 1.5 * twInterval`):
- Captures up to `MAX_SAMPLE_FRAMES = 10` `<video>` samples distributed across `1.05 * effectiveInterval` (pigeonhole principle) and runs 2-phase temporal verification on the top 6 candidates.

---

## 3. Hybrid visual signature (`computeFrameSignature` / `compareSignatures`)

Each frame/thumbnail is reduced (via box filter in `computeSignatureFromRgba`) to a **`16×16`** grid (`SIG_GRID_W = 16`, `SIG_GRID_H = 16`):

- **45% NCC (`normGray`):** normalized cross-correlation (zero-mean, unit-norm luminance vector via dot product). Distinguishes the exact frame from other moments sharing the same webcam/layout.
- **35% dHash `8×8` (H+V, 128 bits):** computed over 2×2 blocks of the 16×16 grid (`64` horizontal + `64` vertical bits) and compared via Hamming distance using `popcount32`.
- **20% RGB L1:** normalized absolute difference across R, G, and B channels on the `16×16` grid.

---

## 4. Reference benchmark profile

- **YouTube clip:** duration `8968s`, `10s` storyboard interval, `898` frames
- **Twitch VOD:** `vodLengthSeconds: 22842`, `count: 200`, `rawInterval: 115`, `spanInterval: 114.7839s`
- **Expected behavior:** aligns around `~03:45:00` (`13499.5s` in Stage 2, within `<= 3s` before `<video>` refinement).
