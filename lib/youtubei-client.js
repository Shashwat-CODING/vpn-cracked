const axios = require('axios');

class YouTubeIClient {
    constructor() {
        this.youtube = null;
        this.initPromise = null;
    }

    async init() {
        try {
            const { Innertube } = await import('youtubei.js');
            this.youtube = await Innertube.create();
            console.log('[YouTubeI] Client initialized successfully');
            return this.youtube;
        } catch (error) {
            console.error('[YouTubeI] Initialization failed:', error);
            this.initPromise = null; // Reset so next attempt can try again
            throw error;
        }
    }

    async ensureInitialized() {
        if (!this.youtube) {
            if (!this.initPromise) {
                this.initPromise = this.init();
            }
            await this.initPromise;
        }
        return this.youtube;
    }

    // --- Search methods ---
    async search(query, filter = null, continuationToken = null) {
        const yt = await this.ensureInitialized();
        try {
            if (continuationToken) {
                const response = await yt.actions.execute('/search', { continuation: continuationToken }, { client: 'YTMUSIC' });
                const results = [];
                const contents = response.data?.continuationContents?.musicSearchResultContinuation?.contents || [];
                for (const item of contents) {
                    const normalized = this._normalizeResponsiveListItem(item.musicResponsiveListItemRenderer);
                    if (normalized.id) results.push(normalized);
                }
                const nextContinuation = response.data?.continuationContents?.musicSearchResultContinuation?.continuations?.[0]?.nextContinuationData?.continuation;
                return {
                    results,
                    continuationToken: nextContinuation || null
                };
            }

            const options = {};
            if (filter) {
                const filterMap = {
                    songs: 'song',
                    videos: 'video',
                    albums: 'album',
                    artists: 'artist',
                    playlists: 'playlist'
                };
                if (filterMap[filter]) options.type = filterMap[filter];
            }

            const searchResults = await yt.music.search(query, options);
            const results = [];

            if (options.type) {
                let items = [];
                if (searchResults.contents?.[0]?.type === 'MusicShelf') {
                    items = searchResults.contents[0].contents || [];
                } else {
                    items = searchResults.contents || [];
                }
                for (const item of items) {
                    const normalized = this._normalizeResponsiveListItem(item);
                    if (normalized.id) results.push(normalized);
                }
            } else {
                const sections = ['songs', 'videos', 'albums', 'playlists', 'artists'];
                for (const sec of sections) {
                    if (searchResults[sec] && searchResults[sec].contents) {
                        for (const item of searchResults[sec].contents) {
                            const normalized = this._normalizeResponsiveListItem(item);
                            if (normalized.id) results.push(normalized);
                        }
                    }
                }
            }

            return {
                results,
                continuationToken: searchResults.continuation || null
            };
        } catch (error) {
            console.error('[YouTubeI] Search failed:', error);
            throw error;
        }
    }

    async getSearchSuggestions(query) {
        const yt = await this.ensureInitialized();
        try {
            const sections = await yt.music.getSearchSuggestions(query);
            const suggestions = [];
            if (sections && sections.length > 0 && sections[0].contents) {
                for (const item of sections[0].contents) {
                    const text = item.suggestion?.text;
                    if (text) suggestions.push(text);
                }
            }
            return suggestions;
        } catch (error) {
            console.error('[YouTubeI] Suggestions failed:', error);
            throw error;
        }
    }

    async getYouTubeSong(query) {
        const yt = await this.ensureInitialized();
        try {
            const search = await yt.search(query, { type: 'video' });
            const first = (search.results || []).find(r => r.type === 'Video');
            if (!first) {
                return { error: 'No YouTube result found' };
            }
            return {
                id: first.id,
                title: first.title?.text || '',
                author: first.author?.name || '',
                duration: first.duration?.text || null,
                channelUrl: first.author?.id ? `channel/${first.author.id}` : null
            };
        } catch (err) {
            console.error('[YouTubeI] getYouTubeSong failed:', err);
            return { error: `YouTube search failed: ${err.message}` };
        }
    }

