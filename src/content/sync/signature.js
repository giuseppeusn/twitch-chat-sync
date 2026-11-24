(() => {
  'use strict';

  const TCS = (globalThis.TCS = globalThis.TCS || {});
  const { SIG_GRID_W, SIG_GRID_H, EDGE_CROP_RATIO } = TCS.constants;

  function computeFrameSignature(imageData) {
    const data = imageData.data;
    const totalPixels = SIG_GRID_W * SIG_GRID_H;
    const gray = new Float32Array(totalPixels);
    const rgb = new Uint8Array(totalPixels * 3);

    let lumSum = 0;
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const l = r * 0.299 + g * 0.587 + b * 0.114;
      gray[i] = l;
      lumSum += l;
      const rIdx = i * 3;
      rgb[rIdx] = r;
      rgb[rIdx + 1] = g;
      rgb[rIdx + 2] = b;
    }

    const avgLum = lumSum / totalPixels;

    const normGray = new Float32Array(totalPixels);
    let sqSum = 0;
    for (let i = 0; i < totalPixels; i++) {
      const v = gray[i] - avgLum;
      normGray[i] = v;
      sqSum += v * v;
    }
    const norm = Math.sqrt(sqSum);
    if (norm > 1e-5) {
      const invNorm = 1 / norm;
      for (let i = 0; i < totalPixels; i++) {
        normGray[i] *= invNorm;
      }
    }

    const grid8 = new Float32Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const y2 = y * 2;
        const x2 = x * 2;
        grid8[y * 8 + x] =
          (gray[y2 * 16 + x2] +
            gray[y2 * 16 + x2 + 1] +
            gray[(y2 + 1) * 16 + x2] +
            gray[(y2 + 1) * 16 + x2 + 1]) *
          0.25;
      }
    }

    const dhash = new Uint32Array(4);
    let bit = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const nextX = (x + 1) & 7;
        if (grid8[y * 8 + x] > grid8[y * 8 + nextX]) {
          dhash[bit >>> 5] |= 1 << (bit & 31);
        }
        bit += 1;
      }
    }
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const nextY = (y + 1) & 7;
        if (grid8[y * 8 + x] > grid8[nextY * 8 + x]) {
          dhash[bit >>> 5] |= 1 << (bit & 31);
        }
        bit += 1;
      }
    }

    return { normGray, dhash, rgb, avgLum };
  }

  function computeSignatureFromRgba(data, imgWidth, imgHeight, sx, sy, sw, sh) {
    const padX = sw * EDGE_CROP_RATIO;
    const padY = sh * EDGE_CROP_RATIO;
    const x0 = sx + padX;
    const y0 = sy + padY;
    const cw = Math.max(1, sw - padX * 2);
    const ch = Math.max(1, sh - padY * 2);
    const cells = SIG_GRID_W * SIG_GRID_H;
    const acc = new Float64Array(cells * 4);

    const yFrom = Math.max(0, Math.floor(y0));
    const yTo = Math.min(imgHeight, Math.ceil(y0 + ch));
    const xFrom = Math.max(0, Math.floor(x0));
    const xTo = Math.min(imgWidth, Math.ceil(x0 + cw));

    for (let y = yFrom; y < yTo; y++) {
      const cy = y + 0.5;
      if (cy < y0 || cy >= y0 + ch) continue;
      const gy = Math.min(
        SIG_GRID_H - 1,
        Math.floor(((cy - y0) / ch) * SIG_GRID_H)
      );
      const rowBase = y * imgWidth;
      for (let x = xFrom; x < xTo; x++) {
        const cx = x + 0.5;
        if (cx < x0 || cx >= x0 + cw) continue;
        const gx = Math.min(
          SIG_GRID_W - 1,
          Math.floor(((cx - x0) / cw) * SIG_GRID_W)
        );
        const si = (rowBase + x) * 4;
        const di = (gy * SIG_GRID_W + gx) * 4;
        acc[di] += data[si];
        acc[di + 1] += data[si + 1];
        acc[di + 2] += data[si + 2];
        acc[di + 3] += 1;
      }
    }

    const out = new Uint8ClampedArray(cells * 4);
    for (let c = 0; c < cells; c++) {
      const n = acc[c * 4 + 3] || 1;
      out[c * 4] = acc[c * 4] / n;
      out[c * 4 + 1] = acc[c * 4 + 1] / n;
      out[c * 4 + 2] = acc[c * 4 + 2] / n;
      out[c * 4 + 3] = 255;
    }
    return computeFrameSignature({ data: out });
  }

  function popcount32(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  function compareSignatures(sigA, sigB) {
    const gA = sigA.normGray;
    const gB = sigB.normGray;
    let dot = 0;
    for (let i = 0; i < gA.length; i++) {
      dot += gA[i] * gB[i];
    }
    const nccSim = Math.max(0, Math.min(1, (dot + 1) * 0.5));

    let hamming = 0;
    for (let i = 0; i < 4; i++) {
      hamming += popcount32((sigA.dhash[i] ^ sigB.dhash[i]) >>> 0);
    }
    const dhashSim = 1 - hamming / 128;

    const rgbA = sigA.rgb;
    const rgbB = sigB.rgb;
    let absDiff = 0;
    for (let i = 0; i < rgbA.length; i++) {
      absDiff += Math.abs(rgbA[i] - rgbB[i]);
    }
    const rgbSim = 1 - absDiff / (rgbA.length * 255);

    return nccSim * 0.45 + dhashSim * 0.35 + rgbSim * 0.2;
  }

  TCS.sync = TCS.sync || {};
  TCS.sync.signature = {
    computeFrameSignature,
    computeSignatureFromRgba,
    popcount32,
    compareSignatures,
  };
})();
