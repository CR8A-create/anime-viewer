const { cors, getCache, setCache, scraperGet, createSlug } = require('../_lib/shared');
const cheerio = require('cheerio');

async function searchAnimeFLV(query) {
    try {
        const { data } = await scraperGet(`https://www3.animeflv.net/browse?q=${encodeURIComponent(query)}`);
        const $ = cheerio.load(data);
        const href = $('.ListAnimes li article a').first().attr('href');
        return href ? `https://www3.animeflv.net${href}` : null;
    } catch { return null; }
}

module.exports = async (req, res) => {
    if (cors(req, res)) return;

    const path = req.query.path || [];
    const action = path[0] || req.url.split('?')[0].split('/').filter(Boolean).pop();

    try {
        // --- AIRING ---
        if (action === 'airing') {
            const cacheKey = 'anime:airing';
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            const { data } = await scraperGet('https://www3.animeflv.net/browse?status=1&order=rating');
            const $ = cheerio.load(data);
            const items = [];
            $('.ListAnimes li article').slice(0, 24).each((_, el) => {
                const title = $(el).find('.Title').text().trim();
                const image = $(el).find('img').attr('src');
                const slug = $(el).find('a').attr('href').split('/').pop();
                const synopsis = $(el).find('.Description p').text().trim().replace(/^Anime\s+\d+(\.\d+)?\s*/i, '') || 'Mira este anime en español.';
                items.push({ mal_id: slug, title, images: { jpg: { large_image_url: image, image_url: image } }, synopsis, score: $(el).find('.Vts').text().trim() || 'N/A' });
            });
            const result = { success: true, data: items };
            setCache(cacheKey, result);
            return res.json(result);
        }

        // --- RECENT ---
        if (action === 'recent') {
            const cacheKey = 'anime:recent';
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            const { data } = await scraperGet('https://www3.animeflv.net/');
            const $ = cheerio.load(data);
            const items = [];
            $('.ListEpisodios li').each((_, el) => {
                const title = $(el).find('.Title').text().trim();
                const epNum = $(el).find('.Capi').text().trim().replace(/Episodio\s*/i, '').trim();
                const image = 'https://www3.animeflv.net' + $(el).find('img').attr('src');
                const slug = $(el).find('a').attr('href').split('/ver/')[1].split('-').slice(0, -1).join('-');
                items.push({ entry: { mal_id: slug, title, images: { jpg: { image_url: image } } }, episodes: [{ title: `Episodio ${epNum}` }] });
            });
            const result = { success: true, data: items };
            setCache(cacheKey, result);
            return res.json(result);
        }

        // --- INFO ---
        if (action === 'info') {
            const title = req.query.title || path[1] || '';
            if (!title) return res.status(400).json({ success: false, message: 'Title required' });
            const cacheKey = `anime:info:${title}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            let slug = createSlug(title);
            let url = `https://www3.animeflv.net/anime/${slug}`;
            let html;
            try {
                const { data } = await scraperGet(url);
                html = data;
            } catch {
                const fallbackUrl = await searchAnimeFLV(title);
                if (!fallbackUrl) return res.json({ success: false, message: 'Anime no encontrado' });
                url = fallbackUrl;
                slug = fallbackUrl.split('/').pop();
                const { data } = await scraperGet(url);
                html = data;
            }

            const $ = cheerio.load(html);
            const scripts = $('script').map((i, el) => $(el).html()).get();
            const episodesScript = scripts.find(s => s && s.includes('var episodes ='));
            if (!episodesScript) return res.json({ success: false, message: 'Sin episodios' });
            
            const rawEps = JSON.parse(episodesScript.match(/var episodes = (\[.*?\]);/)[1]);
            const episodes = rawEps.map(ep => ({ number: ep[0], id: ep[1] })).sort((a, b) => b.number - a.number);
            
            let description = $('.Description p').text().trim() || $('.Description').text().trim() || '';
            let genres = $('.Genres a, .Nvgnrs a').map((i, el) => $(el).text()).get();

            const result = { success: true, slug, description, genres, status: $('.AnmStts').text().trim(), rate: $('.vtprmd').text().trim(), episodes };
            setCache(cacheKey, result);
            return res.json(result);
        }

        // --- VIDEOS (TioAnime primary + JKAnime fallback) ---
        if (action === 'videos') {
            const slug = req.query.slug || path[1];
            const episode = req.query.episode || path[2];
            if (!slug || !episode) return res.status(400).json({ success: false, message: 'Slug and episode required' });

            const cacheKey = `anime:videos:${slug}:${episode}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            let servers = [];

            // --- PRIMARY: TioAnime (same slug format as AnimeFLV, var videos in HTML) ---
            try {
                const { data } = await scraperGet(`https://tioanime.com/ver/${slug}-${episode}`);
                const $ = cheerio.load(data);
                const scripts = $('script').map((_, el) => $(el).html()).get();
                const videoScript = scripts.find(s => s && s.includes('var videos ='));
                if (videoScript) {
                    const match = videoScript.match(/var videos = (\[[\s\S]*?\]);/);
                    if (match) {
                        const videoData = JSON.parse(match[1]);
                        // format: [name, url, flag1, flag2] — TioAnime is sub-only
                        servers = videoData
                            .filter(([, url]) => url && !url.includes('mega.nz') && !url.includes('mail.ru'))
                            .map(([name, url]) => ({ name, url, lang: 'sub' }));
                    }
                }
            } catch { /* ignore */ }

            // --- FALLBACK: JKAnime (has Latino dubs) ---
            if (servers.length === 0) {
                const EMBED_OK = ['Streamtape','VOE','Vidhide','Streamwish','Doodstream','Mp4upload','Mixdrop','YourUpload','Uqload'];
                const slugCandidates = [
                    slug,
                    slug.replace(/-tv$/, ''),
                    slug.replace(/-ova$/, ''),
                    slug.replace(/-movie$/, ''),
                    slug.replace(/-(tv|ova|movie|specials?)$/, ''),
                ].filter((v, i, a) => a.indexOf(v) === i);

                for (const jkSlug of slugCandidates) {
                    try {
                        const { data } = await scraperGet(`https://jkanime.net/${jkSlug}/${episode}/`);
                        const $ = cheerio.load(data);
                        const scripts = $('script').map((_, el) => $(el).html()).get();
                        const srvScript = scripts.find(s => s && s.includes('var servers ='));
                        if (!srvScript) continue;
                        const srvMatch = srvScript.match(/var servers = (\[[\s\S]*?\]);/);
                        if (!srvMatch) continue;
                        const srvData = JSON.parse(srvMatch[1]);
                        const jkServers = srvData
                            .filter(s => EMBED_OK.includes(s.server))
                            .map(s => ({
                                name: s.server,
                                url: Buffer.from(s.remote, 'base64').toString('utf8'),
                                lang: s.lang === 2 ? 'lat' : 'sub',
                            }));
                        if (jkServers.length > 0) { servers = jkServers; break; }
                    } catch { continue; }
                }
            }

            if (servers.length === 0) {
                return res.json({ success: false, message: 'No se encontraron servidores para este episodio' });
            }

            // Latino first
            servers.sort((a, b) => (a.lang === 'lat' ? -1 : 1) - (b.lang === 'lat' ? -1 : 1));

            const result = { success: true, servers };
            setCache(cacheKey, result);
            return res.json(result);
        }

        return res.status(404).json({ success: false, message: 'Endpoint not found' });
    } catch (e) {
        console.error('Anime API Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
};
