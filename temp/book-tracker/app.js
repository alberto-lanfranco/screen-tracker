// App version (semantic versioning)
const APP_VERSION = '3.6.1';
console.log('Book Tracker app.js loaded, version:', APP_VERSION);

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

// Helper functions for determining book list status from timestamps
function getBookListStatus(book) {
    if (book.finishedAt) return 'read';
    if (book.startedAt) return 'reading';
    if (book.addedAt) return 'to_read';
    return null;
}

// Helper to get all unique tags from all books
function getAllUniqueTags() {
    const tags = new Set();
    state.books.forEach(book => {
        if (book.tags) {
            book.tags.forEach(tag => {
                // Exclude rating tags
                if (!tag.match(/^\d{2}_stars$/)) {
                    tags.add(tag);
                }
            });
        }
    });
    return Array.from(tags).sort();
}

// Ensure timestamp integrity when setting list status
function setListTimestamps(book, listStatus) {
    const now = new Date().toISOString();
    
    if (listStatus === 'to_read') {
        book.addedAt = now;
        book.startedAt = null;
        book.finishedAt = null;
    } else if (listStatus === 'reading') {
        book.startedAt = now;
        book.finishedAt = null;
        
        // Integrity check: ensure addedAt is present and before startedAt
        if (!book.addedAt || book.addedAt > book.startedAt) {
            book.addedAt = book.startedAt;
        }
    } else if (listStatus === 'read') {
        book.finishedAt = now;
        
        // Integrity check: ensure startedAt is present and before finishedAt
        if (!book.startedAt || book.startedAt > book.finishedAt) {
            book.startedAt = book.finishedAt;
        }
        
        // Integrity check: ensure addedAt is present and before startedAt
        if (!book.addedAt || book.addedAt > book.startedAt) {
            book.addedAt = book.startedAt;
        }
    }
    
    return book;
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

// Cache book cover image for offline use
async function cacheBookCover(book) {
    if (!book.coverUrl) return book;

    // Skip if already cached (has a cachedCover or coverUrl is already a data URI)
    if (book.cachedCover || book.coverUrl.startsWith('data:')) return book;

    const dataUri = await convertImageToDataUri(book.coverUrl);
    if (dataUri) {
        book.cachedCover = dataUri;
        console.log(`Cached cover for: ${book.title}`);
    }

    return book;
}

// Migrate existing books to cache their covers
async function migrateExistingCovers() {
    console.log('Starting cover migration...');
    let cachedCount = 0;
    let failedCount = 0;

    for (const book of state.books) {
        // Only cache if there's a coverUrl and no cached version yet
        if (book.coverUrl && !book.cachedCover && !book.coverUrl.startsWith('data:')) {
            try {
                await cacheBookCover(book);
                cachedCount++;
                // Save periodically to avoid losing progress
                if (cachedCount % 10 === 0) {
                    saveToLocalStorage();
                }
            } catch (error) {
                console.error(`Failed to cache cover for ${book.title}:`, error);
                failedCount++;
            }
        }
    }

    // Final save
    if (cachedCount > 0) {
        saveToLocalStorage();
        console.log(`Cover migration complete: ${cachedCount} cached, ${failedCount} failed`);
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
    books: [], // Single array of books with tags
    filterTags: [], // Tags to filter by in Books view
    searchQuery: '', // Search query for saved books
    sortBy: 'dateAdded', // dateAdded, title, author, year, rating
    sortOrder: 'desc', // asc or desc
    settings: {
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
let gistIdInput;
let apiTokenInput;
let saveSettingsBtn;
let syncNowBtn;
let syncStatus;
let clearCacheBtn;
let updatePWABtn;
let maintenanceStatus;

// Current book being viewed in detail modal
let currentDetailBook = null;
let currentDetailSource = 'list';

// Initialize app
function init() {
    console.log('Initializing app...');
    
    // Get DOM elements after DOM is loaded
    searchInput = document.getElementById('searchInput');
    searchResults = document.getElementById('searchResults');
    navItems = document.querySelectorAll('.nav-item');
    views = document.querySelectorAll('.view');
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
    
    // Render books view
    renderBooks();

    // Migrate existing book covers to cached data URIs for offline use
    // Run this async without blocking the UI
    setTimeout(() => {
        migrateExistingCovers();
    }, 1000);

    // Show books view by default
    switchView('booksView');
    
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
    document.getElementById('closeModal').addEventListener('click', closeBookDetail);
    document.getElementById('bookDetailModal').addEventListener('click', (e) => {
        if (e.target.id === 'bookDetailModal') {
            closeBookDetail();
        }
    });

    // Settings handlers
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
    
    // Search saved books (Books view)
    const bookSearchInput = document.getElementById('bookSearch');
    if (bookSearchInput) {
        const clearBookSearchBtn = document.getElementById('clearBookSearch');
        let bookSearchTimeout;
        
        bookSearchInput.addEventListener('input', () => {
            clearTimeout(bookSearchTimeout);
            
            // Toggle clear button visibility
            if (clearBookSearchBtn) {
                clearBookSearchBtn.classList.toggle('visible', bookSearchInput.value.length > 0);
            }
            
            bookSearchTimeout = setTimeout(() => {
                state.searchQuery = bookSearchInput.value.trim().toLowerCase();
                renderBooks();
            }, 300);
        });
        
        // Clear book search button
        if (clearBookSearchBtn) {
            clearBookSearchBtn.addEventListener('click', () => {
                bookSearchInput.value = '';
                state.searchQuery = '';
                renderBooks();
                clearBookSearchBtn.classList.remove('visible');
                bookSearchInput.focus();
            });
        }
    }

    // Tag filter buttons (Books view) - delegated event handling
    const tagFiltersContainer = document.getElementById('tagFilters');
    if (tagFiltersContainer) {
        tagFiltersContainer.addEventListener('click', (e) => {
            const button = e.target.closest('.tag-filter');
            if (!button) return;
            
            const filterTag = button.dataset.tag;
            const isListTag = ['to_read', 'reading', 'read'].includes(filterTag);
            
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
                        if (['to_read', 'reading', 'read'].includes(btnTag)) {
                            btn.classList.remove('active');
                        }
                    });
                    // Remove other list tags from filterTags
                    state.filterTags = state.filterTags.filter(t => !['to_read', 'reading', 'read'].includes(t));
                } else {
                    // Deselect other manual tags
                    tagFiltersContainer.querySelectorAll('.tag-filter.manual-tag').forEach(btn => {
                        btn.classList.remove('active');
                    });
                    // Remove other manual tags from filterTags
                    const listTags = ['to_read', 'reading', 'read'];
                    state.filterTags = state.filterTags.filter(t => listTags.includes(t));
                }
                button.classList.add('active');
                state.filterTags.push(filterTag);
            }
            
            renderBooks();
        });
    }
    
    // Sort handlers
    const sortBySelect = document.getElementById('sortBy');
    const sortOrderBtn = document.getElementById('sortOrder');
    
    if (sortBySelect) {
        sortBySelect.addEventListener('change', (e) => {
            state.sortBy = e.target.value;
            saveSortPreference();
            renderBooks();
        });
    }
    
    if (sortOrderBtn) {
        sortOrderBtn.addEventListener('click', () => {
            state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
            sortOrderBtn.textContent = state.sortOrder === 'asc' ? '↑' : '↓';
            saveSortPreference();
            renderBooks();
        });
    }
    
    // Detail modal button handler (delegated)
    const bookDetailContent = document.getElementById('bookDetailContent');
    if (bookDetailContent) {
        bookDetailContent.addEventListener('click', (e) => {
            // Handle Add Book Initial
            const addButton = e.target.closest('button[data-action="add-book-initial"]');
            if (addButton) {
                if (!currentDetailBook) return;
                
                // Add to 'to_read' by default
                addBookToList(currentDetailBook, 'to_read', true);
                
                // Re-render the modal to show the pill selector
                // Find the book in state to ensure we have the latest data (ID, timestamps)
                const addedBook = state.books.find(b => 
                    b.isbn === currentDetailBook.isbn || 
                    (currentDetailBook.id && b.id === currentDetailBook.id)
                );
                
                if (addedBook) {
                    showBookDetail(addedBook, 'search');
                }
                return;
            }

            const button = e.target.closest('button[data-action="add-to-list"]');
            if (!button) return;
            
            const listTag = button.dataset.tag;
            
            if (!currentDetailBook) return;
            
            // Check if book exists in database
            const existingBook = state.books.find(b => 
                b.id === currentDetailBook.id || 
                (currentDetailBook.isbn && (b.id === currentDetailBook.isbn || b.isbn === currentDetailBook.isbn))
            );
            
            if (existingBook) {
                // Book exists, change list status
                changeBookListStatus(existingBook.id, listTag);
                
                // Re-render modal to show/hide rating section based on new status
                const updatedBook = state.books.find(b => b.id === existingBook.id);
                if (updatedBook) {
                    showBookDetail(updatedBook, currentDetailSource);
                }
            } else {
                // New book, add to list (keepSearchOpen = true to prevent clearing search)
                addBookToList(currentDetailBook, listTag, true);
                
                // Re-render modal to show/hide rating section based on new status
                const addedBook = state.books.find(b => 
                    b.isbn === currentDetailBook.isbn || 
                    (currentDetailBook.id && b.id === currentDetailBook.id)
                );
                if (addedBook) {
                    showBookDetail(addedBook, currentDetailSource);
                }
            }
        });
    }
}

