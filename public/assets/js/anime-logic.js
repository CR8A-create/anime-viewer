console.log("Anime Logic Loaded - Version: TURBO_V2");
const API_URL = 'https://api.jikan.moe/v4';
const PROD_URL = 'https://mi-anime-api.onrender.com/api';
const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000/api'
    : PROD_URL;

// === SESSION CACHE (evita re-fetches al navegar entre páginas) ===
const SESSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function getSessionCache(key) {
    try {
        const raw = sessionStorage.getItem('anc_' + key);
        if (!raw) return null;
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts > SESSION_CACHE_TTL) {
            sessionStorage.removeItem('anc_' + key);
            return null;
        }
        return data;
    } catch { return null; }
}

function setSessionCache(key, data) {
    try {
        sessionStorage.setItem('anc_' + key, JSON.stringify({ data, ts: Date.now() }));
    } catch { /* storage full, ignore */ }
}

// Wrapper: fetch con caché de sesión
async function cachedFetch(cacheKey, url) {
    const cached = getSessionCache(cacheKey);
    if (cached) {
        console.log(`⚡ Cache HIT (session): ${cacheKey}`);
        return cached;
    }
    const response = await fetch(url);
    const data = await response.json();
    setSessionCache(cacheKey, data);
    return data;
}

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

// Connection Check with Retry Logic
async function checkBackendConnection(retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

            await fetch(`${BACKEND_URL}/health`, {
                method: 'HEAD',
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            console.log('✓ Backend connected:', BACKEND_URL);
            return true;
        } catch (e) {
            console.warn(`Backend connection attempt ${i + 1}/${retries} failed:`, e.message);
            if (i < retries - 1) {
                // Exponential backoff: wait 1s, then 2s, then 4s
                const waitTime = Math.pow(2, i) * 1000;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    console.warn('✗ Backend unavailable after retries. Falling back to Jikan API (English content).');
    showToast('⚠️ Servidor lento, mostrando contenido en inglés temporalmente.', 'warning');
    return false;
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
    // No bloquear: check de conexión en paralelo con carga de datos
    checkBackendConnection();

    // Check which page we're on - CRITICAL FIX: detect by pathname, not just DOM
    const currentPath = window.location.pathname;
    const isPlayerPage = currentPath.includes('ver.html');
    const isDirectoryPage = currentPath.includes('directorio');
    const isEmisionPage = currentPath.includes('emision');

    if (isPlayerPage) {
        // Only setup player on ver.html
        setupPlayerPage();
    } else if (isDirectoryPage) {
        // Load directory content
        setupDirectoryPage();
    } else if (isEmisionPage) {
        // Load emision content
        setupEmisionPage();
    } else {
        // Main/Carousel logic for index.html
        setupHome();
    }

    // Search listener
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
    }
    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }
});

function setupHome() {
    if (window.location.pathname.includes('directorio') || window.location.pathname.includes('emision')) {
        return;
    }

    // ⚡ CARGA PARALELA: todas las secciones a la vez en lugar de una por una
    Promise.all([
        fetchSeasonAnimeForCarousel(),
        fetchRecentEpisodes(),
        fetchTopAnime()
    ]).then(() => {
        console.log('✓ Todas las secciones de inicio cargadas');
        // Show "Ver Más" button after initial load
        const loadMoreBtn = document.getElementById('loadMorePopular');
        if (loadMoreBtn) {
            loadMoreBtn.style.display = 'flex';
            loadMoreBtn.onclick = loadMorePopularAnime;
        }
    });
}

