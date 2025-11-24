const API_URL = 'https://api.jikan.moe/v4';

// CAMBIA ESTA URL CUANDO SUBAS TU SERVIDOR A RENDER
// Si estás en tu PC, usa localhost. Si ya lo subiste, pon la URL de Render aquí.
// Ejemplo: 'https://mi-anime-server.onrender.com/api'
const BACKEND_URL = 'https://mi-anime-api.onrender.com/api';

// DOM Elements
const mainContent = document.getElementById('mainContent');
const playerView = document.getElementById('playerView');
const recentGrid = document.getElementById('recentGrid');
const popularGrid = document.getElementById('popularGrid');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const videoPlayer = document.getElementById('videoPlayer');
const placeholderMessage = document.getElementById('placeholderMessage');
const episodesList = document.getElementById('episodesList');

// State
let currentAnime = null;
let currentSlug = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check page
    if (window.location.pathname.includes('directorio')) {
        setupDirectory();
    } else if (window.location.pathname.includes('emision')) {
        setupEmision();
    } else {
        fetchSeasonNow();
        fetchTopAnime();
    }

    // Event Listeners
    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
    }
});

// Fetch Data
async function fetchSeasonNow() {
    try {
        const response = await fetch(`${API_URL}/seasons/now?limit=12`);
        const data = await response.json();

        if (data.data && data.data.length > 0) {
            setupCarousel(data.data); // Use top animes for Carousel
            renderAnimeGrid(data.data, recentGrid);
        }
    } catch (error) {
        console.error('Error fetching season anime:', error);
        if (recentGrid) recentGrid.innerHTML = '<p class="error">Error al cargar recientes.</p>';
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
        if (popularGrid) popularGrid.innerHTML = '<p class="error">Error al cargar populares.</p>';
    }
}

async function handleSearch() {
    if (!searchInput) return; // Guard clause if search bar is removed
    const query = searchInput.value.trim();
    if (!query) return;

    // Check if we are on Directory or Emision page
    if (window.location.pathname.includes('directorio') || window.location.pathname.includes('emision')) {
        showHome(); // Ensure we are not in player view

        const grid = document.getElementById('directoryGrid') || document.getElementById('emisionGrid');
        const pagination = document.getElementById('pagination');

        // Update Header to show search context
        const headerTitle = document.querySelector('.section-header h3');
        if (headerTitle) headerTitle.innerHTML = `<i class="fas fa-search"></i> Resultados para: ${query}`;

        if (grid) grid.innerHTML = '<div class="loading">Buscando...</div>';
        if (pagination) pagination.innerHTML = ''; // Hide pagination for search results

        try {
            const response = await fetch(`${API_URL}/anime?q=${query}&limit=24`);
            const data = await response.json();

            if (data.data && data.data.length > 0) {
                renderAnimeGrid(data.data, grid);
            } else {
                if (grid) grid.innerHTML = '<p class="error">No se encontraron resultados.</p>';
            }
        } catch (error) {
            console.error('Error searching:', error);
            if (grid) grid.innerHTML = '<p class="error">Error en la búsqueda.</p>';
        }
        return;
    }

    // Index Page Logic
    if (recentGrid) recentGrid.innerHTML = '<div class="loading">Buscando...</div>';
    if (popularGrid && popularGrid.parentElement) popularGrid.parentElement.style.display = 'none'; // Hide popular section

    const recentHeader = document.querySelector('#recentGrid').previousElementSibling.querySelector('h3');
    if (recentHeader) recentHeader.textContent = `Resultados para: ${query}`;

    showHome();

    try {
        const response = await fetch(`${API_URL}/anime?q=${query}&limit=20`);
        const data = await response.json();
        renderAnimeGrid(data.data, recentGrid);
    } catch (error) {
        console.error('Error searching:', error);
        if (recentGrid) recentGrid.innerHTML = '<p class="error">Error en la búsqueda.</p>';
    }
}

// UI Rendering
// Carousel State
let carouselInterval;
let currentSlide = 0;
let carouselAnimes = [];

