# Screen Tracker PWA - Developer Guide

## Overview
A Progressive Web App (PWA) for tracking movies and TV shows with an iOS-inspired minimal dark theme interface. Users can search for movies and TV shows, add them to a unified collection. Screens can be filtered by tags and searched within the collection.

## Tech Stack
- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **API**: The Movie Database (TMDB) API (free API key required)
- **Storage**: localStorage for persistence
- **PWA**: Service Worker for offline support
- **Design**: iOS inspired, mobile-first, dark theme

## Architecture

### File Structure
```
screen-tracker/
├── index.html          # Main HTML with bottom navigation
├── styles.css          # iOS-inspired styling
├── app.js              # Application logic and state management
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker for offline caching
├── agents.md           # This file - developer guide
└── temp/               # Reference materials (book-tracker)
```

### Core Components

#### 1. Views (Bottom Navigation)
- **Add View**: Search for new movies/TV shows and add to collection
- **Screens View**: View all screens with filtering and search capabilities
- **Settings View**: Configure GitHub Gist sync and maintenance options

#### 2. State Management
```javascript
state = {
    screens: [],               // Unified array of all movies/TV shows
    filterTags: [],           // Active filter tags for Screens view (includes list filters: to_watch, watching, watched)
    searchQuery: '',          // Search query for filtering screens
    sortBy: 'dateAdded',      // Sort field: dateAdded, title, year, rating
    sortOrder: 'desc',        // Sort order: asc, desc
    settings: {
        tmdbApiKey: '',       // User's TMDB API key (optional, falls back to demo key)
        gistId: '',
        apiToken: ''
    },
    lastSyncTime: null,       // Timestamp of last cloud sync
    isSyncing: false
}
```

#### 3. Screen Object Structure
```javascript
{
    id: string,                 // Format: "movie_12345" or "tv_67890" or "manual_timestamp"
    tmdbId: number,             // The Movie Database ID
    type: string,               // "movie" or "tv" (internal only, not in TSV)
    title: string,
    year: string,               // YYYY format
    posterUrl: string,          // TMDB poster URL (original source)
    cachedPoster: string,       // Base64 data URI of cached poster image for offline use
    overview: string,           // Plot description
    tags: string[],             // User-defined tags and rating (01_stars to 10_stars)
                                // Note: "movie"/"show" tags are NOT stored in this array internally
                                // They are added during TSV export and extracted during TSV import
    addedAt: string,            // ISO 8601 timestamp of when screen was added to collection
    finishedAt: string,         // ISO 8601 timestamp of when screen was marked as watched (null if not finished)
    lastWatchedEpisode: string, // Last watched episode for TV shows, format: "s02e06" (null for movies or unwatched shows)
    waitingForNewEpisodes: boolean  // True if watching TV show has caught up with available episodes or next episode is in future (calculated dynamically, not synced to cloud)
}
```

**Type Handling**:
- **Internal representation**: Uses `type` property with values "movie" or "tv"
- **TSV export**: Type is stored as first tag ("movie" or "show") in tags column, no separate type column
- **TSV import**: Type tag is extracted from tags and converted to internal `type` property ("show" → "tv", "movie" → "movie")
- **Reserved tags**: "movie" and "show" cannot be added/removed by users manually

**List Status Determination**: Screens are organized into lists based on properties:
- **To Watch**: `addedAt` is set, no `lastWatchedEpisode` and no `finishedAt`
- **Watching** (TV shows only): `lastWatchedEpisode` is set, `finishedAt` is null
- **Watched**: `finishedAt` is set

**Important**: Movies do not have a "Watching" status - only "To Watch" and "Watched"

## API Integration

### The Movie Database (TMDB) API

#### Configuration
```javascript
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// Get TMDB API key from user settings
function getTmdbApiKey() {
    return state.settings.tmdbApiKey || '';
}
```

**User Configuration**: Users MUST provide their own TMDB API key in the Settings tab under "TMDB API Configuration". The app will not function without an API key. Get a free API key from https://www.themoviedb.org/settings/api

**Settings Storage**: The TMDB API key is stored in `state.settings.tmdbApiKey` and persisted to localStorage under the key `screenTracker_settings`.

**API Key Validation**: If no API key is configured, search functionality will display an error message directing users to configure their API key in Settings.

#### Search Endpoints

**Search Movies**
```
GET https://api.themoviedb.org/3/search/movie?api_key={key}&query={query}&page=1
```

**Search TV Shows**
```
GET https://api.themoviedb.org/3/search/tv?api_key={key}&query={query}&page=1
```

#### API Response Mapping
```javascript
// Movie results
{
    id: movie.id,
    tmdbId: movie.id,
    type: 'movie',
    title: movie.title,
    year: movie.release_date?.substring(0, 4) || '',
    posterUrl: movie.poster_path ? `${TMDB_IMAGE_BASE}/w300${movie.poster_path}` : null,
    overview: movie.overview
}

// TV show results
{
    id: show.id,
    tmdbId: show.id,
    type: 'tv',
    title: show.name,
    year: show.first_air_date?.substring(0, 4) || '',
    posterUrl: show.poster_path ? `${TMDB_IMAGE_BASE}/w300${show.poster_path}` : null,
    overview: show.overview
}
```

