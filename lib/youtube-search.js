export class YouTubeSearch {
  constructor() {
    this.baseURL = 'https://www.youtube.com';
    this.searchURL = 'https://www.youtube.com/results';
    this.continuationURL = 'https://www.youtube.com/youtubei/v1/search';
    this.suggestionsURL = 'https://suggestqueries-clients6.youtube.com/complete/search';
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    this.apiKey = null;
    this.clientVersion = null;
  }

  async _extractAPIConfig(html) {
    try {
      const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
      const clientVersionMatch = html.match(/"clientVersion":"([^"]+)"/);
      if (apiKeyMatch) this.apiKey = apiKeyMatch[1];
      if (clientVersionMatch) this.clientVersion = clientVersionMatch[1];
    } catch (error) {
      console.error('Error extracting API config:', error);
    }
  }

  async _fetchContinuation(continuationToken) {
    try {
      if (!this.apiKey) throw new Error('API key not initialized.');
      const response = await fetch(`${this.continuationURL}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': this.headers['User-Agent'] },
        body: JSON.stringify({
          continuation: continuationToken,
          context: { client: { clientName: 'WEB', clientVersion: this.clientVersion || '2.20231219.01.00' } }
        })
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      throw new Error(`Continuation request failed: ${error.message}`);
    }
  }

  async searchVideos(query, continuationToken = null) {
    try {
      if (continuationToken) {
        const data = await this._fetchContinuation(continuationToken);
        return this._parseContinuationResults(data, 'video');
      }
      if (!query) throw new Error('Query is required.');
      const response = await fetch(`${this.searchURL}?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`, { headers: this.headers });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const html = await response.text();
      await this._extractAPIConfig(html);
      return this._parseVideoResults(html);
    } catch (error) {
      throw new Error(`Video search failed: ${error.message}`);
    }
  }

  async searchChannels(query, continuationToken = null) {
    try {
      if (continuationToken) {
        const data = await this._fetchContinuation(continuationToken);
        return this._parseContinuationResults(data, 'channel');
      }
      if (!query) throw new Error('Query is required.');
      const response = await fetch(`${this.searchURL}?search_query=${encodeURIComponent(query)}&sp=EgIQAg%253D%253D`, { headers: this.headers });
      const html = await response.text();
      await this._extractAPIConfig(html);
      return this._parseChannelResults(html);
    } catch (error) {
      throw new Error(`Channel search failed: ${error.message}`);
    }
  }

  async searchPlaylists(query, continuationToken = null) {
    try {
      if (continuationToken) {
        const data = await this._fetchContinuation(continuationToken);
        return this._parseContinuationResults(data, 'playlist');
      }
      if (!query) throw new Error('Query is required.');
      const response = await fetch(`${this.searchURL}?search_query=${encodeURIComponent(query)}&sp=EgIQAw%253D%253D`, { headers: this.headers });
      const html = await response.text();
      await this._extractAPIConfig(html);
      return this._parsePlaylistResults(html);
    } catch (error) {
      throw new Error(`Playlist search failed: ${error.message}`);
    }
  }

  _parseContinuationResults(data, type) {
    const results = [];
    let nextContinuationToken = null;
    const actions = data?.onResponseReceivedCommands || data?.onResponseReceivedActions || [];
    for (const action of actions) {
      const items = action?.appendContinuationItemsAction?.continuationItems || [];
      const pushByType = (node) => {
        if (!node) return;
        if (type === 'video' && node.videoRenderer) {
          const v = this._parseVideoRenderer(node.videoRenderer);
          if (v) results.push(v);
        } else if (type === 'channel' && node.channelRenderer) {
          const c = this._parseChannelRenderer(node.channelRenderer);
          if (c) results.push(c);
        } else if (type === 'playlist' && node.playlistRenderer) {
          const p = this._parsePlaylistRenderer(node.playlistRenderer);
          if (p) results.push(p);
        } else if (node.richItemRenderer?.content) pushByType(node.richItemRenderer.content);
        else if (node.itemSectionRenderer?.contents) node.itemSectionRenderer.contents.forEach(pushByType);
      };
      items.forEach(item => {
        if (item.continuationItemRenderer) nextContinuationToken = item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        else pushByType(item);
      });
    }
    return { results, continuationToken: nextContinuationToken };
  }

  async getSuggestions(query) {
    try {
      const url = `${this.suggestionsURL}?ds=yt&hl=en&gl=IN&client=youtube&gs_ri=youtube&q=${encodeURIComponent(query)}&cp=${query.length}`;
      const response = await fetch(url, { headers: this.headers });
      const text = await response.text();
      return this._parseSuggestions(text);
    } catch (error) {
      return this._getStaticSuggestions(query);
    }
  }

  async getChannelInfo(channelId) {
    try {
      const response = await fetch(`${this.baseURL}/channel/${channelId}`, { headers: this.headers });
      const html = await response.text();
      return this._parseChannelInfo(html);
    } catch (error) {
      throw new Error(`Channel info failed: ${error.message}`);
    }
  }

  _parseVideoResults(html) {
    const jsonMatch = html.match(/var ytInitialData = ({.+?});/);
    if (!jsonMatch) return { results: [], continuationToken: null };
    const data = JSON.parse(jsonMatch[1]);
    const items = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
    const results = items.map(item => item.videoRenderer ? this._parseVideoRenderer(item.videoRenderer) : item.richItemRenderer?.content?.videoRenderer ? this._parseVideoRenderer(item.richItemRenderer.content.videoRenderer) : null).filter(Boolean);
    return { results, continuationToken: this._extractContinuationToken(data) };
  }

  _parseChannelResults(html) {
    const jsonMatch = html.match(/var ytInitialData = ({.+?});/);
    if (!jsonMatch) return { results: [], continuationToken: null };
    const data = JSON.parse(jsonMatch[1]);
    const items = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.flatMap(s => s?.itemSectionRenderer?.contents || []) || [];
    const results = items.map(item => item.channelRenderer ? this._parseChannelRenderer(item.channelRenderer) : null).filter(Boolean);
    return { results, continuationToken: this._extractContinuationToken(data) };
  }

  _parsePlaylistResults(html) {
    const jsonMatch = html.match(/var ytInitialData = ({.+?});/);
    if (!jsonMatch) return { results: [], continuationToken: null };
    const data = JSON.parse(jsonMatch[1]);
    const items = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.flatMap(s => s?.itemSectionRenderer?.contents || []) || [];
    const results = items.map(item => item.playlistRenderer ? this._parsePlaylistRenderer(item.playlistRenderer) : null).filter(Boolean);
    return { results, continuationToken: this._extractContinuationToken(data) };
  }

  _extractContinuationToken(data) {
    const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    for (const section of sections) {
      if (section.continuationItemRenderer) return section.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      for (const it of (section?.itemSectionRenderer?.contents || [])) {
        if (it.continuationItemRenderer) return it.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      }
    }
    return null;
  }

  _parseVideoRenderer(v) {
    return {
      id: v.videoId,
      title: v.title?.runs?.[0]?.text || v.title?.simpleText,
      duration: v.lengthText?.simpleText,
      channel: { name: v.ownerText?.runs?.[0]?.text, id: v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId },
      thumbnails: (v.thumbnail?.thumbnails || []).map(t => ({ url: t.url, width: t.width, height: t.height })),
      type: 'video'
    };
  }

  _parseChannelRenderer(c) {
    return { type: 'channel', channelId: c.channelId, title: c.title?.simpleText || c.title?.runs?.[0]?.text, thumbnail: c.thumbnail?.thumbnails?.[0]?.url };
  }

  _parsePlaylistRenderer(p) {
    return { type: 'playlist', playlistId: p.playlistId, title: p.title?.simpleText || p.title?.runs?.[0]?.text, thumbnail: p.thumbnails?.[0]?.thumbnails?.[0]?.url, videoCount: p.videoCount };
  }

  _parseSuggestions(text) {
    try {
      let data = text;
      if (data.includes('window.google.ac.')) data = data.slice(data.indexOf('(') + 1, data.lastIndexOf(')'));
      const parsed = JSON.parse(data);
      return (parsed[1] || []).map(item => Array.isArray(item) ? item[0] : item).slice(0, 10);
    } catch { return []; }
  }

  _parseChannelInfo(html) {
    const jsonMatch = html.match(/var ytInitialData = ({.+?});/);
    if (!jsonMatch) throw new Error('Parse failed');
    const header = JSON.parse(jsonMatch[1])?.header?.c4TabbedHeaderRenderer;
    return { title: header.title, channelId: header.channelId, thumbnail: header.avatar?.thumbnails?.[0]?.url };
  }

  _getStaticSuggestions(q) {
    return [q, `${q} song`, `${q} video`, `${q} music`].slice(0, 10);
  }
}