function setupCarousel(animes) {
    carouselAnimes = animes.slice(0, 5); // Top 5 for carousel
    const track = document.getElementById('carouselTrack');
    const indicators = document.getElementById('carouselIndicators');

    track.innerHTML = '';
    indicators.innerHTML = '';

    carouselAnimes.forEach((anime, index) => {
        // Create Slide
        const slide = document.createElement('div');
        slide.className = `hero-slide ${index === 0 ? 'active' : ''}`;
        slide.style.backgroundImage = `url('${anime.images.jpg.large_image_url}')`;

        slide.innerHTML = `
            <div class="hero-content">
                <div class="hero-meta">
                    <span class="status-badge" style="background:var(--primary-color); padding:2px 8px; border-radius:4px; font-size:0.8rem; margin-right:10px;">En Emisión</span>
                    <span>${anime.year || '2025'}</span>
                </div>
                <h2>${anime.title}</h2>
                <p>${anime.synopsis ? anime.synopsis.substring(0, 200) + '...' : 'Sin descripción disponible.'}</p>
                <button class="btn-primary" onclick="openPlayerFromCarousel(${index})">Ver Ahora</button>
            </div>
        `;
        track.appendChild(slide);

        // Create Indicator
        const dot = document.createElement('div');
        dot.className = `indicator ${index === 0 ? 'active' : ''}`;
        dot.onclick = () => goToSlide(index);
        indicators.appendChild(dot);
    });

    // Controls
    document.getElementById('prevBtn').onclick = prevSlide;
    document.getElementById('nextBtn').onclick = nextSlide;

    // Auto Play
    startCarousel();
}

function openPlayerFromCarousel(index) {
    openPlayer(carouselAnimes[index]);
}

function startCarousel() {
    if (carouselInterval) clearInterval(carouselInterval);
    carouselInterval = setInterval(nextSlide, 5000);
}

function goToSlide(index) {
    const slides = document.querySelectorAll('.hero-slide');
    const dots = document.querySelectorAll('.indicator');

    slides[currentSlide].classList.remove('active');
    dots[currentSlide].classList.remove('active');

    currentSlide = index;

    slides[currentSlide].classList.add('active');
    dots[currentSlide].classList.add('active');

    startCarousel(); // Reset timer
}

function nextSlide() {
    let next = currentSlide + 1;
    if (next >= carouselAnimes.length) next = 0;
    goToSlide(next);
}

function prevSlide() {
    let prev = currentSlide - 1;
    if (prev < 0) prev = carouselAnimes.length - 1;
    goToSlide(prev);
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
async function openPlayer(anime) {
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

    // Reset Player UI
    videoPlayer.src = '';
    videoPlayer.style.display = 'none';
    placeholderMessage.style.display = 'flex';
    placeholderMessage.querySelector('p').textContent = 'Cargando lista de episodios...';
    episodesList.innerHTML = '<div class="loading">Cargando...</div>';
    document.querySelector('.server-list').innerHTML = ''; // Clear servers

    // 1. Fetch Episode List from Backend
    try {
        const response = await fetch(`${BACKEND_URL}/anime/${encodeURIComponent(anime.title)}`);
        const data = await response.json();

        if (data.success && data.episodes.length > 0) {
            currentSlug = data.slug; // Save slug for video fetching
            renderEpisodes(data.episodes);

            // Auto-play first episode (latest)
            fetchVideoLinks(data.episodes[0].number);

            // Highlight first episode
            // We do this after rendering, handled in renderEpisodes logic or here
        } else {
            episodesList.innerHTML = '<p>No se encontraron episodios.</p>';
            placeholderMessage.querySelector('p').textContent = 'No se encontraron episodios en AnimeFLV.';
        }
    } catch (error) {
        console.error('Error fetching episodes:', error);
        episodesList.innerHTML = '<p>Error al cargar episodios.</p>';
        placeholderMessage.querySelector('p').textContent = 'Error al conectar con el servidor.';
    }
}

function renderEpisodes(episodes) {
    episodesList.innerHTML = '';

    // Remove existing range selector if any
    const existingSelector = document.querySelector('.range-selector');
    if (existingSelector) existingSelector.remove();

    if (episodes.length <= 24) {
        renderEpisodeChunk(episodes);
    } else {
        // Create Range Selector
        const rangeSelector = document.createElement('div');
        rangeSelector.className = 'range-selector';

        const chunkSize = 24;
        const totalChunks = Math.ceil(episodes.length / chunkSize);

        // Sort episodes descending (usually) or ascending? 
        // AnimeFLV usually lists latest first. Let's assume input is sorted.
        // If we want ranges like "1-24", "25-48", we need to handle sorting.
        // Let's assume episodes are passed in order (usually descending from API).
        // If descending: Ep 100, 99, ... 1.
        // Ranges: 100-77, 76-53...
        // User asked for "1-13, 14-24".
        // Let's sort episodes by number ASCENDING for easier grouping if they are mixed,
        // OR just slice the array if we trust the order.
        // Let's sort them DESCENDING (standard for streaming) but label ranges clearly.

        // Actually, user example: "ep 1-13 luego ep 14-24". This implies Ascending order or just grouping.
        // Let's stick to the current order but group them.

        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, episodes.length);
            const chunk = episodes.slice(start, end);

            const firstEp = chunk[0].number;
            const lastEp = chunk[chunk.length - 1].number;

            const btn = document.createElement('button');
            btn.className = 'range-btn';
            btn.textContent = `${firstEp} - ${lastEp}`;
            if (i === 0) btn.classList.add('active');

            btn.onclick = () => {
                document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderEpisodeChunk(chunk);
            };

            rangeSelector.appendChild(btn);
        }

        episodesList.parentElement.insertBefore(rangeSelector, episodesList);
        renderEpisodeChunk(episodes.slice(0, chunkSize));
    }
}

