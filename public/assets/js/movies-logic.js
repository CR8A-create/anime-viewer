// Movies Logic - TMDB Backend
console.log("Movies Logic Loaded - TMDB Backend");

const TMDB_IMAGE = 'https://image.tmdb.org/t/p';

// Movies backend URL
const MOVIES_BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:4000/api'
    : 'https://movies-api-cuevana.onrender.com/api';

// Fetch popular movies from TMDB
async function fetchPopularMovies(page = 1) {
    try {
        const response = await fetch(`${MOVIES_BACKEND_URL}/movies/popular?page=${page}`);
        const data = await response.json();
        return data.success ? data.data.results : [];
    } catch (error) {
        console.error('Error fetching popular movies:', error);
        return [];
    }
}

// Fetch airing series from TMDB
async function fetchAiringSeries(page = 1) {
    try {
        const response = await fetch(`${MOVIES_BACKEND_URL}/series/airing?page=${page}`);
        const data = await response.json();
        return data.success ? data.data.results : [];
    } catch (error) {
        console.error('Error fetching airing series:', error);
        return [];
    }
}

// Search content in TMDB
async function searchContent(query) {
    try {
        const response = await fetch(`${MOVIES_BACKEND_URL}/movies/search?query=${encodeURIComponent(query)}`);
        const data = await response.json();
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
        const [page1, page2] = await Promise.all([
            fetch(`${MOVIES_BACKEND_URL}/movies/popular?page=1`).then(r => r.json()),
            fetch(`${MOVIES_BACKEND_URL}/movies/popular?page=2`).then(r => r.json())
        ]);

        let allMovies = [];
        if (page1.success) allMovies = allMovies.concat(page1.data.results);
        if (page2.success) allMovies = allMovies.concat(page2.data.results);

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

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
    const moviesGrid = document.getElementById('moviesGrid');
    const seriesGrid = document.getElementById('seriesGrid');
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');

    // Load carousel
    const moviesForCarousel = await fetchMoviesForCarousel();
    if (moviesForCarousel.length > 0) {
        setupCarousel(moviesForCarousel);
    }

    // Load popular movies
    if (moviesGrid) {
        moviesGrid.innerHTML = '<div class="loading">Cargando películas...</div>';
        const movies = await fetchPopularMovies();
        renderMovieGrid(movies, moviesGrid);
    }

    // Load airing series
    if (seriesGrid) {
        seriesGrid.innerHTML = '<div class="loading">Cargando series...</div>';
        const series = await fetchAiringSeries();
        renderMovieGrid(series, seriesGrid);
    }

    // Search functionality
    async function handleSearch() {
        const query = searchInput ? searchInput.value.trim() : '';
        if (!query) return;

        if (moviesGrid) moviesGrid.innerHTML = '<div class="loading">Buscando...</div>';
        if (seriesGrid && seriesGrid.parentElement) seriesGrid.parentElement.style.display = 'none';

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
