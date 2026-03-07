import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import apiRoutes from './routes/api.js';
import jioRoutes from './routes/jiosaavn.js';
import ytRoutes from './routes/youtube.js';
import entityRoutes from './routes/entities.js';
import exploreRoutes from './routes/explore.js';
import relatedRoutes from './routes/related.js'; // 👈 new

const app = new Hono();
app.use('*', logger());
app.use('*', cors());
app.get('/', (c) => c.text('Muzo API is running!'));
app.get('/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));
app.route('/api', apiRoutes);
app.route('/api', jioRoutes);
app.route('/api', ytRoutes);
app.route('/api', entityRoutes);
app.route('/api', exploreRoutes);
app.route('/api', relatedRoutes); // 👈 new
app.notFound((c) => c.json({ error: 'Not Found' }, 404));
app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});
export default app;