function setupDirectoryPage() {
    console.log('Setting up Directory page');
    const directoryGrid = document.getElementById('directoryGrid');
    const genreSelect = document.getElementById('genreSelect');
    const alphabetFilter = document.getElementById('alphabetFilter');

    if (directoryGrid) {
        directoryGrid.innerHTML = '<div class="loading">Cargando directorio...</div>';
        // Load all anime from Jikan API
        fetchAllAnime(directoryGrid);
    }

    // Setup alphabet filter buttons if they don't exist
    if (alphabetFilter && alphabetFilter.children.length <= 1) {
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(letter => {
            const btn = document.createElement('button');
            btn.className = 'alpha-btn';
            btn.textContent = letter;
            btn.dataset.letter = letter;
            btn.onclick = () => filterByLetter(letter);
            alphabetFilter.appendChild(btn);
        });
    }

    // Setup genre filter
    if (genreSelect) {
        genreSelect.addEventListener('change', (e) => {
            const genreId = e.target.value;
            if (genreId) {
                fetchAnimeByGenre(genreId, directoryGrid);
            } else {
                fetchAllAnime(directoryGrid);
            }
        });
    }
}

function setupEmisionPage() {
    console.log('Setting up Emision page');
    const emisionGrid = document.getElementById('emisionGrid');

    if (emisionGrid) {
        emisionGrid.innerHTML = '<div class="loading">Cargando animes en emisión...</div>';
        // Load airing anime
        fetchAiringAnime(emisionGrid);
    }
}

// Pagination state
let currentPage = 1;
let currentFilter = { type: 'all' }; // { type: 'all' | 'genre' | 'letter', value: '' }

async function fetchAllAnime(container, page = 1) {
    try {
        const response = await fetch(`${API_URL}/top/anime?page=${page}&limit=24`);
        const data = await response.json();
        if (data.data && data.data.length > 0) {
            renderAnimeGrid(data.data, container);
            updatePagination(data.pagination, 'all');
        } else if (page === 1) {
            if (container) container.innerHTML = '<p class="error">No se encontraron animes.</p>';
        }
    } catch (error) {
        console.error('Error fetching all anime:', error);
        if (container) container.innerHTML = '<p class="error">Error al cargar el directorio.</p>';
    }
}

async function fetchAiringAnime(container) {
    try {
        const response = await fetch(`${BACKEND_URL}/airing`);
        const data = await response.json();
        if (data.success && data.data.length > 0) {
            renderAnimeGrid(data.data, container);
        }
    } catch (error) {
        console.error('Error fetching airing anime:', error);
        if (container) container.innerHTML = '<p class="error">Error al cargar animes en emisión.</p>';
    }
}

async function fetchAnimeByGenre(genreId, container, page = 1) {
    try {
        if (container) container.innerHTML = '<div class="loading">Filtrando por género...</div>';
        const response = await fetch(`${API_URL}/anime?genres=${genreId}&page=${page}&limit=24`);
        const data = await response.json();
        if (data.data && data.data.length > 0) {
            renderAnimeGrid(data.data, container);
            updatePagination(data.pagination, 'genre', genreId);
        } else {
            if (container) container.innerHTML = '<p class="error">No se encontraron animes en este género.</p>';
        }
    } catch (error) {
        console.error('Error fetching by genre:', error);
        if (container) container.innerHTML = '<p class="error">Error al filtrar por género.</p>';
    }
}

function filterByLetter(letter) {
    const directoryGrid = document.getElementById('directoryGrid');
    if (directoryGrid) {
        directoryGrid.innerHTML = '<div class="loading">Filtrando...</div>';
    }

    // Update active button
    document.querySelectorAll('.alpha-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.letter === letter || (letter === '' && btn.textContent === 'Todo'));
    });

    if (letter === '') {
        currentFilter = { type: 'all' };
        fetchAllAnime(directoryGrid, 1);
        return;
    }

    currentFilter = { type: 'letter', value: letter };
    currentPage = 1;

    // Fetch anime starting with letter
    fetch(`${API_URL}/anime?q=${letter}&page=1&limit=24`)
        .then(res => res.json())
        .then(data => {
            if (data.data && data.data.length > 0) {
                renderAnimeGrid(data.data, directoryGrid);
                updatePagination(data.pagination, 'letter', letter);
            } else {
                if (directoryGrid) directoryGrid.innerHTML = '<p class="error">No se encontraron animes.</p>';
            }
        })
        .catch(error => {
            console.error('Error filtering by letter:', error);
            if (directoryGrid) directoryGrid.innerHTML = '<p class="error">Error al filtrar.</p>';
        });
}

