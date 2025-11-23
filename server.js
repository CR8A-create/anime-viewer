const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('¡El servidor API de Anime está funcionando! Abre index.html para ver la página.');
});

// Helper function to create slug from title
function createSlug(title) {
    return title.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
        .replace(/\s+/g, '-')         // Replace spaces with hyphens
        .replace(/-+/g, '-');         // Remove duplicate hyphens
}

// 1. Get Anime Info and Episode List
app.get('/api/anime/:title', async (req, res) => {
    const { title } = req.params;
    const slug = createSlug(title);
    console.log(`Buscando información de: ${title} (Slug: ${slug})`);

    try {
        const animeUrl = `https://www3.animeflv.net/anime/${slug}`;
        let animePage;
        try {
            animePage = await axios.get(animeUrl);
        } catch (err) {
            console.log('No se encontró con el slug directo.');
            return res.json({ success: false, message: 'Anime no encontrado en AnimeFLV.' });
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

        // Sort by number descending (usually already sorted, but good to ensure)
        episodes.sort((a, b) => b.number - a.number);

        res.json({
            success: true,
            slug: slug, // Return the slug so the frontend sends it back for videos
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
