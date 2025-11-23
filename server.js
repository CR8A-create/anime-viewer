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

app.get('/api/episode/:title', async (req, res) => {
    const { title } = req.params;
    const slug = createSlug(title);
    console.log(`Buscando anime: ${title} (Slug: ${slug})`);

    try {
        // 1. Try to find the Anime Page
        // Note: This assumes the slug matches AnimeFLV's URL structure. 
        // Real-world scrapers often need a search step first.
        const animeUrl = `https://www3.animeflv.net/anime/${slug}`;

        let animePage;
        try {
            animePage = await axios.get(animeUrl);
        } catch (err) {
            // Fallback: Try adding "tv" or "2024" if simple slug fails, or just return error
            console.log('No se encontró con el slug directo, intentando búsqueda...');
            // For this demo, we will just fail gracefully if direct slug doesn't work
            // Implementing a full search is complex for a single file demo
            return res.json({ success: false, message: 'Anime no encontrado en AnimeFLV (Intenta con otro)' });
        }

        const $ = cheerio.load(animePage.data);

        // 2. Get the latest episode link
        // AnimeFLV lists episodes in a script variable usually, or in the DOM
        // Let's try to find the first episode in the list (which is usually the latest)
        // The episodes are often injected via JS, but sometimes present in a script tag: "var episodes = [...]"

        const scripts = $('script').map((i, el) => $(el).html()).get();
        const episodesScript = scripts.find(s => s.includes('var episodes ='));

        if (!episodesScript) {
            return res.json({ success: false, message: 'No se encontraron episodios.' });
        }

        // Extract episodes array
        const episodesMatch = episodesScript.match(/var episodes = (\[.*?\]);/);
        if (!episodesMatch) {
            return res.json({ success: false, message: 'Error al leer episodios.' });
        }

        const episodes = JSON.parse(episodesMatch[1]);
        if (episodes.length === 0) {
            return res.json({ success: false, message: 'Anime sin episodios.' });
        }

        // Get latest episode (first in the list usually)
        const latestEpisode = episodes[0]; // [episodeNum, episodeId]
        const episodeUrl = `https://www3.animeflv.net/ver/${slug}-${latestEpisode[0]}`;

        console.log(`Buscando video en: ${episodeUrl}`);

        // 3. Fetch Episode Page to get Videos
        const episodePage = await axios.get(episodeUrl);
        const $ep = cheerio.load(episodePage.data);

        const epScripts = $ep('script').map((i, el) => $ep(el).html()).get();
        const videosScript = epScripts.find(s => s.includes('var videos ='));

        if (!videosScript) {
            return res.json({ success: false, message: 'No se encontraron videos.' });
        }

        const videosMatch = videosScript.match(/var videos = (\{.*?\});/);
        if (!videosMatch) {
            return res.json({ success: false, message: 'Error al leer videos.' });
        }

        const videosData = JSON.parse(videosMatch[1]);
        const servers = videosData.SUB; // We want subtitled

        // Map to our format
        const mappedServers = servers.map(s => ({
            name: s.server,
            url: s.code
        }));

        res.json({
            success: true,
            servers: mappedServers
        });

    } catch (error) {
        console.error('Error en scraping:', error.message);
        res.json({ success: false, message: 'Error interno del servidor.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor API corriendo en http://localhost:${PORT}`);
});
