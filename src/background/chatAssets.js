import { LOG_PREFIX, MAX_IMAGE_CACHE_SIZE } from './constants.js';
import { arrayBufferToBase64, fetchJsonSafe, twitchGqlRequest } from './utils.js';

let globalBadgesCache = null;
let globalBttvCache = null;
let global7tvCache = null;
const imageDataUrlCache = new Map();

async function getTwitchGlobalBadges() {
  if (globalBadgesCache) return globalBadgesCache;
  try {
    const res = await twitchGqlRequest({
      query: `query {
        badges {
          setID
          version
          imageURL(size: NORMAL)
          title
        }
      }`,
    });
    const list = res?.data?.badges;
    if (Array.isArray(list)) {
      globalBadgesCache = list;
      return list;
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to fetch global badges:`, err.message);
  }
  return [];
}

async function getTwitchChannelBadges(channelId) {
  if (!channelId) return [];
  try {
    const res = await twitchGqlRequest({
      query: `query($id: ID!) {
        user(id: $id) {
          broadcastBadges {
            setID
            version
            imageURL(size: NORMAL)
            title
          }
        }
      }`,
      variables: { id: String(channelId) },
    });
    const list = res?.data?.user?.broadcastBadges;
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to fetch channel badges:`, err.message);
    return [];
  }
}

function parse7tvEmoteSet(emotes, emotesMap) {
  if (!Array.isArray(emotes)) return;
  for (const e of emotes) {
    const code = e?.name;
    const hostUrl = e?.data?.host?.url;
    if (!code || !hostUrl) continue;
    const base = hostUrl.startsWith('//') ? `https:${hostUrl}` : hostUrl;
    emotesMap[code] = { url: `${base}/1x.webp`, provider: '7TV' };
  }
}

export async function fetchChannelChatAssets(channelId) {
  const [globalBadges, channelBadges, bttvGlobal, bttvChannel, sevenTvGlobal, sevenTvChannel] =
    await Promise.all([
      getTwitchGlobalBadges(),
      getTwitchChannelBadges(channelId),
      globalBttvCache
        ? Promise.resolve(globalBttvCache)
        : fetchJsonSafe('https://api.betterttv.net/3/cached/emotes/global').then((d) => {
            if (Array.isArray(d)) globalBttvCache = d;
            return d;
          }),
      channelId
        ? fetchJsonSafe(`https://api.betterttv.net/3/cached/users/twitch/${encodeURIComponent(channelId)}`)
        : Promise.resolve(null),
      global7tvCache
        ? Promise.resolve(global7tvCache)
        : fetchJsonSafe('https://7tv.io/v3/emote-sets/global').then((d) => {
            if (d?.emotes) global7tvCache = d;
            return d;
          }),
      channelId
        ? fetchJsonSafe(`https://7tv.io/v3/users/twitch/${encodeURIComponent(channelId)}`)
        : Promise.resolve(null),
    ]);

  const badgesMap = Object.create(null);
  for (const b of globalBadges) {
    if (b?.setID && b?.imageURL) {
      badgesMap[`${b.setID}/${b.version ?? ''}`] = { url: b.imageURL, title: b.title || b.setID };
    }
  }
  for (const b of channelBadges) {
    if (b?.setID && b?.imageURL) {
      badgesMap[`${b.setID}/${b.version ?? ''}`] = { url: b.imageURL, title: b.title || b.setID };
    }
  }

  const emotesMap = Object.create(null);
  if (Array.isArray(bttvGlobal)) {
    for (const e of bttvGlobal) {
      if (e?.code && e?.id) {
        emotesMap[e.code] = { url: `https://cdn.betterttv.net/emote/${e.id}/1x`, provider: 'BTTV' };
      }
    }
  }
  if (bttvChannel) {
    const chList = [
      ...(Array.isArray(bttvChannel.channelEmotes) ? bttvChannel.channelEmotes : []),
      ...(Array.isArray(bttvChannel.sharedEmotes) ? bttvChannel.sharedEmotes : []),
    ];
    for (const e of chList) {
      if (e?.code && e?.id) {
        emotesMap[e.code] = { url: `https://cdn.betterttv.net/emote/${e.id}/1x`, provider: 'BTTV' };
      }
    }
  }

  parse7tvEmoteSet(sevenTvGlobal?.emotes, emotesMap);
  parse7tvEmoteSet(sevenTvChannel?.emote_set?.emotes, emotesMap);

  return { badgesMap, emotesMap };
}

export async function fetchImageAsDataUrl(url) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  if (imageDataUrlCache.has(url)) {
    return imageDataUrlCache.get(url);
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/png';
    const buffer = await res.arrayBuffer();
    const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;

    if (imageDataUrlCache.size >= MAX_IMAGE_CACHE_SIZE) {
      const firstKey = imageDataUrlCache.keys().next().value;
      imageDataUrlCache.delete(firstKey);
    }
    imageDataUrlCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}