function renderEpisodeChunk(chunk) {
    episodesList.innerHTML = '';
    chunk.forEach(ep => {
        const btn = document.createElement('div');
        btn.className = 'episode-btn';
        // Check if this is the currently playing episode
        // We need to track current episode number globally or check against video player state
        // For now, just render.

        btn.textContent = `Episodio ${ep.number}`;
        btn.onclick = () => {
            document.querySelectorAll('.episode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            fetchVideoLinks(ep.number);
        };
        episodesList.appendChild(btn);
    });
}

async function fetchVideoLinks(episodeNumber) {
    if (!currentSlug) return;

    // Reset Player for new episode
    placeholderMessage.style.display = 'flex';
    videoPlayer.style.display = 'none';
    placeholderMessage.querySelector('p').textContent = `Cargando Episodio ${episodeNumber}...`;
    document.querySelector('.server-list').innerHTML = '<span style="color:#888">Cargando servidores...</span>';

    try {
        const response = await fetch(`${BACKEND_URL}/videos/${currentSlug}/${episodeNumber}`);
        const data = await response.json();

        if (data.success && data.servers.length > 0) {
            placeholderMessage.querySelector('p').textContent = '¡Listo! Selecciona un servidor.';
            currentAnime.servers = data.servers;

            updateServerButtons(data.servers);
            changeServer(data.servers[0].name); // Auto-play first server
        } else {
            placeholderMessage.querySelector('p').textContent = `No se encontraron videos para el episodio ${episodeNumber}.`;
            document.querySelector('.server-list').innerHTML = '';
        }
    } catch (error) {
        console.error('Error fetching videos:', error);
        placeholderMessage.querySelector('p').textContent = 'Error al obtener videos.';
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

// Directory Logic
let currentDirPage = 1;
let currentGenre = '';
let currentLetter = '';

function setupDirectory() {
    const genreSelect = document.getElementById('genreSelect');
    const alphabetFilter = document.getElementById('alphabetFilter');

    // Event Listener for Genre
    if (genreSelect) {
        genreSelect.addEventListener('change', (e) => {
            currentGenre = e.target.value;
            currentLetter = ''; // Reset letter
            currentDirPage = 1;

            // Reset active letter
            updateActiveLetter('');

            fetchDirectoryAnime();
        });
    }

    // Event Listener for "Todo" button
    const todoBtn = alphabetFilter.querySelector('.alpha-btn[data-letter=""]');
    if (todoBtn) {
        todoBtn.addEventListener('click', () => filterByLetter(''));
    }

    // Populate Alphabet
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    letters.forEach(letter => {
        const btn = document.createElement('button');
        btn.className = 'alpha-btn';
        btn.textContent = letter;
        btn.dataset.letter = letter;
        btn.onclick = () => filterByLetter(letter);
        alphabetFilter.appendChild(btn);
    });

    // Initial Fetch
    fetchDirectoryAnime();
}

function filterByLetter(letter) {
    currentLetter = letter;
    currentGenre = ''; // Reset genre when letter changes
    document.getElementById('genreSelect').value = '';
    currentDirPage = 1;
    updateActiveLetter(letter);
    fetchDirectoryAnime();
}

function updateActiveLetter(letter) {
    document.querySelectorAll('.alpha-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.letter === letter);
    });
}

async function fetchDirectoryAnime() {
    const grid = document.getElementById('directoryGrid');
    const pagination = document.getElementById('pagination');

    grid.innerHTML = '<div class="loading">Cargando...</div>';
    pagination.innerHTML = '';

    let url = `${API_URL}/anime?page=${currentDirPage}&limit=24&order_by=popularity`;

    if (currentGenre) {
        url += `&genres=${currentGenre}`;
    } else if (currentLetter) {
        url += `&letter=${currentLetter}`;
    }

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.data && data.data.length > 0) {
            renderAnimeGrid(data.data, grid);
            renderPagination(data.pagination);
        } else {
            grid.innerHTML = '<p class="error">No se encontraron resultados.</p>';
        }
    } catch (error) {
        console.error('Error fetching directory:', error);
        grid.innerHTML = '<p class="error">Error al cargar el directorio.</p>';
    }
}

