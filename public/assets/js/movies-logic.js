// Movies Logic - TMDB Backend (TURBO V2)
console.log("Movies Logic Loaded - TURBO V2");

const TMDB_IMAGE = 'https://image.tmdb.org/t/p';

const MOVIES_BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000/api'
    : 'https://mi-anime-api.onrender.com/api';

// === SESSION CACHE ===
const MV_CACHE_TTL = 5 * 60 * 1000;

function mvCacheGet(key) {
    try {
        const raw = sessionStorage.getItem('mvc_' + key);
        if (!raw) return null;
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts > MV_CACHE_TTL) { sessionStorage.removeItem('mvc_' + key); return null; }
        return data;
    } catch { return null; }
}

function mvCacheSet(key, data) {
    try { sessionStorage.setItem('mvc_' + key, JSON.stringify({ data, ts: Date.now() })); } catch { }
}

async function mvCachedFetch(key, url) {
    const cached = mvCacheGet(key);
    if (cached) { console.log(`⚡ Movies cache HIT: ${key}`); return cached; }
    const res = await fetch(url);
    const data = await res.json();
    mvCacheSet(key, data);
    return data;
}

// Fetch popular movies from TMDB
async function fetchPopularMovies(page = 1) {
    try {
        const data = await mvCachedFetch(`pop_${page}`, `${MOVIES_BACKEND_URL}/movies/popular?page=${page}`);
        return data.success ? data.data.results : [];
    } catch (error) {
        console.error('Error fetching popular movies:', error);
        return [];
    }
}

// Fetch airing series from TMDB
async function fetchAiringSeries(page = 1) {
    try {
        const data = await mvCachedFetch(`air_${page}`, `${MOVIES_BACKEND_URL}/series/airing?page=${page}`);
        return data.success ? data.data.results : [];
    } catch (error) {
        console.error('Error fetching airing series:', error);
        return [];
    }
}

// Search content in TMDB
async function searchContent(query) {
    try {
        const data = await mvCachedFetch(`search_${query}`, `${MOVIES_BACKEND_URL}/movies/search?query=${encodeURIComponent(query)}`);
        return data.success ? data.data : [];
    } catch (error) {
        console.error('Error searching:', error);
        return [];
    }
}

// Render grid of movies/series
function renderMovieGrid(items, container) {
    if (!container) return;
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = '<p class="error">No se encontraron resultados</p>';
        return;
    }

    items.forEach(item => {
        if (!item.poster_path) return;

        const card = document.createElement('div');
        card.className = 'anime-card';
        card.onclick = () => openMoviePlayer(item);

        const title = item.title || item.name;
        const poster = `${TMDB_IMAGE}/w500${item.poster_path}`;
        const type = item.media_type === 'tv' || item.first_air_date ? 'Serie' : 'Película';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';

        card.innerHTML = `
            <img src="${poster}" alt="${title}" loading="lazy">
            <div class="card-info">
                <span class="type">${type} ⭐${rating}</span>
                <h4>${title}</h4>
            </div>
        `;

        container.appendChild(card);
    });
}

// Open player
function openMoviePlayer(item) {
    const params = new URLSearchParams();
    params.set('id', item.id);
    params.set('title', item.title || item.name);

    let type = 'movie';
    if (item.media_type === 'tv' || item.first_air_date || item.name) {
        type = 'tv';
    }
    params.set('type', type);

    window.location.href = `ver.html?${params.toString()}`;
}

// ===================================================================
// CAROUSEL IMPLEMENTATION
// ===================================================================

let carouselInterval;
let currentSlide = 0;
let carouselMovies = [];

async function fetchMoviesForCarousel() {
    try {
        // Solo 1 página en vez de 2 — reduce a la mitad el tiempo de carga
        const data = await mvCachedFetch('carousel', `${MOVIES_BACKEND_URL}/movies/popular?page=1`);
        let allMovies = data.success ? data.data.results : [];
        const shuffled = allMovies.sort(() => 0.5 - Math.random());
        return shuffled.slice(0, 5);
    } catch (error) {
        console.error('Error fetching movies for carousel:', error);
        return [];
    }
}

