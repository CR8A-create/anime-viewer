const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.static('public')); // Serve static files from public folder

app.get('/', (req, res) => {
    res.send('¡El servidor API de Anime está funcionando! Abre index.html para ver la página.');
});

// Health Check Endpoint
app.get('/api/health', (req, res) => {
    res.sendStatus(200);
});

// Simple in-memory cache
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getCache(key) {
    const cached = cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        console.log(`✓ Cache HIT: ${key}`);
        return cached.data;
    }
    console.log(`✗ Cache MISS: ${key}`);
    return null;
}

function setCache(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
    console.log(`✓ Cache SET: ${key}`);
}

// Add timeout to axios requests
axios.defaults.timeout = 10000; // 10 seconds

// Helper function to create slug from title
function createSlug(title) {
    return title.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
        .replace(/\s+/g, '-')         // Replace spaces with hyphens
        .replace(/-+/g, '-');         // Remove duplicate hyphens
}

// Helper to search AnimeFLV if direct slug fails
async function searchAnimeFLV(query) {
    try {
        const searchUrl = `https://www3.animeflv.net/browse?q=${encodeURIComponent(query)}`;
        console.log(`Fallback: Buscando en AnimeFLV: ${searchUrl}`);
        const response = await axios.get(searchUrl);
        const $ = cheerio.load(response.data);

        // Select the first anime in the list
        const firstResult = $('.ListAnimes li article a').first();
        if (firstResult.length > 0) {
            const href = firstResult.attr('href'); // e.g., /anime/re-zero-kara-hajimeru-isekai-seikatsu-3rd-season
            return `https://www3.animeflv.net${href}`;
        }
        return null;
    } catch (error) {
        console.error('Error en búsqueda fallback:', error.message);
        return null;
    }
}

// -1. Get Airing Anime (Carousel)
app.get('/api/airing', async (req, res) => {
    const cacheKey = 'airing';
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get('https://www3.animeflv.net/browse?status=1&order=rating');
        const $ = cheerio.load(response.data);
        const airingAnime = [];

        $('.ListAnimes li article').slice(0, 24).each((i, el) => {
            const $el = $(el);
            const title = $el.find('.Title').text().trim();
            const image = $el.find('img').attr('src');
            const url = $el.find('a').attr('href'); // /anime/slug
            const slug = url.split('/').pop();
            // Try to find description if available in listing, strict search pages usually have .Description
            // If not, we might need a placeholder or fetch details (expensive).
            // AnimeFLV browse page usually has .Description p -- let's verify visual memory or generic selector
            let synopsis = $el.find('.Description p').text().trim();
            // Clean unwanted "Anime 4.5" prefix if present due to scraping structure
            synopsis = synopsis.replace(/^Anime\s+\d+(\.\d+)?\s*/i, '');
            if (!synopsis) synopsis = "Mira este anime en español en AniNova.";

            airingAnime.push({
                mal_id: slug, // Use slug for ID
                title: title,
                images: { jpg: { large_image_url: image, image_url: image } },
                synopsis: synopsis,
                score: $el.find('.Vts').text().trim() || 'N/A'
            });
        });

        const result = { success: true, data: airingAnime };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Error scraping airing:', error.message);
        res.status(500).json({ success: false, message: 'Error fetching airing anime' });
    }
});

// 0. Get Recent Episodes (Home Page)
app.get('/api/recent', async (req, res) => {
    const cacheKey = 'recent';
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get('https://www3.animeflv.net/');
        const $ = cheerio.load(response.data);
        const recentEpisodes = [];

        $('.ListEpisodios li').each((i, el) => {
            const $el = $(el);
            const title = $el.find('.Title').text().trim();
            const episodeStr = $el.find('.Capi').text().trim(); // "Episodio X"
            const episodeNum = episodeStr.replace(/Episodio\s*/i, '').trim();
            const image = $el.find('img').attr('src');
            const url = $el.find('a').attr('href'); // /ver/slug-episode
            const slug = url.split('/ver/')[1].split('-').slice(0, -1).join('-');

            // Construct Jikan-like structure for frontend compatibility
            recentEpisodes.push({
                entry: {
                    mal_id: slug, // Use slug as ID for local logic
                    title: title,
                    images: { jpg: { image_url: 'https://www3.animeflv.net' + image } }
                },
                episodes: [{ title: `Episodio ${episodeNum}` }] // Used for "type" badge
            });
        });

        const result = { success: true, data: recentEpisodes };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Error scraping recent:', error.message);
        res.status(500).json({ success: false, message: 'Error fetching recent episodes' });
    }
});

