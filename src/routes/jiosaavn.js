import { Hono } from 'hono';
import { JioSaavn } from '../../lib/jiosaavn.js';

const jiosaavn = new JioSaavn();
const api = new Hono();

api.get('/search', async (c) => {
    const { title, artist, debug } = c.req.query();
    if (!title || !artist) return c.json({ error: 'Missing params' }, 400);
    try {
        const result = await jiosaavn.search(title, artist, debug === '1');
        return c.json(result);
    } catch (e) { return c.json({ error: e.message }, 500); }
});

api.get('/search/all', async (c) => {
    const { q, limit = 10, debug } = c.req.query();
    if (!q) return c.json({ error: 'Missing query' }, 400);
    try {
        const result = await jiosaavn.searchAll(q, parseInt(limit), debug === '1');
        return c.json(result);
    } catch (e) { return c.json({ error: e.message }, 500); }
});

export default api;
