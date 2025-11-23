const API_URL = 'https://api.jikan.moe/v4';

// CAMBIA ESTA URL CUANDO SUBAS TU SERVIDOR A RENDER
// Si estás en tu PC, usa localhost. Si ya lo subiste, pon la URL de Render aquí.
// Ejemplo: 'https://mi-anime-server.onrender.com/api'
const BACKEND_URL = 'http://localhost:3000/api';

// DOM Elements
const mainContent = document.getElementById('mainContent');
const playerView = document.getElementById('playerView');
const recentGrid = document.getElementById('recentGrid');
const popularGrid = document.getElementById('popularGrid');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const videoPlayer = document.getElementById('videoPlayer');
const placeholderMessage = document.getElementById('placeholderMessage');

// State
let currentAnime = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    fetchSeasonNow();
    fetchTopAnime();

    // Event Listeners
    searchBtn.addEventListener('click', handleSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });
});

// Fetch Data
async function fetchSeasonNow() {
    try {
        const response = await fetch(`${API_URL}/seasons/now?limit=12`);
        const data = await response.json();

        if (data.data && data.data.length > 0) {
            setupHero(data.data[0]); // Use the first trending anime for Hero
            renderAnimeGrid(data.data, recentGrid);
        }
    } catch (error) {
        console.error('Error fetching season anime:', error);
        recentGrid.innerHTML = '<p class="error">Error al cargar recientes.</p>';
    }
}

async function fetchTopAnime() {
    try {
        const response = await fetch(`${API_URL}/top/anime?filter=bypopularity&limit=12`);
        const data = await response.json();

        if (data.data && data.data.length > 0) {
            renderAnimeGrid(data.data, popularGrid);
        }
    } catch (error) {
        console.error('Error fetching top anime:', error);
        popularGrid.innerHTML = '<p class="error">Error al cargar populares.</p>';
    }
}

async function handleSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    // Clear and use recentGrid for results, hide popularGrid
    recentGrid.innerHTML = '<div class="loading">Buscando...</div>';
    popularGrid.parentElement.style.display = 'none'; // Hide popular section
    document.querySelector('#recentGrid').previousElementSibling.querySelector('h3').textContent = `Resultados para: ${query}`;

    showHome();

    try {
        const response = await fetch(`${API_URL}/anime?q=${query}&limit=20`);
        const data = await response.json();
        renderAnimeGrid(data.data, recentGrid);
    } catch (error) {
        console.error('Error searching:', error);
        recentGrid.innerHTML = '<p class="error">Error en la búsqueda.</p>';
    }
}

// UI Rendering
function setupHero(anime) {
    document.getElementById('heroTitle').textContent = anime.title;
    document.getElementById('heroSynopsis').textContent = anime.synopsis ? anime.synopsis.substring(0, 200) + '...' : 'Sin descripción disponible.';

    // Add meta info if not exists
    const metaContainer = document.querySelector('.hero-meta');
    if (!metaContainer) {
        const metaDiv = document.createElement('div');
        metaDiv.className = 'hero-meta';
        metaDiv.innerHTML = `<span class="status-badge" style="background:var(--primary-color); padding:2px 8px; border-radius:4px; font-size:0.8rem; margin-right:10px;">En Emisión</span> <span>${anime.year || '2025'}</span>`;
        document.getElementById('heroTitle').after(metaDiv);
    }

    // Set background image
    const heroSection = document.getElementById('heroSection');
    const imageUrl = anime.images.jpg.large_image_url;
    document.querySelector('.hero-image').style.backgroundImage = `url('${imageUrl}')`;

    document.getElementById('heroBtn').onclick = () => openPlayer(anime);
}

function renderAnimeGrid(animeList, container) {
    container.innerHTML = '';

    animeList.forEach(anime => {
        const card = document.createElement('div');
        card.className = 'anime-card';
        card.onclick = () => openPlayer(anime);

        const imageUrl = anime.images.jpg.image_url;
        const title = anime.title;
        const type = anime.type || 'TV';

        card.innerHTML = `
            <img src="${imageUrl}" alt="${title}">
            <div class="card-info">
                <span class="type">${type}</span>
                <h4>${title}</h4>
            </div>
        `;

        container.appendChild(card);
    });
}

// Player Logic
function openPlayer(anime) {
    currentAnime = anime;
    mainContent.classList.add('hidden');
    playerView.classList.remove('hidden');
    window.scrollTo(0, 0);

    // Update Details
    const detailsHtml = `
        <h2>${anime.title}</h2>
        <p><strong>Géneros:</strong> ${anime.genres.map(g => g.name).join(', ')}</p>
        <p><strong>Episodios:</strong> ${anime.episodes || '?'}</p>
        <p><strong>Sinopsis:</strong> ${anime.synopsis}</p>
    `;
    document.getElementById('animeInfoDetailed').innerHTML = detailsHtml;

    // Try to fetch video from our local server
    fetchVideoLinks(anime.title);
}

async function fetchVideoLinks(animeTitle) {
    // Reset UI
    placeholderMessage.style.display = 'flex';
    videoPlayer.style.display = 'none';
    placeholderMessage.querySelector('p').textContent = 'Buscando enlaces en AnimeFLV...';

    try {
        // Call our local Node.js server
        // Encode the title to handle special characters
        const response = await fetch(`${BACKEND_URL}/episode/${encodeURIComponent(animeTitle)}`);
        const data = await response.json();

        if (data.success && data.servers.length > 0) {
            // We found links!
            placeholderMessage.querySelector('p').textContent = '¡Enlaces encontrados! Selecciona un servidor.';
            // Store links globally or in a way we can access them in changeServer
            currentAnime.servers = data.servers;

            // Auto-select the first server that is usually reliable (e.g., sw, mega) or just the first one
            changeServer(data.servers[0].name);

            // Update buttons
            updateServerButtons(data.servers);
        } else {
            placeholderMessage.querySelector('p').textContent = `No se encontraron videos: ${data.message}`;
        }
    } catch (error) {
        console.error('Error connecting to local server:', error);
        placeholderMessage.querySelector('p').textContent = 'Error: No se pudo conectar al servidor local.';
    }
}

function updateServerButtons(servers) {
    const container = document.querySelector('.server-list');
    container.innerHTML = '';
    servers.forEach(server => {
        const btn = document.createElement('button');
        btn.className = 'server-btn';
        btn.textContent = server.name;
        btn.onclick = () => changeServer(server.name);
        container.appendChild(btn);
    });
}

function showHome() {
    playerView.classList.add('hidden');
    mainContent.classList.remove('hidden');
    videoPlayer.src = ''; // Stop video

    // Reset search view if needed (optional logic)
    if (popularGrid.parentElement.style.display === 'none') {
        // If we were searching, maybe we want to keep the search results?
        // Or reset to home? Let's keep it simple for now.
    }
}

function changeServer(serverName) {
    // Update active button
    document.querySelectorAll('.server-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.toLowerCase().includes(serverName)) {
            btn.classList.add('active');
        }
    });

    if (currentAnime && currentAnime.servers) {
        const server = currentAnime.servers.find(s => s.name === serverName);
        if (server) {
            placeholderMessage.style.display = 'none';
            videoPlayer.style.display = 'block';
            videoPlayer.src = server.url;
            return;
        }
    }

    // Fallback if no real link found
    placeholderMessage.style.display = 'flex';
    videoPlayer.style.display = 'none';
    placeholderMessage.querySelector('p').textContent = `Servidor ${serverName} seleccionado (Sin enlace real disponible).`;
}
