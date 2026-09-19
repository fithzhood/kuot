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
//
// Settembre 2026: le citazioni si riconoscono dal loro `id`, non piu' dalla
// posizione nell'elenco. Prima la citazione del giorno, le preferite e le
// frecce della scheda usavano l'indice nell'array: bastava aggiungere una
// citazione (che finiva in testa in memoria ma in coda nel database) perche'
// "Modifica" in Home aprisse quella accanto, e le frecce saltavano a caso.

const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const RECENTI_QUANTE = 10;

// Gli stili dell'app (vedi i blocchi [data-stile] in kuot.css) e la luce:
// 'chiaro', 'scuro', oppure 'auto' che segue il telefono.
const STILI = ['serene', 'natural', 'elegant', 'classic'];
const LUCI = ['chiaro', 'scuro', 'auto'];

// Icone a tratto, stessa mano di quelle della barra in basso. Prima qui
// c'erano delle emoji, che ogni telefono disegna a modo suo e a colori.
const icona = (dentro) => `<svg class="icona" viewBox="0 0 24 24" aria-hidden="true">${dentro}</svg>`;
const ICONE = {
    stella: icona('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>'),
    matita: icona('<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 7.5 3 3"/>'),
    condividi: icona('<path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
    cestino: icona('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>'),
    fumetto: icona('<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>'),
    libri: icona('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>')
};

class KuotApp {
    constructor() {
        this.quotes = [];
        this.filteredQuotes = [];
        this.currentFilter = 'all';
        this.currentSort = 'recent';
        this.searchQuery = '';
        this.dailyQuoteDate = null;
        this.dailyQuoteId = null;
        this.usedQuoteIds = [];
        this.currentTheme = 'serene';
        this.luce = 'auto';

        // Scheda aperta dalla Libreria: l'elenco che si scorre con le frecce
        // e' fissato al momento dell'apertura, cosi' un ordinamento casuale o
        // una stella tolta non lo rimescolano sotto il dito.
        this.modalIds = [];
        this.modalPos = -1;

        // Foto nei moduli di aggiunta e modifica. `origine` dice da dove viene:
        // 'manuale' (caricata ora), 'autore' (ripresa da un'altra citazione
        // dello stesso autore), 'citazione' (quella che la citazione aveva gia').
        this.photoState = {
            add: { data: null, origine: null, rifiutataPer: null },
            edit: { data: null, origine: null, rifiutataPer: null }
        };

        this.init();
    }

    async init() {
        try {
            await this.initStorage();
            await this.loadQuotes();
            await this.loadSettings();

            this.setupEventListeners();
            this.updateCurrentDate();
            this.applyTheme();

            // Prima del sorteggio: se il blocco e' attivo, la citazione del
            // giorno l'ha gia' decisa la parte Android.
            await this.avviaBlocco();

            this.updateDailyQuote();
            this.updateLibraryView();
            this.updateAuthorList();
            this.avviata = true;

            console.log('Kuot App initialized successfully');
        } catch (error) {
            console.error('Error initializing app:', error);
            this.showError("Non riesco ad avviare l'app");
        }
    }

    // ===== STORAGE SYSTEM (IndexedDB with localStorage fallback) =====
    async initStorage() {
        this.useIndexedDB = false;
        try {
            if ('indexedDB' in window) {
                await this.initIndexedDB();
                this.useIndexedDB = true;
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
                if (!db.objectStoreNames.contains('quotes')) {
                    const quotesStore = db.createObjectStore('quotes', { keyPath: 'id', autoIncrement: true });
                    quotesStore.createIndex('date', 'date', { unique: false });
                    quotesStore.createIndex('author', 'author', { unique: false });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
        });
    }

    // Esegue `lavoro(store)` in una transazione e si risolve quando e' chiusa
    // davvero (oncomplete), non quando l'ultima richiesta ha risposto.
    idb(storeName, mode, lavoro) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], mode);
            let risultato;
            tx.oncomplete = () => resolve(risultato);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
            const req = lavoro(tx.objectStore(storeName));
            if (req) req.onsuccess = () => { risultato = req.result; };
        });
    }

    // Una citazione alla volta: prima ogni stellina riscriveva tutte le
    // citazioni con le loro foto, cioe' 4 MB.
    async putQuote(quote) {
        if (this.useIndexedDB) {
            try {
                await this.idb('quotes', 'readwrite', (store) => store.put(quote));
                return;
            } catch (error) {
                console.error('Error saving quote:', error);
            }
        }
        this.saveQuotesLocal();
    }

    async removeQuoteFromStorage(id) {
        if (this.useIndexedDB) {
            try {
                await this.idb('quotes', 'readwrite', (store) => store.delete(id));
                return;
            } catch (error) {
                console.error('Error deleting quote:', error);
            }
        }
        this.saveQuotesLocal();
    }

    saveQuotesLocal() {
        try {
            localStorage.setItem('kuot_quotes', JSON.stringify(this.quotes));
        } catch (e) {
            console.error('Failed to save to localStorage:', e);
            throw new Error('Failed to save quotes');
        }
    }

    async loadQuotes() {
        try {
            if (this.useIndexedDB) {
                this.quotes = (await this.idb('quotes', 'readonly', (store) => store.getAll())) || [];
            } else {
                const saved = localStorage.getItem('kuot_quotes');
                this.quotes = saved ? JSON.parse(saved) : [];
            }
        } catch (error) {
            console.error('Error loading quotes:', error);
            this.quotes = [];
        }
        // Stesso ordine del database (id crescente), sempre.
        this.quotes.sort((a, b) => a.id - b.id);
    }

    async saveSettings() {
        const settings = {
            theme: this.currentTheme,
            luce: this.luce,
            dailyQuoteDate: this.dailyQuoteDate,
            dailyQuoteId: this.dailyQuoteId,
            usedQuoteIds: this.usedQuoteIds
        };
        try {
            if (this.useIndexedDB) {
                await this.idb('settings', 'readwrite', (store) => {
                    for (const [key, value] of Object.entries(settings)) store.put({ key, value });
                    // Le chiavi della versione a indici non servono piu'.
                    store.delete('dailyQuoteIndex');
                    store.delete('usedQuoteIndexes');
                });
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
        let settings = {};
        try {
            if (this.useIndexedDB) {
                const righe = (await this.idb('settings', 'readonly', (store) => store.getAll())) || [];
                for (const r of righe) settings[r.key] = r.value;
            } else {
                const saved = localStorage.getItem('kuot_settings');
                settings = saved ? JSON.parse(saved) : {};
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }

        this.currentTheme = STILI.includes(settings.theme) ? settings.theme : 'serene';
        this.luce = LUCI.includes(settings.luce) ? settings.luce : 'auto';
        this.dailyQuoteDate = settings.dailyQuoteDate || null;

        if (settings.dailyQuoteId !== undefined || settings.usedQuoteIds !== undefined) {
            this.dailyQuoteId = settings.dailyQuoteId ?? null;
            this.usedQuoteIds = settings.usedQuoteIds || [];
        } else {
            // Passaggio dalla versione a indici. Gli indici erano posizioni
            // nell'elenco cosi' come esce dal database (id crescente), che e'
            // lo stesso ordine di this.quotes adesso.
            const idDi = (i) => (Number.isInteger(i) && this.quotes[i]) ? this.quotes[i].id : null;
            this.dailyQuoteId = idDi(settings.dailyQuoteIndex);
            this.usedQuoteIds = (settings.usedQuoteIndexes || []).map(idDi).filter((id) => id !== null);
        }
    }

    getQuote(id) {
        return this.quotes.find((q) => q.id === id) || null;
    }

    // ===== IMAGE PROCESSING =====
    processImage(file, maxSize = 800, quality = 0.8) {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                const maxDimension = Math.max(width, height);
                if (maxDimension > maxSize) {
                    const ratio = maxSize / maxDimension;
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                URL.revokeObjectURL(img.src);
                canvas.toBlob(resolve, 'image/jpeg', quality);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }

    imageToDataURL(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }

    // ===== DAILY QUOTE LOGIC =====
    updateDailyQuote() {
        const today = new Date().toDateString();
        if (this.dailyQuoteDate !== today || !this.getQuote(this.dailyQuoteId)) {
            this.generateDailyQuote();
            this.dailyQuoteDate = today;
            this.saveSettings();
        }
        this.displayDailyQuote();
    }

    generateDailyQuote() {
        if (this.quotes.length === 0) {
            this.dailyQuoteId = null;
            return;
        }
        const esistenti = new Set(this.quotes.map((q) => q.id));
        this.usedQuoteIds = this.usedQuoteIds.filter((id) => esistenti.has(id));

        let available = this.quotes.filter((q) => !this.usedQuoteIds.includes(q.id));
        if (available.length === 0) {
            this.usedQuoteIds = [];
            available = this.quotes;
        }
        this.dailyQuoteId = available[Math.floor(Math.random() * available.length)].id;
        this.usedQuoteIds.push(this.dailyQuoteId);
    }

    // ===== SCHERMATA DI BLOCCO =====
    //
    // Solo dentro l'APK dalla 1.1. Il guscio Android mette la citazione del
    // giorno come sfondo della schermata di blocco e la cambia da solo a
    // mezzanotte, ad app chiusa. Per riuscirci deve decidere LUI qual e' la
    // citazione del giorno: da qui gli si consegna l'elenco (l'IndexedDB da la'
    // non si legge) e si adotta la sua scelta, cosi' app e blocco mostrano
    // sempre la stessa. Nel browser, o con l'interruttore spento, non cambia
    // niente rispetto a prima.
    blocco() {
        const p = isCapacitorNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.Blocco;
        return p || null;
    }

    // Quanto basta a capire se una foto e' cambiata, senza confrontarla tutta.
    firmaFoto(photo) {
        if (!photo) return '';
        let h = 5381;
        const passo = Math.max(1, Math.floor(photo.length / 512));
        for (let i = 0; i < photo.length; i += passo) h = ((h * 33) ^ photo.charCodeAt(i)) >>> 0;
        return photo.length + ':' + h;
    }

    // All'avvio. Se il ponte non risponde, l'app parte lo stesso.
    async avviaBlocco() {
        if (!this.blocco()) return;
        try {
            await Promise.race([
                this.sincronizzaBlocco(),
                new Promise((_, no) => setTimeout(() => no(new Error('il guscio non risponde')), 4000))
            ]);
        } catch (error) {
            console.warn('Blocco:', error);
        }
    }

    // Dopo ogni aggiunta, modifica o eliminazione: senza far aspettare nessuno.
    avvisaBlocco() {
        if (!this.blocco() || !this.bloccoStato || !this.bloccoStato.attivo) return;
        this.sincronizzaBlocco().catch((error) => console.warn('Blocco:', error));
    }

    // `attivazione`: fin li' il conto delle citazioni gia' uscite l'ha tenuto
    // questa pagina, e lo si passa di la'. `aspetta`: torna solo a sfondo
    // ridisegnato, e un eventuale errore arriva a chi ha chiamato.
    async sincronizzaBlocco({ attivazione = false, aspetta = false, forza = false } = {}) {
        const B = this.blocco();
        if (!B) return;
        this.bloccoStato = await B.stato();
        this.mostraStatoBlocco();
        if (!this.bloccoStato.attivo) return;

        const today = new Date().toDateString();
        const miaDiOggi = this.dailyQuoteDate === today && this.getQuote(this.dailyQuoteId);
        const richiesta = {
            citazioni: this.quotes.map((q) => ({
                id: String(q.id),
                testo: q.text,
                autore: q.author,
                data: this.formatDate(q.date),
                firmaFoto: this.firmaFoto(q.photo)
            })),
            idDiOggi: miaDiOggi ? String(this.dailyQuoteId) : null
        };
        if (attivazione) richiesta.usati = this.usedQuoteIds.map(String);
        const r = await B.sincronizza(richiesta);

        if (r.idDelGiorno) {
            const id = Number(r.idDelGiorno);
            const cambiata = id !== this.dailyQuoteId;
            this.dailyQuoteId = id;
            this.dailyQuoteDate = today;
            this.usedQuoteIds = (r.usati || []).map(Number);
            await this.saveSettings();
            if (cambiata && this.avviata) this.displayDailyQuote();
        }

        // Le foto passano una alla volta. Quella di oggi per prima, poi si
        // ridisegna; le altre seguono in sottofondo e servono da domani.
        const mancanti = r.mancanti || [];
        const giro = (this.bloccoGiro = (this.bloccoGiro || 0) + 1);
        const lavoro = (async () => {
            await this.mandaFotoAlBlocco(mancanti.filter((id) => id === r.idDelGiorno), giro);
            await B.aggiorna({ forza: forza || attivazione });
        })();
        lavoro
            .then(() => this.mandaFotoAlBlocco(mancanti.filter((id) => id !== r.idDelGiorno), giro))
            .catch((error) => console.warn('Blocco:', error));
        if (aspetta) await lavoro;
    }

    async mandaFotoAlBlocco(ids, giro) {
        const B = this.blocco();
        for (const idTesto of ids) {
            // Se nel frattempo e' partita una sincronizzazione piu' recente, ci pensa lei.
            if (giro !== this.bloccoGiro) return;
            const q = this.getQuote(Number(idTesto));
            if (!q || !q.photo) continue;
            await B.salvaFoto({
                id: idTesto,
                firma: this.firmaFoto(q.photo),
                dati: q.photo.slice(q.photo.indexOf(',') + 1)
            });
        }
    }

    mostraStatoBlocco() {
        const sezione = document.getElementById('bloccoSezione');
        const st = this.bloccoStato;
        if (!sezione) return;
        sezione.hidden = !st;
        if (!st) return;
        document.getElementById('bloccoAttivo').setAttribute('aria-checked', st.attivo ? 'true' : 'false');
        document.getElementById('bloccoOpzioni').hidden = !st.attivo;
        document.querySelectorAll('.blocco-sfondo-btn').forEach((b) => {
            b.classList.toggle('active', b.dataset.sfondo === st.sfondo);
        });
    }

    async cambiaBlocco() {
        const B = this.blocco();
        if (!B || this.bloccoOccupato) return;
        const attivo = !(this.bloccoStato && this.bloccoStato.attivo);
        if (attivo && !confirm('Lo sfondo che hai adesso sulla schermata di blocco verrà sostituito, e da qui non si può rimettere. Continuo?')) return;

        this.bloccoOccupato = true;
        try {
            this.bloccoStato = await B.attiva({ attivo });
            this.mostraStatoBlocco();
            if (attivo) {
                await this.sincronizzaBlocco({ attivazione: true, aspetta: true });
                this.showSuccess('La citazione di oggi è sulla schermata di blocco');
            }
        } catch (error) {
            console.error('Blocco:', error);
            this.showError('Non sono riuscito a cambiare lo sfondo del blocco');
        } finally {
            this.bloccoOccupato = false;
        }
    }

    // `dati`: il JPEG in base64 di un'immagine appena scelta, oppure niente
    // per passare da un fondo all'altro.
    async scegliSfondoBlocco(modo, dati = '') {
        const B = this.blocco();
        if (!B || this.bloccoOccupato) return;
        this.bloccoOccupato = true;
        try {
            this.bloccoStato = await B.impostaSfondo({ modo, dati });
            this.mostraStatoBlocco();
            await this.sincronizzaBlocco({ aspetta: true });
            this.showSuccess('Schermata di blocco ridisegnata');
        } catch (error) {
            console.error('Blocco:', error);
            this.showError('Non sono riuscito a cambiare lo sfondo del blocco');
        } finally {
            this.bloccoOccupato = false;
        }
    }

    // L'immagine scelta si ritaglia qui alla misura dello schermo: di la'
    // arriva gia' pronta, e dal ponte passa un file piccolo.
    immaginePerIlBlocco(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                let W = Math.round(screen.width * devicePixelRatio);
                let H = Math.round(screen.height * devicePixelRatio);
                if (W > H) [W, H] = [H, W];
                const canvas = document.createElement('canvas');
                canvas.width = W;
                canvas.height = H;
                const scala = Math.max(W / img.width, H / img.height);
                const w = img.width * scala, h = img.height * scala;
                canvas.getContext('2d').drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
                URL.revokeObjectURL(img.src);
                const url = canvas.toDataURL('image/jpeg', 0.92);
                resolve(url.slice(url.indexOf(',') + 1));
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }

    setupBlocco() {
        document.getElementById('bloccoAttivo').addEventListener('click', () => this.cambiaBlocco());

        const scelta = document.getElementById('bloccoImmagine');
        document.querySelectorAll('.blocco-sfondo-btn').forEach((b) => {
            b.addEventListener('click', () => {
                const st = this.bloccoStato || {};
                if (b.dataset.sfondo !== 'immagine') {
                    if (st.sfondo !== b.dataset.sfondo) this.scegliSfondoBlocco(b.dataset.sfondo);
                } else if (st.haImmagine && st.sfondo !== 'immagine') {
                    this.scegliSfondoBlocco('immagine');
                } else {
                    scelta.value = '';
                    scelta.click();
                }
            });
        });
        scelta.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                await this.scegliSfondoBlocco('immagine', await this.immaginePerIlBlocco(file));
            } catch (error) {
                console.error('Blocco:', error);
                this.showError('Non riesco a leggere quell\'immagine');
            }
        });

        // Kuot puo' restare in memoria per giorni: al ritorno in primo piano la
        // pagina non riparte da capo, quindi e' qui che ci si riallinea al
        // giorno nuovo (e alla citazione che il blocco mostra gia' da mezzanotte).
        document.addEventListener('visibilitychange', async () => {
            if (document.visibilityState !== 'visible' || !this.avviata) return;
            this.updateCurrentDate();
            await this.avviaBlocco();
            this.updateDailyQuote();
        });

        document.getElementById('bloccoAggiorna').addEventListener('click', async () => {
            if (this.bloccoOccupato) return;
            this.bloccoOccupato = true;
            try {
                await this.sincronizzaBlocco({ aspetta: true, forza: true });
                this.showSuccess('Schermata di blocco ridisegnata');
            } catch (error) {
                console.error('Blocco:', error);
                this.showError('Non sono riuscito a ridisegnare lo sfondo');
            } finally {
                this.bloccoOccupato = false;
            }
        });
    }

    // Il blocco citazione usato sia in Home sia nella scheda.
    quoteContentHTML(quote, extraClass = '') {
        const id = quote.id;
        // Sul telefono il corpo 20 diventa 26 (scala dei caratteri 1,3): una
        // citazione di 500 caratteri occupava due schermate. Le lunghe si
        // stringono un po'.
        const n = quote.text.length;
        const taglia = n > 320 ? 'lunghissima' : n > 180 ? 'lunga' : '';
        return `
            <div class="quote-content ${extraClass}">
                <div class="quote-text ${taglia}">${this.escapeHtml(quote.text)}</div>
                <div class="quote-meta">
                    ${quote.photo
                        ? `<img src="${quote.photo}" alt="${this.escapeHtml(quote.author)}" class="author-photo clickable-image" data-action="photo" data-id="${id}">`
                        : `<div class="author-initials">${this.escapeHtml(this.getAuthorInitials(quote.author))}</div>`}
                    <div class="author-info">
                        <div class="author-name">${this.escapeHtml(quote.author)}</div>
                        <div class="quote-date">${this.escapeHtml(this.formatDate(quote.date))}</div>
                    </div>
                </div>
                <div class="quote-actions">
                    <button class="action-btn favorite ${quote.favorite ? 'active' : ''}" data-action="favorite" data-id="${id}">
                        ${ICONE.stella}
                        Preferita
                    </button>
                    <button class="action-btn" data-action="edit" data-id="${id}">
                        ${ICONE.matita}
                        Modifica
                    </button>
                    <button class="action-btn" data-action="share" data-id="${id}">
                        ${ICONE.condividi}
                        Condividi
                    </button>
                </div>
            </div>
        `;
    }

    displayDailyQuote() {
        const container = document.getElementById('dailyQuote');
        const quote = this.getQuote(this.dailyQuoteId);

        if (!quote) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">${ICONE.fumetto}</div>
                    <h2>Nessuna citazione</h2>
                    <p>Comincia la tua raccolta</p>
                    <button class="cta-button" onclick="app.switchTab('add')">Aggiungi la prima citazione</button>
                </div>
            `;
            return;
        }
        container.innerHTML = this.quoteContentHTML(quote, 'fade-in');
    }

    // ===== NAVIGATION =====
    switchTab(tabName) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === tabName);
        });
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.toggle('active', screen.id === `${tabName}Screen`);
        });
        window.scrollTo(0, 0);

        if (tabName === 'library') {
            this.updateLibraryView();
        } else if (tabName === 'add') {
            this.resetAddForm();
        }
    }

    // ===== EVENT LISTENERS =====
    setupEventListeners() {
        document.getElementById('addQuoteForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addQuote();
        });
        document.getElementById('editQuoteForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveEditedQuote();
        });

        document.getElementById('quoteText').addEventListener('input', () => this.updateCharCounter());
        document.getElementById('editQuoteText').addEventListener('input', () => this.updateEditCharCounter());

        document.getElementById('photoInput').addEventListener('change', (e) => this.handlePhotoUpload('add', e));
        document.getElementById('editPhotoInput').addEventListener('change', (e) => this.handlePhotoUpload('edit', e));

        // Foto dell'autore riproposta mentre si scrive il nome.
        document.getElementById('authorName').addEventListener('input', () => this.suggestAuthorPhoto('add'));
        document.getElementById('editAuthorName').addEventListener('input', () => this.suggestAuthorPhoto('edit'));

        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.searchQuery = e.target.value.trim();
            this.updateLibraryView();
        });
        document.getElementById('sortSelect').addEventListener('change', (e) => {
            this.currentSort = e.target.value;
            this.updateLibraryView();
        });

        document.querySelectorAll('.chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.currentFilter = e.currentTarget.dataset.filter;
                this.updateLibraryView();
            });
        });

        document.querySelectorAll('.stile-scheda').forEach((btn) => {
            btn.addEventListener('click', () => this.setTheme(btn.dataset.stile));
        });
        document.querySelectorAll('#luceScelta button').forEach((btn) => {
            btn.addEventListener('click', () => this.setLuce(btn.dataset.luce));
        });
        // Con la luce su 'auto' si segue il telefono anche mentre l'app e' aperta.
        if (window.matchMedia) {
            matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
        }
        this.setupSettingsSheet();
        this.setupBlocco();

        // Un solo ascoltatore per tutti i pulsanti dentro le citazioni: i
        // pulsanti portano l'id della citazione in data-id, cosi' nell'HTML
        // non finiscono ne' nomi con apostrofi ne' foto intere.
        const azioni = (e) => {
            const el = e.target.closest('[data-action]');
            if (!el) return;
            e.stopPropagation();
            const id = Number(el.dataset.id);
            switch (el.dataset.action) {
                case 'favorite': this.toggleFavorite(id); break;
                case 'edit': this.openEditModal(id); break;
                case 'delete': this.deleteQuote(id); break;
                case 'share': this.shareQuote(id); break;
                case 'photo': this.openImageModal(id); break;
                case 'open': this.openQuoteModal(id); break;
            }
        };
        ['dailyQuote', 'quotesGrid', 'modalQuoteContent'].forEach((id) => {
            document.getElementById(id).addEventListener('click', azioni);
        });

        // Scheda: scorrimento orizzontale col dito per passare alla vicina.
        const detail = document.querySelector('#quoteModal .modal-content');
        let x0 = null, y0 = null;
        detail.addEventListener('touchstart', (e) => {
            x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
        }, { passive: true });
        detail.addEventListener('touchend', (e) => {
            if (x0 === null) return;
            const dx = e.changedTouches[0].clientX - x0;
            const dy = e.changedTouches[0].clientY - y0;
            x0 = null;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                this.navigateQuote(dx < 0 ? 1 : -1);
            }
        }, { passive: true });

        // Foto a tutto schermo: si chiude toccando lo sfondo o con Esc.
        const imageModal = document.getElementById('imageModal');
        imageModal.addEventListener('click', (e) => {
            if (e.target === imageModal || e.target.classList.contains('image-modal-content')) {
                this.closeImageModal();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (document.getElementById('settingsPanel').classList.contains('active')) this.toggleSettings(false);
            else if (imageModal.classList.contains('active')) this.closeImageModal();
            else if (document.getElementById('editQuoteModal').classList.contains('active')) this.closeEditModal();
            else if (document.getElementById('quoteModal').classList.contains('active')) this.closeQuoteModal();
        });

        document.getElementById('quoteDate').value = new Date().getFullYear().toString();
        document.getElementById('quoteDate').addEventListener('blur', (e) => this.formatDateInput(e));
        document.getElementById('editQuoteDate').addEventListener('blur', (e) => this.formatDateInput(e));
    }

    updateCharCounter() {
        const textarea = document.getElementById('quoteText');
        const counter = document.querySelector('#addQuoteForm .char-counter');
        const current = textarea.value.length;
        const max = textarea.getAttribute('maxlength');
        counter.textContent = `${current}/${max}`;
        counter.style.color = current > max * 0.9 ? 'var(--warning)' : 'var(--text-secondary)';
    }

    updateEditCharCounter() {
        const textarea = document.getElementById('editQuoteText');
        const counter = document.querySelector('#editQuoteForm .char-counter');
        const current = textarea.value.length;
        const max = textarea.getAttribute('maxlength');
        counter.textContent = `${current}/${max}`;
        counter.style.color = current > max * 0.9 ? 'var(--warning)' : 'var(--text-secondary)';
    }

    // ===== AUTHOR PHOTO REUSE =====

    // Chiave per riconoscere lo stesso autore scritto in modi un po' diversi:
    // maiuscole, accenti, punto finale e note tra parentesi non contano
    // ("Antoine de Saint-Exupéry (attribuzione popolare)" = "antoine de saint-exupery").
    authorKey(name) {
        return String(name || '')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/\([^)]*\)/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    // La foto piu' recente fra le citazioni dello stesso autore.
    findAuthorPhoto(name, escludiId = null) {
        const key = this.authorKey(name);
        if (!key) return null;
        let migliore = null;
        for (const q of this.quotes) {
            if (!q.photo || q.id === escludiId || this.authorKey(q.author) !== key) continue;
            const t = q.updatedAt || q.createdAt || '';
            if (!migliore || t > migliore.t) migliore = { photo: q.photo, author: q.author, t };
        }
        return migliore;
    }

    photoElements(form) {
        if (form === 'add') {
            return {
                placeholder: document.getElementById('addPhotoPlaceholder'),
                preview: document.getElementById('addPhotoPreview'),
                img: document.getElementById('photoPreview'),
                note: document.getElementById('addPhotoNote'),
                input: document.getElementById('photoInput'),
                author: document.getElementById('authorName')
            };
        }
        return {
            placeholder: document.getElementById('editPhotoPlaceholder'),
            preview: document.getElementById('editPhotoPreview'),
            img: document.getElementById('editPhotoPreviewImg'),
            note: document.getElementById('editPhotoNote'),
            input: document.getElementById('editPhotoInput'),
            author: document.getElementById('editAuthorName')
        };
    }

    setFormPhoto(form, data, origine, nota = '') {
        const st = this.photoState[form];
        const el = this.photoElements(form);
        st.data = data;
        st.origine = data ? origine : null;
        el.placeholder.style.display = data ? 'none' : 'flex';
        el.preview.style.display = data ? 'inline-block' : 'none';
        if (data) el.img.src = data; else el.img.removeAttribute('src');
        el.note.textContent = nota;
        el.note.hidden = !nota;
    }

    suggestAuthorPhoto(form) {
        const st = this.photoState[form];
        const el = this.photoElements(form);
        // Una foto scelta a mano, o quella che la citazione aveva gia', non si tocca.
        if (st.origine === 'manuale' || st.origine === 'citazione') return;

        const key = this.authorKey(el.author.value);
        const escludi = form === 'edit' ? this.currentEditId : null;
        const trovata = key && st.rifiutataPer !== key ? this.findAuthorPhoto(el.author.value, escludi) : null;

        if (trovata) {
            if (st.data !== trovata.photo) {
                this.setFormPhoto(form, trovata.photo, 'autore', `Foto già usata per ${trovata.author}`);
            }
        } else if (st.origine === 'autore') {
            this.setFormPhoto(form, null, null);
        }
    }

    async handlePhotoUpload(form, event) {
        const file = event.target.files[0];
        if (!file) return;
        try {
            const processedBlob = await this.processImage(file);
            const dataURL = await this.imageToDataURL(processedBlob);
            this.setFormPhoto(form, dataURL, 'manuale');
        } catch (error) {
            console.error('Error processing image:', error);
            this.showError("Non riesco a leggere l'immagine");
        }
    }

    removeFormPhoto(form, event) {
        event.stopPropagation();
        const st = this.photoState[form];
        const el = this.photoElements(form);
        // Tolta una foto riproposta: per questo autore non la si ripropone piu'
        // finche' il modulo resta aperto.
        if (st.origine === 'autore') st.rifiutataPer = this.authorKey(el.author.value);
        el.input.value = '';
        this.setFormPhoto(form, null, null);
    }

    // Elenco degli autori gia' presenti, per il completamento del nome.
    updateAuthorList() {
        const list = document.getElementById('authorList');
        if (!list) return;
        const visti = new Map();
        for (const q of this.quotes) {
            const k = this.authorKey(q.author);
            if (k && !visti.has(k)) visti.set(k, q.author.trim());
        }
        const nomi = [...visti.values()].sort((a, b) => a.localeCompare(b, 'it'));
        list.innerHTML = nomi.map((n) => `<option value="${this.escapeHtml(n)}"></option>`).join('');
    }

    // ===== ADD QUOTE =====
    async addQuote() {
        const form = document.getElementById('addQuoteForm');
        const submitBtn = form.querySelector('.submit-btn');
        const text = document.getElementById('quoteText').value.trim();
        const author = document.getElementById('authorName').value.trim();
        const date = document.getElementById('quoteDate').value.trim();

        if (!text || !author) {
            this.showError('Servono sia la citazione sia l\'autore');
            return;
        }

        try {
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;

            const anno = new Date().getFullYear().toString();
            const quote = {
                id: Date.now(),
                text,
                author,
                date: date || anno,
                dateStandardized: this.standardizeDate(date || anno),
                photo: this.photoState.add.data || null,
                favorite: false,
                createdAt: new Date().toISOString()
            };

            this.quotes.push(quote);
            await this.putQuote(quote);

            this.resetAddForm();
            this.updateAuthorList();
            this.switchTab('library');

            if (this.quotes.length === 1) this.updateDailyQuote();
            this.avvisaBlocco();

            this.showSuccess('Citazione salvata');
        } catch (error) {
            console.error('Error adding quote:', error);
            this.showError('Non sono riuscito a salvare la citazione');
        } finally {
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
        }
    }

    resetAddForm() {
        document.getElementById('addQuoteForm').reset();
        this.photoState.add = { data: null, origine: null, rifiutataPer: null };
        this.setFormPhoto('add', null, null);
        document.getElementById('quoteDate').value = new Date().getFullYear().toString();
        this.updateCharCounter();
    }

    // ===== LIBRARY VIEW =====
    updateLibraryView() {
        this.applyFiltersAndSort();
        this.renderQuotesGrid();
    }

    normalizza(testo) {
        return String(testo || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    applyFiltersAndSort() {
        let filtered = [...this.quotes];

        if (this.searchQuery) {
            const query = this.normalizza(this.searchQuery);
            filtered = filtered.filter(quote =>
                this.normalizza(quote.text).includes(query) ||
                this.normalizza(quote.author).includes(query)
            );
        }

        const perAggiunta = (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id - a.id;

        switch (this.currentFilter) {
            case 'favorites':
                filtered = filtered.filter(quote => quote.favorite);
                break;
            case 'recent':
                // Le ultime aggiunte, non "quelle degli ultimi 7 giorni": cosi'
                // il filtro non resta vuoto quando per una settimana non si
                // aggiunge niente.
                filtered = [...filtered].sort(perAggiunta).slice(0, RECENTI_QUANTE);
                break;
        }

        switch (this.currentSort) {
            case 'alphabetical':
                filtered.sort((a, b) => a.text.localeCompare(b.text, 'it'));
                break;
            case 'random':
                filtered = this.shuffleArray(filtered);
                break;
            case 'recent':
            default:
                filtered.sort(perAggiunta);
                break;
        }

        this.filteredQuotes = filtered;
    }

    renderQuotesGrid() {
        const container = document.getElementById('quotesGrid');

        if (this.filteredQuotes.length === 0) {
            let titolo, testo;
            if (this.quotes.length === 0) {
                titolo = 'Ancora nessuna citazione';
                testo = 'La tua raccolta comparirà qui';
            } else if (this.searchQuery) {
                titolo = `Niente per «${this.escapeHtml(this.searchQuery)}»`;
                testo = 'Prova con un’altra parola o togli i filtri';
            } else if (this.currentFilter === 'favorites') {
                titolo = 'Nessuna preferita';
                testo = 'Tocca la stella su una citazione per segnarla';
            } else {
                titolo = 'Nessuna citazione';
                testo = 'Prova a togliere i filtri';
            }
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">${ICONE.libri}</div>
                    <h2>${titolo}</h2>
                    <p>${testo}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.filteredQuotes.map((quote) => {
            const id = quote.id;
            return `
                <div class="quote-card" data-action="open" data-id="${id}">
                    <div class="quote-card-top">
                        <div class="quote-card-date">${this.escapeHtml(this.formatDate(quote.date))}</div>
                        <div class="quote-card-actions">
                            <button class="card-action-btn favorite ${quote.favorite ? 'active' : ''}" data-action="favorite" data-id="${id}" aria-label="Preferita">${ICONE.stella}</button>
                            <button class="card-action-btn edit" data-action="edit" data-id="${id}" aria-label="Modifica">${ICONE.matita}</button>
                            <button class="card-action-btn delete" data-action="delete" data-id="${id}" aria-label="Elimina">${ICONE.cestino}</button>
                        </div>
                    </div>
                    <div class="quote-card-text">${this.escapeHtml(quote.text)}</div>
                    <div class="quote-card-meta">
                        ${quote.photo
                            ? `<img src="${quote.photo}" alt="" class="quote-card-photo clickable-image" data-action="photo" data-id="${id}" loading="lazy">`
                            : `<div class="quote-card-initials">${this.escapeHtml(this.getAuthorInitials(quote.author))}</div>`}
                        <div class="quote-card-author">${this.escapeHtml(quote.author)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ===== QUOTE MANAGEMENT =====
    async toggleFavorite(id) {
        const quote = this.getQuote(id);
        if (!quote) return;
        quote.favorite = !quote.favorite;
        await this.putQuote(quote);
        this.refreshViews(id);
    }

    // Ridisegna le viste in cui compare la citazione.
    refreshViews(id) {
        this.updateLibraryView();
        if (id === this.dailyQuoteId) this.displayDailyQuote();
        if (document.getElementById('quoteModal').classList.contains('active') &&
            this.modalIds[this.modalPos] === id) {
            this.renderModalQuote();
        }
    }

    async deleteQuote(id) {
        const quote = this.getQuote(id);
        if (!quote) return;
        if (!confirm(`Eliminare la citazione di ${quote.author}?`)) return;

        try {
            this.quotes = this.quotes.filter((q) => q.id !== id);
            await this.removeQuoteFromStorage(id);

            this.usedQuoteIds = this.usedQuoteIds.filter((u) => u !== id);
            if (id === this.dailyQuoteId) {
                this.generateDailyQuote();
                this.displayDailyQuote();
            }
            await this.saveSettings();
            this.avvisaBlocco();

            this.updateLibraryView();
            this.updateAuthorList();
            this.showSuccess('Citazione eliminata');
        } catch (error) {
            console.error('Error deleting quote:', error);
            this.showError('Non sono riuscito a eliminarla');
        }
    }

    async shareQuote(id) {
        const quote = this.getQuote(id);
        if (!quote) return;
        const shareText = `«${quote.text}» — ${quote.author}`;

        if (navigator.share) {
            try {
                await navigator.share({ title: 'Kuot', text: shareText });
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return;
            }
        }
        if (await this.copyText(shareText)) {
            this.showSuccess('Citazione copiata');
        } else {
            this.showError('Non riesco a copiarla');
        }
    }

    async copyText(testo) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(testo);
                return true;
            }
        } catch (e) { /* si prova sotto */ }
        const area = document.createElement('textarea');
        area.value = testo;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
        document.body.appendChild(area);
        area.select();
        let fatto = false;
        try { fatto = document.execCommand('copy'); } catch (e) { fatto = false; }
        area.remove();
        return fatto;
    }

    // ===== QUOTE MODAL =====
    openQuoteModal(id) {
        this.modalIds = this.filteredQuotes.map((q) => q.id);
        this.modalPos = this.modalIds.indexOf(id);
        if (this.modalPos === -1) {
            this.modalIds = [id];
            this.modalPos = 0;
        }
        this.renderModalQuote();
        document.getElementById('quoteModal').classList.add('active');
    }

    closeQuoteModal() {
        document.getElementById('quoteModal').classList.remove('active');
    }

    navigateQuote(direction) {
        const nuova = this.modalPos + direction;
        if (nuova < 0 || nuova >= this.modalIds.length) return;
        this.modalPos = nuova;
        this.renderModalQuote();
    }

    renderModalQuote() {
        const content = document.getElementById('modalQuoteContent');
        const quote = this.getQuote(this.modalIds[this.modalPos]);
        if (!quote) return;
        content.innerHTML = this.quoteContentHTML(quote);
        content.parentElement.scrollTop = 0;

        const n = this.modalIds.length;
        document.querySelector('#quoteModal .nav-btn.prev').disabled = this.modalPos <= 0;
        document.querySelector('#quoteModal .nav-btn.next').disabled = this.modalPos >= n - 1;
        document.querySelector('#quoteModal .quote-nav-pos').textContent = `${this.modalPos + 1} / ${n}`;
        document.querySelector('#quoteModal .quote-nav').hidden = n <= 1;
    }

    // ===== THEME SYSTEM =====
    // Lo stile (colori e caratteri) e la luce (chiaro, scuro, come il telefono)
    // sono due scelte separate. Finiscono su <html> come data-stile e data-luce,
    // e una copia va nella memoria locale per lo script in testa alla pagina,
    // che li applica prima che l'IndexedDB abbia risposto.
    setTheme(theme) {
        if (!STILI.includes(theme)) return;
        this.currentTheme = theme;
        this.applyTheme();
        this.saveSettings();
    }

    setLuce(luce) {
        if (!LUCI.includes(luce)) return;
        this.luce = luce;
        this.applyTheme();
        this.saveSettings();
    }

    luceEffettiva() {
        if (this.luce !== 'auto') return this.luce;
        return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'scuro' : 'chiaro';
    }

    applyTheme() {
        const luce = this.luceEffettiva();
        const radice = document.documentElement;
        radice.setAttribute('data-stile', this.currentTheme);
        radice.setAttribute('data-luce', luce);
        try {
            localStorage.setItem('kuot_aspetto', JSON.stringify({ stile: this.currentTheme, luce: this.luce }));
        } catch (e) { /* senza memoria locale si vede solo un lampo all'avvio */ }

        // Le schede degli stili si colorano da sole: basta dirgli in che luce siamo.
        document.querySelectorAll('.stile-scheda').forEach((btn) => {
            const attiva = btn.dataset.stile === this.currentTheme;
            btn.setAttribute('data-luce', luce);
            btn.classList.toggle('active', attiva);
            btn.setAttribute('aria-checked', attiva ? 'true' : 'false');
        });
        document.querySelectorAll('#luceScelta button').forEach((btn) => {
            const attiva = btn.dataset.luce === this.luce;
            btn.classList.toggle('active', attiva);
            btn.setAttribute('aria-checked', attiva ? 'true' : 'false');
        });

        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', getComputedStyle(radice).getPropertyValue('--background').trim());
    }

    // ===== EDIT QUOTE =====
    openEditModal(id) {
        const quote = this.getQuote(id);
        if (!quote) return;

        this.currentEditId = id;
        document.getElementById('editQuoteText').value = quote.text;
        document.getElementById('editAuthorName').value = quote.author;
        document.getElementById('editQuoteDate').value = quote.date || '';

        this.photoState.edit = { data: null, origine: null, rifiutataPer: null };
        document.getElementById('editPhotoInput').value = '';
        this.setFormPhoto('edit', quote.photo || null, 'citazione');

        this.updateEditCharCounter();
        this.closeQuoteModal();

        const modal = document.getElementById('editQuoteModal');
        modal.classList.add('active');
        modal.querySelector('.edit-quote-container').scrollTop = 0;
    }

    closeEditModal() {
        document.getElementById('editQuoteModal').classList.remove('active');
        document.getElementById('editQuoteForm').reset();
        this.photoState.edit = { data: null, origine: null, rifiutataPer: null };
        this.setFormPhoto('edit', null, null);
        delete this.currentEditId;
    }

    async saveEditedQuote() {
        const quote = this.getQuote(this.currentEditId);
        if (!quote) {
            this.showError('Citazione non trovata');
            return;
        }

        const form = document.getElementById('editQuoteForm');
        const submitBtn = form.querySelector('.submit-btn');
        const text = document.getElementById('editQuoteText').value.trim();
        const author = document.getElementById('editAuthorName').value.trim();
        const date = document.getElementById('editQuoteDate').value.trim();

        if (!text || !author) {
            this.showError('Servono sia la citazione sia l\'autore');
            return;
        }

        try {
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;

            quote.text = text;
            quote.author = author;
            quote.date = date || quote.date;
            quote.dateStandardized = this.standardizeDate(quote.date);
            quote.photo = this.photoState.edit.data || null;
            quote.updatedAt = new Date().toISOString();

            await this.putQuote(quote);

            const id = quote.id;
            this.closeEditModal();
            this.updateAuthorList();
            this.refreshViews(id);
            this.avvisaBlocco();

            this.showSuccess('Modifiche salvate');
        } catch (error) {
            console.error('Error updating quote:', error);
            this.showError('Non sono riuscito a salvare le modifiche');
        } finally {
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
        }
    }

    // ===== IMAGE FULLSCREEN MODAL =====
    openImageModal(id) {
        const quote = this.getQuote(id);
        if (!quote || !quote.photo) return;
        document.getElementById('fullscreenImage').src = quote.photo;
        document.querySelector('.image-author-name').textContent = quote.author || '';
        document.getElementById('imageModal').classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    closeImageModal() {
        document.getElementById('imageModal').classList.remove('active');
        document.body.style.overflow = '';
    }

    // ===== SETTINGS =====
    toggleSettings(apri) {
        const pannello = document.getElementById('settingsPanel');
        const aperto = typeof apri === 'boolean' ? apri : !pannello.classList.contains('active');
        pannello.classList.toggle('active', aperto);
        pannello.setAttribute('aria-hidden', aperto ? 'false' : 'true');
        if (!aperto) return;
        pannello.querySelector('.sheet-corpo').scrollTop = 0;
        const n = this.quotes.length;
        document.getElementById('settingsPiede').textContent =
            `${n} ${n === 1 ? 'citazione' : 'citazioni'} \u00b7 versione ${APP_BUILD}`;
    }

    // Il pannello si chiude toccando fuori, oppure trascinandolo giu' dalla
    // testa (non dal corpo, che deve poter scorrere).
    setupSettingsSheet() {
        const pannello = document.getElementById('settingsPanel');
        const foglio = pannello.querySelector('.settings-sheet');
        pannello.addEventListener('click', (e) => {
            if (e.target === pannello) this.toggleSettings(false);
        });

        let y0 = null, dy = 0;
        const parte = (e) => { y0 = e.touches[0].clientY; dy = 0; foglio.classList.add('trascinato'); };
        const muove = (e) => {
            if (y0 === null) return;
            dy = Math.max(0, e.touches[0].clientY - y0);
            foglio.style.transform = `translateY(${dy}px)`;
        };
        const finisce = () => {
            if (y0 === null) return;
            y0 = null;
            foglio.classList.remove('trascinato');
            foglio.style.transform = '';
            if (dy > 90) this.toggleSettings(false);
        };
        foglio.querySelectorAll('[data-trascina]').forEach((el) => {
            el.addEventListener('touchstart', parte, { passive: true });
            el.addEventListener('touchmove', muove, { passive: true });
            el.addEventListener('touchend', finisce);
            el.addEventListener('touchcancel', finisce);
        });
    }

    // ===== DATE HANDLING =====
    formatDateInput(event) {
        const input = event.target;
        const value = input.value.trim();
        if (!value) return;
        const formattedDate = this.parseAndFormatDate(value);
        if (formattedDate !== input.value) input.value = formattedDate;
    }

    parseAndFormatDate(dateString) {
        const cleaned = dateString.trim();

        if (this.isValidDateFormat(cleaned)) return cleaned;

        // "marzo 1963", "mar 1963", "March 1963"
        const monthYearMatch = cleaned.match(/^([a-zà-ù]+)\.?\s+(\d{3,4})$/i);
        if (monthYearMatch) {
            const month = this.parseMonth(monthYearMatch[1]);
            if (month) return `${month}/${monthYearMatch[2]}`;
        }

        // "8 aprile 2022", "8 apr 2022"
        const dayMonthYear = cleaned.match(/^(\d{1,2})\s+([a-zà-ù]+)\.?\s+(\d{3,4})$/i);
        if (dayMonthYear) {
            const month = this.parseMonth(dayMonthYear[2]);
            const day = parseInt(dayMonthYear[1], 10);
            if (month && day >= 1 && day <= 31) {
                return `${String(day).padStart(2, '0')}/${month}/${dayMonthYear[3]}`;
            }
        }

        const mmYyyyMatch = cleaned.match(/^(\d{1,2})[\/\-\.](\d{4})$/);
        if (mmYyyyMatch) {
            const month = parseInt(mmYyyyMatch[1], 10);
            if (month >= 1 && month <= 12) return `${String(month).padStart(2, '0')}/${mmYyyyMatch[2]}`;
        }

        const fullDateMatch = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
        if (fullDateMatch) {
            const day = parseInt(fullDateMatch[1], 10);
            const month = parseInt(fullDateMatch[2], 10);
            if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
                return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${fullDateMatch[3]}`;
            }
        }

        // Tutto il resto ("1800 circa", "350 a.C.") resta come e' scritto.
        return cleaned;
    }

    isValidDateFormat(dateString) {
        return [/^\d{4}$/, /^\d{1,2}\/\d{4}$/, /^\d{1,2}\/\d{1,2}\/\d{4}$/].some(f => f.test(dateString));
    }

    parseMonth(monthString) {
        const n = this.normalizza(monthString);
        const mesi = [
            ['gen', 'gennaio', 'jan', 'january'],
            ['feb', 'febbraio', 'february'],
            ['mar', 'marzo', 'march'],
            ['apr', 'aprile', 'april'],
            ['mag', 'maggio', 'may'],
            ['giu', 'giugno', 'jun', 'june'],
            ['lug', 'luglio', 'jul', 'july'],
            ['ago', 'agosto', 'aug', 'august'],
            ['set', 'sett', 'settembre', 'sep', 'sept', 'september'],
            ['ott', 'ottobre', 'oct', 'october'],
            ['nov', 'novembre', 'november'],
            ['dic', 'dicembre', 'dec', 'december']
        ];
        const i = mesi.findIndex((nomi) => nomi.includes(n));
        return i === -1 ? null : String(i + 1).padStart(2, '0');
    }

    standardizeDate(dateString) {
        if (!dateString) return '';
        if (/^\d{4}$/.test(dateString)) return `${dateString}-01-01`;
        if (/^\d{1,2}\/\d{4}$/.test(dateString)) {
            const [month, year] = dateString.split('/');
            return `${year}-${month.padStart(2, '0')}-01`;
        }
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateString)) {
            const [day, month, year] = dateString.split('/');
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        return dateString;
    }

    // ===== UTILITY FUNCTIONS =====
    updateCurrentDate() {
        const dateElement = document.querySelector('.current-date');
        const testo = new Date().toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
        dateElement.textContent = testo.charAt(0).toUpperCase() + testo.slice(1);
    }

    getAuthorInitials(author) {
        return String(author || '')
            .replace(/\([^)]*\)/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .map(word => word.charAt(0).toUpperCase())
            .slice(0, 2)
            .join('');
    }

    formatDate(dateString) {
        if (!dateString) return '';
        const s = String(dateString).trim();

        if (/^\d{4}$/.test(s)) return s;

        if (/^\d{1,2}\/\d{4}$/.test(s)) {
            const [month, year] = s.split('/');
            const nome = MESI_BREVI[parseInt(month, 10) - 1];
            return nome ? `${nome} ${year}` : s;
        }

        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
            const [day, month, year] = s.split('/');
            const nome = MESI_BREVI[parseInt(month, 10) - 1];
            return nome ? `${parseInt(day, 10)} ${nome} ${year}` : s;
        }

        // Date scritte a parole ("1800 circa", "8 aprile 2022"): come sono.
        return s;
    }

    escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.classList.add('uscita');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// ===== GLOBAL FUNCTIONS (for HTML onclick handlers) =====
let app;

function switchTab(tab) { app.switchTab(tab); }
function toggleSettings() { app.toggleSettings(); }
function removePhoto(event) { app.removeFormPhoto('add', event); }
function removeEditPhoto(event) { app.removeFormPhoto('edit', event); }
function closeQuoteModal() { app.closeQuoteModal(); }
function navigateQuote(direction) { app.navigateQuote(direction); }
function closeEditModal() { app.closeEditModal(); }
function closeImageModal() { app.closeImageModal(); }

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    app = new KuotApp();
    window.app = app;
});

// ===== SERVICE WORKER REGISTRATION (for PWA capabilities) =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./kuot-sw.js')
            .then(() => console.log('SW registered'))
            .catch(() => console.log('SW registration failed'));
    });
}
