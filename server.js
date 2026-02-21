const express = require('express');
const cors = require('cors');
const compression = require('compression');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Gzip compression — reduce payload ~70%
app.use(compression());
app.use(express.json());

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Static files con cache de 1 hora en el navegador
app.use(express.static('public', {
    maxAge: '1h',
    etag: true
}));

app.get('/', (req, res) => {
    res.send('¡El servidor API de Anime está funcionando! Abre index.html para ver la página.');
});

// Health Check Endpoint
app.get('/api/health', (req, res) => {
    res.sendStatus(200);
});

// Simple in-memory cache
const cache = new Map();
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes (anime data barely changes)

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

// Helper: get IMDB ID from TMDB (needed for some embed providers)
async function getImdbId(tmdbId, type = 'movie') {
    const cacheKey = `imdb:${type}:${tmdbId}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    try {
        const endpoint = type === 'tv' ? 'tv' : 'movie';
        const response = await axios.get(`${TMDB_BASE}/${endpoint}/${tmdbId}/external_ids`, {
            params: { api_key: TMDB_API_KEY }
        });
        const imdbId = response.data.imdb_id || null;
        if (imdbId) setCache(cacheKey, imdbId);
        return imdbId;
    } catch (error) {
        console.error('Error fetching IMDB ID:', error.message);
        return null;
    }
}

// Movie servers — supports lang param: 'en' (default) or 'es' (dubbed)
app.get('/api/movies/servers/:tmdbId/:lang?', async (req, res) => {
    const { tmdbId } = req.params;
    const lang = req.params.lang || 'en';
    const cacheKey = `movie-servers:${tmdbId}:${lang}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    let servers;

    if (lang === 'es') {
        // Servidores con audio en español — proveedores con mejor soporte multi-idioma
        const imdbId = await getImdbId(tmdbId, 'movie');
        servers = [
            { name: 'Embed.su ES', url: `https://embed.su/embed/movie/${tmdbId}?lang=Spanish` },
            { name: 'MultiEmbed ES', url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&lang=es` },
            { name: 'AutoEmbed ES', url: `https://player.autoembed.cc/embed/movie/${tmdbId}?lang=spa` },
            { name: 'MoviesAPI ES', url: `https://moviesapi.club/movie/${tmdbId}?lang=es` },
        ];
        if (imdbId) {
            servers.push({ name: 'WarezCDN ES', url: `https://embed.warezcdn.com/filme/${imdbId}` });
        }
    } else {
        // Servidores originales (inglés + sub español)
        servers = [
            { name: 'VidSrc.to', url: `https://vidsrc.to/embed/movie/${tmdbId}` },
            { name: 'Embed.su', url: `https://embed.su/embed/movie/${tmdbId}` },
            { name: 'VidSrc PRO', url: `https://vidsrc.pro/embed/movie/${tmdbId}` },
            { name: 'VidSrc.in', url: `https://vidsrc.in/embed/movie?tmdb=${tmdbId}` },
            { name: 'SmashyStream', url: `https://player.smashy.stream/movie/${tmdbId}` },
            { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/movie/${tmdbId}` }
        ];
    }

    const result = { success: true, servers, lang };
    setCache(cacheKey, result);
    res.json(result);
});

// Series servers — supports lang param
app.get('/api/series/servers/:tmdbId/:season/:episode/:lang?', async (req, res) => {
    const { tmdbId, season, episode } = req.params;
    const lang = req.params.lang || 'en';
    const cacheKey = `series-servers:${tmdbId}:${season}:${episode}:${lang}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    let servers;

    if (lang === 'es') {
        const imdbId = await getImdbId(tmdbId, 'tv');
        servers = [
            { name: 'Embed.su ES', url: `https://embed.su/embed/tv/${tmdbId}/${season}/${episode}?lang=Spanish` },
            { name: 'MultiEmbed ES', url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}&lang=es` },
            { name: 'AutoEmbed ES', url: `https://player.autoembed.cc/embed/tv/${tmdbId}/${season}/${episode}?lang=spa` },
            { name: 'MoviesAPI ES', url: `https://moviesapi.club/tv/${tmdbId}/${season}/${episode}?lang=es` },
        ];
        if (imdbId) {
            servers.push({ name: 'WarezCDN ES', url: `https://embed.warezcdn.com/serie/${imdbId}/${season}/${episode}` });
        }
    } else {
        servers = [
            { name: 'VidSrc.to', url: `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}` },
            { name: 'Embed.su', url: `https://embed.su/embed/tv/${tmdbId}/${season}/${episode}` },
            { name: 'VidSrc PRO', url: `https://vidsrc.pro/embed/tv/${tmdbId}/${season}/${episode}` },
            { name: 'VidSrc.in', url: `https://vidsrc.in/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}` },
            { name: 'SmashyStream', url: `https://player.smashy.stream/tv/${tmdbId}?s=${season}&e=${episode}` },
            { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/tv/${tmdbId}/${season}/${episode}` }
        ];
    }

    const result = { success: true, servers, lang };
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

// Movie details (for player info panel)
app.get('/api/movies/details/:tmdbId', async (req, res) => {
    const { tmdbId } = req.params;
    const cacheKey = `movie-details:${tmdbId}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE}/movie/${tmdbId}`, {
            params: { api_key: TMDB_API_KEY, language: 'es-ES' }
        });
        const result = { success: true, data: response.data };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Episode details (for Netflix-style overlay)
app.get('/api/series/episode/:tmdbId/:season/:episode', async (req, res) => {
    const { tmdbId, season, episode } = req.params;
    const cacheKey = `episode-detail:${tmdbId}:${season}:${episode}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/season/${season}/episode/${episode}`, {
            params: { api_key: TMDB_API_KEY, language: 'es-ES' }
        });
        const result = { success: true, data: response.data };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ===================================================================
// ANONYMOUS COMMENTS SYSTEM
// ===================================================================

const COMMENTS_DIR = path.join(__dirname, 'data');
const COMMENTS_FILE = path.join(COMMENTS_DIR, 'comments.json');
const commentRateLimit = new Map(); // IP -> timestamp

// Ensure data directory exists
if (!fs.existsSync(COMMENTS_DIR)) {
    fs.mkdirSync(COMMENTS_DIR, { recursive: true });
}
if (!fs.existsSync(COMMENTS_FILE)) {
    fs.writeFileSync(COMMENTS_FILE, '{}');
}

function loadComments() {
    try {
        return JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf8'));
    } catch { return {}; }
}

function saveComments(data) {
    fs.writeFileSync(COMMENTS_FILE, JSON.stringify(data, null, 2));
}

// Random anonymous names
const ANON_NAMES = [
    'Naruto Fan', 'Otaku Oscuro', 'Senpai Anónimo', 'Weeb Silencioso',
    'Ninja del Sofá', 'Samurai sin Nombre', 'Pirata del Streaming',
    'Cazador de Series', 'Shinigami Anónimo', 'Héroe Random',
    'Dragón Nocturno', 'Fantasma del Chat', 'Leyenda Oculta',
    'Titán Anónimo', 'Espíritu Libre', 'Lobo Solitario',
    'Viajero del Tiempo', 'Caballero Oscuro', 'Phoenix Anónimo'
];

function getAnonName() {
    return ANON_NAMES[Math.floor(Math.random() * ANON_NAMES.length)];
}

// GET comments for a content
app.get('/api/comments/:contentId', (req, res) => {
    const { contentId } = req.params;
    const allComments = loadComments();
    const comments = allComments[contentId] || [];
    res.json({ success: true, comments });
});

// POST a new comment
app.post('/api/comments/:contentId', (req, res) => {
    const { contentId } = req.params;
    const { text } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Validations
    if (!text || text.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Comentario vacío' });
    }
    if (text.length > 500) {
        return res.status(400).json({ success: false, message: 'Máximo 500 caracteres' });
    }

    // Rate limit: 1 comment per 30 seconds per IP
    const lastComment = commentRateLimit.get(ip);
    if (lastComment && Date.now() - lastComment < 30000) {
        const wait = Math.ceil((30000 - (Date.now() - lastComment)) / 1000);
        return res.status(429).json({ success: false, message: `Espera ${wait}s para comentar de nuevo` });
    }

    const allComments = loadComments();
    if (!allComments[contentId]) allComments[contentId] = [];

    const comment = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        name: getAnonName(),
        text: text.trim().substring(0, 500),
        timestamp: new Date().toISOString()
    };

    allComments[contentId].push(comment);

    // Keep only last 100 comments per content
    if (allComments[contentId].length > 100) {
        allComments[contentId] = allComments[contentId].slice(-100);
    }

    saveComments(allComments);
    commentRateLimit.set(ip, Date.now());

    res.json({ success: true, comment });
});

// ===================================================================
// SERVER START + KEEP-ALIVE + PRE-FETCH
// ===================================================================

app.listen(PORT, () => {
    console.log(`\n✓ Servidor API corriendo en http://localhost:${PORT}`);
    console.log(`📺 Anime: http://localhost:${PORT}/anime/index.html`);
    console.log(`🎬 Movies: http://localhost:${PORT}/movies/index.html\n`);

    // Pre-fetch: llenar caché al arrancar para que el primer usuario tenga datos
    console.log('🔄 Pre-cargando datos en caché...');
    Promise.allSettled([
        axios.get(`http://localhost:${PORT}/api/airing`),
        axios.get(`http://localhost:${PORT}/api/recent`),
        axios.get(`http://localhost:${PORT}/api/movies/popular?page=1`),
        axios.get(`http://localhost:${PORT}/api/series/airing?page=1`)
    ]).then(results => {
        const ok = results.filter(r => r.status === 'fulfilled').length;
        console.log(`✓ Pre-fetch completado: ${ok}/4 endpoints cargados en caché`);
    });

    // Self-ping keep-alive: evita que Render.com apague el servidor
    if (process.env.RENDER) {
        const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `https://mi-anime-api.onrender.com`;
        setInterval(() => {
            axios.get(`${RENDER_URL}/api/health`)
                .then(() => console.log('♻ Keep-alive ping OK'))
                .catch(() => console.log('♻ Keep-alive ping sent'));
        }, 14 * 60 * 1000); // Cada 14 minutos
        console.log('♻ Keep-alive activado (ping cada 14 min)');
    }
});
