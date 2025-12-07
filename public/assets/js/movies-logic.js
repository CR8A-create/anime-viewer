// Movies Logic - Cuevana Scraper Backend
console.log("Movies Logic Loaded - Cuevana Backend");

const TMDB_IMAGE = 'https://image.tmdb.org/t/p';

// NEW: Separate backend for movies
const MOVIES_BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:4000/api'  // Local: puerto 4000
    : (process.env.MOVIES_BACKEND_URL || 'https://movies-api-cuevana.onrender.com'); // Producción: usuario configurará

// Fetch popular movies from Cuevana
async function fetchPopularMovies() {
    try {
        const response = await fetch(`${MOVIES_BACKEND_URL}/popular`);
        const data = await response.json();
        return data.success ? data.data : [];
    } catch (error) {
        console.error('Error fetching popular movies:', error);
        return [];
    }
}

// Search content in Cuevana
async function searchContent(query) {
    try {
        const response = await fetch(`${MOVIES_BACKEND_URL}/search?query=${encodeURIComponent(query)}`);
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
        const card = document.createElement('div');
        card.className = 'anime-card'; // Reuse anime styles
        card.onclick = () => openMoviePlayer(item);

        const title = item.title || item.name;
        const poster = item.poster || 'https://via.placeholder.com/300x450?text=No+Image';
        const type = item.type === 'tv' ? 'Serie' : 'Película';
        const rating = item.rating || item.year || '';

        card.innerHTML = `
            <img src="${poster}" alt="${title}" loading="lazy" onerror="this.src='https://via.placeholder.com/300x450?text=No+Image'">
            <div class="card-info">
                <span class="type">${type} ${rating}</span>
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
    params.set('type', item.type || 'movie');

    window.location.href = `ver.html?${params.toString()}`;
}

// ===================================================================
// CAROUSEL IMPLEMENTATION (Dynamic with Random Movies from Cuevana)
// ===================================================================

let carouselInterval;
let currentSlide = 0;
let carouselMovies = [];

async function fetchMoviesForCarousel() {
    try {
        const movies = await fetchPopularMovies();

        // Shuffle and take first 5
        const shuffled = movies.sort(() => 0.5 - Math.random());
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

        const posterUrl = movie.poster || 'https://via.placeholder.com/300x450?text=No+Image';
        const title = movie.title || movie.name;
        const type = movie.type === 'tv' ? 'Serie' : 'Película';

        slide.innerHTML = `
            <div class="hero-backdrop" style="background-image: url('${posterUrl}');"></div>
            <div class="hero-container container">
                <div class="hero-poster">
                    <img src="${posterUrl}" alt="${title}" onerror="this.src='https://via.placeholder.com/300x450?text=No+Image'">
                </div>
                <div class="hero-content">
                    <div class="hero-meta">
                        <span class="status-badge">${type} 🇪🇸 Español</span>
                    </div>
                    <h2>${title}</h2>
                    <p>Contenido disponible en español desde Cuevana</p>
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

    // Load carousel with random popular movies
    const moviesForCarousel = await fetchMoviesForCarousel();
    if (moviesForCarousel.length > 0) {
        setupCarousel(moviesForCarousel);
    }

    // Load popular movies
    if (moviesGrid) {
        moviesGrid.innerHTML = '<div class="loading">Cargando películas desde Cuevana...</div>';
        const movies = await fetchPopularMovies();
        renderMovieGrid(movies, moviesGrid);
    }

    // For series grid, we can use same popular for now or hide it
    if (seriesGrid) {
        seriesGrid.parentElement.style.display = 'none'; // Hide series section for now
    }

    // Search functionality
    async function handleSearch() {
        const query = searchInput ? searchInput.value.trim() : '';
        if (!query) return;

        if (moviesGrid) moviesGrid.innerHTML = '<div class="loading">Buscando en Cuevana...</div>';
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
