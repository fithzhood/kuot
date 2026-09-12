// ===== KUOT APP - SERVICE WORKER =====
//
// Versione riscritta il 12 settembre 2026.
//
// La precedente serviva SEMPRE dalla cache per prima, quindi una volta
// installata l'app restava congelata sulla versione di quel giorno: qualunque
// cosa si pubblicasse, il telefono continuava a mostrare la vecchia.
//
// Adesso: prima la rete, la cache solo come riserva quando la rete non c'e'.
// Cosi' gli aggiornamenti arrivano e l'uso senza linea continua a funzionare.
//
// Il nome della cache e' cambiato apposta: all'attivazione quella vecchia
// viene cancellata. skipWaiting + clients.claim fanno si' che questo service
// worker prenda il posto del precedente subito, senza aspettare che tutte le
// schede vengano chiuse.

const CACHE_NAME = 'kuot-nuova-v1';
const urlsToCache = [
    './',
    './kuot.html',
    './kuot.css',
    './kuot.js',
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(urlsToCache))
            .catch((error) => console.error('Cache iniziale fallita:', error))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((nomi) => Promise.all(
                nomi.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then((risposta) => {
                // Copia in cache quello che arriva, cosi' resta disponibile
                // anche senza linea.
                const copia = risposta.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, copia).catch(() => {});
                });
                return risposta;
            })
            .catch(() => caches.match(event.request).then((c) => {
                if (c) return c;
                if (event.request.destination === 'document') {
                    return caches.match('./kuot.html');
                }
            }))
    );
});
