// App version (semantic versioning)
const APP_VERSION = '1.9.1';
console.log('Screen Tracker app.js loaded, version:', APP_VERSION);

// TMDB API configuration
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// Get TMDB API key from user settings
function getTmdbApiKey() {
    return state.settings.tmdbApiKey || '';
}

// Helper functions for rating tags
function getRatingFromTags(tags) {
    if (!tags) return null;
    const ratingTag = tags.find(tag => tag.match(/^\d{2}_stars$/));
    if (!ratingTag) return null;
    return parseInt(ratingTag.substring(0, 2));
}

function setRatingTag(tags, rating) {
    // Remove any existing rating tags
    const tagsWithoutRating = tags.filter(tag => !tag.match(/^\d{2}_stars$/));
    // Add new rating tag if provided
    if (rating && rating >= 1 && rating <= 10) {
        const ratingTag = rating.toString().padStart(2, '0') + '_stars';
        tagsWithoutRating.push(ratingTag);
    }
    return tagsWithoutRating;
}

// Helper functions for episode tracking
function parseEpisodeCode(code) {
    if (!code) return null;
    const match = code.match(/^s(\d+)e(\d+)$/i);
    if (!match) return null;
    return {
        season: parseInt(match[1]),
        episode: parseInt(match[2])
    };
}

function formatEpisodeCode(season, episode) {
    return `s${season.toString().padStart(2, '0')}e${episode.toString().padStart(2, '0')}`;
}

function isEpisodeWatched(episodeSeason, episodeNumber, lastWatchedCode) {
    if (!lastWatchedCode) return false;

    const lastWatched = parseEpisodeCode(lastWatchedCode);
    if (!lastWatched) return false;

    // Episode is watched if it's before or equal to the last watched episode
    if (episodeSeason < lastWatched.season) return true;
    if (episodeSeason === lastWatched.season && episodeNumber <= lastWatched.episode) return true;

    return false;
}

function updateLastWatchedEpisode(screenId, season, episode) {
    const screen = state.screens.find(s => s.id === screenId);
    if (screen) {
        screen.lastWatchedEpisode = formatEpisodeCode(season, episode);
        saveToLocalStorage();

        // Re-render episodes to update UI
        if (screen.tmdbId) {
            fetchAndDisplayEpisodes(screen.tmdbId, screenId);
        }
    }
}

// Helper functions for determining screen list status from timestamps
function getScreenListStatus(screen) {
    if (screen.finishedAt) return 'watched';
    // Watching status is only for TV shows with episode tracking
    if (screen.type === 'tv' && screen.lastWatchedEpisode) return 'watching';
    if (screen.addedAt) return 'to_watch';
    return null;
}

// Helper to get all unique tags from all screens
function getAllUniqueTags() {
    const tags = new Set();
    state.screens.forEach(screen => {
        if (screen.tags) {
            screen.tags.forEach(tag => {
                // Exclude rating tags
                if (!tag.match(/^\d{2}_stars$/)) {
                    tags.add(tag);
                }
            });
        }
    });
    return Array.from(tags).sort();
}

// Update screen rating
function updateScreenRating(screenId, rating) {
    const screen = state.screens.find(s => s.id === screenId);
    if (screen) {
        screen.tags = setRatingTag(screen.tags || [], rating);
        saveToLocalStorage();
        renderScreens();
    }
}

// Ensure timestamp integrity when setting list status
function setListTimestamps(screen, listStatus) {
    const now = new Date().toISOString();

    if (listStatus === 'to_watch') {
        screen.addedAt = now;
        screen.finishedAt = null;
        // Clear episode tracking when moving back to "to watch"
        screen.lastWatchedEpisode = null;
    } else if (listStatus === 'watching') {
        // Watching is determined by having lastWatchedEpisode set
        // This case is for when pill selector is clicked, but actual
        // episode tracking is done via episode checkmark buttons
        screen.finishedAt = null;

        // Ensure addedAt is set
        if (!screen.addedAt) {
            screen.addedAt = now;
        }
    } else if (listStatus === 'watched') {
        screen.finishedAt = now;

        // Ensure addedAt is present
        if (!screen.addedAt) {
            screen.addedAt = screen.finishedAt;
        }
    }

    return screen;
}

// Update screen metadata
function updateScreenMetadata(screenId, updates) {
    const screenIndex = state.screens.findIndex(s => s.id === screenId);
    if (screenIndex !== -1) {
        const screen = state.screens[screenIndex];

        // If ID is being changed (due to TMDB ID change), check for duplicates
        if (updates.id && updates.id !== screenId) {
            const duplicate = state.screens.find(s => s.id === updates.id);
            if (duplicate) {
                alert('⚠️ Screen with this ID already exists');
                return;
            }
        }

        Object.assign(screen, updates);
        saveToLocalStorage();
        renderScreens();
    }
}

// Function to convert image URL to data URI for offline caching
async function convertImageToDataUri(url) {
    if (!url) return null;

    // If already a data URI, return as-is
    if (url.startsWith('data:')) return url;

    try {
        // Ensure HTTPS
        const httpsUrl = url.replace('http://', 'https://');

        // Fetch the image
        const response = await fetch(httpsUrl);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);

        // Convert to blob
        const blob = await response.blob();

        // Convert blob to data URI
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('Failed to convert image to data URI:', error);
        return null;
    }
}

// Cache screen poster image for offline use
async function cacheScreenPoster(screen) {
    if (!screen.posterUrl) return screen;

    // Skip if already cached (has a cachedPoster or posterUrl is already a data URI)
    if (screen.cachedPoster || screen.posterUrl.startsWith('data:')) return screen;

    const dataUri = await convertImageToDataUri(screen.posterUrl);
    if (dataUri) {
        screen.cachedPoster = dataUri;
        console.log(`Cached poster for: ${screen.title}`);
    }

    return screen;
}

// Migrate existing screens to cache their posters
async function migrateExistingPosters() {
    console.log('Starting poster migration...');
    let cachedCount = 0;
    let failedCount = 0;

    for (const screen of state.screens) {
        // Only cache if there's a posterUrl and no cached version yet
        if (screen.posterUrl && !screen.cachedPoster && !screen.posterUrl.startsWith('data:')) {
            try {
                await cacheScreenPoster(screen);
                cachedCount++;
                // Save periodically to avoid losing progress
                if (cachedCount % 10 === 0) {
                    saveToLocalStorage();
                }
            } catch (error) {
                console.error(`Failed to cache poster for ${screen.title}:`, error);
                failedCount++;
            }
        }
    }

    // Final save
    if (cachedCount > 0) {
        saveToLocalStorage();
        console.log(`Poster migration complete: ${cachedCount} cached, ${failedCount} failed`);
    }
}

