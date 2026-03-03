import { Hono } from 'hono';
import { YTMusic } from '../lib/ytmusicapi.js';
import { YouTubeSearch } from '../lib/youtube-search.js';
import { getYouTubeSong } from '../lib/get_youtube_song.js';
import { getSimilarTracks } from '../lib/lastfm_api.js';

const api = new Hono();
const ytmusic = new YTMusic();
const youtubeSearch = new YouTubeSearch();

const ALLOWED_FILTERS = new Set([
    'songs', 'videos', 'albums', 'artists', 'playlists', 'profiles', 'podcasts', 'episodes', 'community_playlists'
]);

// Helper for parsing video from browse (integrated into index for now or as util)
function parseVideoFromBrowse(video, channelId, channelName) {
    const id = video?.videoId || '';
    const title = video?.title?.runs?.[0]?.text || video?.title?.simpleText || '';
    let duration = 0;
    const durationFields = [
        video?.lengthText?.simpleText,
        video?.lengthSeconds,
        video?.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText
    ];
    for (const field of durationFields) {
        if (field) {
            if (typeof field === 'number') duration = field;
            else {
                const parts = field.split(':').map(p => parseInt(p) || 0);
                duration = parts.length === 2 ? parts[0] * 60 + parts[1] : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0;
            }
        }
        if (duration > 0) break;
    }
    return {
        id, authorId: channelId, duration: duration.toString(), author: channelName,
        title, thumbnail: video?.thumbnail?.thumbnails?.slice(-1)[0]?.url || ''
    };
}

async function fetchChannelItemsBrowse(channelId, perChannelLimit) {
    const url = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false';
    const payload = {
        browseId: channelId,
        context: { client: { hl: "en", gl: "IN", clientName: "WEB", clientVersion: "2.20251013.01.00" } }
    };
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    const items = [];
    const channelName = data?.header?.c4TabbedHeaderRenderer?.title || '';

    const extract = (contents) => {
        if (!contents) return;
        for (const item of contents) {
            const v = item?.richItemRenderer?.content?.videoRenderer || item?.videoRenderer || item?.gridVideoRenderer;
            if (v) items.push(parseVideoFromBrowse(v, channelId, channelName));
            if (item?.itemSectionRenderer?.contents) extract(item.itemSectionRenderer.contents);
            if (item?.richGridRenderer?.contents) extract(item.richGridRenderer.contents);
            if (perChannelLimit && items.length >= perChannelLimit) break;
        }
    };

    const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || data?.contents?.singleColumnBrowseResultsRenderer?.tabs || [];
    for (const tab of tabs) {
        extract(tab?.tabRenderer?.content?.sectionListRenderer?.contents);
        extract(tab?.tabRenderer?.content?.richGridRenderer?.contents);
    }
    return items.slice(0, perChannelLimit);
}

api.get('/music/find', async (c) => {
    const { name, artist } = c.req.query();
    if (!name || !artist) return c.json({ success: false, error: 'Missing parameters' }, 400);
    try {
        const query = `${name} ${artist}`;
        let searchResults = await ytmusic.search(query, 'songs');
        const normalize = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/gi, '');
        const nName = normalize(name);
        const artistsList = artist.split(',').map(normalize);

        let bestMatch = searchResults.results.find(song => {
            const nTitle = normalize(song.title);
            const sArtists = (song.artists || []).map(a => normalize(a.name));
            return (nTitle.includes(nName) || nName.includes(nTitle)) && artistsList.some(a => sArtists.some(sa => sa.includes(a) || a.includes(sa)));
        });

        if (!bestMatch) {
            const videoResults = await ytmusic.search(query, 'videos');
            bestMatch = videoResults.results.find(v => {
                const nTitle = normalize(v.title);
                const vArtists = (v.artists || []).map(a => normalize(a.name));
                return (nTitle.includes(nName) || nName.includes(nTitle)) && artistsList.some(a => vArtists.some(sa => sa.includes(a) || a.includes(sa)));
            });
        }

        return bestMatch ? c.json({ success: true, data: bestMatch }) : c.json({ success: false, error: 'Not found' }, 404);
    } catch (e) { return c.json({ success: false, error: e.message }, 500); }
});

api.get('/stream/:id', async (c) => {
    const id = c.req.param('id');
    const instances = ["https://inv-veltrix.zeabur.app", "https://inv-veltrix-2.zeabur.app"];
    for (const instance of instances) {
        try {
            const res = await fetch(`${instance}/api/v1/videos/${id}`);
            if (res.ok) return c.json(await res.json());
        } catch { }
    }
    return c.json({ success: false, error: 'Failed' }, 404);
});

api.get('/search', async (c) => {
    const { q, filter, continuationToken, ignore_spelling } = c.req.query();
    if (!q && !continuationToken) return c.json({ error: 'Missing query' }, 400);
    if (filter && !ALLOWED_FILTERS.has(filter)) return c.json({ error: 'Invalid filter' }, 400);
    try {
        const results = await ytmusic.search(q, filter, continuationToken, ignore_spelling === 'true');
        return c.json({ query: q, filter, results: results.results, continuationToken: results.continuationToken });
    } catch (e) { return c.json({ error: e.message }, 500); }
});

api.get('/search/suggestions', async (c) => {
    const { q, music } = c.req.query();
    if (!q) return c.json({ error: 'Missing query' }, 400);
    try {
        if (music === '1') {
            let suggestions = await ytmusic.getSearchSuggestions(q);
            if (!suggestions?.length) suggestions = await youtubeSearch.getSuggestions(q);
            return c.json({ suggestions, source: 'ytm' });
        }
        return c.json({ suggestions: await youtubeSearch.getSuggestions(q), source: 'yt' });
    } catch (e) { return c.json({ error: e.message }, 500); }
});

api.get('/similar', async (c) => {
    const { title, artist, limit = 5 } = c.req.query();
    if (!title || !artist) return c.json({ error: 'Missing params' }, 400);
    try {
        const similar = await getSimilarTracks(title, artist, null, limit);
        if (similar.error) return c.json(similar, 500);
        const results = await Promise.all(similar.map(t => getYouTubeSong(`${t.title} ${t.artist}`)));
        return c.json(results.filter(r => !r.error));
    } catch (e) { return c.json({ error: e.message }, 500); }
});

export default api;