function updatePagination(pagination, filterType, filterValue = '') {
    const paginationContainer = document.getElementById('pagination');
    if (!paginationContainer || !pagination) return;

    const { current_page, last_visible_page, has_next_page } = pagination;
    currentPage = current_page;
    currentFilter = { type: filterType, value: filterValue };

    paginationContainer.innerHTML = '';

    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i> Anterior';
    prevBtn.disabled = current_page === 1;
    prevBtn.onclick = () => goToPage(current_page - 1);
    paginationContainer.appendChild(prevBtn);

    // Page numbers (show current, previous, next)
    const pagesToShow = [];
    if (current_page > 1) pagesToShow.push(current_page - 1);
    pagesToShow.push(current_page);
    if (has_next_page) pagesToShow.push(current_page + 1);

    pagesToShow.forEach(pageNum => {
        const pageBtn = document.createElement('button');
        pageBtn.className = `page-btn ${pageNum === current_page ? 'active' : ''}`;
        pageBtn.textContent = pageNum;
        pageBtn.onclick = () => goToPage(pageNum);
        paginationContainer.appendChild(pageBtn);
    });

    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.innerHTML = 'Siguiente <i class="fas fa-chevron-right"></i>';
    nextBtn.disabled = !has_next_page;
    nextBtn.onclick = () => goToPage(current_page + 1);
    paginationContainer.appendChild(nextBtn);
}

function goToPage(page) {
    const directoryGrid = document.getElementById('directoryGrid');
    if (!directoryGrid) return;

    window.scrollTo({ top: 0, behavior: 'smooth' });

    switch (currentFilter.type) {
        case 'all':
            fetchAllAnime(directoryGrid, page);
            break;
        case 'genre':
            fetchAnimeByGenre(currentFilter.value, directoryGrid, page);
            break;
        case 'letter':
            directoryGrid.innerHTML = '<div class="loading">Cargando...</div>';
            fetch(`${API_URL}/anime?q=${currentFilter.value}&page=${page}&limit=24`)
                .then(res => res.json())
                .then(data => {
                    if (data.data && data.data.length > 0) {
                        renderAnimeGrid(data.data, directoryGrid);
                        updatePagination(data.pagination, 'letter', currentFilter.value);
                    }
                })
                .catch(error => console.error('Error:', error));
            break;
    }
}

// State
let currentAnime = null;
let currentSlug = null;
let currentEpisodesList = [];
let currentEpisodeNumber = null;

function playRelativeEpisode(offset) {
    if (currentEpisodeNumber === null) return;
    const newNumber = parseInt(currentEpisodeNumber) + offset;
    // Simple verification
    fetchVideoLinks(newNumber);
}

// ---------------------------------------------------------
// FETCH FUNCTIONS
// ---------------------------------------------------------

async function fetchSeasonAnimeForCarousel() {
    try {
        const data = await cachedFetch('airing', `${BACKEND_URL}/airing`);
        if (data.success && data.data.length > 0) {
            setupCarousel(data.data);
        }
    } catch (error) {
        console.error('Error fetching season anime for carousel:', error);
    }
}

async function fetchRecentEpisodes() {
    try {
        const data = await cachedFetch('recent', `${BACKEND_URL}/recent`);

        if (data.success && data.data.length > 0) {
            const recentEpisodes = data.data.map(item => ({
                ...item.entry,
                type: item.episodes[0].title
            }));
            renderAnimeGrid(recentEpisodes, recentGrid);
        }
    } catch (error) {
        console.error('Error fetching recent episodes:', error);
        if (recentGrid) recentGrid.innerHTML = '<p class="error">Error al cargar recientes.</p>';
    }
}

let popularAnimePage = 1;

