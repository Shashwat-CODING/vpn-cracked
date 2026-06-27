const axios = require('axios');

class YouTubeIClient {
  constructor() {
    this.apiKey = 'AIzaSyC9XL3ZjWjXClIX1FmUxJq--EohcD4_oSs';
    this.ytmContext = {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20251015.03.00',
        hl: 'en',
        gl: 'IN'
      }
    };
    this.ytContext = {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20231219.01.00',
        hl: 'en',
        gl: 'IN'
      }
    };
  }

  async init() {
    return true;
  }

  async ensureInitialized() {
    return true;
  }

  async getAlbum(albumId) {
    try {
      const url = `https://music.youtube.com/youtubei/v1/browse?key=${this.apiKey}`;
      const payload = {
        browseId: albumId,
        context: this.ytmContext
      };
      
      const response = await axios.post(url, payload);
      return this._normalizeRawAlbum(response.data, albumId);
    } catch (error) {
      console.error(`[YouTubeI] Failed to fetch album ${albumId}:`, error);
      throw error;
    }
  }

  async getPlaylist(playlistId) {
    try {
      const url = `https://music.youtube.com/youtubei/v1/browse?key=${this.apiKey}`;
      
      // Support VL prefix if not already present
      let browseId = playlistId;
      if (!browseId.startsWith('VL') && !browseId.startsWith('PL') && !browseId.startsWith('RD')) {
        browseId = 'VL' + browseId;
      }
      
      const payload = {
        browseId: browseId,
        context: this.ytmContext
      };
      
      const response = await axios.post(url, payload);
      return this._normalizeRawPlaylist(response.data, playlistId);
    } catch (error) {
      console.error(`[YouTubeI] Failed to fetch playlist ${playlistId}:`, error);
      throw error;
    }
  }

  async getTrending() {
    try {
      const url = `https://music.youtube.com/youtubei/v1/browse?key=${this.apiKey}`;
      const payload = {
        browseId: 'FEmusic_charts',
        context: this.ytmContext
      };
      
      const response = await axios.post(url, payload);
      const contents = response.data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
      
      const songs = [];
      const videos = [];
      const playlists = [];
      
      // Parse Section 0 (Top Songs)
      if (contents[0]?.musicShelfRenderer) {
        const shelfItems = contents[0].musicShelfRenderer.contents || [];
        shelfItems.forEach(item => {
          const t = item.musicResponsiveListItemRenderer;
          if (t) {
            const normalized = this._normalizeRawResponsiveListItem(t, 'MusicResponsiveListItem');
            if (normalized.id) songs.push(normalized);
          }
        });
      }
      
      // Parse Section 1 (Video charts)
      if (contents[1]?.musicCarouselShelfRenderer) {
        const shelfItems = contents[1].musicCarouselShelfRenderer.contents || [];
        shelfItems.forEach(item => {
          const normalized = this._normalizeRawResponsiveListItem(item, 'MusicTwoRowItem');
          if (normalized.id) videos.push(normalized);
        });
      }
      
      // Parse Section 2 (Languages/Playlists)
      if (contents[2]?.musicCarouselShelfRenderer) {
        const shelfItems = contents[2].musicCarouselShelfRenderer.contents || [];
        shelfItems.forEach(item => {
          const normalized = this._normalizeRawResponsiveListItem(item, 'MusicTwoRowItem');
          if (normalized.id) playlists.push(normalized);
        });
      }

      return {
        songs: songs.slice(0, 20),
        videos: videos.slice(0, 20),
        playlists: playlists.slice(0, 10)
      };
    } catch (error) {
      console.error('[YouTubeI] Failed to fetch trending:', error);
      throw error;
    }
  }

  async getRelated(videoId) {
    try {
      const url = `https://www.youtube.com/youtubei/v1/next?key=${this.apiKey}`;
      const payload = {
        videoId: videoId,
        context: this.ytContext
      };
      
      const response = await axios.post(url, payload);
      const results = response.data?.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results || [];
      
      const normalized = results
        .filter(r => r.lockupViewModel)
        .map(r => this._normalizeRawRelatedItem(r.lockupViewModel))
        .filter(item => {
          if (!item.videoId || !item.title) return false;
          if (item.duration_seconds && item.duration_seconds <= 60) return false;
          if (item.isShort) return false;
          return true;
        });
        
      return normalized;
    } catch (error) {
      console.error(`[YouTubeI] Failed to fetch related for ${videoId}:`, error);
      throw error;
    }
  }

  // Internal Helper Parsers
  _normalizeRawAlbum(data, id) {
    const renderer = data?.contents?.twoColumnBrowseResultsRenderer || {};
    const tabs = renderer.tabs || [];
    const header = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicResponsiveHeaderRenderer || {};
    
    const title = header.title?.runs?.[0]?.text || '';
    const subtitleRuns = header.subtitle?.runs || [];
    const artist = subtitleRuns.map(r => r.text).join('');
    const year = subtitleRuns.find(r => /^\d{4}$/.test(r.text))?.text || '';
    const thumbnail = header.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url || '';
    
    const buttons = header.buttons || [];
    const playButton = buttons.find(b => b.musicPlayButtonRenderer)?.musicPlayButtonRenderer;
    const playlistId = playButton?.playNavigationEndpoint?.watchEndpoint?.playlistId || null;

    // Get tracks
    let tracksList = [];
    const contents = renderer.secondaryContents?.sectionListRenderer?.contents || [];
    const shelf = contents.find(c => c.musicPlaylistShelfRenderer || c.musicShelfRenderer);
    const shelfData = shelf?.musicPlaylistShelfRenderer || shelf?.musicShelfRenderer;
    if (shelfData && shelfData.contents) {
      tracksList = shelfData.contents.map(item => item.musicResponsiveListItemRenderer).filter(Boolean);
    }

    const tracks = tracksList.map(t => this._normalizeRawTrack(t, title));

    return {
      id: id,
      playlistId: playlistId,
      title: title,
      artist: artist,
      year: year,
      thumbnail: thumbnail,
      tracks: tracks,
      type: 'album'
    };
  }

  _normalizeRawPlaylist(data, id) {
    const renderer = data?.contents?.twoColumnBrowseResultsRenderer || data?.contents?.singleColumnBrowseResultsRenderer || {};
    let tabs = renderer.tabs || [];
    
    if (tabs.length === 0 && data?.contents?.singleColumnBrowseResultsRenderer?.tabs) {
      tabs = data.contents.singleColumnBrowseResultsRenderer.tabs;
    }

    const header = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicResponsiveHeaderRenderer || {};
    
    const title = header.title?.runs?.[0]?.text || '';
    const subtitleRuns = header.subtitle?.runs || [];
    const author = subtitleRuns.map(r => r.text).join('');
    const thumbnail = header.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url || '';

    // Get tracks
    let tracksList = [];
    const secondaryContents = renderer.secondaryContents?.sectionListRenderer?.contents || [];
    let shelf = secondaryContents.find(c => c.musicPlaylistShelfRenderer || c.musicShelfRenderer);
    
    if (!shelf && tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents) {
      shelf = tabs[0].tabRenderer.content.sectionListRenderer.contents.find(c => c.musicPlaylistShelfRenderer || c.musicShelfRenderer);
    }
    
    const shelfData = shelf?.musicPlaylistShelfRenderer || shelf?.musicShelfRenderer;
    if (shelfData && shelfData.contents) {
      tracksList = shelfData.contents.map(item => item.musicResponsiveListItemRenderer).filter(Boolean);
    }

    const tracks = tracksList.map(t => this._normalizeRawTrack(t));

    return {
      id: id,
      title: title,
      author: author,
      thumbnail: thumbnail,
      tracks: tracks,
      type: 'playlist'
    };
  }

  _normalizeRawTrack(track, albumName = '') {
    const flexColumns = track.flexColumns || [];
    const title = flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
    
    const subtitleRuns = flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
    const artists = [];
    let album = albumName;
    
    subtitleRuns.forEach(run => {
      const pageType = run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
      if (pageType === 'MUSIC_PAGE_TYPE_ARTIST') {
        artists.push(run.text);
      } else if (pageType === 'MUSIC_PAGE_TYPE_ALBUM') {
        album = run.text;
      }
    });
    
    if (artists.length === 0 && subtitleRuns.length > 0) {
      artists.push(subtitleRuns[0].text);
    }

    let duration = '';
    if (track.fixedColumns && track.fixedColumns.length > 0) {
      duration = track.fixedColumns[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text || '';
    } else if (flexColumns[2]) {
      duration = flexColumns[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
    }

    const watchEndpoint = track.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint;
    const id = watchEndpoint?.videoId || '';
    const thumbnail = track.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url || '';

    return {
      id: id,
      title: title,
      artist: artists.join(', '),
      album: album,
      duration: duration,
      thumbnail: thumbnail,
      videoId: id
    };
  }

  _normalizeRawResponsiveListItem(item, itemType) {
    if (!item) return {};

    if (item.flexColumns) {
      const title = item.flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
      const subtitleRuns = item.flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const artists = [];
      let album = '';
      
      subtitleRuns.forEach(run => {
        const pageType = run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
        if (pageType === 'MUSIC_PAGE_TYPE_ARTIST') {
          artists.push(run.text);
        } else if (pageType === 'MUSIC_PAGE_TYPE_ALBUM') {
          album = run.text;
        }
      });
      
      if (artists.length === 0 && subtitleRuns.length > 0) {
        artists.push(subtitleRuns[0].text);
      }

      let duration = '';
      if (item.fixedColumns && item.fixedColumns.length > 0) {
        duration = item.fixedColumns[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text || '';
      }

      const watchEndpoint = item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint;
      const id = watchEndpoint?.videoId || item.navigationEndpoint?.browseEndpoint?.browseId || '';
      const thumbnail = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url || '';

      return {
        id,
        title,
        artist: artists.join(', '),
        album,
        duration,
        thumbnail,
        views: '',
        type: itemType
      };
    }
    
    if (item.musicTwoRowItemRenderer) {
      const r = item.musicTwoRowItemRenderer;
      const id = r.navigationEndpoint?.watchEndpoint?.videoId || r.navigationEndpoint?.browseEndpoint?.browseId || '';
      const title = r.title?.runs?.[0]?.text || '';
      const subtitleRuns = r.subtitle?.runs || [];
      const artist = subtitleRuns.map(run => run.text).join('');
      const thumbnail = r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url || '';
      
      return {
        id,
        title,
        artist,
        album: '',
        duration: '',
        thumbnail,
        views: '',
        type: itemType
      };
    }

    return {};
  }

  _normalizeRawRelatedItem(lockup) {
    const videoId = lockup.contentId || '';
    const title = lockup.metadata?.lockupMetadataViewModel?.title?.content || '';
    
    const subtitleContent = lockup.metadata?.lockupMetadataViewModel?.subtitle?.content || '';
    const author = subtitleContent.split(' • ')[0] || '';
    
    const sources = lockup.contentImage?.thumbnailViewModel?.image?.sources || [];
    const thumbnail = sources.slice(-1)[0]?.url || '';
    
    let duration = '';
    const overlays = lockup.contentImage?.thumbnailViewModel?.overlays || [];
    for (const overlay of overlays) {
      const timeBadge = overlay.thumbnailBottomOverlayViewModel?.badges?.find(b => b.thumbnailOverlayTimeStatusRenderer);
      if (timeBadge) {
        duration = timeBadge.thumbnailOverlayTimeStatusRenderer.text?.simpleText || '';
        break;
      }
    }
    
    const duration_seconds = this._parseDuration(duration);
    const isShort = duration_seconds > 0 && duration_seconds <= 60;
    
    return {
      videoId,
      title,
      artist: author,
      thumbnail,
      duration,
      duration_seconds,
      isShort
    };
  }

  _parseDuration(durationStr) {
    if (!durationStr || typeof durationStr !== 'string') return 0;
    const parts = durationStr.split(':').map(p => parseInt(p) || 0);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
      return parts[0];
    }
    return 0;
  }
}

const youtubeiClient = new YouTubeIClient();
module.exports = youtubeiClient;