    // --- Song / Stream Details ---
    async getSong(videoId) {
        const yt = await this.ensureInitialized();
        try {
            const response = await yt.actions.execute('/player', {
                videoId
            }, { client: 'YTMUSIC' });
            
            const details = response.data?.videoDetails || {};
            return {
                videoId: details.videoId || videoId,
                title: details.title || '',
                artist: details.author || '',
                duration: details.lengthSeconds || '',
                thumbnail: details.thumbnail?.thumbnails?.[0]?.url || '',
                views: details.viewCount || ''
            };
        } catch (error) {
            console.error('[YouTubeI] getSong failed:', error);
            throw error;
        }
    }

    // --- Album methods ---
    async getAlbum(albumId) {
        const yt = await this.ensureInitialized();
        try {
            const album = await yt.music.getAlbum(albumId);
            return this._normalizeAlbum(album, albumId);
        } catch (error) {
            console.error(`[YouTubeI] Failed to fetch album ${albumId}:`, error);
            throw error;
        }
    }

    _normalizeAlbum(album, id) {
        const tracks = (album.contents || []).map(track => this._normalizeTrack(track, album.header?.title?.text));

        let playlistId = null;
        const buttons = album.header?.buttons || [];
        for (const button of buttons) {
            if (button.type === 'MusicPlayButton' && button.endpoint?.payload?.playlistId) {
                playlistId = button.endpoint.payload.playlistId;
                break;
            }
        }

        return {
            id: id,
            playlistId: playlistId,
            title: album.header?.title?.text || '',
            artist: album.header?.subtitle?.runs?.map(r => r.text).join('') || '',
            year: album.header?.subtitle?.runs?.find(r => /^\d{4}$/.test(r.text))?.text || '',
            thumbnail: album.header?.thumbnail?.contents?.[0]?.url || '',
            tracks: tracks,
            type: 'album'
        };
    }

    // --- Playlist methods ---
    async getPlaylist(playlistId) {
        const yt = await this.ensureInitialized();
        try {
            const playlist = await yt.music.getPlaylist(playlistId);
            return this._normalizePlaylist(playlist, playlistId);
        } catch (error) {
            console.error(`[YouTubeI] Failed to fetch playlist ${playlistId}:`, error);
            throw error;
        }
    }

    _normalizePlaylist(playlist, id) {
        const tracks = (playlist.items || []).map(track => this._normalizeTrack(track));

        return {
            id: id,
            title: playlist.header?.title?.text || '',
            author: playlist.header?.subtitle?.runs?.map(r => r.text).join('') || '',
            thumbnail: playlist.header?.thumbnail?.contents?.[0]?.url || '',
            tracks: tracks,
            type: 'playlist'
        };
    }

    _normalizeTrack(track, albumName = '') {
        const title = track.title || track.name || '';
        const artists = track.artists || [];
        const album = track.album || { name: albumName };
        const duration = track.duration?.text || track.duration || '';
        const id = track.id || track.videoId || '';
        const thumbnail = track.thumbnails?.[0]?.url || '';

        return {
            id: id,
            title: title,
            artist: artists.map(a => a.name).join(', '),
            album: album.name || '',
            duration: duration,
            thumbnail: thumbnail,
            videoId: id
        };
    }

    // --- Artist methods ---
    async getArtist(artistId) {
        const yt = await this.ensureInitialized();
        try {
            const artist = await yt.music.getArtist(artistId);
            return artist;
        } catch (error) {
            console.error(`[YouTubeI] getArtist failed:`, error);
            throw error;
        }
    }

    // --- Explore, Moods, Trending ---
    async _browseRequest(browseId, params = null) {
        const url = 'https://music.youtube.com/youtubei/v1/browse?key=AIzaSyC9XL3ZjWjXClIX1FmUxJq--EohcD4_oSs';
        const requestBody = {
            context: {
                client: {
                    hl: "en",
                    gl: "IN",
                    clientName: "WEB_REMIX",
                    clientVersion: "1.20251013.01.00"
                }
            },
            browseId
        };
        if (params) {
            requestBody.params = params;
        }
        const response = await axios.post(url, requestBody, {
            headers: {
                'content-type': 'application/json',
                'origin': 'https://music.youtube.com'
            }
        });
        return response.data;
    }

