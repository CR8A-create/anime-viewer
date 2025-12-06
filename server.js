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

// 1. Get Anime Info and Episode List
app.get('/api/anime/:title', async (req, res) => {
    const { title } = req.params;
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

        res.json({
            success: true,
            slug: slug, // Return the CORRECT slug
            description: description,
            genres: genres,
            status: status,
            rate: rate,
            episodes: episodes
        });

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

app.listen(PORT, () => {
    console.log(`Servidor API corriendo en http://localhost:${PORT}`);
});
