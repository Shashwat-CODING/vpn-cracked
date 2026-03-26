export class JioSaavn {
  constructor() {
    this.baseURL = 'https://saavn.sumit.co/api';
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
    };
  }

  async search(title, artist, debug = false) {
    try {
      const decodedArtist = decodeURIComponent(artist || '');
      const requestedArtists = decodedArtist.split(',').map(a => a.trim()).filter(Boolean);
      const url = `${this.baseURL}/search/songs?query=${encodeURIComponent(title)}&page=0&limit=10`;

      const response = await fetch(url, { headers: this.headers });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();

      if (!data?.success || !data?.data) throw new Error('Invalid response from JioSaavn');
      const results = data.data.results || [];
      if (results.length === 0) throw new Error('No results found');

      const processedResults = results.map(rawSong => this._createSongPayload(rawSong));
      const matchingTrack = this._findStrictMatchingTrack(processedResults, title, requestedArtists, debug);
      if (!matchingTrack) throw new Error('Strict Match Failed');

      return {
        name: matchingTrack.name,
        year: matchingTrack.year,
        duration: matchingTrack.duration,
        albumName: matchingTrack.album?.name || null,
        artists: matchingTrack.artists.all.map(a => a.name),
        downloadUrl: matchingTrack.downloadUrl
      };
    } catch (error) {
      throw new Error(`JioSaavn search failed: ${error.message}`);
    }
  }

  async searchAll(query, limit = 10, debug = false) {
    try {
      const url = `${this.baseURL}/search/songs?query=${encodeURIComponent(query)}&page=0&limit=${limit}`;
      const response = await fetch(url, { headers: this.headers });
      const data = await response.json();
      if (!data?.success || !data?.data) throw new Error('Invalid response');
      const results = (data.data.results || []).map(rawSong => this._createSongPayload(rawSong));
      return { query, total: results.length, results };
    } catch (error) {
      throw new Error(`JioSaavn searchAll failed: ${error.message}`);
    }
  }

  _createSongPayload(rawSong) {
    let downloadUrl = '';
    if (Array.isArray(rawSong.downloadUrl) && rawSong.downloadUrl.length > 0) {
      const best = rawSong.downloadUrl.find(L => L.quality === '320kbps') || rawSong.downloadUrl.find(L => L.quality === '160kbps') || rawSong.downloadUrl[0];
      downloadUrl = best.url || best.link || '';
    } else downloadUrl = rawSong.downloadUrl || rawSong.url || '';

    return {
      name: rawSong.name || '',
      year: rawSong.year || '',
      duration: rawSong.duration || '',
      album: { name: rawSong.album?.name || '', id: rawSong.album?.id || '' },
      artists: { all: (rawSong.artists?.all || []).map(a => ({ name: a.name || '' })) },
      downloadUrl,
      image: (rawSong.image || []).slice(-1)[0]?.url || ''
    };
  }

  _findStrictMatchingTrack(results, title, requestedArtists, debug) {
    const normalize = s => (s || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
    const reqArtistsNorm = new Set(requestedArtists.map(normalize));

    for (const track of results) {
      const trackName = normalize(track.name);
      const searchTitle = normalize(title);
      if (!trackName.includes(searchTitle) && !searchTitle.includes(trackName)) continue;

      const trackArtistsNorm = new Set(track.artists.all.map(a => normalize(a.name)));
      const allFound = [...reqArtistsNorm].every(ra => [...trackArtistsNorm].some(ta => ta.includes(ra) || ra.includes(ta)));
      if (allFound) return track;
    }
    return null;
  }
}