function renderPagination(paginationData) {
    const pagination = document.getElementById('pagination');
    const { current_page, has_next_page } = paginationData;

    if (current_page > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'page-btn';
        prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
        prevBtn.onclick = () => {
            currentDirPage--;
            fetchDirectoryAnime();
            window.scrollTo(0, 0);
        };
        pagination.appendChild(prevBtn);
    }

    const pageInfo = document.createElement('span');
    pageInfo.style.alignSelf = 'center';
    pageInfo.textContent = `Página ${current_page}`;
    pagination.appendChild(pageInfo);

    if (has_next_page) {
        const nextBtn = document.createElement('button');
        nextBtn.className = 'page-btn';
        nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
        nextBtn.onclick = () => {
            currentDirPage++;
            fetchDirectoryAnime();
            window.scrollTo(0, 0);
        };
        pagination.appendChild(nextBtn);
    }
}

// Emision Page Logic
let currentEmisionPage = 1;

function setupEmision() {
    fetchEmisionAnime();
}

async function fetchEmisionAnime() {
    const grid = document.getElementById('emisionGrid');
    const pagination = document.getElementById('pagination');

    grid.innerHTML = '<div class="loading">Cargando animes en emisión...</div>';
    pagination.innerHTML = '';

    try {
        const response = await fetch(`${API_URL}/seasons/now?page=${currentEmisionPage}&limit=24`);
        const data = await response.json();

        if (data.data && data.data.length > 0) {
            renderAnimeGrid(data.data, grid);
            renderEmisionPagination(data.pagination);
        } else {
            grid.innerHTML = '<p class="error">No se encontraron animes en emisión.</p>';
        }
    } catch (error) {
        console.error('Error fetching emision anime:', error);
        grid.innerHTML = '<p class="error">Error al cargar animes en emisión.</p>';
    }
}

function renderEmisionPagination(paginationData) {
    const pagination = document.getElementById('pagination');
    const { current_page, has_next_page } = paginationData;

    if (current_page > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'page-btn';
        prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
        prevBtn.onclick = () => {
            currentEmisionPage--;
            fetchEmisionAnime();
            window.scrollTo(0, 0);
        };
        pagination.appendChild(prevBtn);
    }

    const pageInfo = document.createElement('span');
    pageInfo.style.alignSelf = 'center';
    pageInfo.textContent = `Página ${current_page}`;
    pagination.appendChild(pageInfo);

    if (has_next_page) {
        const nextBtn = document.createElement('button');
        nextBtn.className = 'page-btn';
        nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
        nextBtn.onclick = () => {
            currentEmisionPage++;
            fetchEmisionAnime();
            window.scrollTo(0, 0);
        };
        pagination.appendChild(nextBtn);
    }
}
