import { Hono } from 'hono';
import youtubeiClient from '../../lib/youtubei-client.js';
import { YTMusic } from '../../lib/ytmusicapi.js';

const api = new Hono();
const ytmusic = new YTMusic();

api.get('/songs/:videoId', async (c) => {
    try {
        const videoId = c.req.param('videoId');
        const data = await ytmusic.getSong(videoId);
        return c.json(data);
    } catch (e) { return c.json({ error: e.message }, 500); }
});

api.get('/albums/:browseId', async (c) => {
    try {
        const browseId = c.req.param('browseId');
        const data = await youtubeiClient.getAlbum(browseId);
        return c.json(data);
    } catch (e) { return c.json({ error: e.message }, 500); }
});

api.get('/artists/:browseId', async (c) => {
    try {
        const browseId = c.req.param('browseId');
        const data = await ytmusic.getArtist(browseId);
        return c.json(data);
    } catch (e) { return c.json({ error: e.message }, 500); }
});

api.get('/playlists/:playlistId', async (c) => {
    try {
        const playlistId = c.req.param('playlistId');
        const data = await youtubeiClient.getPlaylist(playlistId);
        return c.json(data);
    } catch (e) { return c.json({ error: e.message }, 500); }
});

api.get('/artist/:artistId', async (c) => {
    try {
        const artistId = c.req.param('artistId');
        const country = c.req.query('country') || 'US';

        const body = {
            browseId: artistId,
            context: {
                client: { clientName: 'WEB_REMIX', clientVersion: '1.20250915.03.00', gl: country }
            }
        };

        const response = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
            body: JSON.stringify(body)
        });

        if (!response.ok) return c.json({ error: `HTTP error: ${response.status}` }, 500);
        const data = await response.json();

        const header = data?.header?.musicImmersiveHeaderRenderer || data?.header?.musicVisualHeaderRenderer;
        const artistHeader = header?.title?.runs?.[0]?.text;
        let artistAvatar = header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url;
        if (header?.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url) {
            artistAvatar = header.foregroundThumbnail.musicThumbnailRenderer.thumbnail.thumbnails[0].url;
        }

        const contents = data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
        let playlistId = null;
        for (const item of contents) {
            if (item.musicShelfRenderer && item.musicShelfRenderer.title?.runs?.[0]?.text === 'Top songs') {
                playlistId = item.musicShelfRenderer.contents?.[0]?.musicResponsiveListItemRenderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.playlistId;
                break;
            }
        }

        const parseCarousel = (title) => {
            for (const item of contents) {
                if (item.musicCarouselShelfRenderer?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.text === title) {
                    return (item.musicCarouselShelfRenderer.contents || []).map(it => {
                        const twoRow = it.musicTwoRowItemRenderer;
                        if (!twoRow) return null;
                        return {
                            name: twoRow.title?.runs?.[0]?.text,
                            title: twoRow.title?.runs?.[0]?.text,
                            browseId: twoRow.navigationEndpoint?.browseEndpoint?.browseId,
                            thumbnail: twoRow.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url
                        };
                    }).filter(Boolean);
                }
            }
            return null;
        };

        return c.json({
            artistName: artistHeader,
            artistAvatar,
            playlistId,
            recommendedArtists: parseCarousel('Fans might also like'),
            featuredOnPlaylists: parseCarousel('Featured on')
        });
    } catch (error) { return c.json({ error: error.message }, 500); }
});

export default api;
