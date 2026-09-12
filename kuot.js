// Numero di build, letto dal ?v= sul tag di questo script.
const APP_BUILD = (() => {
    const src = (document.currentScript && document.currentScript.src) || '';
    const m = src.match(/[?&]v=(\d+)/);
    return m ? m[1] : '?';
})();

// Vero solo dentro il guscio Android, mai in una scheda del browser.
function isCapacitorNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

document.addEventListener('DOMContentLoaded', () => {
    if (isCapacitorNative()) document.body.classList.add('capacitor');
    const tag = document.getElementById('build-tag');
    if (tag) tag.textContent = 'v' + APP_BUILD;
});

// ===== KUOT APP - MAIN JAVASCRIPT FILE =====

class KuotApp {
    constructor() {
        this.quotes = [];
        this.currentQuoteIndex = 0;
        this.filteredQuotes = [];
        this.currentFilter = 'all';
        this.currentSort = 'recent';
        this.searchQuery = '';
        this.dailyQuoteDate = null;
        this.dailyQuoteIndex = -1;
        this.usedQuoteIndexes = [];
        this.currentTheme = 'serene';
        
        // Initialize the app
        this.init();
    }

    async init() {
        try {
            // Initialize storage
            await this.initStorage();
            
            // Load data
            await this.loadQuotes();
            await this.loadSettings();
            
            // Setup UI
            this.setupEventListeners();
            this.updateCurrentDate();
            this.applyTheme();
            
            // Load initial content
            this.updateDailyQuote();
            this.updateLibraryView();
            
            console.log('Kuot App initialized successfully');
        } catch (error) {
            console.error('Error initializing app:', error);
            this.showError('Failed to initialize app');
        }
    }

    // ===== STORAGE SYSTEM (IndexedDB with localStorage fallback) =====
    async initStorage() {
        this.useIndexedDB = false;
        
        try {
            // Try to initialize IndexedDB
            if ('indexedDB' in window) {
                await this.initIndexedDB();
                this.useIndexedDB = true;
                console.log('Using IndexedDB for storage');
            } else {
                throw new Error('IndexedDB not supported');
            }
        } catch (error) {
            console.warn('IndexedDB failed, falling back to localStorage:', error);
            this.useIndexedDB = false;
        }
    }

    initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('KuotDB', 1);
            
            request.onerror = () => reject(request.error);
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create quotes store
                if (!db.objectStoreNames.contains('quotes')) {
                    const quotesStore = db.createObjectStore('quotes', { keyPath: 'id', autoIncrement: true });
                    quotesStore.createIndex('date', 'date', { unique: false });
                    quotesStore.createIndex('author', 'author', { unique: false });
                }
                
