(() => {
  'use strict';

  const TCS = (globalThis.TCS = globalThis.TCS || {});
  const {
    LOG_PREFIX,
    SIG_GRID_W,
    SIG_GRID_H,
    TARGET_CAPTURE_SECOND,
    MAX_SAMPLE_FRAMES,
    TOP_CANDIDATES_TO_VERIFY,
    EDGE_CROP_RATIO,
    VIDEO_SAMPLE_W,
    VIDEO_SAMPLE_H,
    SPRITE_BATCH_SIZE,
  } = TCS.constants;
  const { t } = TCS.i18n;
  const { sendBackgroundMessage, formatTimestamp, loadImageFromDataUrl } =
    TCS.utils;
  const {
    computeFrameSignature,
    computeSignatureFromRgba,
    compareSignatures,
  } = TCS.sync.signature;

  function waitForSeekAndFrame(videoEl, targetTime, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(
            new Error(
              t(
                'errorSeekTimeout',
                [],
                'Timed out waiting for YouTube player to load frame at 00:05.'
              )
            )
          );
        }
      }, timeoutMs);

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        if (typeof videoEl.requestVideoFrameCallback === 'function') {
          let rvfcDone = false;
          const fallback = setTimeout(() => {
            if (!rvfcDone) {
              rvfcDone = true;
              resolve();
            }
          }, 180);
          videoEl.requestVideoFrameCallback(() => {
            if (!rvfcDone) {
              rvfcDone = true;
              clearTimeout(fallback);
              resolve();
            }
          });
        } else {
          setTimeout(() => requestAnimationFrame(() => resolve()), 120);
        }
      };

      const onSeeked = () => {
        if (videoEl.readyState >= 2) {
          finish();
        } else {
          videoEl.addEventListener('loadeddata', finish, { once: true });
        }
      };

      const cleanup = () => {
        videoEl.removeEventListener('seeked', onSeeked);
        videoEl.removeEventListener('loadeddata', finish);
      };

      if (
        Math.abs(videoEl.currentTime - targetTime) < 0.2 &&
        videoEl.readyState >= 2
      ) {
        finish();
        return;
      }

      videoEl.addEventListener('seeked', onSeeked, { once: true });
      videoEl.currentTime = targetTime;
    });
  }

  function drawCroppedToHashCanvas(ctx, source, sx, sy, sw, sh, dstW, dstH) {
    const padX = sw * EDGE_CROP_RATIO;
    const padY = sh * EDGE_CROP_RATIO;
    ctx.drawImage(
      source,
      sx + padX,
      sy + padY,
      Math.max(1, sw - padX * 2),
      Math.max(1, sh - padY * 2),
      0,
      0,
      dstW,
      dstH
    );
  }

  async function captureYoutubeTargetFrames(videoEl, effectiveInterval) {
    const playerContainer = document.querySelector('.html5-video-player');
    if (playerContainer && playerContainer.classList.contains('ad-showing')) {
      throw new Error(
        t(
          'errorAdShowing',
          [],
          'An ad is playing on YouTube. Wait or skip the ad and try again.'
        )
      );
    }

    if (!videoEl || videoEl.readyState < 1 || !videoEl.videoWidth) {
      throw new Error(
        t('errorPlayerNotReady', [], 'YouTube video player is not ready yet.')
      );
    }

    const originalTime = videoEl.currentTime;
    const wasPaused = videoEl.paused;
    const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;

    const baseTime =
      duration > 0 && duration < TARGET_CAPTURE_SECOND + 1
        ? Math.max(0, duration / 2)
        : TARGET_CAPTURE_SECOND;

    const maxSpan = Math.max(
      0,
      Math.min(effectiveInterval * 1.05, duration - baseTime - 2)
    );
    const sampleCount =
      maxSpan < 10
        ? 1
        : Math.min(MAX_SAMPLE_FRAMES, Math.max(3, Math.ceil(maxSpan / 12) + 1));

    const sampleTimes = [];
    if (sampleCount === 1) {
      sampleTimes.push(baseTime);
    } else {
      const step = maxSpan / (sampleCount - 1);
      for (let i = 0; i < sampleCount; i++) {
        sampleTimes.push(Math.round((baseTime + i * step) * 10) / 10);
      }
    }

    if (!wasPaused) {
      videoEl.pause();
    }

    const canvas = document.createElement('canvas');
    canvas.width = SIG_GRID_W;
    canvas.height = SIG_GRID_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const frames = [];
    try {
      for (const timePoint of sampleTimes) {
        await waitForSeekAndFrame(videoEl, timePoint);
        drawCroppedToHashCanvas(
          ctx,
          videoEl,
          0,
          0,
          videoEl.videoWidth,
          videoEl.videoHeight,
          canvas.width,
          canvas.height
        );
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const sig = computeFrameSignature(imageData);
        frames.push({ captureTime: timePoint, sig });
      }
    } finally {
      videoEl.currentTime = originalTime;
      if (!wasPaused) {
        videoEl.play().catch(() => {});
      }
    }

    const nonBlack = frames.filter((f) => f.sig.avgLum >= 8);
    return nonBlack.length > 0 ? nonBlack : frames;
  }

  function captureVideoFrameSignature(ctx, videoEl) {
    ctx.drawImage(videoEl, 0, 0, VIDEO_SAMPLE_W, VIDEO_SAMPLE_H);
    const pixels = ctx.getImageData(0, 0, VIDEO_SAMPLE_W, VIDEO_SAMPLE_H).data;
    return computeSignatureFromRgba(
      pixels,
      VIDEO_SAMPLE_W,
      VIDEO_SAMPLE_H,
      0,
      0,
      VIDEO_SAMPLE_W,
      VIDEO_SAMPLE_H
    );
  }

  async function refineOffsetWithVideoScan(videoEl, aligned, twSigs, abortId) {
    const playerContainer = document.querySelector('.html5-video-player');
    if (playerContainer && playerContainer.classList.contains('ad-showing')) {
      return { refined: false, peakSim: 0, reason: 'ad-showing' };
    }

    const duration = Number.isFinite(videoEl?.duration) ? videoEl.duration : 0;
    if (
      !videoEl ||
      videoEl.readyState < 1 ||
      !videoEl.videoWidth ||
      duration < 15
    ) {
      return { refined: false, peakSim: 0, reason: 'video-not-ready' };
    }

    const twInterval = aligned.twInterval;
    const segments = aligned.segments || [];
    if (segments.length === 0) {
      return { refined: false, peakSim: 0, reason: 'no-segments' };
    }

    const originalTime = videoEl.currentTime;
    const wasPaused = videoEl.paused;
    if (!wasPaused) videoEl.pause();

    const canvas = document.createElement('canvas');
    canvas.width = VIDEO_SAMPLE_W;
    canvas.height = VIDEO_SAMPLE_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const sigCache = new Map();
    const getVideoSigAt = async (sec) => {
      const timeSec = Math.max(1, Math.min(duration - 1, Math.round(sec)));
      if (sigCache.has(timeSec)) return sigCache.get(timeSec);
      if (TCS.state.syncAbortId !== abortId) {
        throw new Error(t('errorSyncCancelled', [], 'Sync cancelled.'));
      }
      await waitForSeekAndFrame(videoEl, timeSec, 4000);
      const sig = captureVideoFrameSignature(ctx, videoEl);
      sigCache.set(timeSec, sig);
      return sig;
    };

    const scanAnchor = async (twIdx, centerYt, halfWin, step) => {
      const anchorSig = twSigs[twIdx];
      if (!anchorSig) return null;
      let bestT = centerYt;
      let bestSim = -1;
      const minT = Math.max(1, Math.floor(centerYt - halfWin));
      const maxT = Math.min(duration - 1, Math.ceil(centerYt + halfWin));
      for (let timeSec = minT; timeSec <= maxT; timeSec += step) {
        const sig = await getVideoSigAt(timeSec);
        const s = compareSignatures(sig, anchorSig);
        if (s > bestSim) {
          bestSim = s;
          bestT = timeSec;
        }
      }
      if (step > 1) {
        for (const d of [-1, 1]) {
          const timeSec = bestT + d;
          if (timeSec >= 1 && timeSec <= duration - 1) {
            const sig = await getVideoSigAt(timeSec);
            const s = compareSignatures(sig, anchorSig);
            if (s > bestSim) {
              bestSim = s;
              bestT = timeSec;
            }
          }
        }
      }
      return {
        twIdx,
        bestYt: bestT,
        bestSim,
        impliedOffset: twIdx * twInterval - bestT,
      };
    };

    const refineSingleOffset = async (baseOffset, anchors) => {
      const validAnchors = (anchors || []).filter((a) => {
        const est = a.twIdx * twInterval - baseOffset;
        return twSigs[a.twIdx] && est >= 5 && est <= duration - 5;
      });
      if (validAnchors.length === 0) return null;

      const results = [];
      let lockDelta = null;

      for (let idx = 0; idx < validAnchors.length; idx++) {
        const a = validAnchors[idx];
        const estYt = a.twIdx * twInterval - baseOffset;
        let r;
        if (lockDelta !== null) {
          r = await scanAnchor(a.twIdx, estYt - lockDelta, 2, 1);
          if (r && r.bestSim < 0.76) {
            r = await scanAnchor(a.twIdx, estYt, 10, 2);
          }
        } else {
          r = await scanAnchor(a.twIdx, estYt, 10, 2);
          if (r && r.bestSim >= 0.78) {
            lockDelta = r.impliedOffset - baseOffset;
          }
        }
        if (r) results.push(r);
      }

      const confirmed = results.filter((r) => r.bestSim >= 0.78);
      if (confirmed.length === 0) {
        const maxSim = results.reduce((m, r) => Math.max(m, r.bestSim), 0);
        return { confirmed: false, peakSim: maxSim, results };
      }

      confirmed.sort((a, b) => a.impliedOffset - b.impliedOffset);
      const mid = Math.floor(confirmed.length / 2);
      const medianOffset =
        confirmed.length % 2 === 1
          ? confirmed[mid].impliedOffset
          : (confirmed[mid - 1].impliedOffset + confirmed[mid].impliedOffset) *
            0.5;

      const consistent = confirmed.filter(
        (r) => Math.abs(r.impliedOffset - medianOffset) <= 4
      );
      const sims = (consistent.length > 0 ? consistent : confirmed)
        .map((r) => r.bestSim)
        .sort((a, b) => a - b);
      const medianSim = sims[Math.floor(sims.length / 2)];

      const isReliable =
        consistent.length >= 2 || (confirmed.length === 1 && medianSim >= 0.84);
      return {
        confirmed: isReliable,
        offsetSeconds: Math.max(0, Math.round(medianOffset)),
        peakSim: medianSim,
        confirmedCount: consistent.length,
        results,
      };
    };

    try {
      const primarySeg = segments.reduce(
        (a, b) => (b.sumZ > a.sumZ ? b : a),
        segments[0]
      );
      const currentSeg =
        segments.find(
          (s) => originalTime >= s.ytStart && originalTime < s.ytEnd
        ) || segments[0];
      const segsToRefine =
        primarySeg === currentSeg ? [primarySeg] : [primarySeg, currentSeg];

      let anyRefined = false;
      let bestPeakSim = 0;
      let totalConfirmed = 0;

      for (const seg of segsToRefine) {
        const res = await refineSingleOffset(seg.offset, seg.anchors);
        if (res && res.confirmed) {
          seg.offset = res.offsetSeconds;
          anyRefined = true;
          bestPeakSim = Math.max(bestPeakSim, res.peakSim);
          totalConfirmed += res.confirmedCount;
        }
      }

      if (
        !anyRefined &&
        segments.length === 1 &&
        Array.isArray(aligned.distinctTop)
      ) {
        const altPeaks = aligned.distinctTop
          .filter((p) => Math.abs(p.offset - segments[0].offset) >= 25)
          .slice(0, 2);

        for (const alt of altPeaks) {
          const altAnchors = [];
          const stepTw = Math.max(1, Math.floor(duration / twInterval / 4));
          const firstTw = Math.max(
            0,
            Math.ceil((alt.offset + 15) / twInterval)
          );
          const lastTw = Math.min(
            twSigs.length - 1,
            Math.floor((alt.offset + duration - 15) / twInterval)
          );
          for (
            let i = firstTw;
            i <= lastTw && altAnchors.length < 3;
            i += stepTw
          ) {
            if (twSigs[i] && twSigs[i].avgLum >= 8) {
              altAnchors.push({
                twIdx: i,
                estYtTime: i * twInterval - alt.offset,
                z: 1.5,
              });
            }
          }
          const res = await refineSingleOffset(alt.offset, altAnchors);
          if (res && res.confirmed && res.confirmedCount >= 2) {
            segments[0].offset = res.offsetSeconds;
            anyRefined = true;
            bestPeakSim = res.peakSim;
            totalConfirmed = res.confirmedCount;
            break;
          }
        }
      }

      return {
        refined: anyRefined,
        offsetSeconds: segments[0].offset,
        peakSim: bestPeakSim,
        confirmedAnchors: totalConfirmed,
      };
    } catch (err) {
      if (TCS.state.syncAbortId !== abortId) throw err;
      console.warn(`${LOG_PREFIX} Video refinement skipped:`, err.message);
      return { refined: false, peakSim: 0, reason: err.message };
    } finally {
      try {
        videoEl.currentTime = originalTime;
        if (!wasPaused) videoEl.play().catch(() => {});
      } catch {
      }
    }
  }

  async function findCoarseOffsetViaStoryboards(
    videoEl,
    targetFrames,
    vod,
    storyboard,
    effectiveInterval,
    abortId,
    onProgress
  ) {
    const { width, height, cols, rows, count, imageUrls } = storyboard;
    const framesPerSheet = cols * rows;

    const workCanvas = document.createElement('canvas');
    workCanvas.width = SIG_GRID_W;
    workCanvas.height = SIG_GRID_H;
    const ctx = workCanvas.getContext('2d', { willReadFrequently: true });

    const sbSignatures = [];
    let totalBytes = 0;
    let framesScanned = 0;
    const totalExpectedFrames = count || imageUrls.length * framesPerSheet;

    for (
      let batchStart = 0;
      batchStart < imageUrls.length;
      batchStart += SPRITE_BATCH_SIZE
    ) {
      if (TCS.state.syncAbortId !== abortId) {
        throw new Error(t('errorSyncCancelled', [], 'Sync cancelled.'));
      }

      const batchUrls = imageUrls.slice(
        batchStart,
        batchStart + SPRITE_BATCH_SIZE
      );
      const batchResults = await sendBackgroundMessage({
        type: 'FETCH_SPRITE_BATCH',
        urls: batchUrls,
      });

      for (let i = 0; i < batchResults.length; i++) {
        if (TCS.state.syncAbortId !== abortId) {
          throw new Error(t('errorSyncCancelled', [], 'Sync cancelled.'));
        }

        const sheetIndex = batchStart + i;
        const item = batchResults[i];
        if (!item || !item.dataUrl) continue;

        totalBytes += item.byteLength || 0;
        const spriteImg = await loadImageFromDataUrl(item.dataUrl);

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const globalFrameIdx = sheetIndex * framesPerSheet + r * cols + c;
            if (count && globalFrameIdx >= count) break;

            const sx = c * width;
            const sy = r * height;
            if (
              sx + width > spriteImg.naturalWidth ||
              sy + height > spriteImg.naturalHeight
            ) {
              continue;
            }

            drawCroppedToHashCanvas(
              ctx,
              spriteImg,
              sx,
              sy,
              width,
              height,
              workCanvas.width,
              workCanvas.height
            );

            const frameData = ctx.getImageData(
              0,
              0,
              workCanvas.width,
              workCanvas.height
            );
            sbSignatures[globalFrameIdx] = computeFrameSignature(frameData);
            framesScanned += 1;
          }
        }

        const pct = Math.min(
          100,
          Math.round((framesScanned / Math.max(1, totalExpectedFrames)) * 100)
        );
        if (onProgress) {
          onProgress({
            framesScanned,
            totalExpectedFrames,
            pct,
            totalMb: (totalBytes / (1024 * 1024)).toFixed(2),
          });
        }
      }
    }

    if (framesScanned === 0) {
      throw new Error(
        t(
          'errorNoStoryboardFrames',
          [],
          'No storyboard frames could be analyzed.'
        )
      );
    }

    const allMatches = [];
    for (let idx = 0; idx < sbSignatures.length; idx++) {
      const sbSig = sbSignatures[idx];
      if (!sbSig || sbSig.avgLum < 6) continue;

      let localBestSim = -1;
      let localBestTime = targetFrames[0].captureTime;

      for (const tf of targetFrames) {
        const sim = compareSignatures(tf.sig, sbSig);
        if (sim > localBestSim) {
          localBestSim = sim;
          localBestTime = tf.captureTime;
        }
      }

      allMatches.push({
        idx,
        sampleTime: localBestTime,
        startOffset: Math.max(0, idx * effectiveInterval - localBestTime),
        singleSim: localBestSim,
      });
    }

    allMatches.sort((a, b) => b.singleSim - a.singleSim);

    const shortlist = [];
    for (const cand of allMatches) {
      if (shortlist.every((s) => Math.abs(s.idx - cand.idx) >= 2)) {
        shortlist.push(cand);
        if (shortlist.length >= TOP_CANDIDATES_TO_VERIFY) break;
      }
    }

    const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
    const originalTime = videoEl.currentTime;
    const wasPaused = videoEl.paused;
    const verifiedCandidates = [];

    if (shortlist.length > 1 && duration > effectiveInterval + 10) {
      if (!wasPaused) videoEl.pause();
      try {
        for (const cand of shortlist) {
          if (TCS.state.syncAbortId !== abortId) {
            throw new Error(t('errorSyncCancelled', [], 'Sync cancelled.'));
          }

          let scoreSum = cand.singleSim;
          let checks = 1;
          const extraScores = [];

          for (const step of [1, 2]) {
            const nextSbIdx = cand.idx + step;
            const nextYtTime = cand.sampleTime + step * effectiveInterval;
            if (
              nextSbIdx < sbSignatures.length &&
              sbSignatures[nextSbIdx] &&
              nextYtTime < duration - 2
            ) {
              await waitForSeekAndFrame(videoEl, nextYtTime);
              drawCroppedToHashCanvas(
                ctx,
                videoEl,
                0,
                0,
                videoEl.videoWidth,
                videoEl.videoHeight,
                workCanvas.width,
                workCanvas.height
              );
              const nextSig = computeFrameSignature(
                ctx.getImageData(0, 0, workCanvas.width, workCanvas.height)
              );
              const s = compareSignatures(nextSig, sbSignatures[nextSbIdx]);
              scoreSum += s;
              checks += 1;
              extraScores.push(Math.round(s * 100));
            }
          }

          verifiedCandidates.push({
            ...cand,
            verifiedSim: scoreSum / checks,
            checks,
            extraScores,
          });
        }
      } finally {
        videoEl.currentTime = originalTime;
        if (!wasPaused) videoEl.play().catch(() => {});
      }
    } else {
      for (const cand of shortlist) {
        verifiedCandidates.push({
          ...cand,
          verifiedSim: cand.singleSim,
          checks: 1,
          extraScores: [],
        });
      }
    }

    verifiedCandidates.sort((a, b) => b.verifiedSim - a.verifiedSim);
    const winner = verifiedCandidates[0];
    const confidence = Math.max(
      0,
      Math.min(100, Math.round(winner.verifiedSim * 100))
    );

    console.info(`${LOG_PREFIX} Sync diagnostics:`, {
      vodLengthSeconds: vod?.lengthSeconds,
      selectedTier: storyboard.quality,
      availableTiers: storyboard.availableTiers,
      storyboardCount: storyboard.count,
      rawInterval: storyboard.interval,
      effectiveInterval: Number(effectiveInterval.toFixed(4)),
      ytSamplesCaptured: targetFrames.map(
        (f) => `${f.captureTime}s (lum:${Math.round(f.sig.avgLum)})`
      ),
      bestFrameIndex: winner.idx,
      bestMatchedYtSample: `${winner.sampleTime}s`,
      calculatedStartOffset: formatTimestamp(winner.startOffset),
      confidence: `${confidence}%`,
      verifiedTopCandidates: verifiedCandidates.map((c) => ({
        frameIdx: c.idx,
        ytSample: `${c.sampleTime}s`,
        startOffset: formatTimestamp(c.startOffset),
        singleSim: `${Math.round(c.singleSim * 100)}%`,
        extraChecks: c.extraScores.map((s) => `${s}%`),
        finalScore: `${Math.round(c.verifiedSim * 100)}%`,
      })),
    });

    return {
      calculatedStartOffset: winner.startOffset,
      confidence,
      framesScanned,
      totalBytes,
    };
  }

  async function refineOffsetWithHLS(vodId, coarseOffsetSeconds, _targetHash) {
    try {
      const res = await sendBackgroundMessage({
        type: 'REFINE_OFFSET_HLS',
        vodId,
        coarseOffsetSeconds,
      });

      if (res && res.supported && typeof res.offsetSeconds === 'number') {
        return { offsetSeconds: res.offsetSeconds, refined: true };
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} HLS refinement fallback skipped:`, err.message);
    }

    return { offsetSeconds: coarseOffsetSeconds, refined: false };
  }

  TCS.sync = TCS.sync || {};
  TCS.sync.refinement = {
    waitForSeekAndFrame,
    drawCroppedToHashCanvas,
    captureYoutubeTargetFrames,
    captureVideoFrameSignature,
    refineOffsetWithVideoScan,
    findCoarseOffsetViaStoryboards,
    refineOffsetWithHLS,
  };
})();