// Register service worker with update detection
if ('serviceWorker' in navigator) {
    let refreshing = false;
    let lastUpdateCheck = null;
    let updateCheckInterval = null;

    // Detect controller change and reload page
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
    });

    // Function to check for updates
    function checkForUpdates(registration) {
        console.log('Checking for updates...');
        lastUpdateCheck = Date.now();
        registration.update();
    }

    // Start periodic update checks (30 minutes)
    function startUpdateChecks(registration) {
        // Clear any existing interval
        if (updateCheckInterval) {
            clearInterval(updateCheckInterval);
        }

        // Check every 30 minutes
        updateCheckInterval = setInterval(() => {
            checkForUpdates(registration);
        }, 30 * 60 * 1000);
    }

    // Stop periodic update checks
    function stopUpdateChecks() {
        if (updateCheckInterval) {
            clearInterval(updateCheckInterval);
            updateCheckInterval = null;
        }
    }

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                console.log('Service Worker registered');

                // Initial check on load
                checkForUpdates(reg);

                // Start periodic checks
                startUpdateChecks(reg);

                // Listen for updates
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;

                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New service worker installed and old one still controlling
                            console.log('New update installed, will reload automatically...');
                        }
                    });
                });

                // Check when app gains focus (if last check > 30 mins ago)
                window.addEventListener('focus', () => {
                    const now = Date.now();
                    const thirtyMinutes = 30 * 60 * 1000;

                    if (!lastUpdateCheck || (now - lastUpdateCheck) > thirtyMinutes) {
                        checkForUpdates(reg);
                    }

                    // Resume periodic checks when focused
                    startUpdateChecks(reg);
                });

                // Stop checks when app loses focus
                window.addEventListener('blur', () => {
                    stopUpdateChecks();
                });
            })
            .catch(err => console.log('Service Worker registration failed', err));
    });
}

// App state
const state = {
    screens: [], // Single array of screens with tags
    filterTags: [], // Tags to filter by in Screens view
    searchQuery: '', // Search query for saved screens
    sortBy: 'dateAdded', // dateAdded, title, year, rating
    sortOrder: 'desc', // asc or desc
    settings: {
        tmdbApiKey: '',
        gistId: '',
        apiToken: ''
    },
    isSyncing: false,
    lastSyncTime: null // Track last sync timestamp
};

// DOM elements (initialized after DOM loads)
let searchInput;
let searchResults;
let navItems;
let views;
let tmdbApiKeyInput;
let saveTmdbSettingsBtn;
let tmdbStatus;
let gistIdInput;
let apiTokenInput;
let saveSettingsBtn;
let syncNowBtn;
let syncStatus;
let clearCacheBtn;
let updatePWABtn;
let maintenanceStatus;

// Current screen being viewed in detail modal
let currentDetailScreen = null;
let currentDetailSource = 'list';

// Initialize app
function init() {
    console.log('Initializing app...');

    // Get DOM elements after DOM is loaded
    searchInput = document.getElementById('searchInput');
    searchResults = document.getElementById('searchResults');
    navItems = document.querySelectorAll('.nav-item');
    views = document.querySelectorAll('.view');
    tmdbApiKeyInput = document.getElementById('tmdbApiKey');
    saveTmdbSettingsBtn = document.getElementById('saveTmdbSettings');
    tmdbStatus = document.getElementById('tmdbStatus');
    gistIdInput = document.getElementById('gistId');
    apiTokenInput = document.getElementById('apiToken');
    saveSettingsBtn = document.getElementById('saveSettings');
    syncNowBtn = document.getElementById('syncNow');
    syncStatus = document.getElementById('syncStatus');
    clearCacheBtn = document.getElementById('clearCache');
    updatePWABtn = document.getElementById('updatePWA');
    maintenanceStatus = document.getElementById('maintenanceStatus');

    console.log('DOM elements loaded:', {
        searchInput: !!searchInput,
        navItems: navItems.length,
        views: views.length
    });

    loadSettingsFromStorage();
    loadFromLocalStorage();
    loadSortPreference();

    // Display app version
    document.getElementById('appVersion').textContent = APP_VERSION;

    // Render screens view
    renderScreens();

    // Migrate existing screen posters to cached data URIs for offline use
    // Run this async without blocking the UI
    setTimeout(() => {
        migrateExistingPosters();
    }, 1000);

    // Show screens view by default
    switchView('screensView');

    setupEventListeners();

    // Auto-sync on startup if configured
    if (state.settings.apiToken && state.settings.gistId) {
        syncWithGitHub(false);
    }
}

