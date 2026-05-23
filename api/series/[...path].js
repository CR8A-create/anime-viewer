const { cors, getCache, setCache, tmdbGet, getImdbId } = require('../_lib/shared');

module.exports = async (req, res) => {
    if (cors(req, res)) return;

    const { path } = req.query;
    const action = path[0];

    try {
        if (action === 'airing') {
            const page = req.query.page || 1;
            const cacheKey = `series:airing:${page}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            const { data } = await tmdbGet('/tv/on_the_air', { page });
            setCache(cacheKey, { success: true, data });
            return res.json({ success: true, data });
        }

        if (action === 'details') {
            const tmdbId = path[1];
            const cacheKey = `series:details:${tmdbId}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            const { data } = await tmdbGet(`/tv/${tmdbId}`);
            setCache(cacheKey, { success: true, data });
            return res.json({ success: true, data });
        }

        if (action === 'servers') {
            const tmdbId = path[1];
            const season = path[2];
            const episode = path[3];
            const lang = path[4] || 'en';
            if (!tmdbId || !season || !episode) return res.status(400).json({ success: false, message: 'tmdbId, season, and episode required' });
            
            const cacheKey = `series:servers:${tmdbId}:${season}:${episode}:${lang}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            let servers = [];
            if (lang === 'es') {
                const imdbId = await getImdbId(tmdbId, 'tv');
                servers = [
                    { name: 'Embed.su ES', url: `https://embed.su/embed/tv/${tmdbId}/${season}/${episode}?lang=Spanish` },
                    { name: 'MultiEmbed ES', url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}&lang=es` },
                    { name: 'AutoEmbed ES', url: `https://player.autoembed.cc/embed/tv/${tmdbId}/${season}/${episode}?lang=spa` },
                    { name: 'MoviesAPI ES', url: `https://moviesapi.club/tv/${tmdbId}/${season}/${episode}?lang=es` }
                ];
                if (imdbId) servers.push({ name: 'WarezCDN ES', url: `https://embed.warezcdn.com/serie/${imdbId}/${season}/${episode}` });
            } else {
                servers = [
                    { name: 'VidSrc.to', url: `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'Embed.su', url: `https://embed.su/embed/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'VidSrc PRO', url: `https://vidsrc.pro/embed/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'VidSrc.in', url: `https://vidsrc.in/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}` },
                    { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/tv/${tmdbId}/${season}/${episode}` }
                ];
            }
            setCache(cacheKey, { success: true, servers, lang });
            return res.json({ success: true, servers, lang });
        }

        if (action === 'episode') {
            const tmdbId = path[1];
            const season = path[2];
            const episode = path[3];
            if (!tmdbId || !season || !episode) return res.status(400).json({ success: false, message: 'tmdbId, season, and episode required' });
            
            const cacheKey = `series:episode:${tmdbId}:${season}:${episode}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            
            const { data } = await tmdbGet(`/tv/${tmdbId}/season/${season}/episode/${episode}`);
            setCache(cacheKey, { success: true, data });
            return res.json({ success: true, data });
        }

        return res.status(404).json({ success: false, message: 'Not found' });
    } catch (e) {
        console.error('Series API Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
};
