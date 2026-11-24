(() => {
  'use strict';

  const TCS = (globalThis.TCS = globalThis.TCS || {});
  const {
    SYNC_GLOBAL_STEP_SEC,
    SYNC_Z_MIN,
    SYNC_Z_MAX,
    SYNC_SEGMENT_PENALTY,
    SYNC_MIN_SEGMENT_EVIDENCE,
    SYNC_EVIDENCE_Z,
  } = TCS.constants;
  const { t } = TCS.i18n;
  const { compareSignatures } = TCS.sync.signature;
  const { getCandidateTwIntervals } = TCS.sync.storyboard;

  function buildSimilarityMatrix(twSigs, ytSigs) {
    const twLen = twSigs.length;
    const ytLen = ytSigs.length;
    const twValid = new Uint8Array(twLen);
    const ytValid = new Uint8Array(ytLen);
    for (let i = 0; i < twLen; i++) {
      twValid[i] = twSigs[i] && twSigs[i].avgLum >= 6 ? 1 : 0;
    }
    for (let j = 0; j < ytLen; j++) {
      ytValid[j] = ytSigs[j] && ytSigs[j].avgLum >= 6 ? 1 : 0;
    }

    const sim = new Float32Array(twLen * ytLen);
    for (let i = 0; i < twLen; i++) {
      if (!twValid[i]) continue;
      const twSig = twSigs[i];
      const rowOff = i * ytLen;
      for (let j = 0; j < ytLen; j++) {
        if (!ytValid[j]) continue;
        sim[rowOff + j] = compareSignatures(twSig, ytSigs[j]);
      }
    }
    return { sim, twLen, ytLen, twValid, ytValid };
  }

  function buildZScoreMatrix(matrix) {
    const { sim, twLen, ytLen, twValid, ytValid } = matrix;
    const rowMean = new Float64Array(twLen);
    const rowStd = new Float64Array(twLen);
    const colMean = new Float64Array(ytLen);
    const colStd = new Float64Array(ytLen);
    const colCount = new Float64Array(ytLen);
    const colSq = new Float64Array(ytLen);

    for (let i = 0; i < twLen; i++) {
      if (!twValid[i]) continue;
      let s1 = 0;
      let s2 = 0;
      let n = 0;
      const rowOff = i * ytLen;
      for (let j = 0; j < ytLen; j++) {
        if (!ytValid[j]) continue;
        const v = sim[rowOff + j];
        s1 += v;
        s2 += v * v;
        n += 1;
        colMean[j] += v;
        colSq[j] += v * v;
        colCount[j] += 1;
      }
      if (n > 0) {
        rowMean[i] = s1 / n;
        rowStd[i] = Math.max(
          0.01,
          Math.sqrt(Math.max(0, s2 / n - rowMean[i] * rowMean[i]))
        );
      }
    }
    for (let j = 0; j < ytLen; j++) {
      const n = colCount[j];
      if (n > 0) {
        colMean[j] /= n;
        colStd[j] = Math.max(
          0.01,
          Math.sqrt(Math.max(0, colSq[j] / n - colMean[j] * colMean[j]))
        );
      }
    }

    const z = new Float32Array(twLen * ytLen);
    for (let i = 0; i < twLen; i++) {
      const rowOff = i * ytLen;
      for (let j = 0; j < ytLen; j++) {
        if (!twValid[i] || !ytValid[j]) {
          z[rowOff + j] = NaN;
          continue;
        }
        const v = sim[rowOff + j];
        const zr = (v - rowMean[i]) / rowStd[i];
        const zc = (v - colMean[j]) / colStd[j];
        z[rowOff + j] = Math.max(
          SYNC_Z_MIN,
          Math.min(SYNC_Z_MAX, 0.5 * (zr + zc))
        );
      }
    }
    return z;
  }

  function sampleMatrixRow(values, ytLen, i, pos) {
    if (!(pos >= -0.5) || pos > ytLen - 0.5) return NaN;
    const p = Math.max(0, Math.min(ytLen - 1, pos));
    const j0 = Math.floor(p);
    const j1 = Math.min(ytLen - 1, j0 + 1);
    const f = p - j0;
    const v0 = values[i * ytLen + j0];
    const v1 = values[i * ytLen + j1];
    if (Number.isNaN(v0)) return f >= 0.5 ? v1 : NaN;
    if (Number.isNaN(v1)) return f < 0.5 ? v0 : NaN;
    return v0 + (v1 - v0) * f;
  }

  function scanGlobalOffsets(
    z,
    matrix,
    twInterval,
    ytInterval,
    oMin,
    oMax,
    step
  ) {
    const { twLen, ytLen, twValid } = matrix;
    const ytMax = (ytLen - 1) * ytInterval;
    const count = Math.max(1, Math.floor((oMax - oMin) / step) + 1);
    const scores = new Float32Array(count);
    const counts = new Uint16Array(count);
    const maxPossible = Math.max(1, Math.floor(ytMax / twInterval));
    const minN = Math.max(1, Math.min(3, maxPossible));

    for (let k = 0; k < count; k++) {
      const o = oMin + k * step;
      const iFirst = Math.max(
        0,
        Math.ceil((o - 0.5 * ytInterval) / twInterval)
      );
      const iLast = Math.min(
        twLen - 1,
        Math.floor((o + ytMax + 0.5 * ytInterval) / twInterval)
      );
      let sum = 0;
      let n = 0;
      for (let i = iFirst; i <= iLast; i++) {
        if (!twValid[i]) continue;
        const v = sampleMatrixRow(
          z,
          ytLen,
          i,
          (i * twInterval - o) / ytInterval
        );
        if (Number.isNaN(v)) continue;
        sum += v;
        n += 1;
      }
      counts[k] = n;
      scores[k] = n >= minN ? sum / Math.sqrt(n) : -Infinity;
    }
    return { scores, counts, oMin, step };
  }

  function pickDistinctPeaks(scan, maxPeaks, minSeparation) {
    const { scores, counts, oMin, step } = scan;
    const order = [];
    for (let k = 0; k < scores.length; k++) {
      if (Number.isFinite(scores[k])) order.push(k);
    }
    order.sort((a, b) => scores[b] - scores[a]);
    const peaks = [];
    for (const k of order) {
      const offset = oMin + k * step;
      if (peaks.every((p) => Math.abs(p.offset - offset) >= minSeparation)) {
        peaks.push({ offset, score: scores[k], validCount: counts[k] });
        if (peaks.length >= maxPeaks) break;
      }
    }
    return peaks;
  }

  function collectSparseCandidateOffsets(
    z,
    matrix,
    twInterval,
    ytInterval,
    globalPeaks,
    oMin,
    oMax
  ) {
    const { twLen, ytLen, twValid, ytValid } = matrix;
    const binSize = Math.max(4, Math.round(ytInterval * 0.6));
    const bins = new Map();

    for (let i = 0; i < twLen; i++) {
      if (!twValid[i]) continue;
      const twTime = i * twInterval;
      const rowOff = i * ytLen;
      for (let j = 0; j < ytLen; j++) {
        if (!ytValid[j]) continue;
        const zv = z[rowOff + j];
        if (!(zv >= SYNC_EVIDENCE_Z)) continue;
        const off = twTime - j * ytInterval;
        if (off < oMin || off > oMax) continue;
        const b = Math.round(off / binSize);
        for (let db = -1; db <= 1; db++) {
          const key = b + db;
          const w = db === 0 ? zv : zv * 0.5;
          let entry = bins.get(key);
          if (!entry) {
            entry = { weight: 0, weightedOff: 0, count: 0 };
            bins.set(key, entry);
          }
          entry.weight += w;
          entry.weightedOff += off * w;
          if (db === 0) entry.count += 1;
        }
      }
    }

    const ranked = [];
    for (const entry of bins.values()) {
      if (entry.count >= 1 && entry.weight >= 2.5) {
        ranked.push({
          offset: entry.weightedOff / entry.weight,
          weight: entry.weight,
        });
      }
    }
    ranked.sort((a, b) => b.weight - a.weight);

    const candidates = [];
    const addUnique = (off) => {
      const rounded = Math.round(off);
      if (candidates.every((c) => Math.abs(c - rounded) >= 4)) {
        candidates.push(rounded);
      }
    };

    for (const p of globalPeaks) addUnique(p.offset);
    for (const r of ranked) {
      addUnique(r.offset);
      if (candidates.length >= 80) break;
    }
    candidates.sort((a, b) => a - b);
    return candidates;
  }

  function viterbiSparseOffsetPath(
    z,
    matrix,
    twInterval,
    ytInterval,
    candidateOffsets,
    penalty
  ) {
    const { twLen, ytLen, twValid } = matrix;
    const M = candidateOffsets.length;
    if (M === 0) return new Float64Array(ytLen);
    if (M === 1) {
      const p = new Float64Array(ytLen);
      p.fill(candidateOffsets[0]);
      return p;
    }

    let V = new Float64Array(M);
    let Vn = new Float64Array(M);
    const E = new Float64Array(M);
    const jumpIdx = new Int16Array(ytLen * M);

    for (let j = 0; j < ytLen; j++) {
      E.fill(0);
      for (let m = 0; m < M; m++) {
        const o = candidateOffsets[m];
        const tLo = o + (j - 0.5) * ytInterval;
        const tHi = o + (j + 0.5) * ytInterval;
        const iLo = Math.max(0, Math.ceil(tLo / twInterval));
        const iHi = Math.min(twLen - 1, Math.floor(tHi / twInterval));
        for (let i = iLo; i <= iHi; i++) {
          if (!twValid[i]) continue;
          const pos = (i * twInterval - o) / ytInterval;
          if (pos < j - 0.5 || pos >= j + 0.5) continue;
          const v = sampleMatrixRow(z, ytLen, i, pos);
          if (!Number.isNaN(v)) E[m] += v;
        }
      }

      if (j === 0) {
        for (let m = 0; m < M; m++) {
          V[m] = E[m];
          jumpIdx[m] = -1;
        }
        continue;
      }

      let best = -Infinity;
      let bestM = 0;
      for (let m = 0; m < M; m++) {
        if (V[m] > best) {
          best = V[m];
          bestM = m;
        }
      }
      const jumpVal = best - penalty;
      const rowBase = j * M;
      for (let m = 0; m < M; m++) {
        if (jumpVal > V[m]) {
          Vn[m] = jumpVal + E[m];
          jumpIdx[rowBase + m] = bestM;
        } else {
          Vn[m] = V[m] + E[m];
          jumpIdx[rowBase + m] = -1;
        }
      }
      const tmp = V;
      V = Vn;
      Vn = tmp;
    }

    let m = 0;
    let best = -Infinity;
    for (let q = 0; q < M; q++) {
      if (V[q] > best) {
        best = V[q];
        m = q;
      }
    }
    const path = new Float64Array(ytLen);
    for (let j = ytLen - 1; j >= 0; j--) {
      path[j] = candidateOffsets[m];
      if (j > 0) {
        const prev = jumpIdx[j * M + m];
        if (prev >= 0) m = prev;
      }
    }
    return path;
  }

  function collectSegmentEvidence(
    z,
    matrix,
    twInterval,
    ytInterval,
    offset,
    jStart,
    jEnd
  ) {
    const { twLen, ytLen, twValid } = matrix;
    const items = [];
    for (let i = 0; i < twLen; i++) {
      if (!twValid[i]) continue;
      const pos = (i * twInterval - offset) / ytInterval;
      if (pos < jStart - 0.5 || pos >= jEnd + 0.5) continue;
      const v = sampleMatrixRow(z, ytLen, i, pos);
      if (Number.isNaN(v)) continue;
      items.push({ i, pos, z: v });
    }
    return items;
  }

  function refineSegmentOffset(
    matrix,
    z,
    twInterval,
    ytInterval,
    offset,
    evidence
  ) {
    const { sim, ytLen, ytValid } = matrix;
    const samples = [];
    for (const ev of evidence) {
      if (ev.z < SYNC_EVIDENCE_Z) continue;
      const center = Math.round(ev.pos);
      let bj = -1;
      let bs = -Infinity;
      for (let j = center - 1; j <= center + 1; j++) {
        if (j < 0 || j >= ytLen || !ytValid[j]) continue;
        const s = sim[ev.i * ytLen + j];
        if (s > bs) {
          bs = s;
          bj = j;
        }
      }
      if (bj < 0) continue;
      let delta = 0;
      if (bj > 0 && bj < ytLen - 1 && ytValid[bj - 1] && ytValid[bj + 1]) {
        const sl = sim[ev.i * ytLen + bj - 1];
        const sr = sim[ev.i * ytLen + bj + 1];
        const denom = sl - 2 * bs + sr;
        if (denom < -1e-6) {
          delta = Math.max(-0.5, Math.min(0.5, (0.5 * (sl - sr)) / denom));
        }
      }
      const ytTime = (bj + delta) * ytInterval;
      samples.push({ offset: ev.i * twInterval - ytTime, w: ev.z, sim: bs });
    }
    if (samples.length === 0) return { offset, refinedFrames: 0, meanSim: 0 };

    samples.sort((a, b) => a.offset - b.offset);
    const totalW = samples.reduce((acc, s) => acc + s.w, 0);
    let accW = 0;
    let median = samples[0].offset;
    for (const s of samples) {
      accW += s.w;
      if (accW >= totalW / 2) {
        median = s.offset;
        break;
      }
    }
    const meanSim = samples.reduce((acc, s) => acc + s.sim, 0) / samples.length;
    if (Math.abs(median - offset) > 1.5 * ytInterval) {
      return { offset, refinedFrames: 0, meanSim };
    }
    return { offset: median, refinedFrames: samples.length, meanSim };
  }

  function findCutBoundary(ytSigs, jFrom, jTo) {
    let bestJ = Math.round((jFrom + jTo) / 2);
    let bestSim = Infinity;
    for (let j = Math.max(1, jFrom); j <= jTo; j++) {
      const a = ytSigs[j - 1];
      const b = ytSigs[j];
      if (!a || !b) continue;
      const s = compareSignatures(a, b);
      if (s < bestSim) {
        bestSim = s;
        bestJ = j;
      }
    }
    return bestJ;
  }

  function buildSegmentsFromPath(
    path,
    z,
    matrix,
    ytSigs,
    twInterval,
    ytInterval,
    fallbackOffset
  ) {
    const ytLen = path.length;
    let runs = [];
    let start = 0;
    for (let j = 1; j <= ytLen; j++) {
      if (j === ytLen || path[j] !== path[start]) {
        runs.push({ jStart: start, jEnd: j - 1, offset: path[start] });
        start = j;
      }
    }

    const scoreRun = (run) => {
      const ev = collectSegmentEvidence(
        z,
        matrix,
        twInterval,
        ytInterval,
        run.offset,
        run.jStart,
        run.jEnd
      );
      run.evidence = ev;
      run.strong = ev.filter((e) => e.z >= SYNC_EVIDENCE_Z).length;
      run.sumZ = ev.reduce((acc, e) => acc + e.z, 0);
    };

    for (let guard = 0; guard < 50; guard++) {
      runs.forEach(scoreRun);
      let weakestIdx = -1;
      let weakestSum = Infinity;
      runs.forEach((run, idx) => {
        const isEdge = idx === 0 || idx === runs.length - 1;
        const minStrong = isEdge
          ? SYNC_MIN_SEGMENT_EVIDENCE + 1
          : SYNC_MIN_SEGMENT_EVIDENCE;
        if (
          runs.length > 1 &&
          (run.strong < minStrong || run.sumZ < SYNC_SEGMENT_PENALTY)
        ) {
          if (run.sumZ < weakestSum) {
            weakestSum = run.sumZ;
            weakestIdx = idx;
          }
        }
      });
      if (weakestIdx < 0) break;
      const weak = runs[weakestIdx];
      const left = runs[weakestIdx - 1];
      const right = runs[weakestIdx + 1];
      const target = !left
        ? right
        : !right
          ? left
          : left.sumZ >= right.sumZ
            ? left
            : right;
      if (target === left) left.jEnd = weak.jEnd;
      else right.jStart = weak.jStart;
      runs.splice(weakestIdx, 1);
      const merged = [];
      for (const r of runs) {
        const last = merged[merged.length - 1];
        if (last && Math.abs(last.offset - r.offset) < 1e-6) last.jEnd = r.jEnd;
        else merged.push(r);
      }
      runs = merged;
    }
    runs.forEach(scoreRun);

    if (runs.length === 0 || runs.every((r) => r.strong === 0)) {
      return [
        {
          jStart: 0,
          jEnd: ytLen - 1,
          offset: fallbackOffset,
          strong: 0,
          sumZ: 0,
          refinedFrames: 0,
          meanSim: 0,
          evidence: [],
        },
      ];
    }

    for (const run of runs) {
      const refined = refineSegmentOffset(
        matrix,
        z,
        twInterval,
        ytInterval,
        run.offset,
        run.evidence
      );
      run.offset = refined.offset;
      run.refinedFrames = refined.refinedFrames;
      run.meanSim = refined.meanSim;
    }

    const fused = [];
    for (const r of runs) {
      const last = fused[fused.length - 1];
      if (last && Math.abs(last.offset - r.offset) < 8) {
        const wl = Math.max(1, last.strong);
        const wr = Math.max(1, r.strong);
        last.offset = (last.offset * wl + r.offset * wr) / (wl + wr);
        last.jEnd = r.jEnd;
        last.strong += r.strong;
        last.sumZ += r.sumZ;
        last.meanSim = (last.meanSim * wl + r.meanSim * wr) / (wl + wr);
        last.evidence = last.evidence.concat(r.evidence);
      } else {
        fused.push(r);
      }
    }

    for (let s = 1; s < fused.length; s++) {
      const prev = fused[s - 1];
      const cur = fused[s];
      const prevStrong = prev.evidence.filter((e) => e.z >= SYNC_EVIDENCE_Z);
      const curStrong = cur.evidence.filter((e) => e.z >= SYNC_EVIDENCE_Z);
      const lastPrev = prevStrong.length
        ? Math.max(...prevStrong.map((e) => e.pos))
        : prev.jStart;
      const firstCur = curStrong.length
        ? Math.min(...curStrong.map((e) => e.pos))
        : cur.jEnd;
      const jFrom = Math.max(prev.jStart + 1, Math.ceil(lastPrev));
      const jTo = Math.min(cur.jEnd, Math.floor(firstCur));
      if (jTo >= jFrom) {
        const cut = findCutBoundary(ytSigs, jFrom, jTo);
        prev.jEnd = cut - 1;
        cur.jStart = cut;
      }
    }
    return fused;
  }

  function selectSegmentAnchors(
    evidence,
    twInterval,
    offset,
    ytMax,
    maxAnchors = 3
  ) {
    const candidates = (evidence || [])
      .filter((ev) => {
        const ytT = ev.i * twInterval - offset;
        return ev.z >= 1.2 && ytT >= 12 && ytT <= ytMax - 12;
      })
      .sort((a, b) => b.z - a.z);

    const chosen = [];
    for (const ev of candidates) {
      const ytT = ev.i * twInterval - offset;
      if (chosen.every((c) => Math.abs(c.estYtTime - ytT) >= 60)) {
        chosen.push({ twIdx: ev.i, estYtTime: ytT, z: ev.z });
        if (chosen.length >= maxAnchors) break;
      }
    }
    return chosen;
  }

  function computeStoryboardConfidence(margin, strongMeanSim) {
    const sepFactor = 1 / (1 + Math.exp(-(margin - 1.5) * 0.9));
    const baseSim = strongMeanSim > 0 ? strongMeanSim : 0.65;
    if (margin >= 1.5) {
      return Math.max(
        0,
        Math.min(95, Math.round((baseSim * 0.65 + sepFactor * 0.35) * 100))
      );
    }
    return Math.max(
      0,
      Math.min(90, Math.round(Math.min(baseSim, sepFactor) * 100))
    );
  }

  function alignStoryboardsGlobal(
    ytSigs,
    ytInterval,
    twSigs,
    vod,
    twStoryboard
  ) {
    const matrix = buildSimilarityMatrix(twSigs, ytSigs);
    const z = buildZScoreMatrix(matrix);
    const ytMax = (matrix.ytLen - 1) * ytInterval;
    const vodDuration =
      Number(vod?.lengthSeconds) ||
      matrix.twLen * (Number(twStoryboard.interval) || 10);
    const intervalCandidates = getCandidateTwIntervals(vod, twStoryboard);

    let bestRun = null;
    for (const twInterval of intervalCandidates) {
      const oMin = -Math.min(ytMax * 0.25, 900);
      const oMax = vodDuration;
      const scan = scanGlobalOffsets(
        z,
        matrix,
        twInterval,
        ytInterval,
        oMin,
        oMax,
        SYNC_GLOBAL_STEP_SEC
      );
      const peaks = pickDistinctPeaks(scan, 6, Math.max(25, ytInterval * 2.5));
      if (peaks.length === 0) continue;
      if (
        !bestRun ||
        (peaks[0].score > bestRun.peaks[0].score * 1.05 &&
          peaks[0].score > bestRun.peaks[0].score + 0.5)
      ) {
        bestRun = { twInterval, peaks };
      }
    }

    if (!bestRun) {
      throw new Error(
        t(
          'errorAlignStoryboards',
          [],
          'Could not align YouTube and Twitch storyboards.'
        )
      );
    }

    const { twInterval, peaks } = bestRun;
    const globalOffset = peaks[0].offset;

    const dpMin = -Math.min(ytMax, 1800);
    const candidateOffsets = collectSparseCandidateOffsets(
      z,
      matrix,
      twInterval,
      ytInterval,
      peaks,
      dpMin,
      vodDuration
    );
    const path = viterbiSparseOffsetPath(
      z,
      matrix,
      twInterval,
      ytInterval,
      candidateOffsets,
      SYNC_SEGMENT_PENALTY
    );
    const runs = buildSegmentsFromPath(
      path,
      z,
      matrix,
      ytSigs,
      twInterval,
      ytInterval,
      globalOffset
    );

    const segments = runs.map((r, idx) => ({
      ytStart: idx === 0 ? 0 : r.jStart * ytInterval - ytInterval / 2,
      ytEnd: idx === runs.length - 1 ? Infinity : (r.jEnd + 0.5) * ytInterval,
      offset: Math.max(0, Math.round(r.offset * 10) / 10),
      strongFrames: r.strong,
      sumZ: Math.round(r.sumZ * 10) / 10,
      meanSim: r.meanSim || 0,
      anchors: selectSegmentAnchors(r.evidence, twInterval, r.offset, ytMax, 3),
    }));

    const unrelatedSep = Math.max(90, ytInterval * 9);
    const competitor = peaks.find(
      (p) =>
        p !== peaks[0] &&
        segments.every((s) => Math.abs(s.offset - p.offset) > unrelatedSep)
    );
    const margin = peaks[0].score - (competitor ? competitor.score : 0);
    const primarySeg = segments.reduce(
      (a, b) => (b.sumZ > a.sumZ ? b : a),
      segments[0]
    );
    const confidence = computeStoryboardConfidence(margin, primarySeg.meanSim);

    return {
      twInterval,
      winner: {
        offset: segments[0].offset,
        meanSim: primarySeg.meanSim || 0,
        validCount: peaks[0].validCount,
        bestPairIdx: primarySeg.anchors[0]?.twIdx ?? -1,
        score: peaks[0].score,
      },
      segments,
      distinctTop: peaks,
      confidence,
      margin,
    };
  }

  TCS.sync = TCS.sync || {};
  TCS.sync.alignment = {
    buildSimilarityMatrix,
    buildZScoreMatrix,
    sampleMatrixRow,
    scanGlobalOffsets,
    pickDistinctPeaks,
    collectSparseCandidateOffsets,
    viterbiSparseOffsetPath,
    collectSegmentEvidence,
    refineSegmentOffset,
    findCutBoundary,
    buildSegmentsFromPath,
    selectSegmentAnchors,
    computeStoryboardConfidence,
    alignStoryboardsGlobal,
  };
})();