// Event listeners
function setupEventListeners() {
    // Search on input
    if (searchInput) {
        const clearSearchBtn = document.getElementById('clearSearchInput');
        let searchTimeout;

        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            const query = searchInput.value.trim();

            // Toggle clear button visibility
            if (clearSearchBtn) {
                clearSearchBtn.classList.toggle('visible', searchInput.value.length > 0);
            }

            if (query.length > 2) {
                searchTimeout = setTimeout(() => handleSearch(), 1000);
            } else if (query.length === 0) {
                searchResults.innerHTML = '';
            }
        });

        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(searchTimeout);
                handleSearch();
            }
        });

        // Clear search button
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                searchInput.value = '';
                searchResults.innerHTML = '';
                clearSearchBtn.classList.remove('visible');
                searchInput.focus();
            });
        }
    }

    // Bottom navigation
    if (navItems) {
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const viewId = item.dataset.view;
                switchView(viewId);
            });
        });
    }

    // Keyboard detection for mobile
    let initialHeight = window.innerHeight;
    let initialWidth = window.innerWidth;

    window.addEventListener('resize', () => {
        const currentHeight = window.innerHeight;
        const currentWidth = window.innerWidth;

        // If width changed significantly, it's likely a rotation or window resize
        if (Math.abs(currentWidth - initialWidth) > 50) {
            initialWidth = currentWidth;
            initialHeight = currentHeight;
            document.body.classList.remove('keyboard-open');
            return;
        }

        // If width didn't change but height decreased significantly, it's likely keyboard
        if (currentHeight < initialHeight - 100) {
            document.body.classList.add('keyboard-open');
        } else {
            document.body.classList.remove('keyboard-open');
            // Update initial height if it increased (e.g. browser bars hidden/shown)
            if (currentHeight > initialHeight) {
                initialHeight = currentHeight;
            }
        }
    });

    // Modal close handlers
    document.getElementById('closeModal').addEventListener('click', closeScreenDetail);
    document.getElementById('screenDetailModal').addEventListener('click', (e) => {
        if (e.target.id === 'screenDetailModal') {
            closeScreenDetail();
        }
    });

    // Settings handlers
    if (saveTmdbSettingsBtn) saveTmdbSettingsBtn.addEventListener('click', saveTmdbSettings);
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);
    if (syncNowBtn) syncNowBtn.addEventListener('click', () => syncWithGitHub(true));

    // Maintenance handlers
    if (clearCacheBtn) clearCacheBtn.addEventListener('click', clearLocalCache);
    if (updatePWABtn) updatePWABtn.addEventListener('click', updatePWA);

    // Auto-sync on focus (if last sync > 5 minutes ago)
    window.addEventListener('focus', () => {
        if (state.settings.apiToken && state.settings.gistId) {
            const now = Date.now();
            const fiveMinutes = 5 * 60 * 1000;

            if (!state.lastSyncTime || (now - state.lastSyncTime) > fiveMinutes) {
                syncWithGitHub(false);
            }
        }
    });

    // Search saved screens (Screens view)
    const screenSearchInput = document.getElementById('screenSearch');
    if (screenSearchInput) {
        const clearScreenSearchBtn = document.getElementById('clearScreenSearch');
        let screenSearchTimeout;

        screenSearchInput.addEventListener('input', () => {
            clearTimeout(screenSearchTimeout);

            // Toggle clear button visibility
            if (clearScreenSearchBtn) {
                clearScreenSearchBtn.classList.toggle('visible', screenSearchInput.value.length > 0);
            }

            screenSearchTimeout = setTimeout(() => {
                state.searchQuery = screenSearchInput.value.trim().toLowerCase();
                renderScreens();
            }, 300);
        });

        // Clear screen search button
        if (clearScreenSearchBtn) {
            clearScreenSearchBtn.addEventListener('click', () => {
                screenSearchInput.value = '';
                state.searchQuery = '';
                renderScreens();
                clearScreenSearchBtn.classList.remove('visible');
                screenSearchInput.focus();
            });
        }
    }

    // Tag filter buttons (Screens view) - delegated event handling
    const tagFiltersContainer = document.getElementById('tagFilters');
    if (tagFiltersContainer) {
        tagFiltersContainer.addEventListener('click', (e) => {
            const button = e.target.closest('.tag-filter');
            if (!button) return;

            const filterTag = button.dataset.tag;
            const isListTag = ['to_watch', 'watching', 'watched'].includes(filterTag);

            // Toggle selection
            if (button.classList.contains('active')) {
                // Deselect if already selected
                button.classList.remove('active');
                state.filterTags = state.filterTags.filter(t => t !== filterTag);
            } else {
                // Select this tag
                if (isListTag) {
                    // Deselect other list tags
                    tagFiltersContainer.querySelectorAll('.tag-filter').forEach(btn => {
                        const btnTag = btn.dataset.tag;
                        if (['to_watch', 'watching', 'watched'].includes(btnTag)) {
                            btn.classList.remove('active');
                        }
                    });
                    // Remove other list tags from filterTags
                    state.filterTags = state.filterTags.filter(t => !['to_watch', 'watching', 'watched'].includes(t));
                } else {
                    // Deselect other manual tags
                    tagFiltersContainer.querySelectorAll('.tag-filter.manual-tag').forEach(btn => {
                        btn.classList.remove('active');
                    });
                    // Remove other manual tags from filterTags
                    const listTags = ['to_watch', 'watching', 'watched'];
                    state.filterTags = state.filterTags.filter(t => listTags.includes(t));
                }

                state.filterTags.push(filterTag);
                button.classList.add('active');
            }

            renderScreens();
        });
    }

    // Sort controls
    const sortBySelect = document.getElementById('sortBy');
    const sortOrderBtn = document.getElementById('sortOrder');

    if (sortBySelect) {
        sortBySelect.addEventListener('change', () => {
            state.sortBy = sortBySelect.value;
            saveSortPreference();
            renderScreens();
        });
    }

    if (sortOrderBtn) {
        sortOrderBtn.addEventListener('click', () => {
            state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
            sortOrderBtn.textContent = state.sortOrder === 'asc' ? '↑' : '↓';
            saveSortPreference();
            renderScreens();
        });
    }
}

// Switch between views
function switchView(viewId) {
    views.forEach(view => {
        view.classList.toggle('active', view.id === viewId);
    });

    navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewId);
    });

    // If switching to screens view, render screens
    if (viewId === 'screensView') {
        renderScreens();
    }
}

