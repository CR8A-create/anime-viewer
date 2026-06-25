const { cors, getCache, setCache, tmdbGet, getImdbId } = require('../_lib/shared');

module.exports = async (req, res) => {
    if (cors(req, res)) return;

    const path = req.query.path || [];
    const action = path[0] || req.url.split('?')[0].split('/').filter(Boolean).pop();

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
            const tmdbId = req.query.id || path[1];
            const cacheKey = `series:details:${tmdbId}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            const { data } = await tmdbGet(`/tv/${tmdbId}`);
            setCache(cacheKey, { success: true, data });
            return res.json({ success: true, data });
        }

        if (action === 'servers') {
            const tmdbId = req.query.id || path[1];
            const season = req.query.season || path[2];
            const episode = req.query.episode || path[3];
            const lang = req.query.lang || path[4] || 'en';
            if (!tmdbId || !season || !episode) return res.status(400).json({ success: false, message: 'tmdbId, season, and episode required' });

            const cacheKey = `series:servers:${tmdbId}:${season}:${episode}:${lang}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            let servers = [];
            if (lang === 'es') {
                servers = [
                    { name: 'MultiEmbed ES', url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}&lang=es` },
                    { name: 'VidSrc ES', url: `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}?sub_lang=es` },
                    { name: '2Embed ES', url: `https://www.2embed.stream/embed/tv?id=${tmdbId}&s=${season}&e=${episode}` },
                    { name: 'Embed.su ES', url: `https://embed.su/embed/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'Smashy ES', url: `https://player.smashy.stream/tv/${tmdbId}?s=${season}&e=${episode}&lang=es` },
                ];
            } else {
                servers = [
                    { name: 'VidSrc.to', url: `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'Embed.su', url: `https://embed.su/embed/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'VidSrc PRO', url: `https://vidsrc.pro/embed/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'VidSrc.in', url: `https://vidsrc.in/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}` },
                    { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'VidSrc.xyz', url: `https://vidsrc.xyz/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}` },
                    { name: 'MultiEmbed', url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}` },
                ];
            }
            setCache(cacheKey, { success: true, servers, lang });
            return res.json({ success: true, servers, lang });
        }

        if (action === 'episode') {
            const tmdbId = req.query.id || path[1];
            const season = req.query.season || path[2];
            const episode = req.query.episode || path[3];
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
