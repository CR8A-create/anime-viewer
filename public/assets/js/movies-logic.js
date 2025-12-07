// Movies Logic - Similar to anime-logic.js but for TMDB
console.log("Movies Logic Loaded");

const TMDB_IMAGE = 'https://image.tmdb.org/t/p';
const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000/api'
    : 'https://mi-anime-api.onrender.com/api';

// Fetch popular movies
async function fetchPopularMovies(page = 1) {
    try {
        const response = await fetch(`${BACKEND_URL}/movies/popular?page=${page}`);
        const data = await response.json();
        return data.success ? data.data.results : [];
    } catch (error) {
        console.error('Error fetching popular movies:', error);
        return [];
    }
}

// Fetch airing series
async function fetchAiringSeries(page = 1) {
    try {
        const response = await fetch(`${BACKEND_URL}/series/airing?page=${page}`);
        const data = await response.json();
        return data.success ? data.data.results : [];
    } catch (error) {
        console.error('Error fetching airing series:', error);
        return [];
    }
}

// Search multi (movies + series)
async function searchContent(query) {
    try {
        const response = await fetch(`${BACKEND_URL}/movies/search?query=${encodeURIComponent(query)}`);
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
        // Skip if no poster
        if (!item.poster_path) return;

        const card = document.createElement('div');
        card.className = 'anime-card'; // Reuse anime styles
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

    // Determine type
    let type = 'movie';
    if (item.media_type === 'tv' || item.first_air_date || item.name) {
        type = 'tv';
    }
    params.set('type', type);

    window.location.href = `ver.html?${params.toString()}`;
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
    const moviesGrid = document.getElementById('moviesGrid');
    const seriesGrid = document.getElementById('seriesGrid');
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');

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