// Search movies/shows via TMDB API
async function handleSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    searchResults.innerHTML = '<div class="loading">Searching...</div>';

    // Check if API key is configured
    const apiKey = getTmdbApiKey();
    if (!apiKey) {
        searchResults.innerHTML = '<div class="error-message">Please configure your TMDB API key in Settings. Get a free API key at <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer">themoviedb.org/settings/api</a></div>';
        return;
    }

    try {
        // Search for both movies and TV shows
        const [moviesResponse, tvResponse] = await Promise.all([
            fetch(`${TMDB_BASE_URL}/search/movie?api_key=${apiKey}&query=${encodeURIComponent(query)}&page=1`),
            fetch(`${TMDB_BASE_URL}/search/tv?api_key=${apiKey}&query=${encodeURIComponent(query)}&page=1`)
        ]);

        if (!moviesResponse.ok || !tvResponse.ok) {
            searchResults.innerHTML = '<div class="error-message">Search failed. Please check your API key in Settings.</div>';
            return;
        }

        const moviesData = await moviesResponse.json();
        const tvData = await tvResponse.json();

        // Combine and format results
        const results = [];

        // Add movies
        if (moviesData.results) {
            moviesData.results.forEach(movie => {
                results.push({
                    id: `movie_${movie.id}`,
                    tmdbId: movie.id,
                    type: 'movie',
                    title: movie.title,
                    year: movie.release_date ? movie.release_date.substring(0, 4) : '',
                    posterUrl: movie.poster_path ? `${TMDB_IMAGE_BASE}/w300${movie.poster_path}` : null,
                    overview: movie.overview,
                    popularity: movie.popularity || 0
                });
            });
        }

        // Add TV shows
        if (tvData.results) {
            tvData.results.forEach(show => {
                results.push({
                    id: `tv_${show.id}`,
                    tmdbId: show.id,
                    type: 'tv',
                    title: show.name,
                    year: show.first_air_date ? show.first_air_date.substring(0, 4) : '',
                    posterUrl: show.poster_path ? `${TMDB_IMAGE_BASE}/w300${show.poster_path}` : null,
                    overview: show.overview,
                    popularity: show.popularity || 0
                });
            });
        }

        if (results.length > 0) {
            // Sort by popularity (descending) to interleave movies and TV shows by relevance
            results.sort((a, b) => b.popularity - a.popularity);
            displaySearchResults(results.slice(0, 20));
        } else {
            searchResults.innerHTML = '<div class="loading">No results found</div>';
            // Add manual entry button for no results
            const manualEntryButton = document.createElement('button');
            manualEntryButton.className = 'btn-manual-entry';
            manualEntryButton.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <path d="M12 5v14M5 12h14"></path>
                </svg>
                <span>Add manually</span>
            `;
            manualEntryButton.addEventListener('click', showManualEntryModal);
            searchResults.appendChild(manualEntryButton);
        }
    } catch (error) {
        console.error('Search error:', error);
        searchResults.innerHTML = '<div class="error-message">Network error. Please check your connection and try again.</div>';
    }
}

// Display search results
function displaySearchResults(results) {
    searchResults.innerHTML = '';

    results.forEach(result => {
        const resultEl = document.createElement('div');
        resultEl.className = 'search-result-item';

        const posterUrl = result.posterUrl || result.cachedPoster || '';
        const typeLabel = result.type === 'movie' ? 'Movie' : 'TV Show';

        resultEl.innerHTML = `
            ${posterUrl ? `<img src="${posterUrl}" class="screen-cover" alt="${result.title}">` : '<div class="screen-cover"></div>'}
            <div class="screen-info">
                <div class="screen-title">${result.title}</div>
                <div class="screen-meta">${typeLabel}${result.year ? ` • ${result.year}` : ''}</div>
            </div>
        `;

        // Click to view details
        resultEl.addEventListener('click', () => {
            showScreenDetail(result, 'search');
        });

        searchResults.appendChild(resultEl);
    });

    // Add manual entry button at the end
    const manualEntryButton = document.createElement('button');
    manualEntryButton.className = 'btn-manual-entry';
    manualEntryButton.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 5v14M5 12h14"></path>
        </svg>
        <span>Add manually</span>
    `;
    manualEntryButton.addEventListener('click', showManualEntryModal);
    searchResults.appendChild(manualEntryButton);
}

// Fetch TV show episodes from TMDB API
async function fetchTVEpisodes(tmdbId) {
    const apiKey = getTmdbApiKey();
    if (!apiKey || !tmdbId) return null;

    try {
        // First, get the TV show details to find out how many seasons there are
        const tvResponse = await fetch(`${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${apiKey}`);
        if (!tvResponse.ok) return null;

        const tvData = await tvResponse.json();
        const seasons = tvData.seasons || [];

        // Filter out "Season 0" (specials) and get season numbers
        const seasonNumbers = seasons
            .filter(s => s.season_number > 0)
            .map(s => s.season_number)
            .slice(0, 20); // TMDB allows max 20 append_to_response calls

        if (seasonNumbers.length === 0) return null;

        // Build append_to_response parameter for all seasons
        const appendSeasons = seasonNumbers.map(num => `season/${num}`).join(',');

        // Fetch all seasons in one call
        const detailsResponse = await fetch(
            `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${apiKey}&append_to_response=${appendSeasons}`
        );

        if (!detailsResponse.ok) return null;

        const detailsData = await detailsResponse.json();

        // Extract season data
        const seasonsData = [];
        seasonNumbers.forEach(num => {
            const seasonKey = `season/${num}`;
            if (detailsData[seasonKey]) {
                seasonsData.push(detailsData[seasonKey]);
            }
        });

        return seasonsData;
    } catch (error) {
        console.error('Failed to fetch TV episodes:', error);
        return null;
    }
}

// Show screen detail modal
function showScreenDetail(screen, source = 'list', editMode = false) {
    currentDetailScreen = screen;
    currentDetailSource = source;

    const modal = document.getElementById('screenDetailModal');
    const content = document.getElementById('screenDetailContent');

    // Determine if this screen is already in the list
    const existingScreen = state.screens.find(s => s.id === screen.id || (s.tmdbId === screen.tmdbId && s.type === screen.type));
    const isInList = !!existingScreen;
    const displayScreen = existingScreen || screen;

    const posterUrl = displayScreen.cachedPoster || displayScreen.posterUrl || '';
    const typeLabel = displayScreen.type === 'movie' ? 'Movie' : (displayScreen.type === 'tv' ? 'TV Show' : 'Unknown');
    const rating = getRatingFromTags(displayScreen.tags || []);
    const listStatus = getScreenListStatus(displayScreen);

    // Tags section (shown for all tracked screens)
    let tagsSection = '';
    if (isInList) {
        const allTags = displayScreen.tags || [];
        const displayTags = allTags.filter(tag => !tag.match(/^\d{2}_stars$/));
        const tagPills = displayTags.map(tag => `<span class="tag-pill">${tag}<button class="tag-remove" data-tag="${tag}">×</button></span>`).join('');

        tagsSection = `
            <div class="detail-tags">
                <label>Tags</label>
                <div class="tags-container">
                    ${tagPills}
                    <div class="tag-input-wrapper">
                        <input type="text" class="tag-input" placeholder="Add tag..." id="newTagInput">
                    </div>
                </div>
            </div>
        `;
    }

    // Rating section (only for watched screens)
    let ratingSection = '';
    if (isInList && listStatus === 'watched') {
        const currentRating = getRatingFromTags(displayScreen.tags || []);
        const ratingDisplay = currentRating ? `⭐ ${currentRating}/10` : '⭐ ?/10';
        ratingSection = `
            <div class="detail-rating">
                <label>Rating</label>
                <div class="rating-display-wrapper" data-screen-id="${displayScreen.id}">
                    <div class="rating-display">${ratingDisplay}</div>
                    <input type="number"
                           class="rating-input"
                           min="1"
                           max="10"
                           step="1"
                           style="display: none;"
                           placeholder="1-10">
                </div>
            </div>
        `;
    }

    // Edit mode HTML
    if (editMode) {
        content.innerHTML = `
            <div class="detail-cover-container">
                <img src="${posterUrl}" class="detail-cover" alt="${displayScreen.title}">
                <input type="text" class="edit-input" id="editPosterUrl" value="${displayScreen.posterUrl || ''}" placeholder="Poster URL">
            </div>
            <div class="detail-info">
                <input type="text" class="edit-input edit-title" id="editTitle" value="${displayScreen.title}" placeholder="Title">
                <select class="edit-input" id="editType">
                    <option value="movie" ${displayScreen.type === 'movie' ? 'selected' : ''}>Movie</option>
                    <option value="tv" ${displayScreen.type === 'tv' ? 'selected' : ''}>TV Show</option>
                </select>
                <input type="text" class="edit-input" id="editYear" value="${displayScreen.year || ''}" placeholder="Year" style="width: 100px;">
                <label>Overview:</label>
                <textarea class="edit-textarea" id="editOverview" placeholder="Overview">${displayScreen.overview || ''}</textarea>
                ${tagsSection}
                ${ratingSection}
                <div class="detail-actions" style="margin-top: 16px;">
                    <button class="btn btn-small" id="saveEdit">Save</button>
                    <button class="btn btn-small" id="cancelEdit">Cancel</button>
                </div>
            </div>
        `;

        // Add event handlers for Save and Cancel buttons
        const saveBtn = document.getElementById('saveEdit');
        const cancelBtn = document.getElementById('cancelEdit');

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const updates = {
                    title: document.getElementById('editTitle').value.trim() || displayScreen.title,
                    type: document.getElementById('editType').value,
                    year: document.getElementById('editYear').value.trim() || displayScreen.year,
                    posterUrl: document.getElementById('editPosterUrl').value.trim() || displayScreen.posterUrl,
                    overview: document.getElementById('editOverview').value.trim() || displayScreen.overview
                };

                // Update the screen metadata
                updateScreenMetadata(displayScreen.id, updates);

                // If poster URL changed, update cached poster
                if (updates.posterUrl !== displayScreen.posterUrl) {
                    const updatedScreen = state.screens.find(s => s.id === displayScreen.id);
                    if (updatedScreen) {
                        await cacheScreenPoster(updatedScreen);
                        saveToLocalStorage();
                    }
                }

                // Refresh the modal with updated data
                const updatedScreen = state.screens.find(s => s.id === displayScreen.id);
                if (updatedScreen) {
                    showScreenDetail(updatedScreen, source, false);
                }
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                showScreenDetail(displayScreen, source, false);
            });
        }
    } else {
        // Normal view HTML
        content.innerHTML = `
        <div class="detail-header-layout">
            <div class="detail-cover-wrapper">
                ${posterUrl ? `<img src="${posterUrl}" class="detail-cover" alt="${screen.title}">` : '<div class="detail-cover"></div>'}
            </div>
            <div class="detail-metadata">
                <div class="detail-title">${screen.title}</div>
                <div class="detail-meta">${typeLabel}${screen.year ? ` • ${screen.year}` : ''}</div>
                ${screen.tmdbId ? `<div class="detail-tmdb-id">TMDB ID: ${screen.tmdbId}</div>` : ''}
            </div>
        </div>

        <div class="action-group-pill">
            ${isInList ? `
                <div class="list-pill-selector">
                    <button class="pill-segment ${listStatus === 'to_watch' ? 'active' : ''}" data-status="to_watch">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <span>To Watch</span>
                    </button>
                    ${displayScreen.type === 'tv' ? `
                    <button class="pill-segment ${listStatus === 'watching' ? 'active' : ''}" data-status="watching">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                        <span>Watching</span>
                    </button>
                    ` : ''}
                    <button class="pill-segment ${listStatus === 'watched' ? 'active' : ''}" data-status="watched">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span>Watched</span>
                    </button>
                </div>
                <button class="btn-edit-circle" id="editScreen" title="Edit">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="btn-delete-circle" id="deleteScreen" title="Delete">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            ` : `
                <button class="btn-add-screen" id="addScreen">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <rect x="3" y="3" width="18" height="18" rx="4" ry="4"></rect>
                        <line x1="12" y1="8" x2="12" y2="16"></line>
                        <line x1="8" y1="12" x2="16" y2="12"></line>
                    </svg>
                    <span>Add</span>
                </button>
            `}
        </div>

        ${isInList ? `
            <div class="detail-tags">
                <label>Tags</label>
                <div class="tags-container">
                    ${(existingScreen.tags || []).filter(t => !t.match(/^\d{2}_stars$/)).map(tag => `
                        <span class="tag-pill">
                            ${tag}
                            <button class="tag-remove" data-tag="${tag}">×</button>
                        </span>
                    `).join('')}
                    <div class="tag-input-wrapper">
                        <input type="text" class="tag-input" placeholder="Add tag..." id="newTagInput">
                    </div>
                </div>
            </div>
        ` : ''}

        ${ratingSection}

        ${screen.overview ? `<div class="detail-description">${screen.overview}</div>` : ''}

        ${displayScreen.type === 'tv' && displayScreen.tmdbId ? `
            <div id="episodesList" class="episodes-section">
                <div class="episodes-loading">Loading episodes...</div>
            </div>
        ` : ''}
    `;
    }

    // Setup event listeners for detail modal
    setupDetailModalListeners(existingScreen || screen);

    modal.classList.add('active');

    // Fetch and display episodes for TV shows
    if (displayScreen.type === 'tv' && displayScreen.tmdbId && !editMode) {
        fetchAndDisplayEpisodes(displayScreen.tmdbId, displayScreen.id);
    }
}