function setupCarousel(movies) {
    carouselMovies = movies;
    const track = document.getElementById('carouselTrack');
    const indicators = document.getElementById('carouselIndicators');

    if (!track || !indicators) return;

    track.innerHTML = '';
    indicators.innerHTML = '';

    carouselMovies.forEach((movie, index) => {
        const slide = document.createElement('div');
        slide.className = `hero-slide ${index === 0 ? 'active' : ''}`;

        const backdropUrl = movie.backdrop_path
            ? `${TMDB_IMAGE}/original${movie.backdrop_path}`
            : `${TMDB_IMAGE}/w500${movie.poster_path}`;
        const posterUrl = `${TMDB_IMAGE}/w500${movie.poster_path}`;
        const title = movie.title || movie.name;
        const overview = movie.overview ? movie.overview.substring(0, 200) + '...' : 'Sin descripción disponible.';
        const rating = movie.vote_average ? movie.vote_average.toFixed(1) : 'N/A';
        const type = movie.media_type === 'tv' || movie.first_air_date ? 'Serie' : 'Película';

        slide.innerHTML = `
            <div class="hero-backdrop" style="background-image: url('${backdropUrl}');"></div>
            <div class="hero-container container">
                <div class="hero-poster">
                    <img src="${posterUrl}" alt="${title}">
                </div>
                <div class="hero-content">
                    <div class="hero-meta">
                        <span class="status-badge">${type} ⭐${rating}</span>
                    </div>
                    <h2>${title}</h2>
                    <p>${overview}</p>
                    <button class="btn-primary" onclick="openMoviePlayer(carouselMovies[${index}])">Ver Ahora</button>
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
    if (next >= carouselMovies.length) next = 0;
    goToSlide(next);
}

function prevSlide() {
    let prev = currentSlide - 1;
    if (prev < 0) prev = carouselMovies.length - 1;
    goToSlide(prev);
}

// ===================================================================
// PAGINATION STATE
// ===================================================================

let moviesPage = 1;
let seriesPage = 1;

// Append items to grid (without clearing existing ones)
function appendToGrid(items, container) {
    if (!container) return;
    items.forEach(item => {
        if (!item.poster_path) return;
        const card = document.createElement('div');
        card.className = 'anime-card';
        card.onclick = () => openMoviePlayer(item);
        const title = item.title || item.name;
        const poster = `${TMDB_IMAGE}/w500${item.poster_path}`;
        const type = item.media_type === 'tv' || item.first_air_date ? 'Serie' : 'Película';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        card.innerHTML = `
            <img src="${poster}" alt="${title}" loading="lazy">
            <div class="card-info">
                <span class="type">${type} ⭐${rating}</span>
                <h4>${title}</h4>
            </div>
        `;
        container.appendChild(card);
    });
}

// Load More Movies
async function loadMoreMovies() {
    const btn = document.getElementById('loadMoreMovies');
    btn.innerHTML = '<span class="spinner"></span> Cargando...';
    btn.disabled = true;
    moviesPage++;
    const movies = await fetchPopularMovies(moviesPage);
    const grid = document.getElementById('moviesGrid');
    if (movies.length > 0) {
        appendToGrid(movies, grid);
    }
    btn.innerHTML = '<i class="fas fa-plus"></i> Ver Más Películas';
    btn.disabled = false;
    if (movies.length < 10) btn.style.display = 'none'; // No more results
}

// Load More Series
async function loadMoreSeries() {
    const btn = document.getElementById('loadMoreSeries');
    btn.innerHTML = '<span class="spinner"></span> Cargando...';
    btn.disabled = true;
    seriesPage++;
    const series = await fetchAiringSeries(seriesPage);
    const grid = document.getElementById('seriesGrid');
    if (series.length > 0) {
        appendToGrid(series, grid);
    }
    btn.innerHTML = '<i class="fas fa-plus"></i> Ver Más Series';
    btn.disabled = false;
    if (series.length < 10) btn.style.display = 'none';
}

// Initialize on DOMContentLoaded — ⚡ PARALELO
document.addEventListener('DOMContentLoaded', async () => {
    const moviesGrid = document.getElementById('moviesGrid');
    const seriesGrid = document.getElementById('seriesGrid');
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');

    // ⚡ Todo en paralelo: carousel + movies + series
    const [moviesForCarousel, movies, series] = await Promise.all([
        fetchMoviesForCarousel(),
        moviesGrid ? fetchPopularMovies() : Promise.resolve([]),
        seriesGrid ? fetchAiringSeries() : Promise.resolve([])
    ]);

    if (moviesForCarousel.length > 0) setupCarousel(moviesForCarousel);
    if (moviesGrid) renderMovieGrid(movies, moviesGrid);
    if (seriesGrid) renderMovieGrid(series, seriesGrid);

    // Show "Ver Más" buttons
    const loadMoreMoviesBtn = document.getElementById('loadMoreMovies');
    const loadMoreSeriesBtn = document.getElementById('loadMoreSeries');
    if (loadMoreMoviesBtn && movies.length > 0) loadMoreMoviesBtn.style.display = 'flex';
    if (loadMoreSeriesBtn && series.length > 0) loadMoreSeriesBtn.style.display = 'flex';

    console.log('✓ Movies: todas las secciones cargadas en paralelo');

    // Search functionality
    async function handleSearch() {
        const query = searchInput ? searchInput.value.trim() : '';
        if (!query) return;

        if (moviesGrid) moviesGrid.innerHTML = '<div class="loading">Buscando...</div>';
        if (seriesGrid && seriesGrid.parentElement) seriesGrid.parentElement.style.display = 'none';
        if (loadMoreMoviesBtn) loadMoreMoviesBtn.style.display = 'none';
        if (loadMoreSeriesBtn) loadMoreSeriesBtn.style.display = 'none';

        const results = await searchContent(query);

        if (moviesGrid) {
            renderMovieGrid(results, moviesGrid);
            const header = document.querySelector('.section-header h3');
            if (header) header.innerHTML = `<i class="fas fa-search"></i> Resultados para: ${query}`;
        }
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
    }
    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }
});