// 1. Get Anime Info and Episode List
app.get('/api/anime/:title', async (req, res) => {
    const { title } = req.params;
    const cacheKey = `anime:${title}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    let slug = createSlug(title);
    console.log(`Buscando información de: ${title} (Slug estimado: ${slug})`);

    try {
        let animeUrl = `https://www3.animeflv.net/anime/${slug}`;
        let animePage;

        try {
            animePage = await axios.get(animeUrl);
        } catch (err) {
            console.log('Slug directo falló, intentando búsqueda fallback...');
            const fallbackUrl = await searchAnimeFLV(title);
            if (fallbackUrl) {
                console.log(`Encontrado por búsqueda: ${fallbackUrl}`);
                animeUrl = fallbackUrl;
                // Update slug from found URL for cleaner future use if needed
                slug = fallbackUrl.split('/').pop();
                animePage = await axios.get(animeUrl);
            } else {
                console.log('No se encontró tampoco por búsqueda.');
                return res.json({ success: false, message: 'Anime no encontrado en AnimeFLV.' });
            }
        }

        const $ = cheerio.load(animePage.data);

        const scripts = $('script').map((i, el) => $(el).html()).get();
        const episodesScript = scripts.find(s => s.includes('var episodes ='));

        if (!episodesScript) {
            return res.json({ success: false, message: 'No se encontraron episodios.' });
        }

        const episodesMatch = episodesScript.match(/var episodes = (\[.*?\]);/);
        if (!episodesMatch) {
            return res.json({ success: false, message: 'Error al leer episodios.' });
        }

        // AnimeFLV episodes format: [episodeNum, episodeId]
        // We map it to a cleaner format
        const rawEpisodes = JSON.parse(episodesMatch[1]);
        const episodes = rawEpisodes.map(ep => ({
            number: ep[0],
            id: ep[1]
        }));

        // Scrape details (Spanish)
        // Fallback for description
        let description = $('.Description p').text().trim();
        if (!description) description = $('.Description').text().trim();
        if (!description) description = $('meta[property="og:description"]').attr('content');
        if (!description) description = $('meta[name="description"]').attr('content');

        // Fallback for genres
        let genres = $('.Genres a').map((i, el) => $(el).text()).get();
        if (genres.length === 0) genres = $('.Nvgnrs a').map((i, el) => $(el).text()).get();

        const status = $('.AnmStts').text().trim();
        const rate = $('.vtprmd').text().trim();

        // Sort by number descending (usually already sorted, but good to ensure)
        episodes.sort((a, b) => b.number - a.number);

        const result = {
            success: true,
            slug: slug, // Return the CORRECT slug
            description: description,
            genres: genres,
            status: status,
            rate: rate,
            episodes: episodes
        };

        setCache(cacheKey, result);
        res.json(result);

    } catch (error) {
        console.error('Error en scraping anime:', error.message);
        res.json({ success: false, message: 'Error interno del servidor.' });
    }
});

