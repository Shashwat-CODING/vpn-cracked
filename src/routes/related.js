import { Hono } from 'hono';

const relatedRoutes = new Hono();

async function getRelatedSongs(videoId) {
  const ytMusicUrl = 'https://music.youtube.com/youtubei/v1/next?prettyPrint=false';

  const requestBody = {
    context: {
      client: {
        clientName: "WEB_REMIX",
        clientVersion: "1.20251210.03.00",
        hl: "en",
        gl: "IN",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
      }
    },
    videoId,
    playlistId: `RDAMVM${videoId}`,
    isAudioOnly: true
  };

  const response = await fetch(ytMusicUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://music.youtube.com',
      'Referer': `https://music.youtube.com/watch?v=${videoId}`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`YouTube Music API returned ${response.status}`);
  }

  const data = await response.json();
  return parseRelatedSongs(data, videoId);
}

function parseRelatedSongs(data, currentVideoId) {
  const songs = [];

  try {
    const tabs = data?.contents?.singleColumnMusicWatchNextResultsRenderer
      ?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;

    if (!Array.isArray(tabs)) return songs;

    for (const tab of tabs) {
      const contents = tab?.tabRenderer?.content?.musicQueueRenderer
        ?.content?.playlistPanelRenderer?.contents;

      if (!Array.isArray(contents)) continue;

      for (const item of contents) {
        const panel = item?.playlistPanelVideoRenderer;
        if (!panel) continue;

        let thumbnailUrl = panel.thumbnail?.thumbnails?.[0]?.url || '';
        if (thumbnailUrl) {
          thumbnailUrl = thumbnailUrl.replace(/=w\d+-h\d+(-l\d+)?(-rj)?$/, '=w500-h500');
        }

        const song = {
          videoId: panel.videoId || '',
          title: panel.title?.runs?.[0]?.text || 'Unknown Title',
          artist: panel.longBylineText?.runs?.[0]?.text
            || panel.shortBylineText?.runs?.[0]?.text
            || 'Unknown Artist',
          thumbnail: thumbnailUrl,
          duration: panel.lengthText?.runs?.[0]?.text
            || panel.lengthText?.simpleText
            || null
        };

        // Put the requested song first, rest follow in order
        if (panel.videoId === currentVideoId) {
          songs.unshift(song);
        } else {
          songs.push(song);
        }
      }
    }
  } catch (err) {
    console.error('Error parsing related songs:', err);
  }

  return songs;
}

relatedRoutes.get('/related', async (c) => {
  const videoId = c.req.query('videoId');

  if (!videoId) {
    return c.json({
      success: false,
      error: "Missing required query parameter: 'videoId'",
      example: "GET /api/related/?videoId=dQw4w9WgXcQ"
    }, 400);
  }

  try {
    const songs = await getRelatedSongs(videoId);
    return c.json({
      success: true,
      videoId,
      count: songs.length,
      songs
    });
  } catch (err) {
    console.error('Related route error:', err);
    return c.json({
      success: false,
      error: err.message,
      details: 'Failed to fetch related songs from YouTube Music'
    }, 500);
  }
});

export default relatedRoutes;