#### Poster Image Sizes
- **Search results**: w300 (300px width)
- **Detail view**: w500 (500px width) - could be upgraded
- **Thumbnails**: w185 (185px width) - not currently used

#### TV Show Episodes Endpoints

**Get TV Series Details**
```
GET https://api.themoviedb.org/3/tv/{series_id}?api_key={key}
```
Returns TV series information including seasons array.

**Get All Episodes (with append_to_response)**
```
GET https://api.themoviedb.org/3/tv/{series_id}?api_key={key}&append_to_response=season/1,season/2,...
```
Fetches TV series with multiple seasons in one API call. Maximum 20 seasons can be appended.

**Response Structure**:
- Each season object contains `episodes` array
- Episode object: `episode_number`, `name`, `air_date`, `overview`, `still_path`
- Season 0 (specials) is filtered out in implementation

### GitHub Gist API

#### Authentication
```javascript
headers: {
    'Authorization': `token ${apiToken}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json'
}
```

#### Endpoints

**Fetch Gist**
```
GET https://api.github.com/gists/{gistId}
```
Returns gist object with files object containing file content.

**Create Gist**
```
POST https://api.github.com/gists
Body: {
    "description": "Screen Tracker Data",
    "public": false,
    "files": {
        "screens.tsv": {
            "content": "{tsv content}"
        }
    }
}
```
Returns gist object with new gist.id.

**Update Gist**
```
PATCH https://api.github.com/gists/{gistId}
Body: {
    "files": {
        "screens.tsv": {
            "content": "{tsv content}"
        }
    }
}
```

#### Error Handling
- 404: Gist not found (invalid ID)
- 401: Unauthorized (invalid token)
- 403: Token lacks permission or rate limit exceeded
- 422: Invalid request
- Network errors: Show error status

#### Rate Limits
- Authenticated: 5000 requests/hour
- Token needs "gist" scope

## Key Features

### 1. Search
- Auto-search with 1000ms debounce on input
- Search on Enter key
- Clear button (X) appears on right side when text is present
- Searches both movies and TV shows simultaneously
- Combined results (top 20 total)
- Each result shows:
  - Poster image (if available)
  - Title, type (Movie/TV Show), year
- Tap result to open detail modal:
  - Shows "Add to List" button if not in collection
  - Shows list selector and delete button if already in collection
  - Modal stays open after actions
- **Manual Entry Button**:
  - Displayed at bottom of search results
  - Also shown when no results found
  - Opens prompt-based manual entry
  - Fields: Title, Type (Movie/TV Show), Year
  - Creates screen with manual ID format

### 2. Screen Lists
- **Filter Controls** (at top of Screens view):
  - Search input to filter screens by title
  - Clear button (X) appears on right side when text is present
  - Tag filter buttons (three sections):
    - **Type filters**: Movies, Shows (mutually exclusive, shown first)
    - **List status filters**: To Watch, Watching, Watched (mutually exclusive, shown after first separator |)
    - **Manual tags**: User-defined tags (non-mutually exclusive, shown after second separator |, alphabetically sorted)
  - Filter behavior:
    - Type tags are mutually exclusive (can select Movies OR Shows)
    - List status tags are mutually exclusive (can select To Watch OR Watching OR Watched)
    - Manual tags are non-mutually exclusive (can select multiple custom tags)
    - Can combine filters from different sections (e.g., Movies + Watched + scifi + action)
    - Tap active tag to deselect (removes that specific filter)
- **Sort Controls** (in header):
  - Dropdown to select sort field: Date Added (default), Title, Year, Rating
  - Toggle button (↑/↓) to switch between ascending/descending order
  - Preferences persist in localStorage between sessions
- Screens displayed as cards with:
  - Poster image (if available)
  - Title, type, year
  - List status label (To Watch/Watching/Watched)
  - Waiting indicator (⏳ waiting for new episodes) - shown for watching TV shows that have caught up with available episodes or next episode is in future
  - Rating (★ X/10) - displayed only for watched screens
  - Tags (colored badges) - rating tags hidden from display
- Tap card to open detail modal
- Empty state: "No screens" message

### 3. Screen Detail Modal
- Full-screen overlay with blur backdrop
- Side-by-side layout:
  - Poster image on left
  - Metadata on right (title, type, year, TMDB ID)
- Complete overview/description
- **Episode List** (TV shows only):
  - Fetched on-demand from TMDB API when modal opens
  - Grouped by season in collapsible accordion format
  - Each episode displays: episode number, title, air date, overview
  - Season 0 (specials) excluded
  - Uses `append_to_response` to fetch up to 20 seasons efficiently
  - Not stored permanently (fetched fresh each time)
  - **Episode Tracking**:
    - Each episode has a checkmark button to mark as last watched
    - All episodes up to and including last watched are visually marked
    - Click checkmark button to update last watched episode
    - Watched episodes have reduced opacity and grayed-out styling
    - Last watched episode stored in format 's02e06' and synced to cloud
- **Tags management** - shown for screens in lists:
  - Add tags by typing and pressing Enter
  - Remove tags by clicking × button
  - Tags displayed as pills with remove button
- **Rating input** (tap-to-edit number field) - shown only for watched screens
  - Displays as "⭐ 5/10" format (or "⭐ ?/10" when unset), matching list view style
  - Tap to convert to numerical input field (1-10)
  - Save on blur or Enter key, cancel on Escape
  - Supports clearing rating by leaving input empty
- **From search**: Shows "Add" button
- **From list**: Shows pill selector (To Watch/Watching/Watched) + edit button + delete button
- Click outside or X button to close

### 4. Data Persistence

#### Cloud Sync (Primary Storage)
- **Service**: GitHub Gist (https://gist.github.com)
- **Format**: TSV (Tab-Separated Values)
- **Source of Truth**: GitHub Gist stores screen data
- **Authentication**: Personal access token with "gist" scope
- **Endpoint**: https://api.github.com/gists
- **Rate Limit**: 5000 requests/hour (authenticated)
- **Sync Strategy**: Cloud stores complete denormalized screen data

#### TSV Structure
```tsv
addedAt	finishedAt	tmdbID	lastWatchedEpisode	tags	title	year	posterURL	description
2025-01-01T10:00:00.000Z		603		movie,scifi,action,09_stars	The Matrix	1999	https://...	A computer hacker...
2025-01-01T11:00:00.000Z		27205		movie,scifi,thriller	Inception	2010	https://...	A thief who steals...
2025-01-01T09:00:00.000Z	2025-01-01T20:00:00.000Z	1396	s05e16	show,10_stars,drama	Breaking Bad	2008	https://...	A high school chemistry...
```

- **Columns**: addedAt, finishedAt, tmdbID, lastWatchedEpisode, tags, title, year, posterURL, description
- **Delimiter**: Tab character (\t)
- **Encoding**: UTF-8
- **Required Field**: Only `tmdbID` is required - all other fields are optional
- **Data Model**: Denormalized - TSV stores complete metadata
  - **addedAt**: ISO 8601 timestamp (defaults to current timestamp if missing)
  - **finishedAt**: ISO 8601 timestamp (defaults to empty if missing)
  - **tmdbID**: The Movie Database ID (REQUIRED - used to fetch missing metadata)
  - **lastWatchedEpisode**: Last watched episode for TV shows, format "s02e06" (defaults to empty if missing)
  - **tags**: Comma-separated; should start with "movie" or "show" as first tag (type indicator), followed by rating tags like "09_stars" and user-defined tags (if type tag missing, fetched from TMDB API)
  - **title**: Screen title (fetched from TMDB API if missing)
  - **year**: Release/first air year YYYY (fetched from TMDB API if missing)
  - **posterURL**: Original TMDB poster URL (fetched from TMDB API if missing)
  - **description**: Plot description (fetched from TMDB API if missing)

#### Local Storage (Cache)
- localStorage key: `screenTracker_screens`
- Saves entire state.screens object as JSON (including cachedPoster data URIs)
- Loaded on app initialization
- Auto-saves on any screen operation
- Syncs to GitHub Gist automatically after each save
- **Offline Poster Caching**:
  - Poster images are downloaded and converted to base64 data URIs
  - Stored in `cachedPoster` property for offline availability
  - Cached automatically when screens are added
  - Existing screens migrated on app load (background process)
  - Display logic prefers cachedPoster over posterUrl
  - cachedPoster is stored locally only (not synced to cloud to minimize file size)

#### Settings Storage
- localStorage key: `screenTracker_settings`
- Stores: tmdbApiKey, gistId, apiToken
- Persists between sessions

### 5. Cloud Sync Flow

#### Initial Setup (Settings View)
1. User generates GitHub personal access token with "gist" scope at github.com/settings/tokens
2. User enters token in settings
3. User enters existing Gist ID (or leaves empty for new)
4. Click "Save Settings" → saves to localStorage
5. If Gist ID empty: new gist created on first sync
6. Settings saved to localStorage

#### 2-Way Sync (Pull-Merge-Push)
Every sync operation follows this flow:

1. **Pull**: Fetch current gist content from GitHub
2. **Merge**: Combine local and remote screens using merge strategy
3. **Update Local**: Update `state.screens` and localStorage with merged data
4. **Push**: Upload merged data back to GitHub Gist

**Merge Strategy** (TSV is Single Source of Truth):
- Remote TSV from GitHub Gist is authoritative
- Uses screen ID as unique key (`movie_123`, `tv_456`, etc.)
- **For screens in remote TSV** → always include in merge
- **For screens in both local and remote** → pick the one with most recent timestamp
  - Compares latest timestamp from (`addedAt`, `finishedAt`)
  - More recent version wins (based on latest activity)
- **For screens only in local (not in TSV)**:
  - If `addedAt` > `lastSyncTime` → new local addition, keep it
  - If `addedAt` ≤ `lastSyncTime` → was deleted remotely, don't restore it

This ensures deletions propagate properly between devices while preserving new local additions.

#### Auto-Sync on Startup
1. App loads → `init()`
2. Loads settings from localStorage
3. Loads local screens from localStorage
4. If token + gistId configured: Triggers 2-way sync
5. Merged data updates both local state and UI

#### Auto-Sync on Change
1. Any screen operation (add/move/delete/rate/tag)
2. `saveToLocalStorage()` called
3. Automatically calls `syncWithGitHub(false, false)` (silent, push-only)
4. Pushes current local state to GitHub Gist
5. Does NOT pull or merge to prevent deleted items from being restored

### 6. Sorting
- **Sort Options**:
  - Date Added (default): Sorts by addedAt timestamp
  - Title: Alphabetical by screen title
  - Year: By release/first air year
  - Rating: By star rating (1-10)
- **Sort Order**: Ascending (↑) or Descending (↓), toggle with button
- **Persistence**: Sort preferences saved to localStorage key `screenTracker_sort`
- **Implementation**:
  - Event listeners update state and re-render on sort control changes
  - `renderScreens()`: Automatically applies sorting before displaying
- **UI Location**: Sort controls appear in header of Screens view

### 7. Notifications and Alerts
- **Status messages** (sync/maintenance):
  - Displayed in Settings view
  - Include dismiss button (×)
  - Persist until manually dismissed
  - Types: info (blue), success (green), error (red)

## Styling Guidelines

### Color Palette
```css
--bg-primary: #000000
--bg-secondary: #1c1c1e
--bg-tertiary: #2c2c2e
--text-primary: #ffffff
--text-secondary: #98989d
--text-tertiary: #636366
--accent: #0a84ff
--accent-hover: #409cff
--separator: rgba(84, 84, 88, 0.65)
```

### Typography
- Font: monospace (system default)
- Header: 34px, weight 700, letter-spacing -0.8px
- Screen title (card): 17px, weight 600, letter-spacing -0.4px
- Screen title (detail): 22px, weight 700, letter-spacing -0.8px
- Description: 13px/15px, line-height 1.4/1.6

### Key Design Patterns
- Border radius: 10-14px (cards), 8-10px (buttons)
- Borders: None or 0.5px separator lines
- Blur: backdrop-filter: blur(20px) for headers/modals
- Shadows: rgba(0, 0, 0, 0.3) for posters
- Animations: cubic-bezier(0.25, 0.46, 0.45, 0.94)

## Icons (SVG)

### List Icons
- **To Watch**: Bookmark icon
- **Watching**: Play icon
- **Watched**: Checkmark icon
- **Delete**: Trash bin icon
- **Close**: X icon
- **Add**: Plus in rounded square
- **Screen**: Monitor/TV icon (app icon)

All icons: 18x18px in cards, 24x24px in navigation, stroke-width 2

## Mobile Optimization

### Bottom Navigation
- Floating pill-shaped bar at bottom-right
- Fixed position
- Safe area support: `env(safe-area-inset-bottom)`
- 3 nav items with icons + labels
- Active state with accent color
- Hidden when keyboard open

### Touch Interactions
- Minimum touch target: 36-44px
- `-webkit-tap-highlight-color: transparent`
- Active states: scale(0.95-0.98), opacity 0.7-0.8
- No hover states (touch-first)

### Responsive Breakpoints
- Mobile: < 480px (primary target)
- Landscape: max-height 500px
- Tablet: >= 768px
- Adjusts: font sizes, padding, button sizes

## Common Operations

### Adding a Screen

#### From Search Results
1. Search result click → opens detail modal
2. Click "Add to List" button
3. Sets default status to "to_watch"
4. Generates unique ID if not present
5. Caches poster if available
6. Adds screen to `state.screens[]` array
7. Saves to localStorage
8. Renders screens
9. Refreshes detail view to show list options

#### Manual Entry
1. Click "Add manually" button
2. Prompt for title (required)
3. Confirm if movie or TV show
4. Prompt for year (optional)
5. Creates screen object with manual ID
6. Opens detail modal for adding to list

### Changing Screen List Status
1. Click different pill segment in detail modal
2. Updates timestamps using `setListTimestamps(screen, status)`
3. Integrity checks ensure: addedAt ≤ startedAt ≤ finishedAt
4. Saves to localStorage
5. Renders screens
6. Updates UI (pill selector active state)

### Deleting a Screen
1. Click delete button in detail modal
2. Confirmation dialog with screen title
3. If confirmed, removes from state.screens array
4. Saves to localStorage
5. Renders screens
6. Closes modal

## PWA Configuration

### Manifest
- Name: "Screen Tracker"
- Display: standalone
- Theme: #000000 (black)
- Icons: 192x192, 512x512 (monitor/screen SVG)
- Orientation: portrait

### Service Worker
- Cache-first strategy
- Caches: HTML, CSS, JS, manifest, icons
- Cache name: `screen-tracker-v{VERSION}`
- Update: Increment version number in sw.js
- **Auto-update detection**:
  - Checks on initial load
  - Checks when app gains focus (if last check > 30 mins ago)
  - Checks every 30 minutes while app has focus
  - Stops checking when app loses focus (battery optimization)
  - Listens for 'updatefound' event
  - Automatic reload on controller change

## Error Handling

### API Errors
- Display in `.error-message` div with red styling
- Network: "Network error. Please check your connection."
- Generic: "Search failed. Please try again."

### Data Validation
- Check screen doesn't exist before adding (by ID or tmdbId+type)
- Handle missing poster (graceful fallback to empty div)
- Manual entry validation (title required)

## Future Enhancement Considerations

### Potential Features
- Episode tracking for TV shows
- Season progress indicators
- Rewatch counter
- Watch date history
- Personal notes/reviews
- Streaming service indicators
- Genre filtering
- Cast/crew information
- Similar recommendations
- Import from other services (Letterboxd, Trakt)
- Export watchlist

### API Enhancements
- Fetch additional metadata (runtime, genres, cast)
- Trending movies/shows
- Popular this week
- Recommendations based on watched

### Performance
- Virtual scrolling for large lists
- Image lazy loading
- Pagination for search results
- IndexedDB for local cache
- Optimistic UI updates
- Delta sync (only changed items)

## Troubleshooting

### Common Issues
1. **Search not working**: Check TMDB API key validity
2. **Screens not persisting**: Check localStorage availability/quota
3. **Sync not working**:
   - Verify GitHub token is valid (github.com/settings/tokens with "gist" scope)
   - Check gist ID format
   - Verify rate limits not exceeded (5000 req/hour)
   - Check network connectivity
4. **Service Worker not updating**: Increment cache version
5. **Icons not showing**: SVG must be inline in HTML/JS
6. **Modal won't close**: Check event propagation
7. **Duplicate screens after sync**: Cloud sync overrides local data
8. **Posters not loading**: Check TMDB image service status

### Debug Tips
- Check console for errors
- Inspect localStorage: `localStorage.getItem('screenTracker_screens')`
- Inspect settings: `localStorage.getItem('screenTracker_settings')`
- Test TMDB API: Open endpoint URL in browser with API key
- Test GitHub Gist API: GET https://api.github.com/gists/{gistId}
- View gist content: https://gist.github.com/{gistId}
- Clear cache: Unregister service worker in DevTools
- Force sync: Click "Sync Now" in Settings

## Version Management

### Semantic Versioning
- **Version Format**: MAJOR.MINOR.PATCH (e.g., 1.0.0)
- **Location**: `APP_VERSION` constant in `app.js` and `CACHE_VERSION` in `sw.js`
- **Display**: Shown in Settings tab under "About" section
- **Current Version**: 1.13.0
- **When to Update**:
  - **MAJOR**: Breaking changes, major redesigns, incompatible data format changes
  - **MINOR**: New features, significant additions (e.g., episode tracking, new views)
  - **PATCH**: Bug fixes, minor improvements, documentation updates

### Agent Responsibilities

**CRITICAL**: When working on this codebase, you MUST:

1. **Always update version numbers** when making changes:
   - New features → increment MINOR version (e.g., 1.0.0 → 1.1.0)
   - Bug fixes → increment PATCH version (e.g., 1.0.0 → 1.0.1)
   - Breaking changes → increment MAJOR version (e.g., 1.0.0 → 2.0.0)
   - Update both `APP_VERSION` in `app.js` and `CACHE_VERSION` in `sw.js`
   - Keep versions synchronized between app and service worker

2. **Always update agents.md** (this file) when making changes:
   - Update relevant sections to reflect new features, behavior changes, or bug fixes
   - Add new sections if introducing new functionality
   - Keep code examples, flows, and architecture descriptions accurate
   - Update the Version History section with detailed change notes
   - Ensure consistency between code implementation and documentation
   - If you add new APIs, update the API Integration section
   - If you change data structures, update the relevant object structure sections
   - If you modify the sync flow, update the Cloud Sync Flow section
   - **This documentation is the single source of truth for how the app works**

3. **Document version changes properly**:
   - Add entry to Version History section
   - Include date in YYYY-MM-DD format
   - Describe what changed and why
   - Mention any breaking changes or migrations

### Version History
- **1.13.0** (2026-01-02): Added "waiting for new episodes" indicator for TV shows in Screens list view. When a TV show is marked as "Watching" and the last watched episode is either the final available episode or the next episode has a future air date, the list view now displays "⏳ waiting for new episodes" below the "Watching" status label. The waiting status is calculated when the detail modal is opened (episodes are fetched) and when episodes are marked as watched. Added `checkIfWaitingForNewEpisodes()` function to determine waiting status, updated `fetchAndDisplayEpisodes()` to calculate and store the status in `screen.waitingForNewEpisodes` property, modified `updateLastWatchedEpisode()` to recalculate status when episodes are marked as watched, and added CSS styling for the waiting message (.screen-waiting).
- **1.12.0** (2026-01-02): Made GitHub Gist TSV the single source of truth for cross-device sync. Deletions now properly propagate between devices. Rewrote `mergeScreens()` function to treat remote TSV as authoritative: if a screen is not present in the TSV, it was deleted and should not be restored. Added timestamp-based logic to distinguish between new local additions (added after last sync - keep them) and remotely deleted screens (existed before last sync - remove them). Implemented `lastSyncTime` persistence in localStorage to track when last successful sync occurred. This fixes the issue where deleted screens would reappear when syncing between devices. Screens are now only restored if they were added locally after the last sync, otherwise they're treated as deletions.
- **1.11.1** (2026-01-02): Fixed two critical bugs. (1) Rating section now appears immediately when marking a screen as "watched" - pill selector click now refreshes the detail modal to show/hide the rating section based on new status. (2) Fixed deletion persistence issue - deleted screens no longer reappear after sync. Changed auto-sync behavior: after local changes (add/delete/edit), sync now does push-only to GitHub Gist instead of pull-merge-push. This prevents deleted items from being restored from remote. Manual sync and startup sync still do full pull-merge-push for cross-device synchronization. Added `pullMerge` parameter to `syncWithGitHub()` function.
- **1.11.0** (2026-01-02): Added tag suggestions feature to detail modal. When viewing a screen's tags section, users can now tap a dropdown button next to the tag input to see all existing custom tags from their collection. The suggestions panel displays available tags (excluding ones already on the current screen) as clickable chips. Clicking a suggestion instantly adds that tag to the screen. Shows "No available tags" when all tags are already applied or no custom tags exist. Added toggle button with dropdown icon, suggestions panel with chips, click handlers for tag application, and CSS styling including hover effects and animations. This mirrors the book-tracker implementation and makes tag management much easier by avoiding retyping common tags.
- **1.10.3** (2026-01-02): Implemented tolerant TSV parsing with automatic TMDB metadata fetching. TSV import now only requires `tmdbID` field - all other fields are optional. Missing fields are handled automatically: `addedAt` defaults to current timestamp, `finishedAt` and `lastWatchedEpisode` default to empty, and `tags`, `title`, `year`, `posterUrl`, and `overview` are fetched from TMDB API if not present. Added `fetchScreenMetadataFromTMDB()` function that queries TMDB API for missing metadata (tries movie endpoint first, then TV). Made `tsvToScreens()` async to support API calls during import. This enables simpler TSV files with just TMDB IDs, making manual TSV creation and bulk imports much easier.
- **1.10.2** (2026-01-02): Added TSV field sanitization to prevent data corruption. TSV export now sanitizes string fields (title, posterUrl, description/overview) by removing newlines and replacing double quotes with single quotes. Added `sanitizeTSVField()` helper function that converts newlines to spaces and replaces `"` with `'` to ensure TSV integrity when syncing to GitHub Gist. Prevents issues with multi-line descriptions or titles containing special characters that could break the TSV format.
- **1.10.1** (2026-01-02): Fixed PWA update system bugs. (1) Update App button now checks if an update is actually available before reloading - shows "No update available" toast notification if already on latest version instead of unnecessarily restarting the app. (2) Settings (TMDB API key, GitHub Gist ID, API token) now persist when clearing local cache - modified `clearLocalCache()` to only remove screens and sort preferences while preserving settings in localStorage. Updated `updatePWA()` to listen for 'updatefound' event and only reload when a new service worker is installed.
- **1.10.0** (2026-01-02): Refactored type handling to use movie/show as special reserved tags instead of a separate TSV column. Removed 'type' column from TSV format - type is now stored as the first tag ('movie' or 'show') in the tags column. Internally, screens still use the `type` property ('movie' or 'tv'), but TSV export/import now handles the conversion. Updated filter UI to have three distinct sections: Type filters (Movies/Shows - mutually exclusive), List status filters (To Watch/Watching/Watched - mutually exclusive), and Manual tags (non-mutually exclusive). Users can now combine filters across sections (e.g., Movies + Watched + scifi). Added validation to prevent users from manually adding/removing reserved tags (movie, show, rating tags). Updated `screensToTSV()` to export type as first tag, `tsvToScreens()` to extract type from tags, `getAllUniqueTags()` to exclude type tags, and filter rendering/logic to support three-section structure. **Breaking change**: TSV format updated - column count changed from 10 to 9 columns, existing gists will automatically convert on sync.
- **1.9.2** (2026-01-02): Fixed bug where marking an episode as watched would reset season fold states. Previously, `updateLastWatchedEpisode()` re-rendered the entire episode list, causing all seasons to return to their default (expanded) state. Now uses in-place DOM updates to modify episode watched states without re-rendering, preserving the user's chosen fold/unfold state for each season during the modal session. Changed from calling `fetchAndDisplayEpisodes()` to directly updating CSS classes on existing episode items.
- **1.9.1** (2026-01-02): Changed episode list default state to expanded. All seasons now display as unfolded by default when viewing TV show details, making episodes immediately visible. Added `expanded` class to season headers and set initial display to `block` instead of `none`.
- **1.9.0** (2026-01-02): Simplified state management by removing `startedAt` timestamp. "Watching" status is now exclusively for TV shows with episode tracking (`lastWatchedEpisode` set). Movies only have "To Watch" and "Watched" states. Updated `getScreenListStatus()` to check `type === 'tv' && lastWatchedEpisode` for watching status. Updated `setListTimestamps()` to remove startedAt handling. Removed `startedAt` column from TSV sync format. Hidden "Watching" pill segment for movies in detail modal. Updated screen object structure documentation. **Breaking change**: TSV format updated - existing gists need re-sync.
- **1.8.0** (2026-01-02): Added episode tracking for TV shows. Users can now mark episodes as watched by clicking a checkmark button next to each episode. The app tracks the last watched episode in format 's02e06' and visually marks all episodes up to and including the last watched episode with a checkmark. Added `lastWatchedEpisode` field to screen data structure and TSV sync format (new column after tmdbID). Added helper functions: `parseEpisodeCode()`, `formatEpisodeCode()`, `isEpisodeWatched()`, and `updateLastWatchedEpisode()`. Updated `fetchAndDisplayEpisodes()` to render watch buttons and handle watch state. Added comprehensive CSS styling for watched episodes and watch buttons. **Breaking change**: TSV format updated - existing gists will need to be re-synced.
- **1.7.0** (2026-01-02): Added full episode list display for TV shows in detail modal. When viewing a TV show, the detail modal now fetches and displays all episodes grouped by season in collapsible accordions. Each episode shows episode number, title, air date, and overview. Episodes are fetched on-demand from TMDB API using the `append_to_response` parameter to efficiently retrieve multiple seasons in a single API call (up to 20 seasons). Season 0 (specials) is excluded. Added new functions: `fetchTVEpisodes()` and `fetchAndDisplayEpisodes()`. Added comprehensive CSS styling for episodes section including season headers, episode items, and responsive design.
- **1.6.0** (2026-01-02): Implemented proper 2-way sync for GitHub Gist. Previously, sync only pushed local data to Gist, causing data loss when using multiple devices (they would overwrite each other). Now implements pull-merge-push cycle: (1) pulls current Gist content, (2) merges with local data using timestamp-based conflict resolution, (3) updates local state with merged data, (4) pushes merged result to Gist. Merge strategy uses screen ID as unique key and picks the version with the most recent timestamp when conflicts occur. This ensures data converges across devices. Added `getLatestTimestamp()` and `mergeScreens()` helper functions.
- **1.5.5** (2026-01-02): Changed TSV type field from 'tv' to 'show' for better readability. Updated `screensToTSV()` to export TV shows as 'show' and `tsvToScreens()` to convert 'show' back to 'tv' for internal representation. Internal code continues to use 'tv' (matching TMDB API), but TSV files now use the more readable 'show' label.
- **1.5.4** (2026-01-02): Fixed automatic GitHub Gist sync. The `saveToLocalStorage()` function was not calling `syncWithGitHub()` as documented, so screen changes weren't automatically syncing to the cloud. Added automatic silent sync call after each local save to ensure data is pushed to GitHub Gist after every screen operation (add/move/delete/rate/tag).
- **1.5.3** (2026-01-02): Fixed search results to properly interleave movies and TV shows by popularity. Previously, all movie results were shown before TV show results, which could hide highly relevant TV shows. Now captures the `popularity` score from TMDB API responses and sorts the combined results by popularity (descending) before taking the top 20. This ensures the most relevant/popular results appear first regardless of type.
- **1.5.2** (2026-01-02): Fixed critical bug preventing detail modal from working. The `setupDetailModalListeners` function was referencing `content` and `displayScreen` variables that were not in scope, causing ReferenceErrors. Added local definitions of these variables at the beginning of the function: `content` is retrieved from DOM, and `displayScreen` is derived from `existingScreen || screen`.
- **1.5.1** (2026-01-02): Fixed bug where screen detail modal wasn't showing when clicking on items in lists. The normal view template was still using old star rating HTML instead of the new `ratingSection` variable with tap-to-edit interface. Replaced inline star rating HTML with `${ratingSection}` variable.
- **1.5.0** (2026-01-02): Updated rating input to use tap-to-edit number field interface. Replaced the 10-star tappable interface with a more streamlined approach: displays rating as "⭐ 5/10" (or "⭐ ?/10" when unset) matching the list view style. Tap the rating to convert it to a numerical input field (1-10). Save rating on blur or Enter key, cancel on Escape. Supports clearing rating by leaving input empty. Added `updateScreenRating()` function. Updated rating display and input styles in styles.css.
- **1.4.0** (2026-01-02): Restructured TSV cloud sync format. Reordered columns to prioritize timestamps and metadata. Renamed columns from title-case with spaces to camelCase (e.g., "Added At" → "addedAt", "Poster URL" → "posterURL", "Overview" → "description"). Removed "Cached Poster" column from sync (remains local-only). Updated `screensToTSV()` and `tsvToScreens()` functions. **Breaking change**: Existing gists will need to be re-synced with new format.
- **1.3.1** (2026-01-02): Changed "Add to List" button label to just "Add" in search result detail modal for improved UI simplicity and consistency.
- **1.3.0** (2026-01-01): Implemented full edit functionality for tracked screens. Added `updateScreenMetadata()` function to update screen properties (title, type, year, overview, poster URL). Edit button now opens edit mode with editable input fields. Users can modify all screen metadata and save changes. Poster cache is automatically updated when poster URL is changed. Cancel button returns to normal view without saving changes.
- **1.2.0** (2025-01-01): Updated UI to match book-tracker reference. Changed rating display in list view from full stars to emoji format (⭐ 8/10). Added edit button in detail modal for tracked screens (circular button between pill selector and delete button). Reordered detail modal elements: header, action buttons, tags, rating (only for watched), description. Rating now only shown for watched screens. Edit button shows placeholder alert (full edit functionality to be implemented).
- **1.1.2** (2025-01-01): Fixed poster sizing and add button styling to match book-tracker layout. Search result posters now 60x90px (was using wrong class name). Fixed add button styling in detail modal. Changed class from `screen-poster` to `screen-cover` to match CSS. Fixed `.btn-add-book` → `.btn-add-screen` in CSS.
- **1.1.1** (2025-01-01): Removed non-existent demo API key. TMDB API key is now required - users must provide their own free API key from themoviedb.org/settings/api. Added validation to show error message if API key is not configured. Updated UI to clearly indicate API key is required.
- **1.1.0** (2025-01-01): Added user-configurable TMDB API key in Settings. New settings section at the top of Settings tab with API key input field, save button, and status messages.
- **1.0.0** (2025-01-01): Initial release. Complete PWA for tracking movies and TV shows with TMDB API integration, three list states (To Watch, Watching, Watched), 10-star rating system, custom tags, GitHub Gist cloud sync, offline poster caching, and dark-themed monospace UI based on book-tracker architecture.

