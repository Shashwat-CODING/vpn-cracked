const app = require('./app');
const http = require('http');

const PORT = 8089;
const BASE_URL = `http://localhost:${PORT}`;

async function runTests() {
  console.log('Starting Express server for testing...');
  const server = http.createServer(app);
  
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Server listening on port ${PORT}\n`);

  // Dynamically resolve some valid testing IDs by searching first!
  let dynamicAlbumId = 'MPREb_otY5Z18yHue'; // fallback
  let dynamicPlaylistId = 'PL4fGSI1pDJn6jUj5yKvg8z5Z2m9f_8q4l'; // fallback
  let dynamicMoodCategoryParams = ''; // Will fetch from moods API
  let dynamicChannelId = 'UCJn58GeZ4nS8W33SPhWdO1Q'; // fallback

  try {
    console.log('Searching for an album to get a valid live browse ID...');
    const searchRes = await fetch(`${BASE_URL}/api/search?q=Adele&filter=albums`);
    const searchData = await searchRes.json();
    const firstAlbum = searchData.results?.find(r => r.type === 'MusicTwoRowItem' || r.id?.startsWith('MPREb_'));
    if (firstAlbum && firstAlbum.id) {
      dynamicAlbumId = firstAlbum.id;
      console.log(`Resolved dynamic album ID: ${dynamicAlbumId}`);
    }
  } catch (err) {
    console.warn('Failed to resolve dynamic album ID, using fallback:', err.message);
  }

  try {
    console.log('Searching for a video to get a valid live channel ID...');
    const searchRes = await fetch(`${BASE_URL}/api/yt_search?q=Ed%20Sheeran`);
    const searchData = await searchRes.json();
    const firstVideo = searchData.results?.[0];
    if (firstVideo && firstVideo.channel?.id) {
      dynamicChannelId = firstVideo.channel.id;
      console.log(`Resolved dynamic channel ID: ${dynamicChannelId}`);
    }
  } catch (err) {
    console.warn('Failed to resolve dynamic channel ID, using fallback:', err.message);
  }

  try {
    console.log('Fetching mood categories to get a valid dynamic params string...');
    const moodsRes = await fetch(`${BASE_URL}/api/moods`);
    const moodsData = await moodsRes.json();
    // Find Workout category params dynamically
    let foundParams = '';
    for (const cat of moodsData) {
      const workoutItem = cat.items?.find(item => item.title?.toLowerCase() === 'workout');
      if (workoutItem && workoutItem.params) {
        foundParams = workoutItem.params;
        break;
      }
    }
    if (!foundParams && moodsData[0]?.items?.[0]?.params) {
      foundParams = moodsData[0].items[0].params;
    }
    if (foundParams) {
      dynamicMoodCategoryParams = foundParams;
      console.log(`Resolved dynamic mood category params: ${dynamicMoodCategoryParams}`);
    }
  } catch (err) {
    console.warn('Failed to resolve dynamic mood category params:', err.message);
  }

  const SAMPLE_VIDEO_ID = 'kJQP7kiw5Fk'; // Despacito
  const SAMPLE_ARTIST_BROWSE_ID = 'UCtCgG5867f0ZnbIrc8FpTjA'; // Ed Sheeran

  const tests = [
    // JioSaavn Routes
    { name: 'JioSaavn Search', path: `/api/jiosaavn/search?title=Shape%20Of%20You&artist=Ed%20Sheeran` },
    { name: 'JioSaavn Search All', path: `/api/jiosaavn/search/all?q=Taylor%20Swift` },

    // API Routes
    { name: 'Music Find', path: `/api/music/find?name=Shape%20Of%20You&artist=Ed%20Sheeran` },
    { name: 'Stream', path: `/api/stream/${SAMPLE_VIDEO_ID}` },
    { name: 'Search (Default)', path: `/api/search?q=Adele` },
    { name: 'Search with filter (songs)', path: `/api/search?q=Adele&filter=songs` },
    { name: 'Search Suggestions', path: `/api/search/suggestions?q=Coldplay` },
    { name: 'Search Suggestions Debug', path: `/api/search/suggestions/debug?q=Coldplay` },
    { name: 'Similar Songs', path: `/api/similar?title=Shape%20Of%20You&artist=Ed%20Sheeran` },
    { name: 'Feed (Authenticated/Default)', path: `/api/feed?authToken=demo` },
    { name: 'Feed Unauthenticated', path: `/api/feed/unauthenticated?channels=${dynamicChannelId}` },
    { name: 'Album Detail', path: `/api/album/${dynamicAlbumId}` },
    { name: 'Playlist Detail', path: `/api/playlist/${dynamicPlaylistId}` },
    { name: 'Feed Channels', path: `/api/feed/channels=${dynamicChannelId}` },
    { name: 'Trending', path: `/api/trending` },
    { name: 'Related by ID', path: `/api/related/${SAMPLE_VIDEO_ID}` },

    // Explore Routes
    { name: 'Charts', path: `/api/charts` },
    { name: 'Moods', path: `/api/moods` },
    { name: 'Moods by Category', path: `/api/moods/FEmusic_moods_and_genres_category?params=${dynamicMoodCategoryParams}` },
    { name: 'Watch Playlist', path: `/api/watch_playlist?playlistId=${dynamicPlaylistId}&videoId=${SAMPLE_VIDEO_ID}` },

    // Entities Routes
    { name: 'Entity Song', path: `/api/songs/${SAMPLE_VIDEO_ID}` },
    { name: 'Entity Album', path: `/api/albums/${dynamicAlbumId}` },
    { name: 'Entity Artist', path: `/api/artists/${SAMPLE_ARTIST_BROWSE_ID}` },
    { name: 'Entity Playlist', path: `/api/playlists/${dynamicPlaylistId}` },
    { name: 'Entity Artist Summary', path: `/api/artist/${SAMPLE_ARTIST_BROWSE_ID}` },

    // YouTube Routes
    { name: 'YouTube Search', path: `/api/yt_search?q=Ed%20Sheeran` },
    { name: 'YouTube Channel', path: `/api/yt_channel/${dynamicChannelId}` },
    { name: 'YouTube Playlists', path: `/api/yt_playlists?q=Relaxing%20Music` },
    { name: 'YouTube Related', path: `/api/related?videoId=${SAMPLE_VIDEO_ID}` }
  ];

  const results = [];
  let passedCount = 0;

  for (const t of tests) {
    const url = `${BASE_URL}${t.path}`;
    console.log(`Testing: [${t.name}] GET ${t.path}`);
    const start = Date.now();
    try {
      const res = await fetch(url);
      const duration = Date.now() - start;
      const status = res.status;
      let data = null;
      let isJson = false;

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
        isJson = true;
      } else {
        data = await res.text();
      }

      const passed = status >= 200 && status < 300 && (!isJson || !data.error);
      if (passed) passedCount++;

      results.push({
        name: t.name,
        path: t.path,
        status,
        duration,
        passed,
        responseSnippet: isJson ? (JSON.stringify(data).substring(0, 150) + '...') : String(data).substring(0, 150)
      });

      console.log(`Result: ${passed ? '✅ PASSED' : '❌ FAILED'} (${status}) in ${duration}ms\n`);
    } catch (err) {
      const duration = Date.now() - start;
      results.push({
        name: t.name,
        path: t.path,
        status: 'FETCH_ERROR',
        duration,
        passed: false,
        responseSnippet: err.message
      });
      console.log(`Result: 💥 ERROR: ${err.message} in ${duration}ms\n`);
    }
  }

  server.close();
  console.log('--- TEST SUMMARY ---');
  console.log(`Total tests: ${tests.length}`);
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${tests.length - passedCount}`);
  console.log('\nFailed Endpoints:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`- [${r.name}] GET ${r.path} -> Status ${r.status} | Snippet: ${r.responseSnippet}`);
  });
}

runTests().catch(console.error);
