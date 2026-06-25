class YouTubeIClient {
    constructor() {
        this.youtube = null;
        this.initPromise = null;
    }

    async init() {
        try {
            const { Innertube, UniversalCache } = await import('youtubei.js');

            const options = {
                // ANDROID_MUSIC avoids 403s on all yt.music.* browse endpoints.
                // Falls back gracefully if getRelated() needs the WEB client later.
                client_type: 'ANDROID_MUSIC',
                cache: new UniversalCache(false), // in-memory only, no disk I/O
                generate_session_locally: true,   // avoids extra network round-trip for session
            };

            // Optional: cookie-based auth (most reliable, rotate every few weeks)
            // Set YT_COOKIE env var to the full cookie string from a logged-in browser session.
            if (process.env.YT_COOKIE) {
                options.cookie = process.env.YT_COOKIE;
            }

            // Optional: PoToken auth (needed if you switch back to the WEB client)
            // Generate via: https://github.com/iv-org/youtube-po-token-generator
            if (process.env.YT_PO_TOKEN && process.env.YT_VISITOR_DATA) {
                options.po_token = process.env.YT_PO_TOKEN;
                options.visitor_data = process.env.YT_VISITOR_DATA;
            }

            this.youtube = await Innertube.create(options);
            console.log('[YouTubeI] Client initialized successfully');
            return this.youtube;
        } catch (error) {
            console.error('[YouTubeI] Initialization failed:', error);
            this.initPromise = null; // Reset so next attempt can retry
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

    // Reset client and force re-init (used on 403 recovery)
    _resetClient() {
        this.youtube = null;
        this.initPromise = null;
    }

    _is403(error) {
        return (
            error?.status === 403 ||
            error?.message?.includes('403') ||
            error?.message?.includes('status code 403')
        );
    }

    async getAlbum(albumId) {
        const yt = await this.ensureInitialized();
        try {
            const album = await yt.music.getAlbum(albumId);
            return this._normalizeAlbum(album, albumId);
        } catch (error) {
            // On 403, reset and retry once with a fresh session
            if (this._is403(error)) {
                console.warn(`[YouTubeI] 403 on getAlbum(${albumId}), resetting client and retrying...`);
                this._resetClient();
                const freshYt = await this.ensureInitialized();
                try {
                    const album = await freshYt.music.getAlbum(albumId);
                    return this._normalizeAlbum(album, albumId);
                } catch (retryError) {
                    console.error(`[YouTubeI] Retry failed for getAlbum(${albumId}):`, retryError);
                    throw retryError;
                }
            }
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
            // On 403, reset and retry once with a fresh session
            if (this._is403(error)) {
                console.warn(`[YouTubeI] 403 on getPlaylist(${playlistId}), resetting client and retrying...`);
                this._resetClient();
                const freshYt = await this.ensureInitialized();
                try {
                    const playlist = await freshYt.music.getPlaylist(playlistId);
                    return this._normalizePlaylist(playlist, playlistId);
                } catch (retryError) {
                    console.error(`[YouTubeI] Retry failed for getPlaylist(${playlistId}):`, retryError);
                    throw retryError;
                }
            }
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

                    const videoSection = explore.sections.find(s =>
                        (s.title?.text || s.header?.title?.text) === 'New music videos'
                    );
                    if (videoSection) {
                        const videos = (videoSection.contents || [])
                            .map(item => this._normalizeResponsiveListItem(item))
                            .filter(item => item.id);
                        allVideos.push(...videos);
                    }

                    const trendingSection = explore.sections.find(s =>
                        (s.title?.text || s.header?.title?.text) === 'Trending'
                    );
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
            console.log(`[YouTubeI] Found ${items.length} LockupView items in watch_next_feed`);

            const normalized = items
                .map(item => {
                    const result = this._normalizeRelatedItem(item);
                    if (!result.videoId || !result.title) {
                        console.log('[YouTubeI] Filtered out item - missing videoId or title:', { videoId: result.videoId, title: result.title });
                    }
                    return result;
                })
                .filter(item => {
                    if (!item.videoId || !item.title) return false;
                    if (item.duration_seconds && item.duration_seconds <= 60) return false;
                    if (item.isShort) return false;
                    return true;
                });

            console.log(`[YouTubeI] Returning ${normalized.length} related videos after filtering`);
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
            videoId = item.content_position.on_tap.payload?.videoId ||
                item.content_position.on_tap.payload?.watchEndpoint?.videoId || '';
        }

        const title = item.metadata?.title?.text ||
            item.metadata?.title?.runs?.map(r => r.text).join('') || '';

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

        const author = item.metadata?.subtitle?.text ||
            item.metadata?.subtitle?.runs?.map(r => r.text).join(' ') || '';

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
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 1) return parts[0];
        return 0;
    }

    _normalizeResponsiveListItem(item) {
        if (!item) return {};

        let id = item.id || item.videoId ||
            item.endpoint?.payload?.videoId ||
            item.endpoint?.payload?.browseId || '';
        let title = item.title?.text ||
            item.title?.runs?.map(r => r.text).join('') ||
            item.title || '';
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
                            // Year — skip
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
        } else if (item.type === 'MusicTwoRowItem') {
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

        return { id, title, artist, album, duration, thumbnail, views, type: item.type };
    }
}

// Singleton instance
const youtubeiClient = new YouTubeIClient();
module.exports = youtubeiClient;