                // Create settings store
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
        });
    }

    async saveQuotes() {
        try {
            if (this.useIndexedDB) {
                const transaction = this.db.transaction(['quotes'], 'readwrite');
                const store = transaction.objectStore('quotes');
                
                // Clear existing quotes
                await new Promise((resolve, reject) => {
                    const clearRequest = store.clear();
                    clearRequest.onsuccess = () => resolve();
                    clearRequest.onerror = () => reject(clearRequest.error);
                });
                
                // Add all quotes
                for (const quote of this.quotes) {
                    await new Promise((resolve, reject) => {
                        const addRequest = store.add(quote);
                        addRequest.onsuccess = () => resolve();
                        addRequest.onerror = () => reject(addRequest.error);
                    });
                }
            } else {
                // Fallback to localStorage
                localStorage.setItem('kuot_quotes', JSON.stringify(this.quotes));
            }
        } catch (error) {
            console.error('Error saving quotes:', error);
            // Try localStorage as backup
            try {
                localStorage.setItem('kuot_quotes', JSON.stringify(this.quotes));
            } catch (e) {
                console.error('Failed to save to localStorage as well:', e);
                throw new Error('Failed to save quotes');
            }
        }
    }

    async loadQuotes() {
        try {
            if (this.useIndexedDB) {
                const transaction = this.db.transaction(['quotes'], 'readonly');
                const store = transaction.objectStore('quotes');
                
                const quotes = await new Promise((resolve, reject) => {
                    const request = store.getAll();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                
                this.quotes = quotes || [];
            } else {
                // Fallback to localStorage
                const saved = localStorage.getItem('kuot_quotes');
                this.quotes = saved ? JSON.parse(saved) : [];
            }
        } catch (error) {
            console.error('Error loading quotes:', error);
            this.quotes = [];
        }
    }

    async saveSettings() {
        const settings = {
            theme: this.currentTheme,
            dailyQuoteDate: this.dailyQuoteDate,
            dailyQuoteIndex: this.dailyQuoteIndex,
            usedQuoteIndexes: this.usedQuoteIndexes
        };

        try {
            if (this.useIndexedDB) {
                const transaction = this.db.transaction(['settings'], 'readwrite');
                const store = transaction.objectStore('settings');
                
                for (const [key, value] of Object.entries(settings)) {
                    await new Promise((resolve, reject) => {
                        const request = store.put({ key, value });
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    });
                }
            } else {
                localStorage.setItem('kuot_settings', JSON.stringify(settings));
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            try {
                localStorage.setItem('kuot_settings', JSON.stringify(settings));
            } catch (e) {
                console.error('Failed to save settings to localStorage:', e);
            }
        }
    }

    async loadSettings() {
        try {
            let settings = {};
            
            if (this.useIndexedDB) {
                const transaction = this.db.transaction(['settings'], 'readonly');
                const store = transaction.objectStore('settings');
                
                const keys = ['theme', 'dailyQuoteDate', 'dailyQuoteIndex', 'usedQuoteIndexes'];
                for (const key of keys) {
                    const result = await new Promise((resolve, reject) => {
                        const request = store.get(key);
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                    if (result) {
                        settings[key] = result.value;
                    }
                }
            } else {
                const saved = localStorage.getItem('kuot_settings');
                settings = saved ? JSON.parse(saved) : {};
            }

            this.currentTheme = settings.theme || 'serene';
            this.dailyQuoteDate = settings.dailyQuoteDate;
            this.dailyQuoteIndex = settings.dailyQuoteIndex || -1;
            this.usedQuoteIndexes = settings.usedQuoteIndexes || [];
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    // ===== IMAGE PROCESSING =====
    processImage(file, maxSize = 800, quality = 0.8) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            img.onload = () => {
                // Calculate dimensions
                let { width, height } = img;
                const maxDimension = Math.max(width, height);
                
                if (maxDimension > maxSize) {
                    const ratio = maxSize / maxDimension;
                    width *= ratio;
                    height *= ratio;
                }
                
                // Set canvas size
                canvas.width = width;
                canvas.height = height;
                
                // Draw and compress
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to blob
                canvas.toBlob(resolve, 'image/jpeg', quality);
            };
            
            img.src = URL.createObjectURL(file);
        });
    }

    async imageToDataURL(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }

    // ===== DAILY QUOTE LOGIC =====
    updateDailyQuote() {
        const today = new Date().toDateString();
        
        // Check if we need a new daily quote
        if (this.dailyQuoteDate !== today || this.dailyQuoteIndex === -1) {
            this.generateDailyQuote();
            this.dailyQuoteDate = today;
            this.saveSettings();
        }
        
        this.displayDailyQuote();
    }

    generateDailyQuote() {
        if (this.quotes.length === 0) {
            this.dailyQuoteIndex = -1;
            return;
        }
        
        // If we've used all quotes, reset the deck
        if (this.usedQuoteIndexes.length >= this.quotes.length) {
            this.usedQuoteIndexes = [];
        }
        
        // Find available quotes
        const availableIndexes = this.quotes
            .map((_, index) => index)
            .filter(index => !this.usedQuoteIndexes.includes(index));
        
        if (availableIndexes.length === 0) {
            this.usedQuoteIndexes = [];
            this.dailyQuoteIndex = Math.floor(Math.random() * this.quotes.length);
        } else {
            this.dailyQuoteIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
        }
        
        this.usedQuoteIndexes.push(this.dailyQuoteIndex);
    }

    displayDailyQuote() {
        const container = document.getElementById('dailyQuote');
        
        if (this.quotes.length === 0 || this.dailyQuoteIndex === -1) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">💭</div>
                    <h2>Waiting for Quotes</h2>
                    <p>Start your collection of wisdom</p>
                    <button class="cta-button" onclick="app.switchTab('add')">Add Your First Quote</button>
                </div>
            `;
            return;
        }
        
        const quote = this.quotes[this.dailyQuoteIndex];
        const authorInitials = this.getAuthorInitials(quote.author);
        
        container.innerHTML = `
            <div class="quote-content fade-in">
                <div class="quote-text">${this.escapeHtml(quote.text)}</div>
                <div class="quote-meta">
                    ${quote.photo ? 
                        `<img src="${quote.photo}" alt="${quote.author}" class="author-photo clickable-image" onclick="app.openImageModal('${quote.photo}', '${this.escapeHtml(quote.author)}')">` :
                        `<div class="author-initials">${authorInitials}</div>`
                    }
                    <div class="author-info">
                        <div class="author-name">${this.escapeHtml(quote.author)}</div>
                        <div class="quote-date">${this.formatDate(quote.date)}</div>
                    </div>
                </div>
                <div class="quote-actions">
                    <button class="action-btn favorite ${quote.favorite ? 'active' : ''}" 
                            onclick="app.toggleFavorite(${this.dailyQuoteIndex})">
                        <span>${quote.favorite ? '★' : '☆'}</span>
                        Favorite
                    </button>
                    <button class="action-btn" onclick="app.openEditModal(${this.dailyQuoteIndex})">
                        <span>✏️</span>
                        Edit
                    </button>
                    <button class="action-btn" onclick="app.shareQuote(${this.dailyQuoteIndex})">
                        <span>📤</span>
                        Share
                    </button>
                </div>
            </div>
        `;
    }

    // ===== NAVIGATION =====
    switchTab(tabName) {
        // Update navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === tabName);
        });
        
        // Update screens
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.toggle('active', screen.id === `${tabName}Screen`);
        });
        
        // Load content for specific tabs
        if (tabName === 'library') {
            this.updateLibraryView();
        } else if (tabName === 'add') {
            this.resetAddForm();
        }
    }

    // ===== ADD QUOTE FUNCTIONALITY =====
    setupEventListeners() {
        // Form submission
        document.getElementById('addQuoteForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addQuote();
        });
        
        // Edit form submission
        document.getElementById('editQuoteForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveEditedQuote();
        });
        
        // Character counter
        const quoteTextarea = document.getElementById('quoteText');
        quoteTextarea.addEventListener('input', this.updateCharCounter);
        
        // Character counter for edit form
        const editQuoteTextarea = document.getElementById('editQuoteText');
        editQuoteTextarea.addEventListener('input', this.updateEditCharCounter);
        
        // Photo upload
        document.getElementById('photoInput').addEventListener('change', this.handlePhotoUpload.bind(this));
        
        // Edit photo upload
        document.getElementById('editPhotoInput').addEventListener('change', this.handleEditPhotoUpload.bind(this));
        
        // Search and filters
        document.getElementById('searchInput').addEventListener('input', this.handleSearch.bind(this));
        document.getElementById('sortSelect').addEventListener('change', this.handleSort.bind(this));
        
        // Filter chips
        document.querySelectorAll('.chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
                this.currentFilter = e.target.dataset.filter;
                this.updateLibraryView();
            });
        });
        
        // Theme selector
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const theme = e.currentTarget.dataset.theme;
                this.setTheme(theme);
            });
        });
        
        // Set current year as default
        const currentYear = new Date().getFullYear();
        document.getElementById('quoteDate').value = currentYear.toString();
        
        // Add date input formatting
        document.getElementById('quoteDate').addEventListener('blur', this.formatDateInput.bind(this));
        document.getElementById('editQuoteDate').addEventListener('blur', this.formatDateInput.bind(this));
    }

    updateCharCounter() {
        const textarea = document.getElementById('quoteText');
        const counter = document.querySelector('.char-counter');
        const current = textarea.value.length;
        const max = textarea.getAttribute('maxlength');
        
        counter.textContent = `${current}/${max}`;
        counter.style.color = current > max * 0.9 ? 'var(--warning)' : 'var(--text-secondary)';
    }

    async handlePhotoUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        try {
            // Process image
            const processedBlob = await this.processImage(file);
            const dataURL = await this.imageToDataURL(processedBlob);
            
            // Show preview
            const placeholder = document.querySelector('.photo-placeholder');
            const preview = document.querySelector('.photo-preview');
            const previewImg = document.getElementById('photoPreview');
            
            placeholder.style.display = 'none';
            preview.style.display = 'block';
            previewImg.src = dataURL;
            
            // Store processed image data
            this.tempPhotoData = dataURL;
        } catch (error) {
            console.error('Error processing image:', error);
            this.showError('Failed to process image');
        }
    }

    removePhoto(event) {
        event.stopPropagation();
        
        const placeholder = document.querySelector('.photo-placeholder');
        const preview = document.querySelector('.photo-preview');
        
        placeholder.style.display = 'flex';
        preview.style.display = 'none';
        
        document.getElementById('photoInput').value = '';
        delete this.tempPhotoData;
    }

    async addQuote() {
        const form = document.getElementById('addQuoteForm');
        const submitBtn = form.querySelector('.submit-btn');
        
        // Get form data
        const text = document.getElementById('quoteText').value.trim();
        const author = document.getElementById('authorName').value.trim();
        const date = document.getElementById('quoteDate').value;
        
        // Validate
        if (!text || !author) {
            this.showError('Please fill in all required fields');
            return;
        }
        
        try {
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;
            
            // Create quote object
            const quote = {
                id: Date.now(),
                text,
                author,
                date: date || new Date().getFullYear().toString(),
                dateStandardized: this.standardizeDate(date || new Date().getFullYear().toString()),
                photo: this.tempPhotoData || null,
                favorite: false,
                createdAt: new Date().toISOString()
            };
            
            // Add to quotes array
            this.quotes.unshift(quote);
            
            // Save to storage
            await this.saveQuotes();
            
            // Reset form and switch to library
            this.resetAddForm();
            this.switchTab('library');
            
            // Update daily quote if this is the first quote
            if (this.quotes.length === 1) {
                this.updateDailyQuote();
            }
            
            this.showSuccess('Quote added successfully!');
        } catch (error) {
            console.error('Error adding quote:', error);
            this.showError('Failed to add quote');
        } finally {
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
        }
    }

    resetAddForm() {
        document.getElementById('addQuoteForm').reset();
        
        const placeholder = document.querySelector('.photo-placeholder');
        const preview = document.querySelector('.photo-preview');
        
        placeholder.style.display = 'flex';
        preview.style.display = 'none';
        
        delete this.tempPhotoData;
        
        // Set current year as default
        const currentYear = new Date().getFullYear();
        document.getElementById('quoteDate').value = currentYear.toString();
        
        this.updateCharCounter();
    }

    // ===== LIBRARY VIEW =====
    updateLibraryView() {
        this.applyFiltersAndSort();
        this.renderQuotesGrid();
    }

    applyFiltersAndSort() {
        let filtered = [...this.quotes];
        
        // Apply search filter
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter(quote => 
                quote.text.toLowerCase().includes(query) ||
                quote.author.toLowerCase().includes(query)
            );
        }
        
        // Apply category filter
        switch (this.currentFilter) {
            case 'favorites':
                filtered = filtered.filter(quote => quote.favorite);
                break;
            case 'recent':
                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);
                filtered = filtered.filter(quote => new Date(quote.createdAt) > weekAgo);
                break;
        }
        
        // Apply sorting
        switch (this.currentSort) {
            case 'alphabetical':
                filtered.sort((a, b) => a.text.localeCompare(b.text));
                break;
            case 'random':
                filtered = this.shuffleArray([...filtered]);
                break;
            case 'recent':
            default:
                filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                break;
        }
        
        this.filteredQuotes = filtered;
    }

    renderQuotesGrid() {
        const container = document.getElementById('quotesGrid');
        
        if (this.filteredQuotes.length === 0) {
            const emptyMessage = this.quotes.length === 0 ? 
                'No quotes yet' : 
                `No quotes found${this.searchQuery ? ` for "${this.searchQuery}"` : ''}`;
            
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📚</div>
                    <h2>${emptyMessage}</h2>
                    <p>${this.quotes.length === 0 ? 'Your collection will appear here' : 'Try adjusting your search or filters'}</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = this.filteredQuotes.map((quote, index) => {
            const originalIndex = this.quotes.indexOf(quote);
            const authorInitials = this.getAuthorInitials(quote.author);
            
            return `
                <div class="quote-card" onclick="app.openQuoteModal(${originalIndex})">
                    <div class="quote-card-actions">
                        <button class="card-action-btn favorite ${quote.favorite ? 'active' : ''}" 
                                onclick="app.toggleFavorite(${originalIndex}, event)">
                            ${quote.favorite ? '★' : '☆'}
                        </button>
                        <button class="card-action-btn edit" 
                                onclick="app.openEditModal(${originalIndex}, event)">
                            ✏️
                        </button>
                        <button class="card-action-btn delete" 
                                onclick="app.deleteQuote(${originalIndex}, event)">
                            🗑️
                        </button>
                    </div>
                    <div class="quote-card-text">${this.escapeHtml(quote.text)}</div>
                    <div class="quote-card-meta">
                        ${quote.photo ? 
                            `<img src="${quote.photo}" alt="${quote.author}" class="quote-card-photo clickable-image" onclick="app.openImageModal('${quote.photo}', '${this.escapeHtml(quote.author)}'); event.stopPropagation();">` :
                            `<div class="quote-card-initials">${authorInitials}</div>`
                        }
                        <div class="quote-card-author">${this.escapeHtml(quote.author)}</div>
                        <div class="quote-card-date">${this.formatDate(quote.date)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    handleSearch(event) {
        this.searchQuery = event.target.value.trim();
        this.updateLibraryView();
    }

    handleSort(event) {
        this.currentSort = event.target.value;
        this.updateLibraryView();
    }

    // ===== QUOTE MANAGEMENT =====
    async toggleFavorite(index, event = null) {
        if (event) {
            event.stopPropagation();
        }
        
        if (index >= 0 && index < this.quotes.length) {
            this.quotes[index].favorite = !this.quotes[index].favorite;
            await this.saveQuotes();
            
            // Update displays
            this.updateLibraryView();
            if (index === this.dailyQuoteIndex) {
                this.displayDailyQuote();
            }
        }
    }

    async deleteQuote(index, event) {
        event.stopPropagation();
        
        if (!confirm('Are you sure you want to delete this quote?')) {
            return;
        }
        
        try {
            this.quotes.splice(index, 1);
            await this.saveQuotes();
            
            // Update daily quote if necessary
            if (index === this.dailyQuoteIndex) {
                this.generateDailyQuote();
                this.displayDailyQuote();
            } else if (index < this.dailyQuoteIndex) {
                this.dailyQuoteIndex--;
            }
            
            // Remove from used indexes
            this.usedQuoteIndexes = this.usedQuoteIndexes
                .map(i => i > index ? i - 1 : i)
                .filter(i => i !== index);
            
            await this.saveSettings();
            this.updateLibraryView();
            
            this.showSuccess('Quote deleted successfully');
        } catch (error) {
            console.error('Error deleting quote:', error);
            this.showError('Failed to delete quote');
        }
    }

    shareQuote(index) {
        const quote = this.quotes[index];
        if (!quote) return;
        
        const shareText = `"${quote.text}" - ${quote.author}`;
        
        if (navigator.share) {
            navigator.share({
                title: 'Kuot Quote',
                text: shareText
            });
        } else {
            // Fallback: copy to clipboard
            navigator.clipboard.writeText(shareText).then(() => {
                this.showSuccess('Quote copied to clipboard!');
            }).catch(() => {
                this.showError('Failed to copy quote');
            });
        }
    }

    // ===== QUOTE MODAL =====
    openQuoteModal(index) {
        this.currentQuoteIndex = index;
        const modal = document.getElementById('quoteModal');
        const content = document.getElementById('modalQuoteContent');
        
        this.renderModalQuote();
        modal.classList.add('active');
        
        // Update navigation buttons
        this.updateModalNavigation();
    }

    closeQuoteModal() {
        document.getElementById('quoteModal').classList.remove('active');
    }

    navigateQuote(direction) {
        const newIndex = this.currentQuoteIndex + direction;
        
        if (newIndex >= 0 && newIndex < this.filteredQuotes.length) {
            const originalIndex = this.quotes.indexOf(this.filteredQuotes[newIndex]);
            this.currentQuoteIndex = originalIndex;
            this.renderModalQuote();
            this.updateModalNavigation();
        }
    }

    renderModalQuote() {
        const quote = this.quotes[this.currentQuoteIndex];
        if (!quote) return;
        
        const authorInitials = this.getAuthorInitials(quote.author);
        const content = document.getElementById('modalQuoteContent');
        
        content.innerHTML = `
            <div class="quote-content">
                <div class="quote-text">${this.escapeHtml(quote.text)}</div>
                <div class="quote-meta">
                    ${quote.photo ? 
                        `<img src="${quote.photo}" alt="${quote.author}" class="author-photo clickable-image" onclick="app.openImageModal('${quote.photo}', '${this.escapeHtml(quote.author)}')">` :
                        `<div class="author-initials">${authorInitials}</div>`
                    }
                    <div class="author-info">
                        <div class="author-name">${this.escapeHtml(quote.author)}</div>
                        <div class="quote-date">${this.formatDate(quote.date)}</div>
                    </div>
                </div>
                <div class="quote-actions">
                    <button class="action-btn favorite ${quote.favorite ? 'active' : ''}" 
                            onclick="app.toggleFavorite(${this.currentQuoteIndex})">
                        <span>${quote.favorite ? '★' : '☆'}</span>
                        Favorite
                    </button>
                    <button class="action-btn" onclick="app.openEditModal(${this.currentQuoteIndex})">
                        <span>✏️</span>
                        Edit
                    </button>
                    <button class="action-btn" onclick="app.shareQuote(${this.currentQuoteIndex})">
                        <span>📤</span>
                        Share
                    </button>
                </div>
            </div>
        `;
    }

    updateModalNavigation() {
        const currentFilteredIndex = this.filteredQuotes.findIndex(q => 
            this.quotes.indexOf(q) === this.currentQuoteIndex
        );
        
        const prevBtn = document.querySelector('.nav-btn.prev');
        const nextBtn = document.querySelector('.nav-btn.next');
        
        prevBtn.disabled = currentFilteredIndex <= 0;
        nextBtn.disabled = currentFilteredIndex >= this.filteredQuotes.length - 1;
    }

    // ===== THEME SYSTEM =====
    setTheme(theme) {
        this.currentTheme = theme;
        this.applyTheme();
        this.saveSettings();
    }

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.currentTheme);
        
        // Update theme selector
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === this.currentTheme);
        });
    }

    // ===== EDIT QUOTE FUNCTIONALITY =====
    openEditModal(index, event = null) {
        if (event) {
            event.stopPropagation();
        }
        
        if (index < 0 || index >= this.quotes.length) {
            return;
        }
        
        this.currentEditIndex = index;
        const quote = this.quotes[index];
        
        // Populate form with existing data
        document.getElementById('editQuoteText').value = quote.text;
        document.getElementById('editAuthorName').value = quote.author;
        document.getElementById('editQuoteDate').value = quote.date;
        
        // Handle photo
        const placeholder = document.getElementById('editPhotoPlaceholder');
        const preview = document.getElementById('editPhotoPreview');
        const previewImg = document.getElementById('editPhotoPreviewImg');
        
        if (quote.photo) {
            placeholder.style.display = 'none';
            preview.style.display = 'block';
            previewImg.src = quote.photo;
            this.tempEditPhotoData = quote.photo;
        } else {
            placeholder.style.display = 'flex';
            preview.style.display = 'none';
            delete this.tempEditPhotoData;
        }
        
        // Update character counter
        this.updateEditCharCounter();
        
        // Close quote modal if open
        this.closeQuoteModal();
        
        // Show edit modal
        const modal = document.getElementById('editQuoteModal');
        modal.classList.add('active');
    }
    
    closeEditModal() {
        const modal = document.getElementById('editQuoteModal');
        modal.classList.remove('active');
        
        // Clear form
        document.getElementById('editQuoteForm').reset();
        const placeholder = document.getElementById('editPhotoPlaceholder');
        const preview = document.getElementById('editPhotoPreview');
        placeholder.style.display = 'flex';
        preview.style.display = 'none';
        delete this.tempEditPhotoData;
        delete this.currentEditIndex;
    }
    
    updateEditCharCounter() {
        const textarea = document.getElementById('editQuoteText');
        const counter = document.querySelector('#editQuoteForm .char-counter');
        const current = textarea.value.length;
        const max = textarea.getAttribute('maxlength');
        
        counter.textContent = `${current}/${max}`;
        counter.style.color = current > max * 0.9 ? 'var(--warning)' : 'var(--text-secondary)';
    }
    
    async handleEditPhotoUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        try {
            // Process image
            const processedBlob = await this.processImage(file);
            const dataURL = await this.imageToDataURL(processedBlob);
            
            // Show preview
            const placeholder = document.getElementById('editPhotoPlaceholder');
            const preview = document.getElementById('editPhotoPreview');
            const previewImg = document.getElementById('editPhotoPreviewImg');
            
            placeholder.style.display = 'none';
            preview.style.display = 'block';
            previewImg.src = dataURL;
            
            // Store processed image data
            this.tempEditPhotoData = dataURL;
        } catch (error) {
            console.error('Error processing image:', error);
            this.showError('Failed to process image');
        }
    }
    
    removeEditPhoto(event) {
        event.stopPropagation();
        
        const placeholder = document.getElementById('editPhotoPlaceholder');
        const preview = document.getElementById('editPhotoPreview');
        
        placeholder.style.display = 'flex';
        preview.style.display = 'none';
        
        document.getElementById('editPhotoInput').value = '';
        delete this.tempEditPhotoData;
    }
    
    async saveEditedQuote() {
        if (this.currentEditIndex === undefined || this.currentEditIndex < 0 || this.currentEditIndex >= this.quotes.length) {
            this.showError('Invalid quote index');
            return;
        }
        
        const form = document.getElementById('editQuoteForm');
        const submitBtn = form.querySelector('.submit-btn');
        
        // Get form data
        const text = document.getElementById('editQuoteText').value.trim();
        const author = document.getElementById('editAuthorName').value.trim();
        const date = document.getElementById('editQuoteDate').value;
        
        // Validate
        if (!text || !author) {
            this.showError('Please fill in all required fields');
            return;
        }
        
        try {
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;
            
            // Update quote object
            const quote = this.quotes[this.currentEditIndex];
            quote.text = text;
            quote.author = author;
            quote.date = date || quote.date; // Keep original date if not changed
            quote.dateStandardized = this.standardizeDate(date || quote.date);
            quote.photo = this.tempEditPhotoData || null;
            quote.updatedAt = new Date().toISOString();
            
            // Save to storage
            await this.saveQuotes();
            
            // Close modal
            this.closeEditModal();
            
            // Update displays
            this.updateLibraryView();
            if (this.currentEditIndex === this.dailyQuoteIndex) {
                this.displayDailyQuote();
            }
            
            this.showSuccess('Quote updated successfully!');
        } catch (error) {
            console.error('Error updating quote:', error);
            this.showError('Failed to update quote');
        } finally {
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
        }
    }

    // ===== IMAGE FULLSCREEN MODAL =====
    openImageModal(imageSrc, authorName) {
        const modal = document.getElementById('imageModal');
        const fullscreenImage = document.getElementById('fullscreenImage');
        const authorNameElement = document.querySelector('.image-author-name');
        
        fullscreenImage.src = imageSrc;
        authorNameElement.textContent = authorName || '';
        
        modal.classList.add('active');
        
        // Prevent body scrolling
        document.body.style.overflow = 'hidden';
        
        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeImageModal();
            }
        });
        
        // Close on ESC key
        document.addEventListener('keydown', this.handleImageModalKeydown.bind(this));
    }
    
    closeImageModal() {
        const modal = document.getElementById('imageModal');
        modal.classList.remove('active');
        
        // Restore body scrolling
        document.body.style.overflow = '';
        
        // Remove event listeners
        document.removeEventListener('keydown', this.handleImageModalKeydown.bind(this));
    }
    
    handleImageModalKeydown(event) {
        if (event.key === 'Escape') {
            this.closeImageModal();
        }
    }

    // ===== SETTINGS =====
    toggleSettings() {
        const panel = document.getElementById('settingsPanel');
        panel.classList.toggle('active');
    }

    // ===== DATE HANDLING =====
    formatDateInput(event) {
        const input = event.target;
        const value = input.value.trim();
        
        if (!value) return;
        
        const formattedDate = this.parseAndFormatDate(value);
        if (formattedDate !== value) {
            input.value = formattedDate;
        }
    }
    
    parseAndFormatDate(dateString) {
        const cleaned = dateString.trim();
        
        // If it's already a valid format, return as is
        if (this.isValidDateFormat(cleaned)) {
            return cleaned;
        }
        
        // Try to parse various formats
        const yearOnlyMatch = cleaned.match(/^(\d{4})$/);
        if (yearOnlyMatch) {
            return yearOnlyMatch[1];
        }
        
        // Month Year format (e.g., "March 1963", "03/1963", "Mar 1963")
        const monthYearMatch = cleaned.match(/^(\w+)\s+(\d{4})$/i);
        if (monthYearMatch) {
            const month = this.parseMonth(monthYearMatch[1]);
            if (month) {
                return `${month}/${monthYearMatch[2]}`;
            }
        }
        
        // MM/YYYY format
        const mmYyyyMatch = cleaned.match(/^(\d{1,2})\/(\d{4})$/);
        if (mmYyyyMatch) {
            const month = parseInt(mmYyyyMatch[1]);
            if (month >= 1 && month <= 12) {
                return `${month.toString().padStart(2, '0')}/${mmYyyyMatch[2]}`;
            }
        }
        
        // Full date formats (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY)
        const fullDateMatch = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
        if (fullDateMatch) {
            const day = parseInt(fullDateMatch[1]);
            const month = parseInt(fullDateMatch[2]);
            const year = parseInt(fullDateMatch[3]);
            
            if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
                return `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
            }
        }
        
        // Return original if can't parse
        return cleaned;
    }
    
    isValidDateFormat(dateString) {
        // Check if it matches our accepted formats
        const formats = [
            /^\d{4}$/, // YYYY
            /^\d{1,2}\/\d{4}$/, // MM/YYYY
            /^\d{1,2}\/\d{1,2}\/\d{4}$/, // DD/MM/YYYY
        ];
        
        return formats.some(format => format.test(dateString));
    }
    
    parseMonth(monthString) {
        const months = {
            'jan': '01', 'january': '01',
            'feb': '02', 'february': '02',
            'mar': '03', 'march': '03',
            'apr': '04', 'april': '04',
            'may': '05',
            'jun': '06', 'june': '06',
            'jul': '07', 'july': '07',
            'aug': '08', 'august': '08',
            'sep': '09', 'september': '09',
            'oct': '10', 'october': '10',
            'nov': '11', 'november': '11',
            'dec': '12', 'december': '12'
        };
        
        const normalized = monthString.toLowerCase();
        return months[normalized] || null;
    }
    
    // Convert our flexible date format to a standard date for storage and display
    standardizeDate(dateString) {
        if (!dateString) return '';
        
        // Year only
        if (/^\d{4}$/.test(dateString)) {
            return `${dateString}-01-01`;
        }
        
        // Month/Year
        if (/^\d{1,2}\/\d{4}$/.test(dateString)) {
            const [month, year] = dateString.split('/');
            return `${year}-${month.padStart(2, '0')}-01`;
        }
        
        // Full date DD/MM/YYYY
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateString)) {
            const [day, month, year] = dateString.split('/');
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        
        return dateString;
    }

    // ===== UTILITY FUNCTIONS =====
    updateCurrentDate() {
        const dateElement = document.querySelector('.current-date');
        const now = new Date();
        const options = { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
        };
        dateElement.textContent = now.toLocaleDateString('en-US', options);
    }

    getAuthorInitials(author) {
        return author
            .split(' ')
            .map(word => word.charAt(0).toUpperCase())
            .slice(0, 2)
            .join('');
    }

    formatDate(dateString) {
        if (!dateString) return '';
        
        // Handle our flexible date formats
        // Year only (e.g., "1963")
        if (/^\d{4}$/.test(dateString)) {
            return dateString;
        }
        
        // Month/Year (e.g., "03/1963")
        if (/^\d{1,2}\/\d{4}$/.test(dateString)) {
            const [month, year] = dateString.split('/');
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return `${monthNames[parseInt(month) - 1]} ${year}`;
        }
        
        // Full date (e.g., "15/03/1963")
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateString)) {
            const [day, month, year] = dateString.split('/');
            const date = new Date(year, month - 1, day);
            const options = { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric' 
            };
            return date.toLocaleDateString('en-US', options);
        }
        
        // Fallback for any other format
        try {
            const date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                const options = { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                };
                return date.toLocaleDateString('en-US', options);
            }
        } catch (e) {
            // If all else fails, return the original string
        }
        
        return dateString;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'error' ? 'var(--danger)' : 'var(--success)'};
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 10000;
            animation: slideInDown 0.3s ease-out;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            font-weight: 500;
            max-width: 90%;
            text-align: center;
        `;
        notification.textContent = message;
        
        // Add animation styles
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideInDown {
                from { transform: translateX(-50%) translateY(-100%); opacity: 0; }
                to { transform: translateX(-50%) translateY(0); opacity: 1; }
            }
            @keyframes slideOutUp {
                from { transform: translateX(-50%) translateY(0); opacity: 1; }
                to { transform: translateX(-50%) translateY(-100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOutUp 0.3s ease-in forwards';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
                if (style.parentNode) {
                    style.parentNode.removeChild(style);
                }
            }, 300);
        }, 3000);
    }
}

// ===== GLOBAL FUNCTIONS (for HTML onclick handlers) =====
let app;

function switchTab(tab) {
    app.switchTab(tab);
}

function toggleSettings() {
    app.toggleSettings();
}

function removePhoto(event) {
    app.removePhoto(event);
}

function closeQuoteModal() {
    app.closeQuoteModal();
}

function navigateQuote(direction) {
    app.navigateQuote(direction);
}

function closeEditModal() {
    app.closeEditModal();
}

function removeEditPhoto(event) {
    app.removeEditPhoto(event);
}

function closeImageModal() {
    app.closeImageModal();
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    app = new KuotApp();
});

// ===== SERVICE WORKER REGISTRATION (for PWA capabilities) =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./kuot-sw.js')
            .then(registration => console.log('SW registered'))
            .catch(error => console.log('SW registration failed'));
    });
}