// Fetch and display episodes for a TV show
async function fetchAndDisplayEpisodes(tmdbId, screenId) {
    const episodesContainer = document.getElementById('episodesList');
    if (!episodesContainer) return;

    const seasonsData = await fetchTVEpisodes(tmdbId);

    if (!seasonsData || seasonsData.length === 0) {
        episodesContainer.innerHTML = '<div class="episodes-empty">No episode data available</div>';
        return;
    }

    // Get the screen to access lastWatchedEpisode
    const screen = state.screens.find(s => s.id === screenId);
    const lastWatchedEpisode = screen ? screen.lastWatchedEpisode : null;

    // Build episodes HTML grouped by season
    let episodesHTML = '<div class="episodes-header">Episodes</div>';

    seasonsData.forEach(season => {
        const episodes = season.episodes || [];
        if (episodes.length === 0) return;

        episodesHTML += `
            <div class="season-group">
                <button class="season-header expanded" data-season="${season.season_number}">
                    <span class="season-title">Season ${season.season_number}</span>
                    <span class="season-count">${episodes.length} episode${episodes.length !== 1 ? 's' : ''}</span>
                    <svg class="season-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
                <div class="episodes-list" data-season="${season.season_number}" style="display: block;">
                    ${episodes.map(ep => {
                        const watched = isEpisodeWatched(season.season_number, ep.episode_number, lastWatchedEpisode);
                        return `
                        <div class="episode-item ${watched ? 'watched' : ''}">
                            <div class="episode-number">${ep.episode_number}</div>
                            <div class="episode-info">
                                <div class="episode-title">${ep.name || 'Untitled'}</div>
                                <div class="episode-meta">${ep.air_date || 'No date'}</div>
                                ${ep.overview ? `<div class="episode-overview">${ep.overview}</div>` : ''}
                            </div>
                            <button class="episode-watch-btn ${watched ? 'watched' : ''}"
                                    data-screen-id="${screenId}"
                                    data-season="${season.season_number}"
                                    data-episode="${ep.episode_number}"
                                    title="Mark as last watched">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            </button>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    });

    episodesContainer.innerHTML = episodesHTML;

    // Add click handlers for season headers (accordion)
    episodesContainer.querySelectorAll('.season-header').forEach(header => {
        header.addEventListener('click', () => {
            const seasonNum = header.dataset.season;
            const episodesList = episodesContainer.querySelector(`.episodes-list[data-season="${seasonNum}"]`);
            const chevron = header.querySelector('.season-chevron');

            if (episodesList) {
                const isVisible = episodesList.style.display !== 'none';
                episodesList.style.display = isVisible ? 'none' : 'block';
                header.classList.toggle('expanded', !isVisible);
            }
        });
    });

    // Add click handlers for episode watch buttons
    episodesContainer.querySelectorAll('.episode-watch-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const screenId = btn.dataset.screenId;
            const season = parseInt(btn.dataset.season);
            const episode = parseInt(btn.dataset.episode);
            updateLastWatchedEpisode(screenId, season, episode);
        });
    });
}