## Code Style Guidelines

### JavaScript
- Use ES6+ features (arrow functions, template literals, destructuring)
- Avoid jQuery or frameworks - vanilla JavaScript only
- Functions: verb + noun naming (e.g., `showScreenDetail`, `addScreenToList`)
- Event handlers: addEventListener for complex, inline for simple
- No semicolons (consistent with existing code)

### CSS
- Mobile-first approach
- Use CSS variables for colors
- BEM-like naming without strict BEM
- Avoid !important unless absolutely necessary
- Group related styles together
- Maintain consistency with book-tracker styling

### HTML
- Semantic elements where possible
- Accessibility: title attributes on icon buttons
- SVG icons inline for performance
- No unnecessary divs
- Maintain structure similarity with book-tracker

## Testing Checklist
- [ ] Search finds movies by title
- [ ] Search finds TV shows by title
- [ ] Add screen to each list
- [ ] Move screen between lists
- [ ] Delete screen from list
- [ ] Detail modal opens/closes
- [ ] Rating works (tap-to-edit number field)
- [ ] Tags can be added/removed
- [ ] Data persists on reload
- [ ] Works offline (after first load)
- [ ] Posters cache for offline use
- [ ] Bottom nav switches views
- [ ] Sort controls work
- [ ] Filter tags work
- [ ] Search within collection works
- [ ] Error handling for API failures
- [ ] Responsive on mobile
- [ ] Safe area handling on notched devices
- [ ] Keyboard doesn't overlap bottom nav
- [ ] GitHub Gist sync works
- [ ] Manual entry works

## Differences from Book Tracker

### API
- Uses TMDB API instead of Google Books API
- Searches both movies and TV shows simultaneously
- Different result structure (movies vs TV shows)

### Data Model
- `type` field to distinguish movies from TV shows
- `tmdbId` instead of ISBN
- No ISBN requirement (manual entries fully supported)
- `posterUrl` instead of `coverUrl`
- `overview` instead of `description`

### Terminology
- "Screens" instead of "Books"
- "Watched" instead of "Read"
- "To Watch" instead of "To Read"
- "Poster" instead of "Cover"

### Features
- Type indicator (Movie/TV Show) in all views
- Combined movie and TV show search
- No author field
- Simpler manual entry (fewer fields)

### Styling
- Monitor/screen icon instead of book icon
- Adapted messaging for movies/TV shows
- Same dark monospace aesthetic
- Identical UI patterns and interactions