// Search books via Google Books API
async function handleSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    searchResults.innerHTML = '<div class="loading">Searching...</div>';

    try {
        const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=20&printType=books&orderBy=relevance`);
        
        // Check for rate limit or quota errors
        if (response.status === 429) {
            searchResults.innerHTML = '<div class="error-message">Rate limit exceeded. Please try again in a few minutes.</div>';
            return;
        }
        
        if (response.status === 403) {
            searchResults.innerHTML = '<div class="error-message">API quota exceeded. Daily limit reached. Please try again tomorrow.</div>';
            return;
        }
        
        if (!response.ok) {
            searchResults.innerHTML = `<div class="error-message">Search failed (Error ${response.status}). Please try again.</div>`;
            return;
        }
        
        const data = await response.json();

        if (data.items && data.items.length > 0) {
            displaySearchResults(data.items);
        } else {
            searchResults.innerHTML = '<div class="loading">No books found</div>';
            // Add manual entry button for no results
            const manualEntryButton = document.createElement('button');
            manualEntryButton.className = 'btn-manual-entry';
            manualEntryButton.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <path d="M12 5v14M5 12h14"></path>
                </svg>
                <span>Add book manually</span>
            `;
            manualEntryButton.addEventListener('click', showManualEntryModal);
            searchResults.appendChild(manualEntryButton);
        }
    } catch (error) {
        console.error('Search error:', error);
        searchResults.innerHTML = '<div class="error-message">Network error. Please check your connection and try again.</div>';
    }
}

// Helper function to get highest resolution cover image
function getBestCoverUrl(imageLinks) {
    if (!imageLinks) return null;
    // Priority: extraLarge > large > medium > small > thumbnail > smallThumbnail
    return imageLinks.extraLarge || 
           imageLinks.large || 
           imageLinks.medium || 
           imageLinks.small || 
           imageLinks.thumbnail || 
           imageLinks.smallThumbnail || 
           null;
}

