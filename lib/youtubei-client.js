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
            this.initPromise = null;
            throw error;
        }
    }

    async ensureInitialized() {
        if (this.youtube) return this.youtube;
        if (!this.initPromise) {
            this.initPromise = this.init();
        }
        return this.initPromise;
    }

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

    async getTrending() {
        const yt = await this.ensureInitialized();
        try {
            const home = await yt.music.getHomeFeed();
            const allSongs = [], allVideos = [], allPlaylists = [];

            if (home.sections) {
                for (const section of home.sections) {
                    const sectionTitle = section.title?.text || section.header?.title?.text || '';
                    const normalizedItems = (section.contents || []).map(item => this._normalizeResponsiveListItem(item)).filter(item => item.id);
                    const lowerTitle = sectionTitle.toLowerCase();
                    if (lowerTitle.includes('album') || lowerTitle.includes('playlist') || lowerTitle.includes('mix')) allPlaylists.push(...normalizedItems);
                    else if (lowerTitle.includes('video')) allVideos.push(...normalizedItems);
                    else allSongs.push(...normalizedItems);
                }
            }

            return {
                songs: this._removeDuplicates(allSongs).slice(0, 20),
                videos: this._removeDuplicates(allVideos).slice(0, 20),
                playlists: this._removeDuplicates(allPlaylists).slice(0, 10)
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
            return items.map(item => this._normalizeRelatedItem(item)).filter(item => item.videoId && item.title && (!item.duration_seconds || item.duration_seconds > 60) && !item.isShort);
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
                        if (actions && actions.length > 0) videoId = actions[0].video_id;
                        if (!videoId) videoId = button.default_button?.on_tap?.command?.video_id || '';
                        if (videoId) break;
                    }
                }
                if (videoId) break;
            }
        }
        if (!videoId && item.content_position?.on_tap) videoId = item.content_position.on_tap.payload?.videoId || item.content_position.on_tap.payload?.watchEndpoint?.videoId || '';

        const title = item.metadata?.title?.text || item.metadata?.title?.runs?.map(r => r.text).join('') || '';
        const thumbnail = item.content_image?.image?.[0]?.url || '';
        let duration = '', duration_seconds = 0;
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
        return { videoId, title, artist: author, thumbnail, duration, duration_seconds, isShort: (duration_seconds > 0 && duration_seconds <= 60) };
    }

    _parseDuration(durationStr) {
        if (!durationStr || typeof durationStr !== 'string') return 0;
        const parts = durationStr.split(':').map(p => parseInt(p) || 0);
        return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts.length === 2 ? parts[0] * 60 + parts[1] : parts.length === 1 ? parts[0] : 0;
    }

    _normalizeResponsiveListItem(item) {
        if (!item) return {};
        let id = item.id || item.videoId || item.endpoint?.payload?.videoId || item.endpoint?.payload?.browseId || '';
        let title = item.title?.text || item.title?.runs?.map(r => r.text).join('') || item.title || '';
        let artist = '', album = '', duration = '', thumbnail = '', views = '';

        if (item.type === 'MusicResponsiveListItem') {
            if (item.flex_columns && item.flex_columns.length > 0) {
                title = item.flex_columns[0].title?.text || item.flex_columns[0].title?.runs?.map(r => r.text).join('') || title;
                if (item.flex_columns.length > 1) {
                    const textParts = (item.flex_columns[1].title?.runs || []).map(r => r.text).filter(t => t !== ' • ');
                    textParts.forEach(part => {
                        if (/^\d+:\d+$/.test(part) || /^\d+:\d+:\d+$/.test(part)) duration = part;
                        else if (part.includes('view')) views = part;
                        else if (!artist) artist = part;
                        else album = part;
                    });
                }
            }
            thumbnail = item.thumbnails?.[0]?.url || item.thumbnail?.contents?.[0]?.url || '';
        } else if (item.type === 'MusicTwoRowItem') {
            artist = (item.artists || []).map(a => a.name).join(', ');
            views = item.views || (item.subtitle?.runs || []).find(r => r.text.includes('view'))?.text || '';
            if (!artist) artist = (item.subtitle?.runs || []).filter(r => r.text !== ' • ' && !r.text.includes('view'))[0]?.text || '';
            thumbnail = Array.isArray(item.thumbnail) ? item.thumbnail[0].url : item.thumbnails ? item.thumbnails[0].url : item.thumbnail?.contents?.[0]?.url || '';
        }
        return { id, title, artist, album, duration, thumbnail, views, type: item.type };
    }
}

export default new YouTubeIClient();
