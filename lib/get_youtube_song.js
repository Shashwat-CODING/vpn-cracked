import { YouTubeSearch } from './youtube-search.js';

/**
 * Search YouTube and return the first video result with required fields.
 * @param {string} query
 * @returns {Promise<Object>}
 */
export async function getYouTubeSong(query) {
  try {
    const yt = new YouTubeSearch();
    const { results } = await yt.searchVideos(query);
    const first = results && results[0];
    if (!first || !first.id) {
      return { error: 'No YouTube result found' };
    }
    const channelId = first?.channel?.id || null;
    return {
      id: first.id,
      title: first.title,
      author: first?.channel?.name || null,
      duration: first?.duration || null,
      channelUrl: channelId ? `channel/${channelId}` : null
    };
  } catch (err) {
    return { error: `YouTube search failed: ${err.message}` };
  }
}