// Setup event listeners for detail modal
function setupDetailModalListeners(screen) {
    const content = document.getElementById('screenDetailContent');
    const existingScreen = state.screens.find(s => s.id === screen.id);
    const isInList = !!existingScreen;
    const displayScreen = existingScreen || screen;

    // Add to list button (for search results)
    const addBtn = document.getElementById('addScreen');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            // Set default status to "to_watch"
            screen.tags = screen.tags || [];
            setListTimestamps(screen, 'to_watch');

            // Generate unique ID if not present
            if (!screen.id) {
                screen.id = `${screen.type}_${screen.tmdbId || Date.now()}`;
            }

            // Cache poster if available
            await cacheScreenPoster(screen);

            state.screens.push(screen);
            saveToLocalStorage();
            renderScreens();

            // Refresh detail view to show new options
            showScreenDetail(screen, 'list');
        });
    }

    // Edit button
    const editBtn = document.getElementById('editScreen');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            showScreenDetail(screen, currentDetailSource, true);
        });
    }

    // Delete button
    const deleteBtn = document.getElementById('deleteScreen');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (confirm(`Remove "${screen.title}" from your list?`)) {
                const index = state.screens.findIndex(s => s.id === screen.id);
                if (index > -1) {
                    state.screens.splice(index, 1);
                    saveToLocalStorage();
                    renderScreens();
                    closeScreenDetail();
                }
            }
        });
    }

    // List status pill selector
    const pillSegments = document.querySelectorAll('.pill-segment');
    pillSegments.forEach(segment => {
        segment.addEventListener('click', () => {
            const status = segment.dataset.status;

            if (existingScreen) {
                setListTimestamps(existingScreen, status);
                saveToLocalStorage();
                renderScreens();

                // Update UI
                pillSegments.forEach(s => s.classList.remove('active'));
                segment.classList.add('active');
            }
        });
    });

    // Rating input (tap-to-edit)
    const ratingWrapper = content.querySelector('.rating-display-wrapper');
    if (ratingWrapper) {
        const ratingDisplay = ratingWrapper.querySelector('.rating-display');
        const ratingInput = ratingWrapper.querySelector('.rating-input');
        const screenId = ratingWrapper.dataset.screenId;

        // Click on display to edit
        ratingDisplay.addEventListener('click', () => {
            const currentRating = getRatingFromTags(displayScreen.tags || []);
            ratingInput.value = currentRating || '';
            ratingDisplay.style.display = 'none';
            ratingInput.style.display = 'block';
            ratingInput.focus();
            ratingInput.select();
        });

        // Save rating function
        const saveRating = () => {
            const rating = parseInt(ratingInput.value);
            if (ratingInput.value === '' || (rating >= 1 && rating <= 10)) {
                // Update the screen rating (empty value clears the rating)
                updateScreenRating(screenId, ratingInput.value === '' ? null : rating);

                // Update display
                const newRating = ratingInput.value === '' ? null : rating;
                const newDisplay = newRating ? `⭐ ${newRating}/10` : '⭐ ?/10';
                ratingDisplay.textContent = newDisplay;

                // Update displayScreen for consistency
                const screenToUpdate = state.screens.find(s => s.id === screenId);
                if (screenToUpdate) {
                    displayScreen.tags = screenToUpdate.tags;
                }
            }

            // Switch back to display mode
            ratingInput.style.display = 'none';
            ratingDisplay.style.display = 'block';
        };

        // Save on blur
        ratingInput.addEventListener('blur', saveRating);

        // Save on Enter key
        ratingInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                ratingInput.blur(); // Trigger blur event which saves
            } else if (e.key === 'Escape') {
                // Cancel editing
                ratingInput.style.display = 'none';
                ratingDisplay.style.display = 'block';
            }
        });
    }

    // Tag management
    const tagRemoveButtons = document.querySelectorAll('.tag-remove');
    tagRemoveButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const tag = btn.dataset.tag;

            if (existingScreen) {
                existingScreen.tags = existingScreen.tags.filter(t => t !== tag);
                saveToLocalStorage();
                renderScreens();
                showScreenDetail(existingScreen, 'list');
            }
        });
    });

    const newTagInput = document.getElementById('newTagInput');
    if (newTagInput) {
        newTagInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const tag = newTagInput.value.trim().toLowerCase().replace(/\s+/g, '_');

                if (tag && existingScreen) {
                    if (!existingScreen.tags) existingScreen.tags = [];
                    if (!existingScreen.tags.includes(tag)) {
                        existingScreen.tags.push(tag);
                        saveToLocalStorage();
                        renderScreens();
                        showScreenDetail(existingScreen, 'list');
                    }
                }
            }
        });
    }
}

// Close screen detail modal
function closeScreenDetail() {
    document.getElementById('screenDetailModal').classList.remove('active');
    currentDetailScreen = null;
    currentDetailSource = null;
}

// Show manual entry modal
function showManualEntryModal() {
    const title = prompt('Enter title:');
    if (!title) return;

    const type = confirm('Is this a movie? (Cancel for TV show)') ? 'movie' : 'tv';
    const year = prompt('Enter year (optional):') || '';

    const screen = {
        id: `manual_${Date.now()}`,
        type: type,
        title: title,
        year: year,
        tags: [],
        posterUrl: null,
        overview: ''
    };

    showScreenDetail(screen, 'search');
}

