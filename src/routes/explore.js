import { Hono } from 'hono';
import { YTMusic } from '../../lib/ytmusicapi.js';

const api = new Hono();
const ytmusic = new YTMusic();

api.get('/charts', async (c) => {
    try {
        const country = c.req.query('country');
        const data = await ytmusic.getCharts(country);
        return c.json(data);
    } catch (error) {
        return c.json({
            error: `Charts data unavailable: ${error.message}`,
            message: 'YouTube Music charts are currently not accessible.',
            fallback: 'Try using the search endpoint instead: /api/search?q=trending&filter=songs'
        }, 500);
    }
});

api.get('/moods', async (c) => {
    try {
        const data = await ytmusic.getMoodCategories();
        return c.json(data);
    } catch (error) {
        return c.json({
            error: `Mood categories unavailable: ${error.message}`,
            message: 'YouTube Music mood categories are currently not accessible.'
        }, 500);
    }
});

api.get('/moods/:categoryId', async (c) => {
    try {
        const categoryId = c.req.param('categoryId');
        const data = await ytmusic.getMoodPlaylists(categoryId);
        return c.json(data);
    } catch (error) {
        return c.json({
            error: `Mood playlists unavailable: ${error.message}`,
            message: `Mood playlists for category '${c.req.param('categoryId')}' are currently not accessible.`
        }, 500);
    }
});

api.get('/watch_playlist', async (c) => {
    try {
        const { videoId, playlistId, radio, shuffle, limit = 25 } = c.req.query();
        if (!videoId && !playlistId) return c.json({ error: 'Provide either videoId or playlistId' }, 400);
        const data = await ytmusic.getWatchPlaylist(videoId, playlistId, radio === 'true', shuffle === 'true', parseInt(limit));
        return c.json(data);
    } catch (error) { return c.json({ error: error.message }, 500); }
});

export default api;
