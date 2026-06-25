const app = require('./app');
const http = require('http');

const PORT = 8089;
const BASE_URL = `http://localhost:${PORT}`;

// Sample test data
const SAMPLE_VIDEO_ID = 'kJQP7kiw5Fk'; // Despacito
const SAMPLE_ALBUM_BROWSE_ID = 'MPREb_otY5Z18yHue'; 
const SAMPLE_ARTIST_BROWSE_ID = 'UCtCgG5867f0ZnbIrc8FpTjA'; // Ed Sheeran
const SAMPLE_PLAYLIST_ID = 'PL4fGSI1pDJn6jUj5yKvg8z5Z2m9f_8q4l';
const SAMPLE_CHANNEL_ID = 'UCJn58GeZ4nS8W33SPhWdO1Q';
const SAMPLE_CATEGORY_ID = 'FEmusic_moods_and_genres_category_workout';

const tests = [
  // JioSaavn Routes
  { name: 'JioSaavn Search', path: `/api/jiosaavn/search?query=Taylor%20Swift` },
  { name: 'JioSaavn Search All', path: `/api/jiosaavn/search/all?query=Taylor%20Swift` },

  // API Routes
  { name: 'Music Find', path: `/api/music/find?q=Shape%20Of%20You` },
  { name: 'Stream', path: `/api/stream/${SAMPLE_VIDEO_ID}` },
  { name: 'Search (Default)', path: `/api/search?q=Adele` },
  { name: 'Search with filter (songs)', path: `/api/search?q=Adele&filter=songs` },
  { name: 'Search Suggestions', path: `/api/search/suggestions?q=Coldplay` },
  { name: 'Search Suggestions Debug', path: `/api/search/suggestions/debug?q=Coldplay` },
  { name: 'Similar Songs', path: `/api/similar?id=${SAMPLE_VIDEO_ID}` },
  { name: 'Feed (Authenticated/Default)', path: `/api/feed` },
  { name: 'Feed Unauthenticated', path: `/api/feed/unauthenticated` },
  { name: 'Album Detail', path: `/api/album/${SAMPLE_ALBUM_BROWSE_ID}` },
  { name: 'Playlist Detail', path: `/api/playlist/${SAMPLE_PLAYLIST_ID}` },
  { name: 'Feed Channels', path: `/api/feed/channels=${SAMPLE_CHANNEL_ID}` },
  { name: 'Trending', path: `/api/trending` },
  { name: 'Related by ID', path: `/api/related/${SAMPLE_VIDEO_ID}` },

  // Explore Routes
  { name: 'Charts', path: `/api/charts` },
  { name: 'Moods', path: `/api/moods` },
  { name: 'Moods by Category', path: `/api/moods/${SAMPLE_CATEGORY_ID}` },
  { name: 'Watch Playlist', path: `/api/watch_playlist?playlistId=${SAMPLE_PLAYLIST_ID}&videoId=${SAMPLE_VIDEO_ID}` },

  // Entities Routes
  { name: 'Entity Song', path: `/api/songs/${SAMPLE_VIDEO_ID}` },
  { name: 'Entity Album', path: `/api/albums/${SAMPLE_ALBUM_BROWSE_ID}` },
  { name: 'Entity Artist', path: `/api/artists/${SAMPLE_ARTIST_BROWSE_ID}` },
  { name: 'Entity Playlist', path: `/api/playlists/${SAMPLE_PLAYLIST_ID}` },
  { name: 'Entity Artist Summary', path: `/api/artist/${SAMPLE_ARTIST_BROWSE_ID}` },

  // YouTube Routes
  { name: 'YouTube Search', path: `/api/yt_search?q=Ed%20Sheeran` },
  { name: 'YouTube Channel', path: `/api/yt_channel/${SAMPLE_CHANNEL_ID}` },
  { name: 'YouTube Playlists', path: `/api/yt_playlists?q=Relaxing%20Music` },
  { name: 'YouTube Related', path: `/api/related?videoId=${SAMPLE_VIDEO_ID}` }
];

async function runTests() {
  console.log('Starting Express server for testing...');
  const server = http.createServer(app);
  
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Server listening on port ${PORT}\n`);

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
