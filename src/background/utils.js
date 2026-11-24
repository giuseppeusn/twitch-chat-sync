import { TWITCH_CLIENT_ID, TWITCH_GQL_URL } from './constants.js';

export function t(key, substitutions, fallback = '') {
  try {
    const msg = chrome.i18n.getMessage(key, substitutions);
    return msg || fallback || key;
  } catch {
    return fallback || key;
  }
}

export async function twitchGqlRequest(body) {
  const response = await fetch(TWITCH_GQL_URL, {
    method: 'POST',
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Twitch GQL HTTP ${response.status}: ${response.statusText}`);
  }

  const json = await response.json();
  if (json.errors && json.errors.length > 0 && !json.data) {
    throw new Error(`Twitch GQL Error: ${json.errors.map((e) => e.message).join('; ')}`);
  }

  return json;
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

export async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
