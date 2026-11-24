import { LOG_PREFIX, VIDEO_COMMENTS_PERSISTED_HASH } from './constants.js';
import { arrayBufferToBase64, t, twitchGqlRequest } from './utils.js';

let persistedChatQueryDisabled = false;

export async function fetchVodMetadataAndStoryboards(vodId) {
  const query = `
    query VideoStoryboardMetadata($id: ID!) {
      video(id: $id) {
        id
        title
        lengthSeconds
        seekPreviewsURL
        animatedPreviewURL
        owner {
          id
          login
          displayName
        }
      }
    }
  `;

  const gqlResult = await twitchGqlRequest({
    operationName: 'VideoStoryboardMetadata',
    variables: { id: String(vodId) },
    query,
  });

  const video = gqlResult?.data?.video;
  if (!video) {
    throw new Error(t('bgVodNotFound', [String(vodId)], `VOD "${vodId}" not found on Twitch.`));
  }

  if (!video.seekPreviewsURL) {
    throw new Error(t('bgMissingSeekPreviews', [], 'Twitch did not return seekPreviewsURL for this VOD.'));
  }

  const specResponse = await fetch(video.seekPreviewsURL);
  if (!specResponse.ok) {
    throw new Error(
      t('bgStoryboardManifestHttp', [String(specResponse.status)], `Failed to download storyboard manifest (HTTP ${specResponse.status}).`)
    );
  }

  const specs = await specResponse.json();
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error(t('bgStoryboardManifestEmpty', [], 'Storyboard manifest is empty or has an unexpected format.'));
  }

  const validSpecs = specs.filter(
    (s) => Array.isArray(s.images) && s.images.length > 0 && Number(s.count) > 0
  );
  if (validSpecs.length === 0) {
    throw new Error(t('bgNoValidStoryboardTier', [], 'No valid storyboard tier found in manifest.'));
  }

  const sortedSpecs = [...validSpecs].sort((a, b) => {
    const intA = Number(a.interval) || Infinity;
    const intB = Number(b.interval) || Infinity;
    if (intA !== intB) return intA - intB;

    const countA = Number(a.count) || 0;
    const countB = Number(b.count) || 0;
    if (countA !== countB) return countB - countA;

    const lightA = a.images.length <= 12 ? 1 : 0;
    const lightB = b.images.length <= 12 ? 1 : 0;
    if (lightA !== lightB) return lightB - lightA;
    if (lightA && lightB) return (Number(b.width) || 0) - (Number(a.width) || 0);

    return (Number(a.width) || 0) - (Number(b.width) || 0);
  });

  const selectedSpec = sortedSpecs[0];

  const availableTiers = validSpecs.map((s) => ({
    quality: s.quality || 'default',
    width: Number(s.width),
    height: Number(s.height),
    count: Number(s.count),
    interval: Number(s.interval),
    sheets: s.images.length,
  }));

  const baseUrl = video.seekPreviewsURL.substring(
    0,
    video.seekPreviewsURL.lastIndexOf('/') + 1
  );

  const imageUrls = (selectedSpec.images || []).map((imgPath) => {
    if (/^https?:\/\//i.test(imgPath)) {
      return imgPath;
    }
    return `${baseUrl}${imgPath.replace(/^\//, '')}`;
  });

  return {
    vod: {
      id: video.id,
      title: video.title || `VOD ${video.id}`,
      lengthSeconds: Number(video.lengthSeconds) || 0,
      channel: video.owner?.displayName || video.owner?.login || 'Twitch',
      channelId: video.owner?.id || null,
    },
    storyboard: {
      quality: selectedSpec.quality || 'default',
      width: Number(selectedSpec.width),
      height: Number(selectedSpec.height),
      cols: Number(selectedSpec.cols),
      rows: Number(selectedSpec.rows),
      count: Number(selectedSpec.count),
      interval: Number(selectedSpec.interval) || 10,
      imageUrls,
      availableTiers,
    },
  };
}

export async function fetchSpriteBatch(urls) {
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          return { url, error: `HTTP ${res.status}`, dataUrl: null, byteLength: 0 };
        }
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        const buffer = await res.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);
        return {
          url,
          error: null,
          dataUrl: `data:${contentType};base64,${base64}`,
          byteLength: buffer.byteLength,
        };
      } catch (err) {
        return { url, error: err.message || String(err), dataUrl: null, byteLength: 0 };
      }
    })
  );
  return results;
}

