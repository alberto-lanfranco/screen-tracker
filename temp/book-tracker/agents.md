# Book Tracker PWA - Developer Guide

## Overview
A Progressive Web App (PWA) for tracking books with an iOS-inspired minimal dark theme interface. Users can search for books, add them to a unified collection. Books can be filtered by tags and searched within the collection.

## Tech Stack
- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **API**: Google Books API (no authentication required)
- **Storage**: localStorage for persistence
- **PWA**: Service Worker for offline support
- **Design**: iOS inspired, mobile-first, dark theme

## Architecture

### File Structure
```
book-tracker/
├── index.html          # Main HTML with bottom navigation
├── styles.css          # iOS-inspired styling
├── app.js              # Application logic and state management
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker for offline caching
└── README.md           # Project documentation
```

### Core Components

#### 1. Views (Bottom Navigation)
- **Add View**: Search for new books and add to collection
- **Books View**: View all books with filtering and search capabilities
- **Settings View**: Configure GitHub Gist sync and maintenance options

#### 2. State Management
```javascript
state = {
    books: [],                 // Unified array of all books
    filterTags: [],           // Active filter tags for Books view (includes list filters: to_read, reading, read)
    searchQuery: '',          // Search query for filtering books
    sortBy: 'dateAdded',      // Sort field: dateAdded, startedAt, finishedAt, title, author, year, rating
    sortOrder: 'desc',        // Sort order: asc, desc
    settings: {
        gistId: '',
        apiToken: ''
    },
    lastSyncTime: null,       // Timestamp of last cloud sync
    isSyncing: false
}
```

#### 3. Book Object Structure
```javascript
{
    id: string,           // Google Books ID
    title: string,
    author: string,       // Comma-separated if multiple
    year: string,         // YYYY format
    coverUrl: string,     // Google Books thumbnail URL (original source)
    cachedCover: string,  // Base64 data URI of cached cover image for offline use (v3.6.0+)
    isbn: string,         // Optional
    description: string,  // Optional, HTML may be present
    tags: string[],       // User-defined tags and rating (01_stars to 10_stars)
    addedAt: string,      // ISO 8601 timestamp of when book was added to To Read list
    startedAt: string,    // ISO 8601 timestamp of when book was moved to Reading list (null if not started)
    finishedAt: string    // ISO 8601 timestamp of when book was moved to Read list (null if not finished)
}
```

**List Status Determination**: Books are now organized into lists based on timestamps rather than tags:
- **To Read**: `addedAt` is set, `startedAt` and `finishedAt` are null
- **Reading**: `startedAt` is set, `finishedAt` is null
- **Read**: `finishedAt` is set

**Timestamp Integrity**: When setting timestamps, the system enforces:
- `addedAt` ≤ `startedAt` ≤ `finishedAt`
- If integrity check fails, earlier timestamps are copied from later ones

