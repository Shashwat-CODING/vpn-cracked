const express = require('express');

const router = express.Router();

const YT_FILTERS = new Set(['all', 'channels', 'playlists', 'videos']);

/**
 * @swagger
 * /api/yt_search:
 *   get:
 *     summary: Search YouTube
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query string
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [all, channels, playlists, videos]
 *           default: all
 *         description: Filter results by type
 *       - in: query
 *         name: continuationToken
 *         schema:
 *           type: string
 *         description: Continuation token for pagination
 *     responses:
 *       200:
 *         description: YouTube search results with continuation token
 *       400:
 *         description: Missing/invalid params
 */
router.get('/yt_search', async (req, res) => {
  try {
    const { q: query, filter = 'all', continuationToken } = req.query;

    // FIXED: Allow continuation without query
    if (!query && !continuationToken) {
      return res.status(400).json({ error: "Missing required query parameter 'q' or 'continuationToken'" });
    }

    if (!YT_FILTERS.has(filter)) {
      return res.status(400).json({
        error: `Invalid filter. Allowed: ${Array.from(YT_FILTERS).sort()}`
      });
    }

    const youtubeSearch = req.app.locals.youtubeSearch;
    let results = [];
    let nextContinuationToken = null;

    // When continuation token is provided, only search the specific filter type
    if (continuationToken) {
      // FIXED: Don't pass query when using continuation token
      if (filter === 'videos') {
        const videoResults = await youtubeSearch.searchVideos(null, continuationToken);
        results = videoResults.results;
        nextContinuationToken = videoResults.continuationToken;
      } else if (filter === 'channels') {
        const channelResults = await youtubeSearch.searchChannels(null, continuationToken);
        results = channelResults.results;
        nextContinuationToken = channelResults.continuationToken;
      } else if (filter === 'playlists') {
        const playlistResults = await youtubeSearch.searchPlaylists(null, continuationToken);
        results = playlistResults.results;
        nextContinuationToken = playlistResults.continuationToken;
      }
    } else {
      // Initial search without continuation token
      if (filter === 'videos' || filter === 'all') {
        const videoResults = await youtubeSearch.searchVideos(query, null);
        results.push(...videoResults.results);
        nextContinuationToken = videoResults.continuationToken;
      }

      if (filter === 'channels' || filter === 'all') {
        const channelResults = await youtubeSearch.searchChannels(query, null);
        results.push(...channelResults.results);
        if (!nextContinuationToken) nextContinuationToken = channelResults.continuationToken;
      }

      if (filter === 'playlists' || filter === 'all') {
        const playlistResults = await youtubeSearch.searchPlaylists(query, null);
        results.push(...playlistResults.results);
        if (!nextContinuationToken) nextContinuationToken = playlistResults.continuationToken;
      }
    }

    // Include continuationToken at the end
    res.json({
      filter,
      query: query || null,
      results,
      continuationToken: nextContinuationToken
    });
  } catch (error) {
    console.error('YouTube search error:', error);
    res.status(500).json({ error: `Search failed: ${error.message}` });
  }
});

/**
 * @swagger
 * /api/yt_channel/{channelId}:
 *   get:
 *     summary: Get YouTube channel information
 *     parameters:
 *       - in: path
 *         name: channelId
 *         required: true
 *         schema:
 *           type: string
 *         description: YouTube channel ID
 *     responses:
 *       200:
 *         description: Channel information
 *       400:
 *         description: Invalid channel ID
 */
router.get('/yt_channel/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    const youtubeSearch = req.app.locals.youtubeSearch;

    // Get channel info using search
    const channelResults = await youtubeSearch.searchChannels(`channel:${channelId}`, null);

    if (channelResults.results.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    res.json({
      channelId,
      channelInfo: channelResults.results[0]
    });
  } catch (error) {
    console.error('YouTube channel error:', error);
    res.status(500).json({ error: `Failed to get channel info: ${error.message}` });
  }
});

/**
 * @swagger
 * /api/yt_playlists:
 *   get:
 *     summary: Search YouTube playlists
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query for playlists
 *       - in: query
 *         name: continuationToken
 *         schema:
 *           type: string
 *         description: Continuation token for pagination
 *     responses:
 *       200:
 *         description: YouTube playlists with continuation token
 *       400:
 *         description: Missing/invalid params
 */
router.get('/yt_playlists', async (req, res) => {
  try {
    const { q: query, continuationToken } = req.query;

    // FIXED: Allow continuation without query
    if (!query && !continuationToken) {
      return res.status(400).json({ error: "Missing required query parameter 'q' or 'continuationToken'" });
    }

    const youtubeSearch = req.app.locals.youtubeSearch;
    const playlistResults = await youtubeSearch.searchPlaylists(
      query || null, 
      continuationToken
    );

    res.json({
      query: query || null,
      playlists: playlistResults.results,
      continuationToken: playlistResults.continuationToken
    });
  } catch (error) {
    console.error('YouTube playlists error:', error);
    res.status(500).json({ error: `Failed to search playlists: ${error.message}` });
  }
});

/**
 * @swagger
 * /api/related:
 *   get:
 *     summary: Get related songs based on a video ID
 *     parameters:
 *       - in: query
 *         name: videoId
 *         required: true
 *         schema:
 *           type: string
 *         description: Video ID to get related songs for
 *     responses:
 *       200:
 *         description: List of related songs
 *       400:
 *         description: Missing videoId
 */
router.get('/related', async (req, res) => {
  const { videoId } = req.query;

  if (!videoId) {
    return res.status(400).json({
      success: false,
      error: "Missing required query parameter: 'videoId'",
      example: "GET /api/related?videoId=dQw4w9WgXcQ"
    });
  }

  try {
    const ytmusic = req.app.locals.ytmusic;
    const songs = await getRelatedSongs(videoId, ytmusic);
    res.json({
      success: true,
      videoId,
      count: songs.length,
      songs
    });
  } catch (error) {
    console.error('Related error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to fetch related songs from YouTube Music'
    });
  }
});

async function getRelatedSongs(videoId, ytmusic) {
  // Use the internal ytmusic client for authenticated request
  const body = {
    videoId,
    playlistId: `RDAMVM${videoId}`,
    isAudioOnly: true
  };

  const data = await ytmusic._makeRequest('next', body);
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

module.exports = router;
