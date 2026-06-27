const axios = require('axios');

const BASE_URL = 'http://127.0.0.1:8787';

async function testEndpoints() {
    console.log('--- Starting Cloudflare Worker Endpoint Verification ---');
    
    const endpoints = [
        { name: 'Root Redirect', url: '/', expectRedirect: true },
        { name: 'Health Check', url: '/health' },
        { name: 'API Search', url: '/api/search?q=test' },
        { name: 'Vercel Alias: JioSaavn', url: '/jiosaavn/search?title=Kabira&artist=Arijit%20Singh' },
        { name: 'Vercel Alias: Entities (Song)', url: '/entities/songs/VKjRiOTSgG8' },
        { name: 'Vercel Alias: Entities (Album)', url: '/entities/albums/MPREb_1Aoz4jxVKot' },
        { name: 'Vercel Alias: Entities (Playlist)', url: '/entities/playlists/OLAK5uy_kB0TlQ4WJlkPGYvROL4FbPvoM2I_ikFT0' },
        { name: 'Trending Charts', url: '/api/trending' },
        { name: 'Related Videos', url: '/api/related/VKjRiOTSgG8' },
    ];

    for (const endpoint of endpoints) {
        try {
            console.log(`\n[TEST] Testing ${endpoint.name} (${endpoint.url})...`);
            const response = await axios.get(`${BASE_URL}${endpoint.url}`, {
                maxRedirects: endpoint.expectRedirect ? 0 : 5,
                validateStatus: (status) => status < 400 || (endpoint.expectRedirect && status === 302)
            });

            if (endpoint.expectRedirect && response.status === 302) {
                console.log(`  ✅ Success: Redirected to ${response.headers.location}`);
            } else if (response.status === 200) {
                console.log(`  ✅ Success: Status 200`);
                if (endpoint.url.includes('search')) {
                    console.log(`  📄 Data length: ${JSON.stringify(response.data).length} bytes`);
                }
            } else {
                console.log(`  ❌ Failed: Unexpected status ${response.status}`);
            }
        } catch (error) {
            console.log(`  ❌ Failed: ${error.message}`);
            if (error.response) {
                console.log(`  Response Status: ${error.response.status}`);
                console.log(`  Response Data:`, error.response.data);
            }
        }
    }
    
    console.log('\n--- Verification Finished ---');
}

testEndpoints();