// Display search results
function displaySearchResults(books) {
    searchResults.innerHTML = '';

    books.forEach(item => {
        const book = item.volumeInfo;
        const bookData = {
            id: item.id,
            title: book.title,
            author: book.authors ? book.authors.join(', ') : 'Unknown Author',
            year: book.publishedDate ? book.publishedDate.substring(0, 4) : 'N/A',
            coverUrl: getBestCoverUrl(book.imageLinks),
            isbn: book.industryIdentifiers ? book.industryIdentifiers[0]?.identifier : null,
            description: book.description || null,
            tags: [],
            addedAt: new Date().toISOString()
        };

        const resultItem = createSearchResultItem(bookData);
        searchResults.appendChild(resultItem);
    });
    
    // Add manual entry button at the bottom
    const manualEntryButton = document.createElement('button');
    manualEntryButton.className = 'btn-manual-entry';
    manualEntryButton.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 5v14M5 12h14"></path>
        </svg>
        <span>Can't find your book? Add manually</span>
    `;
    manualEntryButton.addEventListener('click', showManualEntryModal);
    searchResults.appendChild(manualEntryButton);
}

// Create search result item
function createSearchResultItem(book) {
    const div = document.createElement('div');
    div.className = 'search-result-item';

    // Prefer cached cover for offline use, fallback to URL
    const coverUrl = book.cachedCover
        ? book.cachedCover
        : (book.coverUrl
            ? book.coverUrl.replace('http://', 'https://')
            : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI5MCIgdmlld0JveD0iMCAwIDYwIDkwIj48cmVjdCB3aWR0aD0iNjAiIGhlaWdodD0iOTAiIGZpbGw9IiMyYzJjMmUiLz48cmVjdCB4PSIxNSIgeT0iMjAiIHdpZHRoPSIzMCIgaGVpZ2h0PSI0MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjM2MzY2IiBzdHJva2Utd2lkdGg9IjIiIHJ4PSIyIi8+PGxpbmUgeDE9IjIwIiB5MT0iMzAiIHgyPSI0MCIgeTI9IjMwIiBzdHJva2U9IiM2MzYzNjYiIHN0cm9rZS13aWR0aD0iMS41Ii8+PGxpbmUgeDE9IjIwIiB5MT0iMzgiIHgyPSI0MCIgeTI9IjM4IiBzdHJva2U9IiM2MzYzNjYiIHN0cm9rZS13aWR0aD0iMS41Ii8+PGxpbmUgeDE9IjIwIiB5MT0iNDYiIHgyPSIzNSIgeTI9IjQ2IiBzdHJva2U9IiM2MzYzNjYiIHN0cm9rZS13aWR0aD0iMS41Ii8+PC9zdmc+');

    // Check if book exists in database (match by Google Books ID or ISBN)
    const existingBook = state.books.find(b => 
        b.id === book.id || 
        (book.isbn && (b.id === book.isbn || b.isbn === book.isbn))
    );
    const currentListTag = existingBook ? getBookListStatus(existingBook) : null;

    div.innerHTML = `
        <img src="${coverUrl}" alt="${book.title}" class="book-cover" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI5MCIgdmlld0JveD0iMCAwIDYwIDkwIj48cmVjdCB3aWR0aD0iNjAiIGhlaWdodD0iOTAiIGZpbGw9IiMyYzJjMmUiLz48cmVjdCB4PSIxNSIgeT0iMjAiIHdpZHRoPSIzMCIgaGVpZ2h0PSI0MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjM2MzY2IiBzdHJva2Utd2lkdGg9IjIiIHJ4PSIyIi8+PGxpbmUgeDE9IjIwIiB5MT0iMzAiIHgyPSI0MCIgeTI9IjMwIiBzdHJva2U9IiM2MzYzNjYiIHN0cm9rZS13aWR0aD0iMS41Ii8+PGxpbmUgeDE9IjIwIiB5MT0iMzgiIHgyPSI0MCIgeTI9IjM4IiBzdHJva2U9IiM2MzYzNjYiIHN0cm9rZS13aWR0aD0iMS41Ii8+PGxpbmUgeDE9IjIwIiB5MT0iNDYiIHgyPSIzNSIgeTI9IjQ2IiBzdHJva2U9IiM2MzYzNjYiIHN0cm9rZS13aWR0aD0iMS41Ii8+PC9zdmc+'">
        <div class="book-info">
            <div class="book-title">${book.title}</div>
            <div class="book-author">${book.author}</div>
            <div class="book-year">${book.year}</div>
        </div>
    `;

    // Add click handler to open detail view
    div.addEventListener('click', () => {
        showBookDetail(book, 'search');
    });

    return div;
}



// Add book to list
// Add book with specific list tag (to_read, reading, read)
async function addBookToList(book, listTag, keepSearchOpen = false) {
    // Check if book has ISBN (required for cloud sync)
    if (!book.isbn) {
        showToast('⚠️ Book has no ISBN - won\'t sync to cloud');
        // Still add to local list, but warn user
    }

    // Check if book already exists
    if (state.books.some(b => b.id === book.id)) {
        showToast('Book already in your collection');
        return;
    }

    // Initialize tags array (for rating and custom tags only)
    book.tags = book.tags || [];

    // Set timestamps based on list status
    setListTimestamps(book, listTag);

    // Cache the book cover for offline use
    await cacheBookCover(book);

    state.books.push(book);
    saveToLocalStorage();
    renderBooks();

    // Clear search and show success (unless keepSearchOpen is true)
    if (!keepSearchOpen) {
        searchResults.innerHTML = '';
        searchInput.value = '';
    }
    if (book.isbn) {
        showToast('Book added!');
    }
}

// Simple toast notification
function showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: max(20px, env(safe-area-inset-top, 20px));
        left: 50%;
        transform: translateX(-50%);
        background: rgba(44, 44, 46, 0.95);
        backdrop-filter: blur(20px);
        color: white;
        padding: 12px 24px;
        border-radius: 20px;
        font-size: 15px;
        font-weight: 500;
        z-index: 10000;
        pointer-events: none;
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Remove book completely
function removeBook(bookId) {
    const book = state.books.find(b => b.id === bookId);
    if (!book) return;
    
    // Show confirmation dialog
    const confirmDelete = confirm(`Delete "${book.title}"?\n\nThis action cannot be undone.`);
    if (!confirmDelete) return;
    
    state.books = state.books.filter(book => book.id !== bookId);
    saveToLocalStorage();
    renderBooks();
}

// Move book to different list
// Change book list status by updating timestamps
function changeBookListStatus(bookId, newListTag) {
    const book = state.books.find(b => b.id === bookId);
    if (book) {
        // Set timestamps based on new list status
        setListTimestamps(book, newListTag);
        saveToLocalStorage();
        renderBooks();
        showToast('Book status updated!');
    }
}

// Update book rating (stored as tag)
function updateBookRating(bookId, rating) {
    const book = state.books.find(b => b.id === bookId);
    if (book) {
        // Ensure tags array exists
        if (!book.tags) book.tags = [];
        // Set rating tag (removes old rating tag, adds new one)
        book.tags = setRatingTag(book.tags, rating);
        saveToLocalStorage();
        renderBooks();
    }
}

// Add tag to book
function addTagToBook(bookId, tag) {
    const book = state.books.find(b => b.id === bookId);
    if (book) {
        if (!book.tags) book.tags = [];
        if (!book.tags.includes(tag)) {
            book.tags.push(tag);
            saveToLocalStorage();
            renderBooks();
        }
    }
}

// Remove tag from book
function removeTagFromBook(bookId, tag) {
    const book = state.books.find(b => b.id === bookId);
    if (book && book.tags) {
        book.tags = book.tags.filter(t => t !== tag);
        saveToLocalStorage();
        renderBooks();
    }
}

// Switch view
function switchView(viewId) {
    // Update navigation
    navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewId);
    });

    // Update views
    views.forEach(view => {
        view.classList.toggle('active', view.id === viewId);
    });

    // If switching to books view, render books
    if (viewId === 'booksView') {
        renderBooks();
    }

    // Scroll to top of new view
    window.scrollTo(0, 0);
}

// Sort books based on current sort settings
function sortBooks(books) {
    const sorted = [...books];
    
    sorted.sort((a, b) => {
        let aVal, bVal;
        
        switch(state.sortBy) {
            case 'title':
                aVal = a.title.toLowerCase();
                bVal = b.title.toLowerCase();
                break;
            case 'author':
                aVal = a.author.toLowerCase();
                bVal = b.author.toLowerCase();
                break;
            case 'year':
                aVal = a.year === 'N/A' ? '0' : a.year;
                bVal = b.year === 'N/A' ? '0' : b.year;
                break;
            case 'rating':
                aVal = getRatingFromTags(a.tags) || 0;
                bVal = getRatingFromTags(b.tags) || 0;
                break;
            case 'startedAt':
                aVal = a.startedAt || '';
                bVal = b.startedAt || '';
                break;
            case 'finishedAt':
                aVal = a.finishedAt || '';
                bVal = b.finishedAt || '';
                break;
            case 'dateAdded':
            default:
                aVal = a.addedAt || '';
                bVal = b.addedAt || '';
                break;
        }
        
        if (aVal < bVal) return state.sortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return state.sortOrder === 'asc' ? 1 : -1;
        return 0;
    });
    
    return sorted;
}

// Update sort options based on active list filter
function updateSortOptions() {
    const sortBySelect = document.getElementById('sortBy');
    if (!sortBySelect) return;
    
    // Determine active list filter
    const activeListFilter = state.filterTags.find(tag => ['to_read', 'reading', 'read'].includes(tag));
    
    // Get current options
    const currentValue = sortBySelect.value;
    
    // Build options based on active filter
    let optionsHTML = `
        <option value="dateAdded">Date Added</option>
        <option value="title">Title</option>
        <option value="author">Author</option>
        <option value="year">Year</option>
        <option value="rating">Rating</option>
    `;
    
    // Add "Started At" for reading and read lists
    if (activeListFilter === 'reading' || activeListFilter === 'read') {
        optionsHTML += `<option value="startedAt">Started At</option>`;
    }
    
    // Add "Finished At" for read list only
    if (activeListFilter === 'read') {
        optionsHTML += `<option value="finishedAt">Finished At</option>`;
    }
    
    sortBySelect.innerHTML = optionsHTML;
    
    // Restore previous value if it's still available, otherwise reset to dateAdded
    const availableValues = Array.from(sortBySelect.options).map(opt => opt.value);
    if (availableValues.includes(currentValue)) {
        sortBySelect.value = currentValue;
        state.sortBy = currentValue;
    } else {
        sortBySelect.value = 'dateAdded';
        state.sortBy = 'dateAdded';
    }
}

// Render tag filters
function renderTagFilters() {
    const tagFiltersContainer = document.getElementById('tagFilters');
    if (!tagFiltersContainer) return;
    
    // Get all unique manual tags (excluding rating tags)
    const sortedManualTags = getAllUniqueTags();
    
    // Build HTML
    let html = '';
    
    // List status filters (always shown first)
    html += `<button class="tag-filter ${state.filterTags.includes('to_read') ? 'active' : ''}" data-tag="to_read">To Read</button>`;
    html += `<button class="tag-filter ${state.filterTags.includes('reading') ? 'active' : ''}" data-tag="reading">Reading</button>`;
    html += `<button class="tag-filter ${state.filterTags.includes('read') ? 'active' : ''}" data-tag="read">Read</button>`;
    
    // Separator and manual tags
    if (sortedManualTags.length > 0) {
        html += `<span class="tag-separator">|</span>`;
        sortedManualTags.forEach(tag => {
            html += `<button class="tag-filter manual-tag ${state.filterTags.includes(tag) ? 'active' : ''}" data-tag="${tag}">${tag}</button>`;
        });
    }
    
    tagFiltersContainer.innerHTML = html;
}

// Render specific list
// Render books view with filtering
function renderBooks() {
    const bookListElement = document.getElementById('bookList');
    if (!bookListElement) return; // Not on books view
    
    // Render tag filters
    renderTagFilters();
    
    // Update sort dropdown options based on active filter
    updateSortOptions();
    
    // Apply filters
    let filteredBooks = state.books;
    
    // Filter by selected tags (must match ALL selected tags)
    if (state.filterTags.length > 0) {
        filteredBooks = filteredBooks.filter(book => {
            return state.filterTags.every(tag => {
                // Handle list status tags differently (based on timestamps)
                if (tag === 'to_read' || tag === 'reading' || tag === 'read') {
                    return getBookListStatus(book) === tag;
                }
                // Handle regular tags
                return book.tags && book.tags.includes(tag);
            });
        });
    }
    
    // Filter by search query
    if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase();
        filteredBooks = filteredBooks.filter(book =>
            book.title.toLowerCase().includes(query) ||
            book.author.toLowerCase().includes(query) ||
            (book.tags && book.tags.some(tag => tag.toLowerCase().includes(query)))
        );
    }
    
    if (filteredBooks.length === 0) {
        bookListElement.innerHTML = '<div class="empty-state">No books found</div>';
        return;
    }
    
    bookListElement.innerHTML = '';
    
    // Sort books before rendering
    const sortedBooks = sortBooks(filteredBooks);
    
    sortedBooks.forEach(book => {
        const bookCard = createBookCard(book);
        bookListElement.appendChild(bookCard);
    });
}

// Create book card
function createBookCard(book) {
    const div = document.createElement('div');
    div.className = 'book-card';
    div.style.cursor = 'pointer';

    // Prefer cached cover for offline use, fallback to URL
    const coverUrl = book.cachedCover
        ? book.cachedCover
        : (book.coverUrl
            ? book.coverUrl.replace('http://', 'https://')
            : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSIxMjAiIHZpZXdCb3g9IjAgMCA4MCAxMjAiPjxyZWN0IHdpZHRoPSI4MCIgaGVpZ2h0PSIxMjAiIGZpbGw9IiMyYzJjMmUiLz48cmVjdCB4PSIyMCIgeT0iMzAiIHdpZHRoPSI0MCIgaGVpZ2h0PSI1NSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjM2MzY2IiBzdHJva2Utd2lkdGg9IjIuNSIgcng9IjMiLz48bGluZSB4MT0iMjgiIHkxPSI0NSIgeDI9IjUyIiB5Mj0iNDUiIHN0cm9rZT0iIzYzNjM2NiIgc3Ryb2tlLXdpZHRoPSIyIi8+PGxpbmUgeDE9IjI4IiB5MT0iNTUiIHgyPSI1MiIgeTI9IjU1IiBzdHJva2U9IiM2MzYzNjYiIHN0cm9rZS13aWR0aD0iMiIvPjxsaW5lIHgxPSIyOCIgeTE9IjY1IiB4Mj0iNDUiIHkyPSI2NSIgc3Ryb2tlPSIjNjM2MzY2IiBzdHJva2Utd2lkdGg9IjIiLz48L3N2Zz4=');
    
    // Show rating if book has one (extract from tags)
    const rating = getRatingFromTags(book.tags);
    const ratingDisplay = rating 
        ? `<div class="book-rating">⭐ ${rating}/10</div>` 
        : '';
    
    // Show tags (filter out rating tags from display)
    const displayTags = book.tags ? book.tags.filter(t => 
        !t.match(/^\d{2}_stars$/)
    ) : [];
    const tags = displayTags.length > 0 
        ? `<div class="book-tags">${displayTags.map(tag => `<span class="tag-badge">${tag}</span>`).join('')}</div>` 
        : '';
    
    // Get current list status from timestamps
    const currentListTag = getBookListStatus(book) || 'to_read';

    div.innerHTML = `
        <img src="${coverUrl}" alt="${book.title}" class="book-cover" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSIxMjAiIHZpZXdCb3g9IjAgMCA4MCAxMjAiPjxyZWN0IHdpZHRoPSI4MCIgaGVpZ2h0PSIxMjAiIGZpbGw9IiMyYzJjMmUiLz48cmVjdCB4PSIyMCIgeT0iMzAiIHdpZHRoPSI0MCIgaGVpZ2h0PSI1NSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjM2MzY2IiBzdHJva2Utd2lkdGg9IjIuNSIgcng9IjMiLz48bGluZSB4MT0iMjgiIHkxPSI0NSIgeDI9IjUyIiB5Mj0iNDUiIHN0cm9rZT0iIzYzNjM2NiIgc3Ryb2tlLXdpZHRoPSIyIi8+PGxpbmUgeDE9IjI4IiB5MT0iNTUiIHgyPSI1MiIgeTI9IjU1IiBzdHJva2U9IiM2MzYzNjYiIHN0cm9rZS13aWR0aD0iMiIvPjxsaW5lIHgxPSIyOCIgeTE9IjY1IiB4Mj0iNDUiIHkyPSI2NSIgc3Ryb2tlPSIjNjM2MzY2IiBzdHJva2Utd2lkdGg9IjIiLz48L3N2Zz4='">
        <div class="book-card-content">
            <div class="book-card-header">
                <div class="book-title">${book.title}</div>
                <div class="book-author">${book.author}</div>
                <div class="book-year">${book.year}</div>
                ${ratingDisplay}
                ${tags}
            </div>
        </div>
    `;

    // Add click handler to open detail view, except on buttons
    div.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
            showBookDetail(book, 'list');
        }
    });

    return div;
}

// Get list status buttons based on current tag
function getListStatusButtons(currentTag, bookId) {
    const buttons = [];
    const icons = {
        to_read: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
        reading: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>',
        read: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    };
    const labels = {
        to_read: 'To Read',
        reading: 'Reading',
        read: 'Read'
    };

    for (const [key, icon] of Object.entries(icons)) {
        const isActive = key === currentTag;
        const activeClass = isActive ? ' active' : '';
        const onclick = isActive ? '' : `onclick="changeBookListStatus('${bookId}', '${key}')"`;
        buttons.push(`<button class="btn btn-icon${activeClass}" ${onclick} title="${labels[key]}" ${isActive ? 'disabled' : ''}>${icon}</button>`);
    }

    return buttons.join('');
}

// Update book metadata
function updateBookMetadata(bookId, updates) {
    const bookIndex = state.books.findIndex(b => b.id === bookId);
    if (bookIndex !== -1) {
        const book = state.books[bookIndex];
        
        // If ID is being changed (due to ISBN change), check for duplicates
        if (updates.id && updates.id !== bookId) {
            const duplicate = state.books.find(b => b.id === updates.id);
            if (duplicate) {
                showToast('⚠️ Book with this ISBN already exists');
                return;
            }
        }
        
        Object.assign(book, updates);
        saveToLocalStorage();
        renderBooks();
    }
}

// Show manual entry modal
function showManualEntryModal() {
    const modal = document.getElementById('bookDetailModal');
    const content = document.getElementById('bookDetailContent');
    
    let selectedList = null; // Track selected list
    
    content.innerHTML = `
        <div class="detail-info" style="padding-top: 0;">
            <h2 style="margin-bottom: 24px;">Add Book Manually</h2>
            <label>Title</label>
            <input type="text" class="edit-input edit-title" id="manualTitle" placeholder="Enter book title">
            <label>Author</label>
            <input type="text" class="edit-input" id="manualAuthor" placeholder="Enter author name">
            <label>Year</label>
            <input type="text" class="edit-input" id="manualYear" placeholder="Publication year (e.g., 2020)" style="width: 150px;">
            <label>Description</label>
            <textarea class="edit-textarea" id="manualDescription" placeholder="Book description or notes"></textarea>
            <label>Cover URL</label>
            <input type="text" class="edit-input" id="manualCoverUrl" placeholder="Cover image URL (optional)">
            
            <label style="margin-top: 8px;">ISBN</label>
            <input type="text" class="edit-input" id="manualIsbn" placeholder="ISBN-10 or ISBN-13 (required)">
            
            <label style="margin-top: 16px;">Add to list:</label>
            <div class="detail-actions" style="margin-top: 12px; margin-bottom: 16px;">
                <div class="action-group" id="manualListButtons">
                    <button class="btn btn-icon" data-list="to_read" title="To Read">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                        </svg>
                        <span style="font-size: 13px; margin-left: 4px;">To Read</span>
                    </button>
                    <button class="btn btn-icon" data-list="reading" title="Reading">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                        </svg>
                        <span style="font-size: 13px; margin-left: 4px;">Reading</span>
                    </button>
                    <button class="btn btn-icon" data-list="read" title="Read">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span style="font-size: 13px; margin-left: 4px;">Read</span>
                    </button>
                </div>
            </div>
            
            <button class="btn btn-primary" id="saveManualBook" style="width: 100%; padding: 14px; font-size: 17px; font-weight: 600;">
                Save Book
            </button>
        </div>
    `;
    
    // Add event listeners for list selection buttons (toggle active state)
    const listButtons = content.querySelectorAll('button[data-list]');
    listButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all buttons
            listButtons.forEach(b => b.classList.remove('active'));
            // Add active class to clicked button
            btn.classList.add('active');
            // Store selected list
            selectedList = btn.dataset.list;
        });
    });
    
    // Pre-select "To Read" by default
    listButtons[0].classList.add('active');
    selectedList = 'to_read';
    
    // Add event listener for save button
    const saveButton = document.getElementById('saveManualBook');
    saveButton.addEventListener('click', async () => {
        const title = document.getElementById('manualTitle').value.trim();
        const author = document.getElementById('manualAuthor').value.trim();
        const isbn = document.getElementById('manualIsbn').value.trim();

        if (!title || !author) {
            showToast('⚠️ Title and Author are required');
            return;
        }

        if (!isbn) {
            showToast('⚠️ ISBN is required for syncing to cloud');
            return;
        }

        if (!selectedList) {
            showToast('⚠️ Please select a list');
            return;
        }

        const year = document.getElementById('manualYear').value.trim() || 'N/A';
        const description = document.getElementById('manualDescription').value.trim() || null;
        const coverUrl = document.getElementById('manualCoverUrl').value.trim() || null;

        // Create book object
        const manualBook = {
            id: isbn,
            title: title,
            author: author,
            year: year,
            isbn: isbn,
            description: description,
            coverUrl: coverUrl,
            tags: []
        };

        // Set timestamps based on selected list
        setListTimestamps(manualBook, selectedList);

        // Cache the book cover for offline use
        await cacheBookCover(manualBook);

        showToast('Book added!');

        // Add to state
        state.books.push(manualBook);
        saveToLocalStorage();
        renderBooks();
        
        // Close modal and clear search
        closeBookDetail();
        searchResults.innerHTML = '';
        searchInput.value = '';
    });
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Focus on title input
    setTimeout(() => {
        document.getElementById('manualTitle').focus();
    }, 100);
}

// Show book detail modal
function showBookDetail(book, source = 'list', editMode = false) {
    const modal = document.getElementById('bookDetailModal');
    const content = document.getElementById('bookDetailContent');
    
    // Check if book exists in database
    const existingBook = state.books.find(b => 
        b.id === book.id || 
        (book.isbn && (b.id === book.isbn || b.isbn === book.isbn))
    );

    // Determine if we are treating this as a library book
    const isLibraryBook = (source === 'list') || !!existingBook;
    
    // Use existingBook if available (source of truth), otherwise use the passed book
    const displayBook = existingBook || book;
    
    // Store current book for event handlers
    currentDetailBook = displayBook;
    currentDetailSource = source;

    // Prefer cached cover for offline use, fallback to URL
    const coverUrl = displayBook.cachedCover
        ? displayBook.cachedCover
        : (displayBook.coverUrl
            ? displayBook.coverUrl.replace('http://', 'https://')
            : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMjAwIDMwMCI+PHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIzMDAiIGZpbGw9IiMyYzJjMmUiLz48cmVjdCB4PSI1MCIgeT0iNzUiIHdpZHRoPSIxMDAiIGhlaWdodD0iMTQwIiBmaWxsPSJub25lIiBzdHJva2U9IiM2MzYzNjYiIHN0cm9rZS13aWR0aD0iMyIgcng9IjQiLz48bGluZSB4MT0iNjUiIHkxPSIxMTAiIHgyPSIxMzUiIHkyPSIxMTAiIHN0cm9rZT0iIzYzNjM2NiIgc3Ryb2tlLXdpZHRoPSIyLjUiLz48bGluZSB4MT0iNjUiIHkxPSIxMzUiIHgyPSIxMzUiIHkyPSIxMzUiIHN0cm9rZT0iIzYzNjM2NiIgc3Ryb2tlLXdpZHRoPSIyLjUiLz48bGluZSB4MT0iNjUiIHkxPSIxNjAiIHgyPSIxMjAiIHkyPSIxNjAiIHN0cm9rZT0iIzYzNjM2NiIgc3Ryb2tlLXdpZHRoPSIyLjUiLz48L3N2Zz4=');

    const description = displayBook.description || 'No description available.';
    const isbn = displayBook.isbn ? `<div class="detail-isbn"><strong>ISBN:</strong> ${displayBook.isbn}</div>` : '';

    // Edit button for books in lists (only shown in edit mode for save/cancel)
    let editButton = '';
    if (isLibraryBook && editMode) {
        editButton = `<button class="btn btn-small" data-action="save-edit" data-book-id="${displayBook.id}">Save</button>
               <button class="btn btn-small" data-action="cancel-edit" data-book-id="${displayBook.id}">Cancel</button>`;
    }

    // Show tags section for books in lists (filter out rating tags)
    let tagsSection = '';
    if (isLibraryBook) {
        const allTags = displayBook.tags || [];
        const displayTags = allTags.filter(tag => 
            !tag.match(/^\d{2}_stars$/)
        );
        const tagPills = displayTags.map(tag => `<span class="tag-pill">${tag}<button class="tag-remove" data-tag="${tag}">×</button></span>`).join('');
        
        tagsSection = `
            <div class="detail-tags">
                <label>Tags:</label>
                <div class="tags-container">
                    ${tagPills}
                </div>
                <div class="tag-input-wrapper">
                    <input type="text" class="tag-input" placeholder="Add tag..." data-book-id="${displayBook.id}">
                    <button class="btn btn-icon" id="toggleTagsBtn" title="Choose from existing tags">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                </div>
                <div class="tag-suggestions-panel" id="tagSuggestionsPanel"></div>
            </div>
        `;
    }

    // Show rating input for books with Read status (finishedAt is set)
    let ratingSection = '';
    const hasReadTag = displayBook.finishedAt;
    if (isLibraryBook && hasReadTag) {
        const currentRating = getRatingFromTags(displayBook.tags) || 0;
        let stars = '';
        for (let i = 1; i <= 10; i++) {
            const filled = i <= currentRating ? 'filled' : '';
            stars += `<span class="star ${filled}" data-rating="${i}">★</span>`;
        }
        ratingSection = `
            <div class="detail-rating">
                <label>Rating:</label>
                <div class="star-rating" data-book-id="${displayBook.id}">${stars}</div>
            </div>
        `;
    }

    // Show list action buttons
    let listActions = '';
    if (isLibraryBook) {
        const currentTag = getBookListStatus(displayBook) || 'to_read';
        
        listActions = `
            <div class="action-group-pill">
                <div class="list-pill-selector">
                    <button class="pill-segment ${currentTag === 'to_read' ? 'active' : ''}" data-action="add-to-list" data-tag="to_read" data-book-id="${displayBook.id}" title="To Read">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                        </svg>
                        <span>To Read</span>
                    </button>
                    <button class="pill-segment ${currentTag === 'reading' ? 'active' : ''}" data-action="add-to-list" data-tag="reading" data-book-id="${displayBook.id}" title="Reading">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                        </svg>
                        <span>Reading</span>
                    </button>
                    <button class="pill-segment ${currentTag === 'read' ? 'active' : ''}" data-action="add-to-list" data-tag="read" data-book-id="${displayBook.id}" title="Read">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span>Read</span>
                    </button>
                </div>
                <button class="btn-edit-circle" data-action="edit" data-book-id="${displayBook.id}" title="Edit">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="btn-delete-circle" data-action="delete" data-book-id="${displayBook.id}" title="Remove">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `;
    } else {
        listActions = `
            <button class="btn-add-book" data-action="add-book-initial" data-book-id="${displayBook.id}">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                    <rect x="3" y="3" width="18" height="18" rx="4" ry="4"></rect>
                    <line x1="12" y1="8" x2="12" y2="16"></line>
                    <line x1="8" y1="12" x2="16" y2="12"></line>
                </svg>
                <span>Add</span>
            </button>
        `;
    }

    // Render content based on edit mode
    if (editMode) {
        content.innerHTML = `
            <div class="detail-cover-container">
                <img src="${coverUrl}" alt="${book.title}" class="detail-cover" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMjAwIDMwMCI+PHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIzMDAiIGZpbGw9IiMyYzJjMmUiLz48cmVjdCB4PSI1MCIgeT0iNzUiIHdpZHRoPSIxMDAiIGhlaWdodD0iMTQwIiBmaWxsPSJub25lIiBzdHJva2U9IiM2MzYzNjYiIHN0cm9rZS13aWR0aD0iMyIgcng9IjQiLz48bGluZSB4MT0iNjUiIHkxPSIxMTAiIHgyPSIxMzUiIHkyPSIxMTAiIHN0cm9rZT0iIzYzNjM2NiIgc3Ryb2tlLXdpZHRoPSIyLjUiLz48bGluZSB4MT0iNjUiIHkxPSIxMzUiIHgyPSIxMzUiIHkyPSIxMzUiIHN0cm9rZT0iIzYzNjM2NiIgc3Ryb2tlLXdpZHRoPSIyLjUiLz48bGluZSB4MT0iNjUiIHkxPSIxNjAiIHgyPSIxMjAiIHkyPSIxNjAiIHN0cm9rZT0iIzYzNjM2NiIgc3Ryb2tlLXdpZHRoPSIyLjUiLz48L3N2Zz4='">
                <input type="text" class="edit-input" id="editCoverUrl" value="${book.coverUrl || ''}" placeholder="Cover URL">
            </div>
            <div class="detail-info">
                <input type="text" class="edit-input edit-title" id="editTitle" value="${book.title}" placeholder="Title">
                <input type="text" class="edit-input" id="editAuthor" value="${book.author}" placeholder="Author">
                <input type="text" class="edit-input" id="editYear" value="${book.year}" placeholder="Year" style="width: 100px;">
                <input type="text" class="edit-input" id="editIsbn" value="${book.isbn || ''}" placeholder="ISBN (required)" style="width: 200px;">
                <label>Description:</label>
                <textarea class="edit-textarea" id="editDescription" placeholder="Description">${book.description || ''}</textarea>
                ${tagsSection}
                ${ratingSection}
                <div class="detail-actions" style="margin-top: 16px;">
                    ${editButton}
                </div>
            </div>
        `;
    } else {
        content.innerHTML = `
            <div class="detail-header-layout">
                <div class="detail-cover-wrapper">
                    <img src="${coverUrl}" alt="${book.title}" class="detail-cover" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMjAwIDMwMCI+PHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIzMDAiIGZpbGw9IiMyYzJjMmUiLz48cmVjdCB4PSI1MCIgeT0iNzUiIHdpZHRoPSIxMDAiIGhlaWdodD0iMTQwIiBmaWxsPSJub25lIiBzdHJva2U9IiM2MzYzNjYiIHN0cm9rZS13aWR0aD0iMyIgcng9IjQiLz48bGluZSB4MT0iNjUiIHkxPSIxMTAiIHgyPSIxMzUiIHkyPSIxMTAiIHN0cm9rZT0iIzYzNjM2NiIgc3Ryb2tlLXdpZHRoPSIyLjUiLz48bGluZSB4MT0iNjUiIHkxPSIxMzUiIHgyPSIxMzUiIHkyPSIxMzUiIHN0cm9rZT0iIzYzNjM2NiIgc3Ryb2tlLXdpZHRoPSIyLjUiLz48bGluZSB4MT0iNjUiIHkxPSIxNjAiIHgyPSIxMjAiIHkyPSIxNjAiIHN0cm9rZT0iIzYzNjM2NiIgc3Ryb2tlLXdpZHRoPSIyLjUiLz48L3N2Zz4='">
                </div>
                <div class="detail-metadata">
                    <h2 class="detail-title">${book.title}</h2>
                    <div class="detail-author">${book.author}</div>
                    <div class="detail-year">${book.year}</div>
                    ${isbn}
                </div>
            </div>
            ${listActions}
            ${tagsSection}
            ${ratingSection}
            <div class="detail-description">${description}</div>
        `;
    }

    // Add event listeners for action buttons
    content.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (btn.dataset.action === 'delete') {
                // Delete button
                removeBook(book.id);
                
                // Check if book was removed (user might have cancelled)
                const stillExists = state.books.some(b => b.id === book.id);
                if (!stillExists) {
                    if (source === 'search') {
                        // Re-render modal to show "Add" button
                        showBookDetail(book, 'search');
                    } else {
                        closeBookDetail();
                    }
                }
            } else if (btn.dataset.action === 'edit') {
                // Edit button
                showBookDetail(book, source, true);
            } else if (btn.dataset.action === 'save-edit') {
                // Save edit button
                const newIsbn = document.getElementById('editIsbn').value.trim();
                
                // Validate ISBN is not empty
                if (!newIsbn) {
                    showToast('⚠️ ISBN is required');
                    return;
                }
                
                const updates = {
                    title: document.getElementById('editTitle').value.trim() || book.title,
                    author: document.getElementById('editAuthor').value.trim() || book.author,
                    year: document.getElementById('editYear').value.trim() || book.year,
                    description: document.getElementById('editDescription').value.trim() || null,
                    coverUrl: document.getElementById('editCoverUrl').value.trim() || null,
                    isbn: newIsbn
                };
                
                // If ISBN changed, update the book ID as well
                if (newIsbn !== book.isbn) {
                    updates.id = newIsbn;
                }
                
                updateBookMetadata(book.id, updates);
                // Refresh the modal with updated data (use new ID if changed)
                const updatedBook = state.books.find(b => b.id === (updates.id || book.id));
                if (updatedBook) {
                    showBookDetail(updatedBook, source, false);
                }
                showToast('Book updated!');
            } else if (btn.dataset.action === 'cancel-edit') {
                // Cancel edit button
                showBookDetail(book, source, false);
            }
            // Note: List status buttons are handled by event delegation in setupEventListeners()
        });
    });

    // Add event listener for star rating
    const starRating = content.querySelector('.star-rating');
    if (starRating) {
        starRating.querySelectorAll('.star').forEach(star => {
            star.addEventListener('click', (e) => {
                const rating = parseInt(e.target.dataset.rating);
                updateBookRating(book.id, rating);
                
                // Update star display
                starRating.querySelectorAll('.star').forEach(s => {
                    const starValue = parseInt(s.dataset.rating);
                    if (starValue <= rating) {
                        s.classList.add('filled');
                    } else {
                        s.classList.remove('filled');
                    }
                });
            });
        });
    }

    // Add event listeners for tags
    const tagInput = content.querySelector('.tag-input');
    if (tagInput) {
        tagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.value.trim()) {
                const tag = e.target.value.trim();
                addTagToBook(book.id, tag);
                e.target.value = '';
                
                // Re-render the book detail to show new tag
                setTimeout(() => showBookDetail(book, source), 100);
            }
        });
        
        // Remove tag event listeners
        content.querySelectorAll('.tag-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = btn.dataset.tag;
                removeTagFromBook(book.id, tag);
                
                // Re-render the book detail
                setTimeout(() => showBookDetail(book, source), 100);
            });
        });
        
        // Toggle tags panel event listener
        const toggleTagsBtn = content.querySelector('#toggleTagsBtn');
        const suggestionsPanel = content.querySelector('#tagSuggestionsPanel');
        
        if (toggleTagsBtn && suggestionsPanel) {
            toggleTagsBtn.addEventListener('click', () => {
                const isVisible = suggestionsPanel.classList.contains('visible');
                
                if (!isVisible) {
                    // Show panel
                    const existingTags = getAllUniqueTags();
                    // Filter out tags already on the book
                    const availableTags = existingTags.filter(t => !book.tags || !book.tags.includes(t));
                    
                    if (availableTags.length === 0) {
                        suggestionsPanel.innerHTML = '<span style="color: var(--text-tertiary); font-size: 13px;">No other existing tags</span>';
                    } else {
                        suggestionsPanel.innerHTML = availableTags.map(tag => 
                            `<span class="suggestion-chip" data-tag="${tag}">${tag}</span>`
                        ).join('');
                        
                        // Add click listeners to chips
                        suggestionsPanel.querySelectorAll('.suggestion-chip').forEach(chip => {
                            chip.addEventListener('click', () => {
                                addTagToBook(book.id, chip.dataset.tag);
                                // Re-render the book detail
                                setTimeout(() => showBookDetail(book, source), 100);
                            });
                        });
                    }
                    suggestionsPanel.classList.add('visible');
                    toggleTagsBtn.classList.add('active');
                } else {
                    // Hide panel
                    suggestionsPanel.classList.remove('visible');
                    toggleTagsBtn.classList.remove('active');
                }
            });
        }
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// Close book detail modal
function closeBookDetail() {
    const modal = document.getElementById('bookDetailModal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// ===== PASTEMYST SYNC FUNCTIONS =====

// Convert books to TSV format (denormalized: all fields stored)
// Column order: addedAt, startedAt, finishedAt, isbn, tags, title, author, year, coverUrl, description
function booksToTSV() {
    const lines = ['addedAt\tstartedAt\tfinishedAt\tisbn\ttags\ttitle\tauthor\tyear\tcoverUrl\tdescription'];
    
    state.books.forEach(book => {
        // Only sync books that have ISBN
        if (book.isbn) {
            const tags = book.tags && book.tags.length > 0 ? book.tags.join(',') : '';
            // Sanitize text fields: replace illegal characters
            const escapeField = (str) => {
                if (!str) return '';
                return String(str).replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, '').replace(/"/g, "'");
            };
            const row = [
                book.addedAt || '',
                book.startedAt || '',
                book.finishedAt || '',
                book.isbn || '',
                tags,
                escapeField(book.title),
                escapeField(book.author),
                book.year || '',
                book.coverUrl || '',
                escapeField(book.description)
            ];
            lines.push(row.join('\t'));
        }
    });
    
    return lines.join('\n');
}

// Parse TSV to books (use TSV data first, fallback to API if fields missing)
// Expected column order: addedAt, startedAt, finishedAt, isbn, tags, title, author, year, coverUrl, description
async function tsvToBooks(tsv) {
    const lines = tsv.trim().split('\n');
    if (lines.length < 1) return [];
    
    const books = [];
    
    // Parse header to detect columns
    const header = lines[0].split('\t');
    const columnMap = {};
    header.forEach((col, idx) => {
        columnMap[col.trim()] = idx;
    });
    
    // Expected column order (enforced)
    const expectedColumnOrder = ['addedAt', 'startedAt', 'finishedAt', 'isbn', 'tags', 'title', 'author', 'year', 'coverUrl', 'description'];
    
    // Check if columns are in wrong order
    const actualOrder = header.map(col => col.trim());
    const isWrongOrder = !expectedColumnOrder.every((col, idx) => actualOrder[idx] === col);
    
    // Check if we need to migrate from legacy tag-based system
    // MIGRATION: TODO - Remove in next major version (v4.0.0)
    // Legacy TSV format detected if startedAt/finishedAt columns are missing
    const needsMigration = !header.includes('startedAt') || !header.includes('finishedAt');
    
    // Track if any fields needed sanitization (double quotes replaced)
    let needsSanitization = false;
    
    // Skip header line and parse book data
    const fetchPromises = [];
    
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split('\t');
        if (cols.length < 1) continue;
        
        // Extract values from TSV (use column map for flexibility)
        const getValue = (colName) => {
            const idx = columnMap[colName];
            return idx !== undefined ? (cols[idx] || '').trim() : '';
        };
        
        // Sanitize text fields from TSV (replace double quotes with single quotes)
        const sanitizeField = (str) => {
            if (!str) return '';
            const sanitized = str.replace(/"/g, "'");
            if (sanitized !== str) needsSanitization = true;
            return sanitized;
        };
        
        const isbn = getValue('isbn');
        if (!isbn) continue; // Skip rows without ISBN
        
        const title = sanitizeField(getValue('title'));
        const author = sanitizeField(getValue('author'));
        const year = getValue('year');
        const description = sanitizeField(getValue('description'));
        const coverUrl = getValue('coverUrl');
        const tagsStr = getValue('tags');
        let addedAt = getValue('addedAt');
        let startedAt = getValue('startedAt');
        let finishedAt = getValue('finishedAt');
        
        let tags = tagsStr ? tagsStr.split(',').filter(t => t.trim()) : [];
        
        // MIGRATION: Convert legacy tag-based list status to timestamps
        // TODO - Remove in next major version (v4.0.0)
        if (needsMigration) {
            const listTag = tags.find(t => ['to_read', 'reading', 'read'].includes(t));
            if (listTag === 'to_read') {
                // No migration needed - addedAt is already set
                startedAt = '';
                finishedAt = '';
            } else if (listTag === 'reading') {
                // Use addedAt as startedAt since we don't know when it was started
                startedAt = addedAt;
                finishedAt = '';
            } else if (listTag === 'read') {
                // Copy addedAt to all three timestamps
                startedAt = addedAt;
                finishedAt = addedAt;
            }
            // Remove list status tags from tags array
            tags = tags.filter(t => !['to_read', 'reading', 'read'].includes(t));
        }
        
        // Perform timestamp integrity checks
        if (startedAt) {
            // Ensure addedAt is present and before startedAt
            if (!addedAt || addedAt > startedAt) {
                addedAt = startedAt;
            }
        }
        
        if (finishedAt) {
            // Ensure startedAt is present and before finishedAt
            if (!startedAt || startedAt > finishedAt) {
                startedAt = finishedAt;
            }
            // Ensure addedAt is present and before startedAt
            if (!addedAt || addedAt > startedAt) {
                addedAt = startedAt;
            }
        }
        
        // Check if we need to fetch data from API (any denormalized field missing)
        const needsAPIFetch = !title || !author || !year || !description || !coverUrl;
        
        if (!needsAPIFetch) {
            // All required data present in TSV - use it directly
            // Generate ID from ISBN if not available
            const book = {
                id: isbn, // Use ISBN as ID for consistency
                isbn: isbn,
                title: title || 'Unknown Title',
                author: author || 'Unknown Author',
                year: year || 'N/A',
                description: description || null,
                coverUrl: coverUrl || null,
                tags: tags,
                addedAt: addedAt || null,
                startedAt: startedAt || null,
                finishedAt: finishedAt || null
            };
            books.push(book);
        } else {
            // Fetch missing data from Google Books API
            fetchPromises.push(
                fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.items && data.items.length > 0) {
                            const item = data.items[0];
                            const volumeInfo = item.volumeInfo;
                            
                            // Use TSV values if present, otherwise use API values
                            const book = {
                                id: item.id || isbn,
                                isbn: isbn,
                                title: title || volumeInfo.title || 'Unknown Title',
                                author: author || volumeInfo.authors?.join(', ') || 'Unknown Author',
                                year: year || volumeInfo.publishedDate?.substring(0, 4) || 'N/A',
                                description: description || volumeInfo.description || null,
                                coverUrl: coverUrl || getBestCoverUrl(volumeInfo.imageLinks) || null,
                                tags: tags,
                                addedAt: addedAt || null,
                                startedAt: startedAt || null,
                                finishedAt: finishedAt || null
                            };
                            
                            books.push(book);
                            
                            // Mark that this book needs TSV update
                            book._needsUpdate = true;
                        } else {
                            // API returned no results - use TSV data as-is
                            const book = {
                                id: isbn,
                                isbn: isbn,
                                title: title || 'Unknown Title',
                                author: author || 'Unknown Author',
                                year: year || 'N/A',
                                description: description || null,
                                coverUrl: coverUrl || null,
                                tags: tags,
                                addedAt: addedAt || null,
                                startedAt: startedAt || null,
                                finishedAt: finishedAt || null
                            };
                            books.push(book);
                        }
                    })
                    .catch(err => {
                        console.error(`Failed to fetch book with ISBN ${isbn}:`, err);
                        // Use TSV data as fallback
                        const book = {
                            id: isbn,
                            isbn: isbn,
                            title: title || 'Unknown Title',
                            author: author || 'Unknown Author',
                            year: year || 'N/A',
                            description: description || null,
                            coverUrl: coverUrl || null,
                            tags: tags,
                            addedAt: addedAt || null,
                            startedAt: startedAt || null,
                            finishedAt: finishedAt || null
                        };
                        books.push(book);
                    })
            );
        }
    }
    
    // Wait for all API calls to complete
    await Promise.all(fetchPromises);
    
    // Check if any books need TSV update or if column order is wrong or needs migration or sanitization
    const needsUpdate = books.some(b => b._needsUpdate) || isWrongOrder || needsMigration || needsSanitization;
    books.forEach(b => delete b._needsUpdate);
    
    // Store flag to indicate TSV needs reordering/migration/sanitization
    if (isWrongOrder) {
        console.log('TSV columns in wrong order - will be fixed on next sync');
    }
    if (needsMigration) {
        console.log('Legacy tag-based system detected - migrating to timestamp-based system');
    }
    if (needsSanitization) {
        console.log('Double quotes detected in TSV - sanitizing and will push fixed version');
    }
    
    return { books, needsReorder: isWrongOrder || needsMigration || needsSanitization };
}

// Fetch paste from PasteMyst
async function fetchGist(gistId, token) {
    const headers = {
        'Accept': 'application/vnd.github+json'
    };
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }
    
    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers
    });
    
    if (!response.ok) {
        let errorMsg = 'Failed to fetch gist';
        if (response.status === 404) {
            errorMsg = 'Gist not found. Check your Gist ID in Settings.';
        } else if (response.status === 401) {
            errorMsg = 'Invalid GitHub token. Please check your token in Settings.';
        } else if (response.status === 403) {
            errorMsg = 'GitHub token lacks permission or rate limit exceeded.';
        } else {
            errorMsg = `Failed to fetch gist (${response.status}).`;
        }
        throw new Error(errorMsg);
    }
    
    return await response.json();
}

// Create new gist on GitHub
async function createGist(token) {
    const tsv = booksToTSV();
    
    const response = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            description: 'Book Tracker Database',
            public: false,
            files: {
                'books.tsv': {
                    content: tsv
                }
            }
        })
    });
    
    if (!response.ok) {
        let errorMsg = 'Failed to create gist';
        if (response.status === 401) {
            errorMsg = 'Invalid GitHub token. Please check your token in Settings.';
        } else if (response.status === 403) {
            errorMsg = 'GitHub token lacks permission. Generate a new token at github.com/settings/tokens with "gist" scope.';
        } else if (response.status === 422) {
            errorMsg = 'Invalid request. Please check your settings.';
        } else {
            errorMsg = `Failed to create gist (${response.status}). Check your GitHub token.`;
        }
        throw new Error(errorMsg);
    }
    
    return await response.json();
}

// Update existing gist on GitHub
async function updateGist(gistId, token) {
    const tsv = booksToTSV();
    
    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            files: {
                'books.tsv': {
                    content: tsv
                }
            }
        })
    });
    
    if (!response.ok) {
        let errorMsg = 'Failed to update gist';
        if (response.status === 401) {
            errorMsg = 'Invalid GitHub token. Please check your token in Settings.';
        } else if (response.status === 403) {
            errorMsg = 'GitHub token lacks permission or rate limit exceeded.';
        } else if (response.status === 404) {
            errorMsg = 'Gist not found. The Gist ID may be invalid. Try creating a new gist by clearing the Gist ID field.';
        } else if (response.status === 422) {
            errorMsg = 'Invalid request. Please check your settings.';
        } else {
            errorMsg = `Failed to update gist (${response.status}). Check your settings.`;
        }
        throw new Error(errorMsg);
    }
    
    return await response.json();
}

// Main sync function
async function syncWithGitHub(manualSync = false) {
    if (state.isSyncing) return;
    
    const token = state.settings.apiToken.trim();
    const gistId = state.settings.gistId.trim();
    
    if (!token) {
        if (manualSync) {
            showSyncStatus('Please configure GitHub token in settings', 'error');
        }
        return;
    }
    
    state.isSyncing = true;
    if (manualSync) showSyncStatus('Syncing...', 'info');
    
    try {
        if (!gistId) {
            // Create new gist
            const gist = await createGist(token);
            state.settings.gistId = gist.id;
            gistIdInput.value = gist.id;
            saveSettingsToStorage();
            showSyncStatus(`Synced! New gist created: ${gist.id}`, 'success');
        } else {
            // Fetch existing gist and sync
            const gist = await fetchGist(gistId, token);
            
            if (gist.files && gist.files['books.tsv']) {
                const tsv = gist.files['books.tsv'].content;
                const result = await tsvToBooks(tsv);
                
                // Remote is source of truth - overwrite local
                state.books = result.books;
                
                // Re-render books view
                renderBooks();
                
                // Save to localStorage as cache
                saveToLocalStorage();
                
                // If columns were in wrong order, push corrected TSV back to cloud
                if (result.needsReorder) {
                    console.log('Fixing TSV column order...');
                    await updateGist(gistId, token);
                    if (manualSync) {
                        showSyncStatus('Synced successfully! (column order fixed)', 'success');
                    }
                } else if (manualSync) {
                    showSyncStatus('Synced successfully!', 'success');
                }
            } else if (manualSync) {
                showSyncStatus('Synced successfully!', 'success');
            }
        }
        
        // Update last sync time on successful sync
        state.lastSyncTime = Date.now();
    } catch (error) {
        console.error('Sync error:', error);
        let errorMsg = error.message;
        if (error.message.includes('Failed to fetch')) {
            errorMsg = 'Network error. Check your internet connection.';
        }
        showSyncStatus(errorMsg, 'error');
    } finally {
        state.isSyncing = false;
    }
}

// Push local changes to GitHub
async function pushToGitHub() {
    const token = state.settings.apiToken.trim();
    const gistId = state.settings.gistId.trim();
    
    if (!token || !gistId) return;
    if (state.isSyncing) return;
    
    state.isSyncing = true;
    
    try {
        await updateGist(gistId, token);
    } catch (error) {
        console.error('Push error:', error);
    } finally {
        state.isSyncing = false;
    }
}

// Show sync status message
function showSyncStatus(message, type = 'info') {
    if (!syncStatus) {
        console.warn('syncStatus element not found');
        return;
    }
    
    syncStatus.innerHTML = `
        <span class="status-message-text">${message}</span>
        <button class="status-dismiss-btn" onclick="this.parentElement.style.display='none'">×</button>
    `;
    syncStatus.className = `sync-status sync-${type}`;
    syncStatus.style.display = 'flex';
}

// Save settings
function saveSettings() {
    state.settings.gistId = gistIdInput.value.trim();
    state.settings.apiToken = apiTokenInput.value.trim();
    saveSettingsToStorage();
    showSyncStatus('Settings saved!', 'success');
}

// Load settings from storage
function loadSettingsFromStorage() {
    const saved = localStorage.getItem('bookTrackerSettings');
    if (saved) {
        try {
            state.settings = JSON.parse(saved);
            gistIdInput.value = state.settings.gistId || '';
            apiTokenInput.value = state.settings.apiToken || '';
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }
}

// Save settings to storage
function saveSettingsToStorage() {
    localStorage.setItem('bookTrackerSettings', JSON.stringify(state.settings));
}

// Save sort preference
function saveSortPreference() {
    localStorage.setItem('bookTrackerSort', JSON.stringify({
        sortBy: state.sortBy,
        sortOrder: state.sortOrder
    }));
}

// Load sort preference
function loadSortPreference() {
    const saved = localStorage.getItem('bookTrackerSort');
    if (saved) {
        try {
            const sortPref = JSON.parse(saved);
            state.sortBy = sortPref.sortBy || 'dateAdded';
            state.sortOrder = sortPref.sortOrder || 'desc';
            
            // Update UI
            const sortBySelect = document.getElementById('sortBy');
            const sortOrderBtn = document.getElementById('sortOrder');
            if (sortBySelect) sortBySelect.value = state.sortBy;
            if (sortOrderBtn) sortOrderBtn.textContent = state.sortOrder === 'asc' ? '↑' : '↓';
        } catch (error) {
            console.error('Error loading sort preference:', error);
        }
    }
}

// ===== LOCAL STORAGE FUNCTIONS =====

// Local storage functions
function saveToLocalStorage() {
    localStorage.setItem('bookTrackerData', JSON.stringify(state.books));
    // Also push to PasteMyst if configured
    pushToGitHub();
}

function loadFromLocalStorage() {
    const saved = localStorage.getItem('bookTrackerData');
    if (saved) {
        try {
            state.books = JSON.parse(saved);
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }
}

// ===== MAINTENANCE FUNCTIONS =====

// Clear local cache
function clearLocalCache() {
    if (confirm('Are you sure you want to clear the local cache? This will remove all books from this device. Books synced to cloud will be restored on next sync.')) {
        localStorage.removeItem('bookTrackerData');
        state.books = [];
        renderBooks();
        showMaintenanceStatus('Local cache cleared. Sync to restore from cloud.', 'success');
    }
}



// Update PWA (manual check from settings)
function updatePWA() {
    if ('serviceWorker' in navigator) {
        showMaintenanceStatus('Checking for updates...', 'info');
        
        navigator.serviceWorker.getRegistration().then(registration => {
            if (registration) {
                registration.update().then(() => {
                    // Check if there's a waiting service worker
                    if (registration.waiting) {
                        showMaintenanceStatus('Update available! App will reload shortly.', 'success');
                    } else {
                        showMaintenanceStatus('App is up to date!', 'success');
                    }
                });
            } else {
                showMaintenanceStatus('No service worker registered.', 'error');
            }
        }).catch(err => {
            console.error('Update check failed:', err);
            showMaintenanceStatus('Failed to check for updates.', 'error');
        });
    } else {
        showMaintenanceStatus('Service workers not supported.', 'error');
    }
}

// Show maintenance status message
function showMaintenanceStatus(message, type = 'info') {
    if (!maintenanceStatus) {
        console.warn('maintenanceStatus element not found');
        return;
    }
    
    maintenanceStatus.innerHTML = `
        <span class="status-message-text">${message}</span>
        <button class="status-dismiss-btn" onclick="this.parentElement.style.display='none'">×</button>
    `;
    maintenanceStatus.className = `sync-status sync-${type}`;
    maintenanceStatus.style.display = 'flex';
}

// Start the app when DOM is ready
console.log('Document ready state:', document.readyState);
if (document.readyState === 'loading') {
    console.log('Waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', init);
} else {
    console.log('DOM already loaded, calling init()...');
    init();
}