async function fetchChatPageRaw(vodId, offsetSeconds, cursor) {
  const variables = { videoID: String(vodId) };
  if (cursor) {
    variables.cursor = cursor;
  } else {
    variables.contentOffsetSeconds = Math.max(0, Math.floor(offsetSeconds));
  }

  if (!persistedChatQueryDisabled) {
    try {
      const persistedRes = await twitchGqlRequest({
        operationName: 'VideoCommentsByOffsetOrCursor',
        variables,
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: VIDEO_COMMENTS_PERSISTED_HASH,
          },
        },
      });

      const hasPersistedError = persistedRes?.errors?.some((e) =>
        String(e.message || '').includes('PersistedQueryNotFound')
      );

      if (hasPersistedError) {
        persistedChatQueryDisabled = true;
      } else if (persistedRes?.data?.video?.comments) {
        return {
          comments: persistedRes.data.video.comments,
          usedOffsetMode: false,
        };
      }
    } catch (err) {
      if (String(err?.message || '').includes('PersistedQueryNotFound')) {
        persistedChatQueryDisabled = true;
      }
      console.warn(`${LOG_PREFIX} PersistedQuery failed, falling back to inline query:`, err.message);
    }
  }

  const inlineVariables = {
    videoID: String(vodId),
    contentOffsetSeconds: Math.max(0, Math.floor(offsetSeconds || 0)),
  };

  const inlineQuery = `
    query VideoCommentsByOffsetOrCursor($videoID: ID!, $contentOffsetSeconds: Int) {
      video(id: $videoID) {
        comments(contentOffsetSeconds: $contentOffsetSeconds) {
          edges {
            cursor
            node {
              id
              contentOffsetSeconds
              createdAt
              commenter {
                displayName
                login
              }
              message {
                userColor
                userBadges {
                  setID
                  version
                }
                fragments {
                  text
                  emote {
                    emoteID
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    }
  `;

  const inlineRes = await twitchGqlRequest({
    operationName: 'VideoCommentsByOffsetOrCursor',
    variables: inlineVariables,
    query: inlineQuery,
  });

  return {
    comments: inlineRes?.data?.video?.comments || null,
    usedOffsetMode: true,
  };
}

function isSubscriptionNoticeText(text) {
  if (!text) return false;
  return /^(?:\S+\s+(?:subscribed\s+(?:with\s+Prime|at\s+Tier\s+\d)|gifted\s+a\s+Tier\s+\d+\s+sub|is\s+gifting\s+\d+|converted\s+from\s+a\s+Prime|extended\s+their\s+Tier|continued\s+the\s+Gift\s+Sub|se\s+inscreveu\s+(?:com\s+Prime|no\s+Grupo)|presenteou|está\s+presenteando)|An\s+anonymous\s+(?:user|gifter)\s+gifted|They've\s+subscribed\s+for\s+\d+\s+month)/i.test(
    text.trim()
  );
}

function normalizeCommentNode(edge) {
  const node = edge?.node;
  if (!node || !node.message) return null;

  const rawFragments = Array.isArray(node.message.fragments) ? node.message.fragments : [];
  const fragments = rawFragments.map((f) => ({
    text: f?.text || '',
    emoteId: f?.emote?.emoteID || null,
  }));
  const text = fragments.map((f) => f.text).join('').trim();
  if (!text) return null;

  const rawBadges = Array.isArray(node.message.userBadges) ? node.message.userBadges : [];
  const badges = rawBadges
    .filter((b) => b && b.setID)
    .map((b) => ({
      setID: String(b.setID),
      version: String(b.version ?? ''),
    }));

  const author =
    node.commenter?.displayName || node.commenter?.login || t('anonymousAuthor', [], 'Anonymous');

  const createdAtMs = node.createdAt ? Date.parse(node.createdAt) : NaN;

  return {
    id: node.id || `${node.contentOffsetSeconds}-${author}-${text.slice(0, 12)}`,
    offsetSeconds: Number(node.contentOffsetSeconds) || 0,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
    author,
    color: node.message.userColor || null,
    badges,
    fragments,
    isSubscription: isSubscriptionNoticeText(text),
    text,
  };
}