    async getMoodCategories() {
        try {
            const data = await this._browseRequest('FEmusic_moods_and_genres');
            return this._parseMoodCategories(data);
        } catch (error) {
            console.error('[YouTubeI] getMoodCategories failed:', error);
            throw error;
        }
    }

    async getMoodPlaylists(categoryId, params = null) {
        try {
            const data = await this._browseRequest(categoryId, params);
            return this._parseMoodPlaylists(data);
        } catch (error) {
            console.error('[YouTubeI] getMoodPlaylists failed:', error);
            throw error;
        }
    }

    _parseMoodCategories(data) {
        const contents = data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
        const categories = [];

        contents.forEach(section => {
            const grid = section.gridRenderer;
            if (grid) {
                const title = grid.header?.gridHeaderRenderer?.title?.runs?.[0]?.text || '';
                const items = (grid.items || []).map(item => {
                    const button = item.musicNavigationButtonRenderer;
                    if (button) {
                        return {
                            title: button.buttonText?.runs?.[0]?.text || '',
                            browseId: button.clickCommand?.browseEndpoint?.browseId || '',
                            params: button.clickCommand?.browseEndpoint?.params || ''
                        };
                    }
                    return null;
                }).filter(Boolean);

                categories.push({
                    title,
                    items
                });
            }
        });

        return categories;
    }

    _parseMoodPlaylists(data) {
        const contents = data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
        const playlists = [];

        contents.forEach(section => {
            if (section.musicShelfRenderer) {
                const items = section.musicShelfRenderer.contents || [];
                const playlistItems = items.map(item => this._parseMusicItem(item.musicResponsiveListItemRenderer)).filter(Boolean);
                playlists.push(...playlistItems);
            }
        });

        return playlists;
    }

    _parseMusicItem(item) {
        if (!item) return null;
        const id = item.playlistId || item.videoId || item.navigationEndpoint?.browseEndpoint?.browseId || '';
        const title = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
        const subtitleRuns = item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
        const artist = subtitleRuns.map(r => r.text).join('') || '';
        const thumbnail = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url || '';
        return {
            id,
            title,
            artist,
            thumbnail
        };
    }

    async getWatchPlaylist(videoId = null, playlistId = null) {
        const url = 'https://music.youtube.com/youtubei/v1/next?key=AIzaSyC9XL3ZjWjXClIX1FmUxJq--EohcD4_oSs';
        const requestBody = {
            context: {
                client: {
                    hl: "en",
                    gl: "IN",
                    clientName: "WEB_REMIX",
                    clientVersion: "1.20251013.01.00"
                }
            },
            videoId,
            playlistId
        };
        const response = await axios.post(url, requestBody, {
            headers: {
                'content-type': 'application/json',
                'origin': 'https://music.youtube.com'
            }
        });
        return this._parseWatchPlaylist(response.data);
    }

    _parseWatchPlaylist(data) {
        const contents = data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents || [];
        const tracks = [];

        contents.forEach(item => {
            if (item.playlistPanelVideoRenderer) {
                const video = item.playlistPanelVideoRenderer;
                tracks.push({
                    videoId: video.videoId,
                    title: video.title?.runs?.[0]?.text,
                    author: video.shortBylineText?.runs?.[0]?.text,
                    lengthSeconds: video.lengthSeconds,
                    thumbnail: video.thumbnail?.thumbnails?.[0]?.url
                });
            }
        });

        return tracks;
    }

