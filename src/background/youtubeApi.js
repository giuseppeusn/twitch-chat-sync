import { t } from './utils.js';

export async function fetchYoutubeStoryboards(youtubeId, maxFrames = 900) {
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`);
  if (!pageRes.ok) {
    throw new Error(
      t('bgYoutubeFetchHttp', [String(pageRes.status)], `Failed to fetch YouTube page (HTTP ${pageRes.status}).`)
    );
  }

  const html = await pageRes.text();
  const marker = '"playerStoryboardSpecRenderer":{"spec":"';
  const idx = html.indexOf(marker);
  if (idx === -1) {
    return null;
  }

  const start = idx + marker.length;
  const end = html.indexOf('"', start);
  if (end === -1) return null;

  const rawSpec = html
    .slice(start, end)
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/');

  const durMatch = html.match(/"lengthSeconds":"(\d+)"/);
  const durationSeconds = durMatch ? Number(durMatch[1]) : 0;

  const parts = rawSpec.split('|');
  if (parts.length < 2) return null;

  const baseUrl = parts[0];
  const levels = [];

  for (let i = 1; i < parts.length; i++) {
    const segs = parts[i].split('#');
    if (segs.length < 8) continue;
    const width = Number(segs[0]);
    const height = Number(segs[1]);
    const count = Number(segs[2]);
    const cols = Number(segs[3]);
    const rows = Number(segs[4]);
    const intervalMs = Number(segs[5]);
    const name = segs[6];
    const sigh = segs[7];

    if (!width || !height || !count || !cols || !rows || !intervalMs) continue;

    const framesPerSheet = cols * rows;
    const effectiveCount = Math.min(count, maxFrames);
    const sheetsNeeded = Math.ceil(effectiveCount / framesPerSheet);

    levels.push({
      level: i - 1,
      width,
      height,
      count: effectiveCount,
      totalCount: count,
      cols,
      rows,
      intervalSeconds: intervalMs / 1000,
      name,
      sigh,
      sheetsNeeded,
    });
  }

  if (levels.length === 0) return null;

  const lightLevels = levels.filter((l) => l.sheetsNeeded <= 15);
  const chosen =
    lightLevels.length > 0
      ? lightLevels.sort((a, b) => b.width - a.width)[0]
      : levels.sort((a, b) => a.sheetsNeeded - b.sheetsNeeded)[0];

  const imageUrls = [];
  for (let m = 0; m < chosen.sheetsNeeded; m++) {
    const sheetName = chosen.name.replace('$M', String(m));
    const url =
      baseUrl.replace('$L', String(chosen.level)).replace('$N', sheetName) +
      `&sigh=${encodeURIComponent(chosen.sigh)}`;
    imageUrls.push(url);
  }

  return {
    durationSeconds,
    storyboard: {
      level: chosen.level,
      width: chosen.width,
      height: chosen.height,
      cols: chosen.cols,
      rows: chosen.rows,
      count: chosen.count,
      interval: chosen.intervalSeconds,
      imageUrls,
    },
  };
}