function applySubSecondOffsets(messages) {
  const groups = new Map();
  for (const msg of messages) {
    const sec = Math.floor(msg.offsetSeconds);
    let bucket = groups.get(sec);
    if (!bucket) {
      bucket = [];
      groups.set(sec, bucket);
    }
    bucket.push(msg);
  }

  for (const [sec, bucket] of groups.entries()) {
    if (bucket.length <= 1) continue;

    const withTs = bucket.filter((m) => typeof m.createdAtMs === 'number');
    if (withTs.length === bucket.length) {
      bucket.sort((a, b) => a.createdAtMs - b.createdAtMs);
      const minMs = bucket[0].createdAtMs;
      const spanMs = Math.max(1, bucket[bucket.length - 1].createdAtMs - minMs);
      for (let i = 0; i < bucket.length; i++) {
        const rel = spanMs > 1000 ? (i / bucket.length) * 0.96 : ((bucket[i].createdAtMs - minMs) / 1000);
        const frac = Math.min(0.98, Math.max(0, rel)) + (i / bucket.length) * 0.015;
        bucket[i].offsetSeconds = sec + Math.min(0.995, frac);
      }
    } else {
      for (let i = 0; i < bucket.length; i++) {
        bucket[i].offsetSeconds = sec + (i / bucket.length) * 0.96;
      }
    }
  }
}

export async function fetchChatRange({ vodId, startOffset, endOffset, cursor = null, maxPages = 16 }) {
  const messages = [];
  const seenIds = new Set();
  let currentCursor = cursor;
  let currentOffset = Math.max(0, Math.floor(startOffset || 0));
  let hasNextPage = true;
  let pagesFetched = 0;
  let lastOffset = currentOffset;
  let emptySteps = 0;

  while (hasNextPage && pagesFetched < maxPages) {
    const { comments, usedOffsetMode } = await fetchChatPageRaw(
      vodId,
      currentOffset,
      persistedChatQueryDisabled ? null : currentCursor
    );
    pagesFetched += 1;

    if (!comments || !Array.isArray(comments.edges) || comments.edges.length === 0) {
      if (usedOffsetMode && typeof endOffset === 'number' && currentOffset + 60 <= endOffset && emptySteps < 3) {
        emptySteps += 1;
        currentOffset += 60;
        lastOffset = Math.max(lastOffset, currentOffset);
        continue;
      }
      hasNextPage = Boolean(usedOffsetMode);
      break;
    }

    emptySteps = 0;
    let pageMaxOffset = currentOffset;
    let addedOnPage = 0;

    for (const edge of comments.edges) {
      const msg = normalizeCommentNode(edge);
      if (msg) {
        if (msg.offsetSeconds > pageMaxOffset) {
          pageMaxOffset = msg.offsetSeconds;
        }
        if (msg.offsetSeconds > lastOffset) {
          lastOffset = msg.offsetSeconds;
        }
        if (!seenIds.has(msg.id)) {
          seenIds.add(msg.id);
          messages.push(msg);
          addedOnPage += 1;
        }
      }
    }

    if (usedOffsetMode) {
      if (pageMaxOffset > currentOffset && addedOnPage > 0) {
        currentOffset = pageMaxOffset;
      } else {
        currentOffset += addedOnPage === 0 ? 2 : 1;
      }
      currentCursor = null;
      hasNextPage = true;
    } else {
      const lastEdge = comments.edges[comments.edges.length - 1];
      currentCursor = lastEdge?.cursor || null;
      hasNextPage = Boolean(comments.pageInfo?.hasNextPage && currentCursor);
    }

    if (typeof endOffset === 'number' && lastOffset >= endOffset) {
      break;
    }
  }

  applySubSecondOffsets(messages);
  messages.sort((a, b) => a.offsetSeconds - b.offsetSeconds);

  return {
    messages,
    nextCursor: currentCursor,
    hasNextPage,
    lastOffset,
    pagesFetched,
  };
}

export async function fetchHlsRefinementStub({ vodId, coarseOffsetSeconds }) {
  return {
    supported: false,
    vodId,
    offsetSeconds: coarseOffsetSeconds,
    message: t('bgHlsNotEnabled', [], 'HLS refinement is not enabled yet; using storyboard offset.'),
  };
}