async function fetchTopAnime(page = 1, append = false) {
    try {
        const data = await cachedFetch(`top_anime_p${page}`, `${API_URL}/top/anime?filter=bypopularity&limit=12&page=${page}`);

        if (data.data && data.data.length > 0) {
            if (append && popularGrid) {
                // Append to existing grid
                data.data.forEach(anime => {
                    const card = document.createElement('div');
                    card.className = 'anime-card';
                    card.onclick = () => {
                        window.location.href = `ver.html?anime=${encodeURIComponent(anime.title)}`;
                    };
                    const thumb = anime.images?.jpg?.image_url || anime.image_url;
                    const name = anime.title || 'Sin título';
                    card.innerHTML = `
                        <img src="${thumb}" alt="${name}" loading="lazy">
                        <div class="card-info">
                            <span class="type">${anime.type || 'Anime'}</span>
                            <h4>${name}</h4>
                        </div>`;
                    popularGrid.appendChild(card);
                });
            } else {
                renderAnimeGrid(data.data, popularGrid);
            }
        }
    } catch (error) {
        console.error('Error fetching top anime:', error);
        if (popularGrid) popularGrid.innerHTML = '<p class="error">Error al cargar populares.</p>';
    }
}

async function loadMorePopularAnime() {
    const btn = document.getElementById('loadMorePopular');
    if (!btn) return;
    btn.innerHTML = '<span class="spinner"></span> Cargando...';
    btn.disabled = true;
    popularAnimePage++;
    await fetchTopAnime(popularAnimePage, true);
    btn.innerHTML = '<i class="fas fa-plus"></i> Ver Más Animes';
    btn.disabled = false;
}