## API Integration

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
    "description": "Book Tracker Database",
    "public": false,
    "files": {
        "books.tsv": {
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
        "books.tsv": {
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

### Google Books API
- **Endpoint**: `https://www.googleapis.com/books/v1/volumes`
- **Parameters**: `q` (query), `maxResults=20`, `printType=books`
- **No authentication required** for basic searches
- **Rate limits**: 1000 requests/day per IP (free tier)
- **Error codes**:
  - 429: Rate limit exceeded
  - 403: Quota exceeded

### API Response Mapping
```javascript
// Google Books volumeInfo → App bookData
{
    id: item.id,
    title: volumeInfo.title,
    author: volumeInfo.authors?.join(', ') || 'Unknown Author',
    year: volumeInfo.publishedDate?.substring(0, 4) || 'N/A',
    coverUrl: volumeInfo.imageLinks?.thumbnail || null,
    isbn: volumeInfo.industryIdentifiers?.[0]?.identifier || null,
    description: volumeInfo.description || null
}
```

## Key Features

### 1. Search
- Auto-search with 1000ms debounce on input
- Search on Enter key
- Clear button (X) appears on right side when text is present
- 20 results displayed
- Each result shows:
  - Cover image (60x90px)
  - Title, author, year
- Tap result to open detail modal:
  - Shows 3 list buttons with labels (To Read, Reading, Read)
  - Buttons highlight if book already exists in a list
  - Clicking button adds book or changes list status
  - Modal stays open after clicking (doesn't auto-close)
- **Manual Entry Button**:
  - Displayed at bottom of search results
  - Also shown when no results found
  - Opens modal for manual book entry
  - Fields: Title, Author, Year, Description, Cover URL, ISBN
  - Add to list buttons (To Read, Reading, Read) - select before saving
  - "Save Book" button at bottom to commit entry
  - Books without ISBN won't sync to cloud (warning shown)

### 2. Book Lists
- **Filter Controls** (at top of Books view):
  - Search input to filter books by title/author
  - Clear button (X) appears on right side when text is present
  - Tag filter buttons (dynamic):
    - List status tags: To Read, Reading, Read (always shown first, blue accent when active)
    - Manual tags: User-defined tags (shown after separator |, orange accent when active, alphabetically sorted)
    - List tags are mutually exclusive within group
    - Manual tags are mutually exclusive within group
    - Can combine one list tag + one manual tag
    - Tap active tag to deselect (show all)
- **Sort Controls** (in header):
  - Dropdown to select sort field: Date Added (default), Title, Author, Year, Rating, Started At, Finished At
  - **Dynamic sort options**: Started At only shown for Reading and Read lists, Finished At only shown for Read list
  - Toggle button (↑/↓) to switch between ascending/descending order
  - Preferences persist in localStorage between sessions
- Books displayed as cards with:
  - Cover image (80x120px)
  - Title, author, year
  - Rating (⭐ X/10) - displayed only for books with Read status (finishedAt is set)
  - Tags (colored badges) - rating tags hidden from display
  - Three list status icons (current one highlighted/active)
  - Delete button (far right)
- Tap card to open detail modal
- Empty state: "No books" message

### 3. Book Detail Modal
- Full-screen overlay with blur backdrop
- Larger cover image (200x300px)
- Complete description
- ISBN display if available
- **Edit Mode** - shown for books in lists:
  - Edit button (✏️) in top-right corner
  - Click to enter edit mode with editable fields:
    - Title (text input)
    - Author (text input)
    - Year (text input)
    - ISBN (text input, required)
    - Description (textarea)
    - Cover URL (text input)
  - Save/Cancel buttons to commit or discard changes
  - ISBN changes update the book ID and check for duplicates
  - Changes sync to cloud immediately on save
- **Tags management** - shown for books in lists:
  - Add tags by typing and pressing Enter
  - **Tag suggestions**: Shows list of existing tags while typing
  - Remove tags by clicking × button
  - Tags displayed as pills with remove button
- **Rating input** (10 tappable stars) - shown only for books with Read status (finishedAt is set)
- **From search**: Shows 3 list buttons with labels (To Read, Reading, Read) to add book
- **From list**: Shows 3 list buttons (current highlighted) + delete button + edit button
- Click outside or X button to close

### 4. Data Persistence

#### Cloud Sync (Primary Storage)
- **Service**: GitHub Gist (https://gist.github.com)
- **Format**: TSV (Tab-Separated Values) - minimal schema
- **Source of Truth**: GitHub Gist stores ISBN, list placement, ratings, tags, and timestamps
- **Authentication**: Personal access token with "gist" scope
- **Endpoint**: https://api.github.com/gists
- **Rate Limit**: 5000 requests/hour (authenticated)
- **Sync Strategy**: Cloud stores complete denormalized book data (isbn, title, author, year, description, coverUrl, tags, timestamp). This allows users to edit metadata without re-fetching from API. Missing fields are fetched from Google Books API as fallback.

#### TSV Structure
```tsv
addedAt	startedAt	finishedAt	isbn	tags	title	author	year	coverUrl	description
2025-12-08T10:30:00.000Z			9780547928227	fantasy,classic	The Hobbit	J.R.R. Tolkien	1937	https://...	A fantasy novel about...
2025-12-07T15:45:00.000Z	2025-12-08T09:00:00.000Z		9780451524935	dystopian,scifi	1984	George Orwell	1949	https://...	Dystopian social...
2025-12-06T20:15:00.000Z	2025-12-07T10:00:00.000Z	2025-12-08T14:30:00.000Z	9780441013593	09_stars,scifi,epic	Dune	Frank Herbert	1965	https://...	Science fiction novel...
```
- **Columns** (enforced order): addedAt, startedAt, finishedAt, isbn, tags, title, author, year, coverUrl, description
- **Delimiter**: Tab character (\t)
- **Encoding**: UTF-8
- **Data Model**: **Denormalized** - TSV stores complete book metadata to allow user editing
  - **addedAt**: ISO 8601 timestamp of when book was added to To Read list (required)
  - **startedAt**: ISO 8601 timestamp of when book was moved to Reading list (empty for To Read books)
  - **finishedAt**: ISO 8601 timestamp of when book was moved to Read list (empty for To Read and Reading books)
  - **isbn**: ISBN identifier (required)
  - **tags**: Comma-separated list including:
    - Rating: `01_stars` to `10_stars` (optional, only one, typically for books with Read status)
    - Custom tags: Any user-defined tags
  - **title**: Book title (editable by user)
  - **author**: Author name(s) (editable by user)
  - **year**: Publication year (editable by user)
  - **coverUrl**: URL to book cover image (editable by user)
  - **description**: Full book description (editable by user)
- **Parse Strategy**: 
  - TSV values take precedence over API values
  - If any denormalized field (title, author, year, description, coverUrl) is missing, fetch from Google Books API
  - API values are only used to fill missing fields; existing TSV values are preserved
  - Automatically adds missing columns to support backward compatibility
  - **Column order enforcement**: Parser can read columns in any order, but exports enforce: addedAt, startedAt, finishedAt, isbn, tags, title, author, year, coverUrl, description
  - If wrong column order detected, TSV is automatically fixed on next sync
  - **Timestamp integrity checks**: Ensures addedAt ≤ startedAt ≤ finishedAt when parsing
  - **Text field sanitization**: 
    - Double quotes (`"`) replaced with single quotes (`'`)
    - Tabs and newlines replaced with spaces
    - Applied when exporting to TSV and when parsing existing TSV data
    - Ensures TSV format compliance by making `"` illegal in text fields
- **Legacy Migration** (v3.0.0+): 
  - Automatically detects old tag-based list system (to_read, reading, read tags)
  - Converts tags to timestamps: to_read books unchanged, reading books copy addedAt to startedAt, read books copy addedAt to all three timestamps
  - Removes list status tags from tags array
  - **Note**: This migration logic will be removed in v4.0.0

#### Local Storage (Cache)
- localStorage key: `bookTrackerData`
- Saves entire state.books object as JSON (including cachedCover data URIs)
- Loaded on app initialization
- Auto-saves on any book operation
- Syncs to GitHub Gist automatically after each save
- **Offline Image Caching** (v3.6.0+):
  - Book cover images are downloaded and converted to base64 data URIs
  - Stored in `cachedCover` property for offline availability
  - Cached automatically when books are added (manual or API)
  - Existing books migrated on app load (background process)
  - Display logic prefers cachedCover over coverUrl for reliability
  - Only coverUrl (not cachedCover) is synced to cloud to keep TSV file small

#### Settings Storage
- localStorage key: `bookTrackerSettings`
- Stores: gistId, apiToken
- Persists between sessions

### 5. Cloud Sync Flow

#### Initial Setup (Settings View)
1. User generates GitHub personal access token with "gist" scope at github.com/settings/tokens
2. User enters token in settings
3. User enters existing Gist ID (or leaves empty for new)
4. Click "Save Settings" → `saveSettings()`
5. If Gist ID empty: `createGist()` → new gist created on first sync
6. Settings saved to localStorage

#### Auto-Sync on Startup
1. App loads → `init()`
2. Loads settings from localStorage
3. If token + gistId exist: `syncWithGitHub(false)`
4. Fetches gist → `fetchGist(gistId)`
5. Parses TSV → `tsvToBooks(tsvContent)`
   - Sanitizes text fields (replaces `"` with `'`)
   - Detects if sanitization was needed
6. For each ISBN in TSV:
   - Check local cache first
   - If not cached, fetch book data from Google Books API
7. Builds complete book objects with cloud data
8. Updates state (cloud takes precedence)
9. If TSV needed fixing (column order, migration, or sanitization), pushes corrected version back to server
10. Updates UI

#### Manual Sync
1. User clicks "Sync Now" button
2. `syncWithGitHub(true)` with showStatus=true
3. Shows "Syncing..." status message
4. Fetches gist, parses (with sanitization), updates state
5. If TSV needed fixing, pushes corrected version back to server
6. Shows success/error status message (indicates if fixes were applied)

#### Push on Change
1. Any book operation (add/move/delete/rate/tag/edit)
2. `saveToLocalStorage()` called (caches full book data locally)
3. Automatically calls `pushToGitHub()`
4. Converts books to denormalized TSV → `booksToTSV()` (addedAt, startedAt, finishedAt, isbn, tags, title, author, year, coverUrl, description)
5. Updates gist → `updateGist(gistId, tsvContent)`
6. Silent push (no UI status shown)
7. Note: Only books with ISBN are synced to cloud

### 6. Sorting
- **Sort Options**:
  - Date Added (default): Sorts by addedAt timestamp
  - Started At: Sorts by startedAt timestamp (only shown for Reading and Read lists)
  - Finished At: Sorts by finishedAt timestamp (only shown for Read list)
  - Title: Alphabetical by book title
  - Author: Alphabetical by author name
  - Year: By publication year
  - Rating: By star rating (1-10)
- **Dynamic Options**: Sort dropdown updates based on active list filter
- **Sort Order**: Ascending (↑) or Descending (↓), toggle with button
- **Persistence**: Sort preferences saved to localStorage key `bookTrackerSort`
- **Implementation**:
  - `updateSortOptions()`: Dynamically updates dropdown based on active filter
  - `sortBooks(books)`: Compares books based on state.sortBy and state.sortOrder
  - `renderBooks()`: Automatically applies sorting before displaying books
  - Event listeners update state and re-render on sort control changes
- **UI Location**: Sort controls appear in header of Books view

### 7. Notifications and Alerts
- **Toast notifications** (brief messages):
  - Success: "Book added!", "Book moved!"
  - Error: Duplicate book warnings
  - 4-second display with fade-out animation
  - Positioned in safe area (respects iPhone notch)
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
- Book title (card): 17px, weight 600, letter-spacing -0.4px
- Book title (detail): 28px, weight 700, letter-spacing -0.8px
- Description: 13px/15px, line-height 1.4/1.6

### Key Design Patterns
- Border radius: 10-14px (cards), 8-10px (buttons)
- Borders: None or 0.5px separator lines
- Blur: backdrop-filter: blur(20px) for headers/modals
- Shadows: rgba(0, 0, 0, 0.3) for covers
- Animations: cubic-bezier(0.25, 0.46, 0.45, 0.94)

## Icons (SVG)

### List Icons
- **To Read**: Closed book icon
- **Reading**: Open book icon  
- **Read**: Checkmark icon
- **Delete**: Trash bin icon
- **Close**: X icon
- **Search**: Magnifying glass icon

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
- Adjusts: font sizes, padding, button sizes

## Common Operations

### Adding a Book

#### From Search Results
1. Search result click → `addBookToList(book, listTag)`
2. Check for duplicates by ID
3. Set timestamps using `setListTimestamps(book, listTag)` based on selected list
4. Add book to `state.books[]` array
5. Save to localStorage
6. Render books
7. Show toast notification

#### Manual Entry
1. Click "Add manually" button (bottom of search results or when no results)
2. `showManualEntryModal()` opens modal with entry form
3. Fill in fields:
   - Title (required)
   - Author (required)
   - ISBN (required for cloud sync)
   - Year (optional)
   - Description (optional)
   - Cover URL (optional)
4. Select one of three list buttons (To Read, Reading, Read)
   - Buttons toggle active state on click
   - "To Read" is pre-selected by default
5. Click "Save Book" button at bottom
6. Validates required fields (title, author, isbn, list selection)
7. Creates book object with `id: isbn`
8. Sets timestamps using `setListTimestamps(book, listTag)`
9. Adds to state.books array
10. Saves to localStorage (triggers cloud sync)
11. Shows success toast notification
12. Closes modal and clears search

### Changing Book List Status
1. Click non-active list icon
2. `changeBookListStatus(bookId, newListTag)`
3. Find book and update timestamps using `setListTimestamps(book, newListTag)`
4. Integrity checks ensure: addedAt ≤ startedAt ≤ finishedAt
5. Save to localStorage
6. Render books
7. Show toast notification

### Editing Book Metadata
1. Open book detail modal
2. Click edit button (✏️)
3. Modify fields in edit mode
4. Click "Save" → `updateBookMetadata(bookId, updates)`
5. Updates book object in state.books array
6. Save to localStorage (triggers cloud sync)
7. Re-render books view
8. Show toast notification

### Deleting a Book
1. Click delete button
2. `removeBook(bookId)`
3. Shows confirmation dialog with book title
4. If confirmed, filter book out of state.books array
5. Save to localStorage
6. Render books

## PWA Configuration

### Manifest
- Name: "Book Tracker"
- Display: standalone
- Theme: #000000 (black)
- Icons: 192x192, 512x512 (required but placeholder)

### Service Worker
- Cache-first strategy
- Caches: HTML, CSS, JS, manifest, icons
- Cache name: `book-tracker-v{VERSION}`
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
- Specific messages for:
  - 429: "Rate limit exceeded. Please try again in a few minutes."
  - 403: "API quota exceeded. Daily limit reached. Please try again tomorrow."
  - Network: "Network error. Please check your connection."

### Data Validation
- Check book doesn't exist before adding
- Handle missing book properties (author, description, coverUrl)
- Graceful fallback to placeholder SVG for missing covers

## Future Enhancement Considerations

### Potential Features
- Book notes (add to TSV columns)
- Reading progress percentage
- Reading statistics/analytics
- Export/import TSV files
- Multiple reading lists (expand TSV tags)
- Search filters (year, genre, language)
- Dark/light theme toggle
- Conflict resolution UI for sync conflicts
- Offline queue for sync operations
- Sync history/audit log

### API Alternatives
- Open Library API (original, less reliable)
- ISBN DB API (ISBN-focused)
- Custom backend proxy (for Goodreads scraping)

### Storage Alternatives
- PasteMyst (paste-based storage, simpler than GitHub but less reliable)
- Pastebin.com (less developer-friendly API)
- JSONBin.io (JSON-focused, rate limits)
- Firebase Realtime Database (requires account)
- Cloudflare Workers KV (requires account)

### Performance
- Virtual scrolling for large lists
- Image lazy loading
- Search result pagination
- IndexedDB instead of localStorage for local cache
- Debounced sync pushes (batch updates)
- Optimistic UI updates before sync completes
- Delta sync (only send changed books)
- Compression for large TSV files

## Troubleshooting

### Common Issues
1. **Search not working**: Check Google Books API quota
2. **Books not persisting**: Check localStorage availability/quota
3. **Sync not working**: 
   - Verify GitHub token is valid (generate at github.com/settings/tokens with "gist" scope)
   - Check gist ID format (alphanumeric string)
   - Verify rate limits not exceeded (5000 req/hour)
   - Check network connectivity
4. **Service Worker not updating**: Increment cache version
5. **Icons not showing**: SVG must be inline in HTML/JS
6. **Modal won't close**: Check event propagation on buttons
7. **Duplicate books after sync**: Cloud sync overrides local data
8. **Book not syncing to cloud**: Book must have ISBN to sync (warning shown on add)
9. **Missing book data after sync**: Ensure Google Books API is accessible to fetch metadata

### Debug Tips
- Check console for errors
- Inspect localStorage: `localStorage.getItem('bookTrackerData')`
- Inspect settings: `localStorage.getItem('bookTrackerSettings')`
- Test Google Books API: Open endpoint URL in browser
- Test GitHub Gist API: 
  - GET https://api.github.com/gists/{gistId}
  - Check response in browser DevTools
- View gist content: https://gist.github.com/{gistId}
- Clear cache: Unregister service worker in DevTools
- Force sync: Click "Sync Now" in Settings and watch console

## Version Management

### Semantic Versioning
- **Version Format**: MAJOR.MINOR.PATCH (e.g., 1.1.0)
- **Location**: `APP_VERSION` constant in `app.js` and `CACHE_VERSION` in `sw.js`
- **Display**: Shown in Settings tab under "About" section
- **Current Version**: 3.6.0
- **When to Update**:
  - **MAJOR**: Breaking changes, major redesigns, incompatible data format changes
  - **MINOR**: New features, significant additions (e.g., new sync method, sorting, tags)
  - **PATCH**: Bug fixes, minor improvements, documentation updates

### Agent Responsibilities
- **Always update version** when making changes:
  - New features → increment MINOR version (e.g., 1.0.0 → 1.1.0)
  - Bug fixes → increment PATCH version (e.g., 1.1.0 → 1.1.1)
  - Breaking changes → increment MAJOR version (e.g., 1.1.0 → 2.0.0)
- Update both `APP_VERSION` in `app.js` and `CACHE_VERSION` in `sw.js`
- Keep versions synchronized between app and service worker
- Document version changes in commit messages
- **Always update agents.md** when making changes:
  - Update relevant sections to reflect new features, behavior changes, or bug fixes
  - Add new sections if introducing new functionality
  - Keep code examples, flows, and architecture descriptions accurate
  - Ensure consistency between code implementation and documentation

### Version History
- **3.6.0** (2025-12-31): Feature: All book covers are now cached for offline availability. Added convertImageToDataUri(), cacheBookCover(), and migrateExistingCovers() functions. Book covers are downloaded and stored as base64 data URIs in the cachedCover property when books are added. Existing book covers are migrated automatically on app load. Display logic updated to prefer cached covers over URLs for offline reliability. Only coverUrl is synced to cloud to keep TSV file size manageable.
- **3.5.18** (2025-12-17): UX Update: Removed update notification popup. Updates are now applied automatically with a page reload when a new version is detected.
- **3.5.17** (2025-12-16): UI Fix: Adjusted book detail modal to respect safe area insets (notch) in both portrait and landscape modes. Added padding to book metadata to prevent title from overlapping with the close button.
- **3.5.16** (2025-12-16): Bug Fix: Fixed issue where bottom navigation would disappear in landscape mode due to incorrect keyboard detection logic. Added proper width change detection to distinguish between rotation and keyboard events.
- **3.5.15** (2025-12-16): UI Fix: Fixed bottom navigation positioning. Set bottom padding to 20px in both portrait and landscape to match right padding, and improved landscape visibility by removing height restrictions and respecting safe area insets.
- **3.5.14** (2025-12-16): UI Fix: Adjusted bottom navigation bar positioning. Reduced bottom padding in portrait mode and fixed visibility issue in landscape mode by respecting safe area insets correctly.
- **3.5.13** (2025-12-16): UI Update: Removed rounded corners from app icons (square background) for better platform adaptability.
- **3.5.12** (2025-12-16): UI Update: Updated app icons with a thinner stroke (0.65px) and accent color (#0a84ff) for the book symbol, matching the active state of the bottom navigation bar.
- **3.5.11** (2025-12-16): UI Update: Refined app icons with a dark background (#1c1c1e) and thinner white stroke (1.3px) for a sleeker, more modern look.
- **3.5.10** (2025-12-16): UI Update: Updated app icons (favicon, PWA icons) to use the same open book symbol as the "Books" tab, replacing the previous emoji-based icons.
- **3.5.9** (2025-12-16): UI Update: Removed list status buttons (To Read/Reading/Read) and delete button from book cards in the "Books" tab list view for a cleaner interface.
- **3.5.8** (2025-12-16): Bug Fix: Fixed issue where rating section would not appear immediately when moving a book to "Read" list in the detail view.
- **3.5.7** (2025-12-16): UI Update: Moved tags and rating section in book detail view to be positioned between the list action buttons and the book description.
- **3.5.6** (2025-12-16): Code Refactor: Fully unified `showBookDetail` logic to ensure identical rendering for library books regardless of entry point (Search vs List), fixing missing Edit button in search view.
- **3.5.5** (2025-12-16): Unified book detail view actions - now uses the same pill selector and circular buttons (edit/delete) for both search results and existing library books.
- **3.5.4** (2025-12-16): Updated book detail layout to display cover image side-by-side with book metadata (title, author, etc.) for better use of space.
- **3.5.3** (2025-12-16): Increased max-width of book detail modal on larger screens (tablets/desktop) to 900px to better utilize horizontal space.
- **3.5.2** (2025-12-16): Updated "Add" button style in book detail view to exactly match the dimensions, icon size, and label spacing of the list selector pill.
- **3.5.1** (2025-12-16): Refined book detail UI - added labels to list selector pills, updated "Add" button style (pill-shaped, vertical layout), and increased spacing between actions and description.
- **3.5.0** (2025-12-16): Redesigned book detail view from search results. Now shows a single "Add" button initially. Upon adding, it transforms into a pill selector for list status (To Read, Reading, Read) and a separate circular delete button.
- **3.4.2** (2025-12-16): Changed search input placeholder in Add view to "Add new books...".
- **3.4.1** (2025-12-16): Changed title of Add view from "Add Book" to "Add" for consistency with navigation label.
- **3.4.0** (2025-12-16): Redesigned bottom navigation bar - now a floating pill-shaped bar positioned at the bottom-right of the screen.
- **3.3.0** (2025-12-15): Replaced native datalist with a custom tag selection UI. Added a dedicated button next to the tag input that opens a panel of existing tags for easy selection.
- **3.2.4** (2025-12-15): Fixed datalist dropdown alignment by styling the native indicator directly with the custom icon, ensuring the visual icon matches the clickable area.
- **3.2.3** (2025-12-15): Moved datalist dropdown icon to input background to guarantee visibility across all browsers, while keeping native click behavior.
- **3.2.2** (2025-12-15): Replaced native datalist dropdown arrow with custom white SVG icon to ensure visibility in all dark mode environments.
- **3.2.1** (2025-12-15): Fixed invisible datalist dropdown arrow in dark mode by inverting the indicator color.
- **3.2.0** (2025-12-15): Added tag suggestions in book detail view - users can now select from existing tags when adding new tags to a book.
- **3.1.5** (2025-12-13): Moved edit button to action bar as icon-only button next to delete button
- **3.1.4** (2025-12-13): Fixed placeholder SVG by switching to base64 encoding for better cross-browser compatibility
- **3.1.3** (2025-12-13): Replaced emoji-based placeholder with geometric book icon (lines and rectangle) for better browser compatibility
- **3.1.2** (2025-12-13): Fixed duplicate rect element in search result placeholder SVG
- **3.1.1** (2025-12-13): Made ISBN field editable when editing existing books, validates for duplicates and updates book ID accordingly
- **3.1.0** (2025-12-13): Made ISBN field mandatory for manual book entry to ensure all books can sync to cloud
- **3.0.6** (2025-12-13): Changed default tab to Books view on app startup (previously was Add view)
- **3.0.5** (2025-12-13): Added automatic push of sanitized TSV when double quotes detected - tracks if sanitization occurred during parsing and automatically pushes fixed version back to server
- **3.0.4** (2025-12-13): Changed quote handling - double quotes (`"`) now replaced with single quotes (`'`) in TSV, applied to both new entries and pre-existing data, making `"` illegal in text fields. When double quotes detected during sync, sanitized TSV is automatically pushed back to server.
- **3.0.3** (2025-12-13): Properly implemented backslash-escaped quotes - `"` → `\"` when saving to TSV, `\"` → `"` when reading/displaying
- **3.0.2** (2025-12-13): Fixed text field escaping - double quotes are now replaced with spaces (same as tabs/newlines) instead of using "" escaping
- **3.0.1** (2025-12-13): Added double quote escaping in TSV export/import - quotes are now escaped as "" (two double quotes) in text fields, and unescaped when parsing to handle existing data correctly
- **3.0.0** (2025-12-13): **BREAKING CHANGE** - Migrated from tag-based list tracking to timestamp-based columns (addedAt, startedAt, finishedAt). Books now determine list status from timestamps instead of tags. Added dynamic sort options (Started At for Reading/Read lists, Finished At for Read list). Includes automatic migration from legacy tag system. Updated TSV format with new timestamp columns at start.
- **2.11.1** (2025-12-12): Fixed modal closing bug, moved toast notifications to safe area (above notch), increased toast duration to 4 seconds
- **2.11.0** (2025-12-12): Fixed search detail modal - buttons now show active state for existing books, clicking buttons adds/changes list without closing modal
- **2.10.0** (2025-12-12): Reduced button label spacing, added dismiss buttons to all alerts/banners (no auto-hide)
- **2.9.0** (2025-12-12): Simplified search results in Add tab - removed list action icons from results, added labels below buttons in detail modal when viewing from search
- **2.8.2** (2025-12-12): Removed grey background from filter section in Books tab for cleaner appearance
- **2.8.1** (2025-12-12): Fixed vertical alignment of clear button in Books tab search field
- **2.8.0** (2025-12-12): Added clear buttons (X) to both search fields - appears when text is present, clears input and refocuses on tap
- **2.7.2** (2025-12-12): Fixed search result icon highlighting to match books by both Google Books ID and ISBN
- **2.7.1** (2025-12-12): Removed book description from book cards in Books view - descriptions now only shown in full-page detail modal
- **2.7.0** (2025-12-12): Search results now highlight list status icons if book already exists in database, clicking icon changes list status instead of re-adding
- **2.6.4** (2025-12-12): Increased Google Books API search debounce from 500ms to 1000ms to reduce unnecessary API calls
- **2.6.3** (2025-12-12): Disabled zoom in PWA by adding maximum-scale=1.0 and user-scalable=no to viewport meta tag
- **2.6.2** (2025-12-12): Added confirmation dialog before deleting books - shows book title and "cannot be undone" warning
- **2.6.1** (2025-12-12): Fixed combined tag filtering - changed from .some() to .every() so books must match ALL selected tags
- **2.6.0** (2025-12-12): Enhanced tag filter system - dynamic manual tags with orange accent, removed "All" filter, multi-group filtering (list + manual), toggle deselection, vertical separator, alphabetical sorting
- **2.5.1** (2025-12-12): Fixed monospace font to apply to all elements including buttons using !important
- **2.5.0** (2025-12-12): Changed font to monospace for entire interface
- **2.4.2** (2025-12-12): Optimized update check frequency - checks on focus (if >30 mins since last), every 30 mins while focused, stops when unfocused for battery savings
- **2.4.1** (2025-12-12): Improved app update detection with automatic update banner, better user messaging, automatic update checks every 60 seconds
- **2.4.0** (2025-12-12): Enforced TSV column order (addedAt, isbn, tags, title, author, year, coverUrl, description), automatic column reordering on sync if wrong order detected
- **2.3.1** (2025-12-12): Improved manual entry UX - removed cover preview from top, removed asterisks, reordered fields, added dedicated "Save Book" button, list buttons now toggle instead of immediate save
- **2.3.0** (2025-12-12): Added manual book entry feature with dedicated modal, manual entry button at bottom of search results
- **2.2.0** (2025-12-12): Denormalized TSV structure with all book metadata fields (title, author, year, description, coverUrl), added book metadata editing UI, automatic column handling for backward compatibility, smart API fallback for any missing fields

## Code Style Guidelines

### JavaScript
- Use ES6+ features (arrow functions, template literals, destructuring)
- Avoid jQuery or frameworks
- Functions: verb + noun naming (e.g., `showBookDetail`, `addBookToList`)
- Event handlers inline in HTML for simple actions, addEventListener for complex
- No semicolons (consistent with existing code)

### CSS
- Mobile-first approach
- Use CSS variables for colors
- BEM-like naming without strict BEM
- Avoid !important
- Group related styles together

### HTML
- Semantic elements where possible
- Accessibility: title attributes on icon buttons
- SVG icons inline for performance
- No unnecessary divs

## Testing Checklist
- [ ] Search finds books by title
- [ ] Search finds books by author
- [ ] Search finds translated titles
- [ ] Add book to each list
- [ ] Move book between lists
- [ ] Delete book from list
- [ ] Detail modal opens/closes
- [ ] Data persists on reload
- [ ] Works offline (after first load)
- [ ] Bottom nav switches views
- [ ] Toast notifications appear
- [ ] Error handling for API failures
- [ ] Responsive on mobile
- [ ] Safe area handling on notched devices
- [ ] Keyboard doesn't overlap bottom nav
