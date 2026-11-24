import { LOG_PREFIX } from './constants.js';
import { t } from './utils.js';
import {
  fetchVodMetadataAndStoryboards,
  fetchSpriteBatch,
  fetchChatRange,
  fetchHlsRefinementStub,
} from './twitchApi.js';
import { fetchYoutubeStoryboards } from './youtubeApi.js';
import { fetchChannelChatAssets, fetchImageAsDataUrl } from './chatAssets.js';

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  (async () => {
    try {
      switch (request?.type) {
        case 'GET_VOD_STORYBOARDS': {
          const data = await fetchVodMetadataAndStoryboards(request.vodId);
          sendResponse({ ok: true, data });
          break;
        }

        case 'GET_YT_STORYBOARDS': {
          const data = await fetchYoutubeStoryboards(request.youtubeId, request.maxFrames || 300);
          sendResponse({ ok: true, data });
          break;
        }

        case 'FETCH_SPRITE_BATCH': {
          const data = await fetchSpriteBatch(request.urls || []);
          sendResponse({ ok: true, data });
          break;
        }

        case 'FETCH_CHAT_RANGE': {
          const data = await fetchChatRange(request);
          sendResponse({ ok: true, data });
          break;
        }

        case 'GET_CHAT_ASSETS': {
          const data = await fetchChannelChatAssets(request.channelId);
          sendResponse({ ok: true, data });
          break;
        }

        case 'FETCH_IMAGE_DATA_URL': {
          const dataUrl = await fetchImageAsDataUrl(request.url);
          sendResponse({ ok: true, data: dataUrl });
          break;
        }

        case 'REFINE_OFFSET_HLS': {
          const data = await fetchHlsRefinementStub(request);
          sendResponse({ ok: true, data });
          break;
        }

        default:
          sendResponse({
            ok: false,
            error: t('bgUnknownAction', [String(request?.type)], `Unknown action: ${request?.type}`),
          });
      }
    } catch (error) {
      console.error(LOG_PREFIX, error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_CHAT_PANEL' }).catch(() => {});
});
