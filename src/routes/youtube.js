import { Hono } from 'hono';
import { YouTubeSearch } from '../lib/youtube-search.js';

const youtubeSearch = new YouTubeSearch();
const api = new Hono();

const YT_FILTERS = new Set(['all', 'channels', 'playlists', 'videos']);

api.get('/yt_search', async (c) => {
    const { q, filter = 'all', continuationToken } = c.req.query();
    if (!q && !continuationToken) return c.json({ error: 'Missing query' }, 400);
    if (!YT_FILTERS.has(filter)) return c.json({ error: 'Invalid filter' }, 400);

    try {
        let results = [];
        let nextContinuationToken = null;

        if (continuationToken) {
            const typeMap = { 'videos': 'searchVideos', 'channels': 'searchChannels', 'playlists': 'searchPlaylists' };
            if (typeMap[filter]) {
                const res = await youtubeSearch[typeMap[filter]](null, continuationToken);
                results = res.results;
                nextContinuationToken = res.continuationToken;
            }
        } else {
            if (filter === 'videos' || filter === 'all') {
                const res = await youtubeSearch.searchVideos(q);
                results.push(...res.results);
                nextContinuationToken = res.continuationToken;
            }
            if (filter === 'channels' || filter === 'all') {
                const res = await youtubeSearch.searchChannels(q);
                results.push(...res.results);
                if (!nextContinuationToken) nextContinuationToken = res.continuationToken;
            }
            if (filter === 'playlists' || filter === 'all') {
                const res = await youtubeSearch.searchPlaylists(q);
                results.push(...res.results);
                if (!nextContinuationToken) nextContinuationToken = res.continuationToken;
            }
        }

        return c.json({ filter, query: q, results, continuationToken: nextContinuationToken });
    } catch (e) { return c.json({ error: e.message }, 500); }
});

api.get('/yt_channel/:channelId', async (c) => {
    const channelId = c.req.param('channelId');
    try {
        const res = await youtubeSearch.searchChannels(`channel:${channelId}`);
        return res.results.length ? c.json({ channelId, channelInfo: res.results[0] }) : c.json({ error: 'Not found' }, 404);
    } catch (e) { return c.json({ error: e.message }, 500); }
});

api.get('/yt_playlists', async (c) => {
    const { q, continuationToken } = c.req.query();
    if (!q && !continuationToken) return c.json({ error: 'Missing query' }, 400);
    try {
        const res = await youtubeSearch.searchPlaylists(q, continuationToken);
        return c.json({ query: q, playlists: res.results, continuationToken: res.continuationToken });
    } catch (e) { return c.json({ error: e.message }, 500); }
});

export default api;