async function handleSearch() {
    if (!searchInput) return;
    const query = searchInput.value.trim();
    if (!query) return;

    // Check if we are on Directory or Emision page
    if (window.location.pathname.includes('directorio') || window.location.pathname.includes('emision')) {
        showHome();

        const grid = document.getElementById('directoryGrid') || document.getElementById('emisionGrid');
        const pagination = document.getElementById('pagination');
        const headerTitle = document.querySelector('.section-header h3');
        if (headerTitle) headerTitle.innerHTML = `<i class="fas fa-search"></i> Resultados para: ${query}`;

        if (grid) grid.innerHTML = '<div class="loading">Buscando...</div>';
        if (pagination) pagination.innerHTML = '';

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
    if (popularGrid && popularGrid.parentElement) popularGrid.parentElement.style.display = 'none';

    const recentHeader = document.querySelector('#recentGrid').previousElementSibling.querySelector('h3');
    if (recentHeader) recentHeader.textContent = `Resultados para: ${query}`;

    try {
        const response = await fetch(`${API_URL}/anime?q=${query}&limit=20`);
        const data = await response.json();
        renderAnimeGrid(data.data, recentGrid);
    } catch (error) {
        console.error('Error searching:', error);
        if (recentGrid) recentGrid.innerHTML = '<p class="error">Error en la búsqueda.</p>';
    }
}

// ---------------------------------------------------------
// UI RENDERING & CAROUSEL
// ---------------------------------------------------------

let carouselInterval;
let currentSlide = 0;
let carouselAnimes = [];

function setupCarousel(animes) {
    carouselAnimes = animes.slice(0, 5);
    const track = document.getElementById('carouselTrack');
    const indicators = document.getElementById('carouselIndicators');

    if (!track) return;

    track.innerHTML = '';
    indicators.innerHTML = '';

    carouselAnimes.forEach((anime, index) => {
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
                </div>
                <h2>${anime.title}</h2>
                <p>${anime.synopsis ? anime.synopsis.substring(0, 200) + '...' : 'Sin descripción disponible.'}</p>
                <button class="btn-primary" onclick="openPlayerFromCarousel(${index})">Ver Ahora</button>
            </div>
        </div>
        `;
        track.appendChild(slide);

        const dot = document.createElement('div');
        dot.className = `indicator ${index === 0 ? 'active' : ''}`;
        dot.onclick = () => goToSlide(index);
        indicators.appendChild(dot);
    });

    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (prevBtn) prevBtn.onclick = prevSlide;
    if (nextBtn) nextBtn.onclick = nextSlide;

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
    if (!slides.length) return;

    slides[currentSlide].classList.remove('active');
    dots[currentSlide].classList.remove('active');

    currentSlide = index;

    slides[currentSlide].classList.add('active');
    dots[currentSlide].classList.add('active');

    startCarousel();
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
    if (!container) return;
    container.innerHTML = '';

    animeList.forEach(anime => {
        const card = document.createElement('div');
        card.className = 'anime-card';
        card.onclick = () => openPlayer(anime);

        const imageUrl = anime.images.jpg.image_url;
        const title = anime.title;
        const type = anime.type || 'TV';

        card.innerHTML = `
            <img src="${imageUrl}" alt="${title}" loading="lazy">
            <div class="card-info">
                <span class="type">${type.replace('Episode', 'Episodio')}</span>
                <h4>${title}</h4>
            </div>
        `;

        container.appendChild(card);
    });
}

// ---------------------------------------------------------
// PLAYER & NAVIGATION Logic
// ---------------------------------------------------------

// CRITICAL: Must be defined before usage in onclick
function openPlayer(anime) {
    // Redirect logic
    const params = new URLSearchParams();
    params.set('id', anime.mal_id);
    params.set('title', anime.title);
    window.location.href = `ver.html?${params.toString()}`;
}
// Expose globally for inline onclicks
window.openPlayer = openPlayer;

async function setupPlayerPage() {
    const params = new URLSearchParams(window.location.search);
    const animeId = params.get('id');
    const animeTitle = params.get('title');

    if (!animeId && !animeTitle) {
        alert('No se especificó un anime.');
        window.location.href = 'index.html';
        return;
    }

    // 1. If we have a title (from strict local navigation), use it directly.
    if (animeTitle) {
        console.log('Using title for local backend:', animeTitle);
        currentAnime = { title: animeTitle, mal_id: animeId };
        initializePlayer(currentAnime);
        return;
    }

    // 2. If ID is a Slug (not a number), it's likely from our local backend but title param was lost.
    // We treat the ID as the title/slug.
    if (animeId && isNaN(animeId)) {
        console.log('ID is slug, bypassing Jikan:', animeId);
        // Clean slug to title approximation if needed, or just use slug as title for search
        // For better search, we might want to prettify it, but searchAnimeFLV handles some fuzziness.
        currentAnime = { title: animeId, mal_id: animeId };
        initializePlayer(currentAnime);
        return;
    }

    // 3. Fallback: Numeric ID -> Fetch Jikan Metadata first (English)
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
        document.getElementById('animeInfoDetailed').innerHTML = '<p>ID de anime no encontrado.</p>';
    }
}

async function initializePlayer(anime) {
    console.log('Inicializando player para:', anime.title);
    let detailsHtml = `
        <h2>${anime.title}</h2>
        <p><strong>Géneros:</strong> ${anime.genres ? anime.genres.map(g => g.name).join(', ') : (anime.genres_real ? anime.genres_real.join(', ') : 'N/A')}</p>
        <p><strong>Episodios:</strong> ${anime.episodes || '?'}</p>
        <p><strong>Sinopsis:</strong> ${anime.synopsis || ''}</p>
    `;
    const infoDiv = document.getElementById('animeInfoDetailed');
    if (infoDiv) infoDiv.innerHTML = detailsHtml;

    const videoPlayer = document.getElementById('videoPlayer');
    const placeholderMessage = document.getElementById('placeholderMessage');
    const episodesList = document.getElementById('episodesList');
    const prevBtn = document.getElementById('prevEpBtn');
    const nextBtn = document.getElementById('nextEpBtn');

    if (prevBtn) prevBtn.onclick = () => playRelativeEpisode(-1);
    if (nextBtn) nextBtn.onclick = () => playRelativeEpisode(1);

    if (videoPlayer) videoPlayer.style.display = 'none';
    if (placeholderMessage) placeholderMessage.style.display = 'flex';
    if (episodesList) episodesList.innerHTML = '<div class="loading">Cargando...</div>';

    const serverList = document.querySelector('.server-list');
    if (serverList) serverList.innerHTML = '';

    try {
        const fetchUrl = `${BACKEND_URL}/anime/${encodeURIComponent(anime.title)}`;
        console.log('Fetching anime details from backend:', fetchUrl);
        const response = await fetch(fetchUrl);
        const data = await response.json();

        if (data.success) {
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
                if (episodesList) episodesList.innerHTML = '<p>No se encontraron episodios.</p>';
                if (placeholderMessage) placeholderMessage.querySelector('p').textContent = 'Lo sentimos, no disponible.';
            }

        } else {
            if (episodesList) episodesList.innerHTML = '<p>No se encontraron episodios.</p>';
        }
    } catch (error) {
        console.error('Error fetching episodes:', error);
        if (episodesList) episodesList.innerHTML = '<p>Error al cargar episodios.</p>';
    }
}

async function fetchVideoLinks(episodeNumber) {
    if (!currentSlug) return;
    currentEpisodeNumber = episodeNumber;

    const videoPlayer = document.getElementById('videoPlayer');
    const placeholderMessage = document.getElementById('placeholderMessage');
    const serverList = document.querySelector('.server-list');

    // Update Nav Buttons
    const prevBtn = document.getElementById('prevEpBtn');
    const nextBtn = document.getElementById('nextEpBtn');

    if (prevBtn && nextBtn && currentEpisodesList.length > 0) {
        const currentEp = parseInt(episodeNumber);
        // Logic for buttons...
        const hasNext = currentEpisodesList.some(e => e.number == (currentEp + 1));
        const hasPrev = currentEpisodesList.some(e => e.number == (currentEp - 1));

        nextBtn.disabled = !hasNext;
        prevBtn.disabled = !hasPrev;

        // Custom labels
        if (hasPrev) {
            prevBtn.innerHTML = `<i class="fas fa-chevron-left"></i> Ep ${currentEp - 1}`;
        } else {
            prevBtn.innerHTML = `<i class="fas fa-chevron-left"></i> Anterior`;
        }

        if (hasNext) {
            nextBtn.innerHTML = `Ep ${currentEp + 1} <i class="fas fa-chevron-right"></i>`;
        } else {
            nextBtn.innerHTML = `Siguiente <i class="fas fa-chevron-right"></i>`;
        }

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
            changeServer(data.servers[0].name, data.servers[0].url);
        } else {
            if (serverList) serverList.innerHTML = '<p>No hay servidores disponibles.</p>';
            if (placeholderMessage) placeholderMessage.querySelector('p').textContent = 'No hay opciones de video.';
        }
    } catch (error) {
        console.error('Error fetching video servers:', error);
        if (serverList) serverList.innerHTML = '<p>Error al cargar servidores.</p>';
    }
}

function updateServerButtons(servers) {
    const serverList = document.querySelector('.server-list');
    if (!serverList) return;
    serverList.innerHTML = '';

    servers.forEach(server => {
        const btn = document.createElement('button');
        btn.className = 'server-btn';
        btn.textContent = server.name;
        btn.onclick = () => changeServer(server.name, server.url);
        serverList.appendChild(btn);
    });
}

function changeServer(serverName, url) {
    const videoPlayer = document.getElementById('videoPlayer');
    const placeholderMessage = document.getElementById('placeholderMessage');

    if (placeholderMessage) placeholderMessage.style.display = 'none';

    if (videoPlayer) {
        videoPlayer.style.display = 'block';
        videoPlayer.src = url;
    }

    document.querySelectorAll('.server-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === serverName);
    });
}

function renderEpisodes(episodes) {
    const episodesList = document.getElementById('episodesList');
    if (!episodesList) return;

    episodesList.innerHTML = '';
    const existingSelector = document.querySelector('.range-selector');
    if (existingSelector) existingSelector.remove();

    if (episodes.length <= 24) {
        renderEpisodeChunk(episodes);
    } else {
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
        const btn = document.createElement('button');
        btn.className = 'episode-btn';
        btn.innerHTML = `<i class="fas fa-play"></i> Episodio ${ep.number}`;
        btn.onclick = () => fetchVideoLinks(ep.number);
        episodesList.appendChild(btn);
    });
}

function showHome() {
    if (mainContent) mainContent.style.display = 'block';
    if (playerView) playerView.style.display = 'none';
    window.scrollTo(0, 0);
}
