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

// Connection Check
async function checkBackendConnection() {
    try {
        await fetch(`${BACKEND_URL}/health`, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
        console.log('Backend connected:', BACKEND_URL);
    } catch (e) {
        console.warn('Backend disconnected. Falling back to Jikan English API.');
        showToast('⚠️ Modo Sin Servidor: Mostrando datos en Inglés (Jikan API).', 'warning');
    }
}

function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; 
        background: ${type === 'warning' ? '#ff9800' : '#333'}; 
        color: white; padding: 12px 24px; border-radius: 8px; 
        z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        font-family: 'Outfit', sans-serif; animation: slideUp 0.3s ease;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

document.addEventListener('DOMContentLoaded', () => {
    checkBackendConnection();
});

// State
let currentAnime = null;
let currentSlug = null;
let currentEpisodesList = [];
let currentEpisodeNumber = null;

function playRelativeEpisode(offset) {
    if (currentEpisodeNumber === null) return;
    const newNumber = parseInt(currentEpisodeNumber) + offset;
    const targetEp = currentEpisodesList.find(e => e.number == newNumber);
    if (targetEp) {
        fetchVideoLinks(newNumber);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check page
    if (window.location.pathname.includes('directorio')) {
        setupDirectory();
    } else if (window.location.pathname.includes('emision')) {
        setupEmision();
    } else if (window.location.pathname.includes('ver.html')) {
        setupPlayerPage();
    } else {
        fetchSeasonNow(); // Mantener para el Carrusel
        fetchRecentEpisodes(); // Nuevo: Para la cuadrícula de recientes
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
        // Fetch more items to randomize (e.g., 25 items)
        const response = await fetch(`${API_URL}/seasons/now?limit=25`);
        const data = await response.json();

        if (data.data && data.data.length > 0) {
            // Shuffle Array
            const shuffled = data.data.sort(() => 0.5 - Math.random());
            // Take top 5
            let selected = shuffled.slice(0, 5);

            // Translate via Backend
            const translatedPromises = selected.map(async (anime) => {
                try {
                    const res = await fetch(`${BACKEND_URL}/anime/${encodeURIComponent(anime.title)}`);
                    const details = await res.json();
                    if (details.success && details.description) {
                        return {
                            ...anime,
                            synopsis: details.description,
                            genres: details.genres ? details.genres.map(g => ({ name: g })) : anime.genres
                        };
                    }
                } catch (e) {
                    console.error('Translation failed for', anime.title);
                }
                return anime; // Fallback to original
            });

            selected = await Promise.all(translatedPromises);
            setupCarousel(selected);
        }
    } catch (error) {
        console.error('Error fetching season anime for carousel:', error);
    }
}

async function fetchRecentEpisodes() {
    try {
        const response = await fetch(`${API_URL}/watch/episodes`);
        const data = await response.json();

        if (data.data && data.data.length > 0) {
            // Mapeamos los datos para que coincidan con renderAnimeGrid
            const recentEpisodes = data.data.map(item => ({
                ...item.entry,
                type: item.episodes[0] ? item.episodes[0].title : 'Nuevo' // Usamos el título del episodio como "tipo"
            }));
            renderAnimeGrid(recentEpisodes, recentGrid);
        }
    } catch (error) {
        console.error('Error fetching recent episodes:', error);
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

        slide.innerHTML = `
        <div class="hero-backdrop" style="background-image: url('${anime.images.jpg.large_image_url}');"></div>
        <div class="hero-container container">
            <div class="hero-poster">
                <img src="${anime.images.jpg.large_image_url}" alt="${anime.title}">
            </div>
            <div class="hero-content">
                <div class="hero-meta">
                    <span class="status-badge">En Emisión</span>
                    <span>${anime.year || '2025'}</span>
                </div>
                <h2>${anime.title}</h2>
                <p>${anime.synopsis ? anime.synopsis.substring(0, 200) + '...' : 'Sin descripción disponible.'}</p>
                <button class="btn-primary" onclick="openPlayerFromCarousel(${index})">Ver Ahora</button>
            </div>
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


async function setupPlayerPage() {
    const params = new URLSearchParams(window.location.search);
    const animeId = params.get('id');
    const animeTitle = params.get('title');

    if (!animeId && !animeTitle) {
        alert('No se especificó un anime.');
        window.location.href = 'index.html';
        return;
    }

    // Attempt to Re-construct anime object or fetch it
    // If we have ID, we can fetch from Jikan to get details
    if (animeId) {
        try {
            const response = await fetch(`${API_URL}/anime/${animeId}`);
            const data = await response.json();
            if (data.data) {
                currentAnime = data.data;
                initializePlayer(currentAnime);
            }
        } catch (e) {
            console.error('Error loading anime details:', e);
            document.getElementById('animeInfoDetailed').innerHTML = '<p>Error al cargar detalles.</p>';
        }
    } else {
        // Fallback currently not fully supported without ID, but could search by title
        document.getElementById('animeInfoDetailed').innerHTML = '<p>ID de anime no encontrado.</p>';
    }
}

async function initializePlayer(anime) {
    // We will update details AFTER fetching backend data to prefer Spanish
    // Initial render with Jikan data (English) as placeholder
    let detailsHtml = `
        <h2>${anime.title}</h2>
        <p><strong>Géneros:</strong> ${anime.genres ? anime.genres.map(g => g.name).join(', ') : 'N/A'}</p>
        <p><strong>Episodios:</strong> ${anime.episodes || '?'}</p>
        <p><strong>Sinopsis:</strong> ${anime.synopsis || ''}</p>
    `;
    const infoDiv = document.getElementById('animeInfoDetailed');
    if (infoDiv) infoDiv.innerHTML = detailsHtml;

    // State
    const videoPlayer = document.getElementById('videoPlayer');
    const placeholderMessage = document.getElementById('placeholderMessage');
    const episodesList = document.getElementById('episodesList');
    const prevBtn = document.getElementById('prevEpBtn');
    const nextBtn = document.getElementById('nextEpBtn');

    if (prevBtn) prevBtn.onclick = () => playRelativeEpisode(-1);
    if (nextBtn) nextBtn.onclick = () => playRelativeEpisode(1);

    if (videoPlayer) videoPlayer.style.display = 'none';
    if (placeholderMessage) placeholderMessage.style.display = 'flex';
    if (placeholderMessage) placeholderMessage.querySelector('p').textContent = 'Cargando lista de episodios...';
    if (episodesList) episodesList.innerHTML = '<div class="loading">Cargando...</div>';

    const serverList = document.querySelector('.server-list');
    if (serverList) serverList.innerHTML = '';

    // Fetch Episodes & Spanish Details
    try {
        const response = await fetch(`${BACKEND_URL}/anime/${encodeURIComponent(anime.title)}`);
        const data = await response.json();

        if (data.success) {
            // UDPATE INFO WITH SPANISH DATA
            if (data.description || data.genres) {
                detailsHtml = `
                    <h2>${anime.title}</h2>
                    <p><strong>Géneros:</strong> ${data.genres ? data.genres.join(', ') : (anime.genres ? anime.genres.map(g => g.name).join(', ') : 'N/A')}</p>
                    <p><strong>Estado:</strong> ${data.status || 'Desconocido'} &nbsp;|&nbsp; <strong>Calificación:</strong> ${data.rate || 'N/A'}</p> 
                    <p><strong>Episodios:</strong> ${data.episodes.length}</p>
                    <p class="synopsis-es"><strong>Sinopsis:</strong> ${data.description || anime.synopsis || 'Sin descripción.'}</p>
                `;
                if (infoDiv) infoDiv.innerHTML = detailsHtml;
            }

            if (data.episodes.length > 0) {
                currentSlug = data.slug;
                currentEpisodesList = data.episodes;
                renderEpisodes(data.episodes);
                fetchVideoLinks(data.episodes[0].number);
            } else {
                // ... handle no episodes
                if (episodesList) episodesList.innerHTML = '<p>No se encontraron episodios.</p>';
                if (placeholderMessage) placeholderMessage.querySelector('p').textContent = 'Lo sentimos, no hay episodios disponibles para este anime por el momento.';
            }

        } else {
            if (episodesList) episodesList.innerHTML = '<p>No se encontraron episodios.</p>';
            if (placeholderMessage) placeholderMessage.querySelector('p').textContent = 'Lo sentimos, no hay episodios disponibles para este anime por el momento.';
        }
    } catch (error) {
        console.error('Error fetching episodes:', error);
        if (episodesList) episodesList.innerHTML = '<p>Error al cargar episodios.</p>';
        if (placeholderMessage) placeholderMessage.querySelector('p').textContent = 'Error al conectar con el servidor.';
    }
}

// Helper to search AnimeFLV if direct slug fails
async function searchAnimeFLV(query) {
    // ... logic handled on backend now
}

async function fetchVideoLinks(episodeNumber) {
    if (!currentSlug) return;
    currentEpisodeNumber = episodeNumber; // Track current

    const videoPlayer = document.getElementById('videoPlayer');
    const placeholderMessage = document.getElementById('placeholderMessage');
    const serverList = document.querySelector('.server-list');
    const prevBtn = document.getElementById('prevEpBtn');
    const nextBtn = document.getElementById('nextEpBtn');

    // Update Navigation Buttons
    if (prevBtn && nextBtn && currentEpisodesList.length > 0) {
        const currentEp = parseInt(episodeNumber);
        const nextEpNum = currentEp + 1;
        const prevEpNum = currentEp - 1;

        // Use weak comparison (==) just in case types differ, though parseInt helps
        const hasNext = currentEpisodesList.some(e => e.number == nextEpNum);
        const hasPrev = currentEpisodesList.some(e => e.number == prevEpNum);

        nextBtn.disabled = !hasNext;
        nextBtn.innerHTML = hasNext
            ? `Siguiente (Ep ${nextEpNum}) <i class="fas fa-chevron-right"></i>`
            : `Siguiente <i class="fas fa-chevron-right"></i>`;

        prevBtn.disabled = !hasPrev;
        prevBtn.innerHTML = hasPrev
            ? `<i class="fas fa-chevron-left"></i> Anterior (Ep ${prevEpNum})`
            : `<i class="fas fa-chevron-left"></i> Anterior`;

        // Update Title / Status
        const activeTitle = document.getElementById('activeEpisodeTitle');
        if (activeTitle) {
            activeTitle.style.display = 'block';
            activeTitle.textContent = `Viendo Episodio ${currentEp}`;
        }
    }
    if (serverList) serverList.innerHTML = '<div class="loading">Obteniendo servidores...</div>';

    try {
        const response = await fetch(`${BACKEND_URL}/videos/${currentSlug}/${episodeNumber}`);
        const data = await response.json();

        if (data.success && data.servers.length > 0) {
            updateServerButtons(data.servers);
            // Auto-play first server
            changeServer(data.servers[0].name, data.servers[0].url);
        } else {
            if (serverList) serverList.innerHTML = '<p>No hay servidores disponibles.</p>';
            if (placeholderMessage) placeholderMessage.querySelector('p').textContent = 'No se encontraron opciones de video.';
        }
    } catch (error) {
        console.error('Error fetching video servers:', error);
        if (serverList) serverList.innerHTML = '<p>Error al cargar servidores.</p>';
        if (placeholderMessage) placeholderMessage.querySelector('p').textContent = 'Error al conectar con el servidor de videos.';
    }
}

function renderEpisodes(episodes) {
    const episodesList = document.getElementById('episodesList');
    if (!episodesList) return;

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
    const episodesList = document.getElementById('episodesList');
    episodesList.innerHTML = '';

    chunk.forEach(ep => {
        const btn = document.createElement('div');
        btn.className = 'episode-btn';
        btn.textContent = `Episodio ${ep.number}`;
        btn.onclick = () => {
            document.querySelectorAll('.episode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            fetchVideoLinks(ep.number);
        };
        episodesList.appendChild(btn);
    });
}

function updateServerButtons(servers) {
    const container = document.querySelector('.server-list');
    container.innerHTML = '';
    servers.forEach(server => {
        const btn = document.createElement('button');
        btn.className = 'server-btn';
        btn.textContent = server.name;
        // Pass URL directly
        btn.onclick = () => changeServer(server.name, server.url);
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

function changeServer(serverName, serverUrl) {
    // Update active button
    document.querySelectorAll('.server-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.includes(serverName)) {
            btn.classList.add('active');
        }
    });

    const videoPlayer = document.getElementById('videoPlayer');
    const placeholderMessage = document.getElementById('placeholderMessage');

    if (serverUrl) {
        placeholderMessage.style.display = 'none';
        videoPlayer.style.display = 'block';
        videoPlayer.src = serverUrl;
        return;
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
