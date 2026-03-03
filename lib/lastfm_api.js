// Embedded Last.fm API key as requested
export const LASTFM_API_KEY = '0867bcb6f36c879398969db682a7b69b';

/**
 * Fetch similar tracks from Last.fm and return simplified results.
 * @param {string} title
 * @param {string} artist
 * @param {string} apiKey
 * @param {string} limit
 * @returns {Promise<Array | { error: string }>}
 */
export async function getSimilarTracks(title, artist, apiKey, limit) {
  const effectiveKey = apiKey || LASTFM_API_KEY;
  const url = `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&api_key=${effectiveKey}&limit=${encodeURIComponent(limit)}&format=json`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();

    if (data?.error) {
      return { error: data.message || 'Last.fm error' };
    }

    const tracks = data?.similartracks?.track || [];
    const simplified = tracks.map(t => ({ title: t.name, artist: t?.artist?.name })).filter(t => t.title && t.artist);
    return simplified;
  } catch (err) {
    console.error('Error fetching Last.fm similar tracks:', err);
    return { error: 'Failed to fetch similar tracks from Last.fm' };
  }
}