    async getTrending() {
        const yt = await this.ensureInitialized();
        try {
            const home = await yt.music.getHomeFeed();
            const allSongs = [];
            const allVideos = [];
            const allPlaylists = [];

            if (home.sections) {
                for (const section of home.sections) {
                    const sectionTitle = section.title?.text || section.header?.title?.text || '';
                    const items = section.contents || [];
                    if (items.length === 0) continue;

                    const normalizedItems = items
                        .map(item => this._normalizeResponsiveListItem(item))
                        .filter(item => item.id);

                    const lowerTitle = sectionTitle.toLowerCase();
                    if (lowerTitle.includes('album') || lowerTitle.includes('playlist') || lowerTitle.includes('mix')) {
                        allPlaylists.push(...normalizedItems);
                    } else if (lowerTitle.includes('video')) {
                        allVideos.push(...normalizedItems);
                    } else {
                        allSongs.push(...normalizedItems);
                    }
                }
            }

            if (allVideos.length < 20 || allPlaylists.length < 10) {
                try {
                    const explore = await yt.music.getExplore();
                    const videoSection = explore.sections.find(s => (s.title?.text || s.header?.title?.text) === 'New music videos');
                    if (videoSection) {
                        const videos = (videoSection.contents || [])
                            .map(item => this._normalizeResponsiveListItem(item))
                            .filter(item => item.id);
                        allVideos.push(...videos);
                    }

                    const trendingSection = explore.sections.find(s => (s.title?.text || s.header?.title?.text) === 'Trending');
                    if (trendingSection) {
                        const trendingItems = (trendingSection.contents || [])
                            .map(item => this._normalizeResponsiveListItem(item))
                            .filter(item => item.id);

                        if (allSongs.length < 20) {
                            allSongs.push(...trendingItems);
                        }
                    }
                } catch (e) {
                    console.warn('[YouTubeI] Failed to fetch Explore fallback:', e.message);
                }
            }

            if (allPlaylists.length < 10) {
                try {
                    const playlistSearch = await yt.music.search('Trending', { type: 'playlist' });
                    let playlistItems = [];
                    if (playlistSearch.contents?.length > 0 && playlistSearch.contents[0].type === 'MusicShelf') {
                        playlistItems = playlistSearch.contents[0].contents;
                    } else {
                        playlistItems = playlistSearch.contents || [];
                    }

                    const searchedPlaylists = playlistItems
                        .map(item => this._normalizeResponsiveListItem(item))
                        .filter(item => item.id);

                    allPlaylists.push(...searchedPlaylists);
                } catch (e) {
                    console.warn('[YouTubeI] Failed to fetch Playlist fallback:', e.message);
                }
            }

            const uniqueSongs = this._removeDuplicates(allSongs).slice(0, 20);
            const uniqueVideos = this._removeDuplicates(allVideos).slice(0, 20);
            const uniquePlaylists = this._removeDuplicates(allPlaylists).slice(0, 10);

            return {
                songs: uniqueSongs,
                videos: uniqueVideos,
                playlists: uniquePlaylists
            };
        } catch (error) {
            console.error('[YouTubeI] Failed to fetch trending:', error);
            throw error;
        }
    }

