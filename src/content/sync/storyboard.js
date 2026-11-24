(() => {
  'use strict';

  const TCS = (globalThis.TCS = globalThis.TCS || {});
  const { SPRITE_BATCH_SIZE } = TCS.constants;
  const { t } = TCS.i18n;
  const { sendBackgroundMessage, loadImageFromDataUrl } = TCS.utils;
  const { computeSignatureFromRgba } = TCS.sync.signature;

  function getCandidateTwIntervals(vod, storyboard) {
    const raw = Number(storyboard.interval) || 10;
    const count = Number(storyboard.count) || 0;
    const lengthSec = Number(vod?.lengthSeconds) || 0;
    const list = [];
    const pushUnique = (val) => {
      if (!Number.isFinite(val) || val <= 0) return;
      if (list.every((existing) => Math.abs(existing - val) > 0.04)) {
        list.push(val);
      }
    };

    if (lengthSec > 0 && count > 1) {
      const spanNm1 = lengthSec / (count - 1);
      const spanN = lengthSec / count;
      if ((count - 1) * raw > lengthSec) {
        pushUnique(spanNm1);
        pushUnique(spanN);
        pushUnique(raw);
      } else {
        pushUnique(raw);
        pushUnique(spanNm1);
        pushUnique(spanN);
      }
    } else {
      pushUnique(raw);
    }
    return list;
  }

  function computeEffectiveInterval(vod, storyboard) {
    const candidates = getCandidateTwIntervals(vod, storyboard);
    return candidates[0];
  }

  async function extractStoryboardSignatures(storyboard, abortId, onProgress) {
    const { width, height, cols, rows, count, imageUrls } = storyboard;
    const framesPerSheet = cols * rows;

    const sheetCanvas = document.createElement('canvas');
    const sheetCtx = sheetCanvas.getContext('2d', { willReadFrequently: true });

    const signatures = [];
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
        const imgW = spriteImg.naturalWidth;
        const imgH = spriteImg.naturalHeight;
        if (!imgW || !imgH) continue;

        if (sheetCanvas.width !== imgW || sheetCanvas.height !== imgH) {
          sheetCanvas.width = imgW;
          sheetCanvas.height = imgH;
        }
        sheetCtx.drawImage(spriteImg, 0, 0);
        const sheetPixels = sheetCtx.getImageData(0, 0, imgW, imgH).data;

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const globalFrameIdx = sheetIndex * framesPerSheet + r * cols + c;
            if (count && globalFrameIdx >= count) break;

            const sx = c * width;
            const sy = r * height;
            if (sx + width > imgW || sy + height > imgH) {
              continue;
            }

            signatures[globalFrameIdx] = computeSignatureFromRgba(
              sheetPixels,
              imgW,
              imgH,
              sx,
              sy,
              width,
              height
            );
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

    return { signatures, framesScanned, totalBytes };
  }

  TCS.sync = TCS.sync || {};
  TCS.sync.storyboard = {
    getCandidateTwIntervals,
    computeEffectiveInterval,
    extractStoryboardSignatures,
  };
})();
