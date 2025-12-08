const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 4000;

// CORS configuration
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Cache system
const cache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

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

// TMDB API Key - Obtener gratis en https://www.themoviedb.org/settings/api
// Esta es una key de ejemplo - el usuario debe obtener la suya
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'e9e9d8b6e3e9d8b6e3e9d8b6e3e9d8b6';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', server: 'Movies API - TMDB', timestamp: new Date().toISOString() });
});

// ====================================================================
// TMDB ENDPOINTS
// ====================================================================

// Popular Movies
app.get('/api/movies/popular', async (req, res) => {
    const page = req.query.page || 1;
    const cacheKey = `movies:popular:${page}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE_URL}/movie/popular`, {
            params: { api_key: TMDB_API_KEY, page, language: 'es-ES' }
        });

        const result = { success: true, data: response.data };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Error fetching popular movies:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Airing Series
app.get('/api/series/airing', async (req, res) => {
    const page = req.query.page || 1;
    const cacheKey = `series:airing:${page}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE_URL}/tv/on_the_air`, {
            params: { api_key: TMDB_API_KEY, page, language: 'es-ES' }
        });

        const result = { success: true, data: response.data };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Error fetching airing series:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Search Multi
app.get('/api/movies/search', async (req, res) => {
    const query = req.query.query;
    if (!query) return res.status(400).json({ success: false, message: 'Query required' });

    const cacheKey = `search:${query}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE_URL}/search/multi`, {
            params: { api_key: TMDB_API_KEY, query, language: 'es-ES' }
        });

        const result = { success: true, data: response.data.results };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Error searching:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Movie Servers (Streaming Links)
app.get('/api/movies/servers/:tmdbId', async (req, res) => {
    const { tmdbId } = req.params;
    const cacheKey = `movie-servers:${tmdbId}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const servers = [
        { name: 'VidSrc.to', url: `https://vidsrc.to/embed/movie/${tmdbId}` },
        { name: 'VidSrc PRO', url: `https://vidsrc.pro/embed/movie/${tmdbId}` },
        { name: 'VidSrc.in', url: `https://vidsrc.in/embed/movie?tmdb=${tmdbId}` },
        { name: 'SmashyStream', url: `https://player.smashy.stream/movie/${tmdbId}` }
    ];

    const result = { success: true, servers };
    setCache(cacheKey, result);
    res.json(result);
});

// Series Servers (Streaming Links)
app.get('/api/series/servers/:tmdbId/:season/:episode', async (req, res) => {
    const { tmdbId, season, episode } = req.params;
    const cacheKey = `series-servers:${tmdbId}:${season}:${episode}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const servers = [
        { name: 'VidSrc.to', url: `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}` },
        { name: 'VidSrc PRO', url: `https://vidsrc.pro/embed/tv/${tmdbId}/${season}/${episode}` },
        { name: 'VidSrc.in', url: `https://vidsrc.in/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}` },
        { name: 'SmashyStream', url: `https://player.smashy.stream/tv/${tmdbId}?s=${season}&e=${episode}` }
    ];

    const result = { success: true, servers };
    setCache(cacheKey, result);
    res.json(result);
});

// Series Details (for seasons/episodes)
app.get('/api/series/details/:tmdbId', async (req, res) => {
    const { tmdbId } = req.params;
    const cacheKey = `series-details:${tmdbId}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE_URL}/tv/${tmdbId}`, {
            params: { api_key: TMDB_API_KEY, language: 'es-ES' }
        });

        const result = { success: true, data: response.data };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Error fetching series details:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ====================================================================
// START SERVER
// ====================================================================
app.listen(PORT, () => {
    console.log(`\n✓ Servidor Movies API corriendo en http://localhost:${PORT}`);
    console.log(`🎬 Usando TMDB API`);
    console.log(`📝 Endpoints disponibles:`);
    console.log(`   GET /api/health`);
    console.log(`   GET /api/movies/popular?page=1`);
    console.log(`   GET /api/series/airing?page=1`);
    console.log(`   GET /api/movies/search?query=avatar`);
    console.log(`   GET /api/movies/servers/:tmdbId`);
    console.log(`   GET /api/series/servers/:tmdbId/:season/:episode`);
    console.log(`   GET /api/series/details/:tmdbId`);
    console.log(``);
});