    _removeDuplicates(items) {
        const seen = new Set();
        return items.filter(item => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
        });
    }

    async getRelated(videoId) {
        const yt = await this.ensureInitialized();
        try {
            const info = await yt.getInfo(videoId);
            const watchNextFeed = info.watch_next_feed || [];
            const items = watchNextFeed.filter(item => item.type === 'LockupView');
            const normalized = items
                .map(item => this._normalizeRelatedItem(item))
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

    _normalizeRelatedItem(item) {
        if (!item || item.type !== 'LockupView') return {};

        let videoId = '';
        if (item.content_image?.overlays) {
            for (const overlay of item.content_image.overlays) {
                if (overlay.type === 'ThumbnailHoverOverlayToggleActionsView' && overlay.buttons) {
                    for (const button of overlay.buttons) {
                        const actions = button.default_button?.on_tap?.command?.actions;
                        if (actions && actions.length > 0) {
                            videoId = actions[0].video_id;
                            if (videoId) break;
                        }
                        if (!videoId) {
                            videoId = button.default_button?.on_tap?.command?.video_id || '';
                        }
                        if (videoId) break;
                    }
                }
                if (videoId) break;
            }
        }

        if (!videoId && item.content_position?.on_tap) {
            videoId = item.content_position.on_tap.payload?.videoId || item.content_position.on_tap.payload?.watchEndpoint?.videoId || '';
        }

        const title = item.metadata?.title?.text || item.metadata?.title?.runs?.map(r => r.text).join('') || '';
        const thumbnail = item.content_image?.image?.[0]?.url || '';

        let duration = '';
        let duration_seconds = 0;
        if (item.content_image?.overlays) {
            for (const overlay of item.content_image.overlays) {
                if (overlay.type === 'ThumbnailOverlayBadgeView' && overlay.badges) {
                    for (const badge of overlay.badges) {
                        if (badge.type === 'ThumbnailBadgeView' && badge.text) {
                            duration = badge.text;
                            duration_seconds = this._parseDuration(duration);
                            break;
                        }
                    }
                }
                if (duration) break;
            }
        }

        const author = item.metadata?.subtitle?.text || item.metadata?.subtitle?.runs?.map(r => r.text).join(' ') || '';
        const isShort = (duration_seconds > 0 && duration_seconds <= 60) || false;

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

    _normalizeResponsiveListItem(item) {
        if (!item) return {};

        let id = item.id || item.videoId || item.endpoint?.payload?.videoId || item.endpoint?.payload?.browseId || '';
        let title = item.title?.text || item.title?.runs?.map(r => r.text).join('') || item.title || '';
        let artist = '';
        let album = '';
        let duration = '';
        let thumbnail = '';
        let views = '';

        if (item.type === 'MusicResponsiveListItem') {
            if (item.flex_columns && item.flex_columns.length > 0) {
                title = item.flex_columns[0].title?.text ||
                    item.flex_columns[0].title?.runs?.map(r => r.text).join('') || title;

                if (item.flex_columns.length > 1) {
                    const subtitleRuns = item.flex_columns[1].title?.runs || [];
                    const textParts = subtitleRuns.map(r => r.text).filter(t => t !== ' • ');

                    textParts.forEach(part => {
                        if (/^\d{4}$/.test(part)) {
                            // Year
                        } else if (/^\d+:\d+$/.test(part) || /^\d+:\d+:\d+$/.test(part)) {
                            duration = part;
                        } else if (part.includes('views') || part.includes('view')) {
                            views = part;
                        } else if (!artist) {
                            artist = part;
                        } else {
                            album = part;
                        }
                    });
                }
            }
            thumbnail = item.thumbnails?.[0]?.url || item.thumbnail?.contents?.[0]?.url || '';
        }
        else if (item.type === 'MusicTwoRowItem') {
            if (item.artists) {
                artist = item.artists.map(a => a.name).join(', ');
            }
            if (item.views) {
                views = item.views;
            }

            if (!artist) {
                const subtitleRuns = item.subtitle?.runs || [];
                const textParts = subtitleRuns.map(r => r.text).filter(t => t !== ' • ');
                textParts.forEach(part => {
                    if (part.includes('views') || part.includes('view')) views = part;
                    else if (!artist) artist = part;
                });
            }

            if (Array.isArray(item.thumbnail)) {
                thumbnail = item.thumbnail[0].url;
            } else if (item.thumbnails) {
                thumbnail = item.thumbnails[0].url;
            } else {
                thumbnail = item.thumbnail?.contents?.[0]?.url || '';
            }
        }

        return {
            id,
            title,
            artist,
            artists: artist ? [{ name: artist }] : [],
            album,
            duration,
            thumbnail,
            views,
            type: item.type
        };
    }

    // --- Backward Compatibility wrappers for legacy code ---
    async _makeRequest(endpoint, params) {
        const yt = await this.ensureInitialized();
        const route = `/${endpoint}`;
        const response = await yt.actions.execute(route, params, { client: 'YTMUSIC' });
        return response.data;
    }

    async getCharts(country = 'US') {
        try {
            const data = await this._browseRequest('FEmusic_charts');
            return data;
        } catch (error) {
            console.error('[YouTubeI] getCharts failed:', error);
            throw error;
        }
    }

    async getSuggestions(query) {
        return this.getSearchSuggestions(query);
    }

    async searchVideos(query, continuationToken = null) {
        const yt = await this.ensureInitialized();
        try {
            if (continuationToken) {
                const response = await yt.actions.execute('/search', { continuation: continuationToken });
                const results = [];
                const contents = response.data?.continuationContents?.searchResultContinuation?.contents || [];
                for (const item of contents) {
                    const video = item.videoRenderer;
                    if (video) {
                        results.push({
                            id: video.videoId,
                            title: video.title?.runs?.map(r => r.text).join('') || '',
                            duration: video.lengthText?.simpleText || '',
                            views: video.viewCountText?.simpleText || '',
                            channel: {
                                name: video.ownerText?.runs?.[0]?.text || '',
                                id: video.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || ''
                            }
                        });
                    }
                }
                const nextContinuation = response.data?.continuationContents?.searchResultContinuation?.continuations?.[0]?.nextContinuationData?.continuation;
                return {
                    results,
                    nextPageToken: nextContinuation || null
                };
            }

            const searchResults = await yt.search(query, { type: 'video' });
            const results = (searchResults.results || []).filter(r => r.type === 'Video').map(v => ({
                id: v.id,
                title: v.title?.text || '',
                duration: v.duration?.text || '',
                views: v.short_view_count?.text || '',
                channel: {
                    name: v.author?.name || '',
                    id: v.author?.id || ''
                }
            }));

            return {
                results,
                nextPageToken: searchResults.continuation || null
            };
        } catch (error) {
            console.error('[YouTubeI] searchVideos failed:', error);
            throw error;
        }
    }

    async searchChannels(query, continuationToken = null) {
        const yt = await this.ensureInitialized();
        try {
            if (continuationToken) {
                const response = await yt.actions.execute('/search', { continuation: continuationToken });
                const results = [];
                const contents = response.data?.continuationContents?.searchResultContinuation?.contents || [];
                for (const item of contents) {
                    const channel = item.channelRenderer;
                    if (channel) {
                        results.push({
                            id: channel.channelId,
                            title: channel.title?.simpleText || '',
                            snippet: channel.descriptionSnippet?.runs?.map(r => r.text).join('') || '',
                            thumbnail: channel.thumbnail?.thumbnails?.[0]?.url || ''
                        });
                    }
                }
                const nextContinuation = response.data?.continuationContents?.searchResultContinuation?.continuations?.[0]?.nextContinuationData?.continuation;
                return {
                    results,
                    nextPageToken: nextContinuation || null
                };
            }

            const searchResults = await yt.search(query, { type: 'channel' });
            const results = (searchResults.results || []).filter(r => r.type === 'Channel').map(c => ({
                id: c.id,
                title: c.author?.name || '',
                snippet: c.description || '',
                thumbnail: c.thumbnail?.url || ''
            }));

            return {
                results,
                nextPageToken: searchResults.continuation || null
            };
        } catch (error) {
            console.error('[YouTubeI] searchChannels failed:', error);
            throw error;
        }
    }

    async searchPlaylists(query, continuationToken = null) {
        const yt = await this.ensureInitialized();
        try {
            if (continuationToken) {
                const response = await yt.actions.execute('/search', { continuation: continuationToken });
                const results = [];
                const contents = response.data?.continuationContents?.searchResultContinuation?.contents || [];
                for (const item of contents) {
                    const playlist = item.playlistRenderer;
                    if (playlist) {
                        results.push({
                            id: playlist.playlistId,
                            title: playlist.title?.simpleText || '',
                            videoCount: playlist.videoCount || '',
                            thumbnail: playlist.thumbnails?.[0]?.thumbnails?.[0]?.url || ''
                        });
                    }
                }
                const nextContinuation = response.data?.continuationContents?.searchResultContinuation?.continuations?.[0]?.nextContinuationData?.continuation;
                return {
                    results,
                    nextPageToken: nextContinuation || null
                };
            }

            const searchResults = await yt.search(query, { type: 'playlist' });
            const results = (searchResults.results || []).filter(r => r.type === 'Playlist').map(p => ({
                id: p.id,
                title: p.title?.text || '',
                videoCount: p.video_count || '',
                thumbnail: p.thumbnails?.[0]?.url || ''
            }));

            return {
                results,
                nextPageToken: searchResults.continuation || null
            };
        } catch (error) {
            console.error('[YouTubeI] searchPlaylists failed:', error);
            throw error;
        }
    }
}

const youtubeiClient = new YouTubeIClient();
module.exports = youtubeiClient;