// 2. Get Video Servers for a Specific Episode
app.get('/api/videos/:slug/:episode', async (req, res) => {
    const { slug, episode } = req.params;
    console.log(`Buscando videos para: ${slug} Episodio ${episode}`);

    try {
        const episodeUrl = `https://www3.animeflv.net/ver/${slug}-${episode}`;

        const episodePage = await axios.get(episodeUrl);
        const $ = cheerio.load(episodePage.data);

        const scripts = $('script').map((i, el) => $(el).html()).get();
        const videosScript = scripts.find(s => s.includes('var videos ='));

        if (!videosScript) {
            return res.json({ success: false, message: 'No se encontraron videos.' });
        }

        const videosMatch = videosScript.match(/var videos = (\{.*?\});/);
        if (!videosMatch) {
            return res.json({ success: false, message: 'Error al leer videos.' });
        }

        const videosData = JSON.parse(videosMatch[1]);
        const servers = videosData.SUB; // We want subtitled

        const mappedServers = servers.map(s => ({
            name: s.server,
            url: s.code
        }));

        res.json({
            success: true,
            servers: mappedServers
        });

    } catch (error) {
        console.error('Error en scraping video:', error.message);
        res.json({ success: false, message: 'Error al obtener videos.' });
    }
});

// ===================================================================
// MOVIES & SERIES ENDPOINTS (TMDB + VidSrc/SuperEmbed)
// ===================================================================

const TMDB_API_KEY = process.env.TMDB_API_KEY || '38e61227f85671163c275f9bd95a8803';
const TMDB_BASE = 'https://api.themoviedb.org/3';

app.get('/api/movies/popular', async (req, res) => {
    const page = req.query.page || 1;
    const cacheKey = `movies:popular:${page}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE}/movie/popular`, {
            params: { api_key: TMDB_API_KEY, language: 'es-ES', page: page }
        });
        const result = { success: true, data: response.data };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/series/airing', async (req, res) => {
    const page = req.query.page || 1;
    const cacheKey = `series:airing:${page}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE}/tv/on_the_air`, {
            params: { api_key: TMDB_API_KEY, language: 'es-ES', page: page }
        });
        const result = { success: true, data: response.data };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/movies/search', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ success: false, message: 'Query required' });

    const cacheKey = `search:${query}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE}/search/multi`, {
            params: { api_key: TMDB_API_KEY, language: 'es-ES', query: query }
        });
        const result = { success: true, data: response.data.results };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/movies/servers/:tmdbId', async (req, res) => {
    const { tmdbId } = req.params;
    const cacheKey = `movie-servers:${tmdbId}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const servers = [
        { name: 'VidSrc', url: `https://vidsrc.xyz/embed/movie/${tmdbId}` },
        { name: 'SuperEmbed', url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1` },
        { name: 'Embed.su', url: `https://embed.su/embed/movie/${tmdbId}` },
        { name: 'VidSrc.me', url: `https://vidsrc.me/embed/movie?tmdb=${tmdbId}` }
    ];

    const result = { success: true, servers };
    setCache(cacheKey, result);
    res.json(result);
});

app.get('/api/series/servers/:tmdbId/:season/:episode', async (req, res) => {
    const { tmdbId, season, episode } = req.params;
    const cacheKey = `series-servers:${tmdbId}:${season}:${episode}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const servers = [
        { name: 'VidSrc', url: `https://vidsrc.xyz/embed/tv/${tmdbId}/${season}/${episode}` },
        { name: 'SuperEmbed', url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}` },
        { name: 'Embed.su', url: `https://embed.su/embed/tv/${tmdbId}/${season}/${episode}` },
        { name: 'VidSrc.me', url: `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}` }
    ];

    const result = { success: true, servers };
    setCache(cacheKey, result);
    res.json(result);
});

app.get('/api/series/details/:tmdbId', async (req, res) => {
    const { tmdbId } = req.params;
    const cacheKey = `series-details:${tmdbId}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE}/tv/${tmdbId}`, {
            params: { api_key: TMDB_API_KEY, language: 'es-ES' }
        });
        const result = { success: true, data: response.data };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n✓ Servidor API corriendo en http://localhost:${PORT}`);
    console.log(`📺 Anime: http://localhost:${PORT}/anime/index.html`);
    console.log(`🎬 Movies: http://localhost:${PORT}/movies/index.html\n`);
});