// Render screens list
function renderScreens() {
    const screenList = document.getElementById('screenList');
    if (!screenList) return;

    // Apply filters
    let filteredScreens = state.screens;

    // Filter by tags
    if (state.filterTags.length > 0) {
        filteredScreens = filteredScreens.filter(screen => {
            return state.filterTags.every(filterTag => {
                // Check list status tags
                if (['to_watch', 'watching', 'watched'].includes(filterTag)) {
                    return getScreenListStatus(screen) === filterTag;
                }
                // Check manual tags
                return screen.tags && screen.tags.includes(filterTag);
            });
        });
    }

    // Filter by search query
    if (state.searchQuery) {
        filteredScreens = filteredScreens.filter(screen => {
            const searchStr = `${screen.title} ${screen.year}`.toLowerCase();
            return searchStr.includes(state.searchQuery);
        });
    }

    // Sort screens
    filteredScreens.sort((a, b) => {
        let compare = 0;

        switch (state.sortBy) {
            case 'title':
                compare = (a.title || '').localeCompare(b.title || '');
                break;
            case 'year':
                compare = (a.year || '') - (b.year || '');
                break;
            case 'rating':
                const ratingA = getRatingFromTags(a.tags) || 0;
                const ratingB = getRatingFromTags(b.tags) || 0;
                compare = ratingB - ratingA;
                break;
            case 'dateAdded':
            default:
                compare = (b.addedAt || '').localeCompare(a.addedAt || '');
                break;
        }

        return state.sortOrder === 'asc' ? compare : -compare;
    });

    // Render tag filters
    renderTagFilters();

    // Render screens
    if (filteredScreens.length === 0) {
        screenList.innerHTML = '';
        screenList.classList.add('empty');
        return;
    }

    screenList.classList.remove('empty');
    screenList.innerHTML = filteredScreens.map(screen => {
        const posterUrl = screen.cachedPoster || screen.posterUrl || '';
        const typeLabel = screen.type === 'movie' ? 'Movie' : (screen.type === 'tv' ? 'TV Show' : 'Unknown');
        const rating = getRatingFromTags(screen.tags || []);
        const listStatus = getScreenListStatus(screen);
        const statusLabels = {
            to_watch: 'To Watch',
            watching: 'Watching',
            watched: 'Watched'
        };

        return `
            <div class="screen-card" data-screen-id="${screen.id}">
                ${posterUrl ? `<img src="${posterUrl}" class="screen-cover" alt="${screen.title}">` : '<div class="screen-cover"></div>'}
                <div class="screen-card-content">
                    <div class="screen-card-header">
                        <div class="screen-title">${screen.title}</div>
                        <div class="screen-meta">${typeLabel}${screen.year ? ` • ${screen.year}` : ''}</div>
                        ${listStatus ? `<div class="screen-status">${statusLabels[listStatus]}</div>` : ''}
                        ${rating ? `<div class="screen-rating">⭐ ${rating}/10</div>` : ''}
                        ${screen.tags && screen.tags.filter(t => !t.match(/^\d{2}_stars$/)).length > 0 ? `
                            <div class="screen-tags">
                                ${screen.tags.filter(t => !t.match(/^\d{2}_stars$/)).map(tag => `<span class="tag-badge">${tag}</span>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers
    screenList.querySelectorAll('.screen-card').forEach(card => {
        card.addEventListener('click', () => {
            const screenId = card.dataset.screenId;
            const screen = state.screens.find(s => s.id === screenId);
            if (screen) {
                showScreenDetail(screen, 'list');
            }
        });
    });
}

// Render tag filters
function renderTagFilters() {
    const tagFiltersContainer = document.getElementById('tagFilters');
    if (!tagFiltersContainer) return;

    // Get all unique tags
    const uniqueTags = getAllUniqueTags();

    // Build filters HTML
    const filters = [];

    // List status filters
    filters.push(`
        <button class="tag-filter ${state.filterTags.includes('to_watch') ? 'active' : ''}" data-tag="to_watch">To Watch</button>
        <button class="tag-filter ${state.filterTags.includes('watching') ? 'active' : ''}" data-tag="watching">Watching</button>
        <button class="tag-filter ${state.filterTags.includes('watched') ? 'active' : ''}" data-tag="watched">Watched</button>
    `);

    // Manual tags
    if (uniqueTags.length > 0) {
        filters.push('<span class="tag-separator">|</span>');
        uniqueTags.forEach(tag => {
            filters.push(`<button class="tag-filter manual-tag ${state.filterTags.includes(tag) ? 'active' : ''}" data-tag="${tag}">${tag}</button>`);
        });
    }

    tagFiltersContainer.innerHTML = filters.join('');
}

// Storage functions
function saveToLocalStorage() {
    try {
        localStorage.setItem('screenTracker_screens', JSON.stringify(state.screens));
        console.log('Saved to localStorage:', state.screens.length, 'screens');

        // Automatically sync to GitHub Gist (silent push)
        syncWithGitHub(false);
    } catch (e) {
        console.error('Failed to save to localStorage:', e);
    }
}

function loadFromLocalStorage() {
    try {
        const stored = localStorage.getItem('screenTracker_screens');
        if (stored) {
            state.screens = JSON.parse(stored);
            console.log('Loaded from localStorage:', state.screens.length, 'screens');
        }
    } catch (e) {
        console.error('Failed to load from localStorage:', e);
    }
}

function saveSettingsToStorage() {
    try {
        localStorage.setItem('screenTracker_settings', JSON.stringify(state.settings));
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

function loadSettingsFromStorage() {
    try {
        const stored = localStorage.getItem('screenTracker_settings');
        if (stored) {
            state.settings = JSON.parse(stored);

            // Populate settings inputs
            if (tmdbApiKeyInput) tmdbApiKeyInput.value = state.settings.tmdbApiKey || '';
            if (gistIdInput) gistIdInput.value = state.settings.gistId || '';
            if (apiTokenInput) apiTokenInput.value = state.settings.apiToken || '';
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

function saveSortPreference() {
    try {
        localStorage.setItem('screenTracker_sort', JSON.stringify({
            sortBy: state.sortBy,
            sortOrder: state.sortOrder
        }));
    } catch (e) {
        console.error('Failed to save sort preference:', e);
    }
}

function loadSortPreference() {
    try {
        const stored = localStorage.getItem('screenTracker_sort');
        if (stored) {
            const { sortBy, sortOrder } = JSON.parse(stored);
            state.sortBy = sortBy || 'dateAdded';
            state.sortOrder = sortOrder || 'desc';

            // Update UI
            const sortBySelect = document.getElementById('sortBy');
            const sortOrderBtn = document.getElementById('sortOrder');
            if (sortBySelect) sortBySelect.value = state.sortBy;
            if (sortOrderBtn) sortOrderBtn.textContent = state.sortOrder === 'asc' ? '↑' : '↓';
        }
    } catch (e) {
        console.error('Failed to load sort preference:', e);
    }
}

// Settings functions
function saveTmdbSettings() {
    state.settings.tmdbApiKey = tmdbApiKeyInput.value.trim();

    saveSettingsToStorage();

    showTmdbStatus('API key saved successfully', 'success');
}

function saveSettings() {
    state.settings.gistId = gistIdInput.value.trim();
    state.settings.apiToken = apiTokenInput.value.trim();

    saveSettingsToStorage();

    showSyncStatus('Settings saved successfully', 'success');
}

function showTmdbStatus(message, type = 'info') {
    tmdbStatus.innerHTML = `
        <div class="status-message-text">${message}</div>
        <button class="status-dismiss-btn" onclick="this.parentElement.innerHTML = ''">×</button>
    `;
    tmdbStatus.className = `sync-status sync-${type}`;
}

function showSyncStatus(message, type = 'info') {
    syncStatus.innerHTML = `
        <div class="status-message-text">${message}</div>
        <button class="status-dismiss-btn" onclick="this.parentElement.innerHTML = ''">×</button>
    `;
    syncStatus.className = `sync-status sync-${type}`;
}

function showMaintenanceStatus(message, type = 'info') {
    maintenanceStatus.innerHTML = `
        <div class="status-message-text">${message}</div>
        <button class="status-dismiss-btn" onclick="this.parentElement.innerHTML = ''">×</button>
    `;
    maintenanceStatus.className = `sync-status sync-${type}`;
}

// GitHub Gist sync
// Helper function to get the most recent timestamp from a screen
function getLatestTimestamp(screen) {
    const timestamps = [screen.addedAt, screen.startedAt, screen.finishedAt].filter(t => t);
    if (timestamps.length === 0) return null;
    return new Date(Math.max(...timestamps.map(t => new Date(t).getTime())));
}

// Merge local and remote screens (2-way sync)
function mergeScreens(localScreens, remoteScreens) {
    const merged = new Map();

    // Add all local screens to map
    localScreens.forEach(screen => {
        merged.set(screen.id, screen);
    });

    // Merge with remote screens
    remoteScreens.forEach(remoteScreen => {
        const localScreen = merged.get(remoteScreen.id);

        if (!localScreen) {
            // Screen only exists remotely - add it
            merged.set(remoteScreen.id, remoteScreen);
        } else {
            // Screen exists in both - pick the one with most recent timestamp
            const localLatest = getLatestTimestamp(localScreen);
            const remoteLatest = getLatestTimestamp(remoteScreen);

            if (remoteLatest && (!localLatest || remoteLatest > localLatest)) {
                // Remote is newer - use it
                merged.set(remoteScreen.id, remoteScreen);
            }
            // Otherwise keep local (already in map)
        }
    });

    return Array.from(merged.values());
}

async function syncWithGitHub(showFeedback = true) {
    if (!state.settings.apiToken) {
        if (showFeedback) {
            showSyncStatus('Please configure GitHub token first', 'error');
        }
        return;
    }

    if (state.isSyncing) {
        if (showFeedback) {
            showSyncStatus('Sync already in progress', 'info');
        }
        return;
    }

    state.isSyncing = true;
    if (showFeedback) showSyncStatus('Syncing...', 'info');

    try {
        let remoteScreens = [];

        // Step 1: Pull from GitHub Gist (if gist exists)
        if (state.settings.gistId) {
            const fetchResponse = await fetch(`https://api.github.com/gists/${state.settings.gistId}`, {
                headers: {
                    'Authorization': `token ${state.settings.apiToken}`,
                    'Accept': 'application/vnd.github+json'
                }
            });

            if (fetchResponse.ok) {
                const gistData = await fetchResponse.json();
                const tsvContent = gistData.files['screens.tsv']?.content;

                if (tsvContent) {
                    remoteScreens = tsvToScreens(tsvContent);
                    console.log('Pulled from Gist:', remoteScreens.length, 'screens');
                }
            } else if (fetchResponse.status === 404) {
                console.log('Gist not found, will create new one');
                state.settings.gistId = '';
            } else {
                throw new Error(`GitHub API error: ${fetchResponse.status}`);
            }
        }

        // Step 2: Merge local and remote screens
        const mergedScreens = mergeScreens(state.screens, remoteScreens);
        console.log('Merged:', mergedScreens.length, 'screens (local:', state.screens.length, ', remote:', remoteScreens.length, ')');

        // Step 3: Update local state with merged data
        state.screens = mergedScreens;
        localStorage.setItem('screenTracker_screens', JSON.stringify(state.screens));
        renderScreens();

        // Step 4: Push merged data to GitHub Gist
        const tsvData = screensToTSV(mergedScreens);

        const gistData = {
            description: 'Screen Tracker Data',
            public: false,
            files: {
                'screens.tsv': {
                    content: tsvData
                }
            }
        };

        let response;
        if (state.settings.gistId) {
            // Update existing gist
            response = await fetch(`https://api.github.com/gists/${state.settings.gistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `token ${state.settings.apiToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gistData)
            });
        } else {
            // Create new gist
            response = await fetch('https://api.github.com/gists', {
                method: 'POST',
                headers: {
                    'Authorization': `token ${state.settings.apiToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gistData)
            });
        }

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const result = await response.json();

        // Save gist ID if it was just created
        if (!state.settings.gistId) {
            state.settings.gistId = result.id;
            gistIdInput.value = result.id;
            saveSettingsToStorage();
        }

        state.lastSyncTime = Date.now();
        if (showFeedback) showSyncStatus('Synced successfully', 'success');
    } catch (error) {
        console.error('Sync error:', error);
        if (showFeedback) showSyncStatus('Sync failed: ' + error.message, 'error');
    } finally {
        state.isSyncing = false;
    }
}

// Convert screens to TSV format
function screensToTSV(screens) {
    const header = 'addedAt\tfinishedAt\ttmdbID\tlastWatchedEpisode\ttags\ttype\ttitle\tyear\tposterURL\tdescription';
    const rows = screens.map(screen => {
        // Map 'tv' to 'show' for TSV export
        const tsvType = screen.type === 'tv' ? 'show' : screen.type;
        return [
            screen.addedAt || '',
            screen.finishedAt || '',
            screen.tmdbId || '',
            screen.lastWatchedEpisode || '',
            (screen.tags || []).join(','),
            tsvType || '',
            screen.title || '',
            screen.year || '',
            screen.posterUrl || '',
            screen.overview || ''
        ].join('\t');
    });

    return header + '\n' + rows.join('\n');
}

// Convert TSV to screens
function tsvToScreens(tsv) {
    const lines = tsv.split('\n');
    if (lines.length < 2) return [];

    const screens = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split('\t');
        if (parts.length < 10) continue;

        // Map 'show' back to 'tv' for internal representation
        const internalType = parts[5] === 'show' ? 'tv' : parts[5];

        const screen = {
            addedAt: parts[0],
            finishedAt: parts[1],
            tmdbId: parts[2],
            lastWatchedEpisode: parts[3] || null,
            tags: parts[4] ? parts[4].split(',').filter(t => t) : [],
            type: internalType,
            title: parts[6],
            year: parts[7],
            posterUrl: parts[8],
            overview: parts[9]
        };

        // Generate ID
        screen.id = screen.tmdbId ? `${screen.type}_${screen.tmdbId}` : `manual_${Date.now()}_${i}`;

        screens.push(screen);
    }

    return screens;
}

// Maintenance functions
function clearLocalCache() {
    if (confirm('This will clear all local data. Are you sure?')) {
        localStorage.removeItem('screenTracker_screens');
        localStorage.removeItem('screenTracker_settings');
        localStorage.removeItem('screenTracker_sort');
        state.screens = [];
        state.filterTags = [];
        state.searchQuery = '';
        renderScreens();
        showMaintenanceStatus('Cache cleared successfully', 'success');
    }
}

function updatePWA() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(reg => {
            if (reg) {
                reg.update().then(() => {
                    showMaintenanceStatus('Checking for updates...', 'info');
                    // Force reload after a short delay
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
                });
            }
        });
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
