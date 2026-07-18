// Service worker with network-first strategy for HTML/JS and cache-first for static assets
// Bump CACHE_NAME manually when cached assets change.

const CACHE_NAME = 'thesis-v10';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './styles.css',
    './js/app.js',
    './js/state.js',
    './js/blocks.js',
    './js/modals.js',
    './js/modes.js',
    './js/formatting.js',
    './js/io.js',
    './js/db.js',
    './js/utils.js',
    './js/sanitize.js',
    './js/history.js',
    './js/find.js',
    './js/retype.js',
    './favicon.ico',
    './android-chrome-192x192.png',
    './android-chrome-512x512.png',
    './apple-touch-icon.png',
    './manifest.json'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - network-first for HTML/JS, cache-first for other assets
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    const cacheResponse = (response) => {
        if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
    };
    const offlineFallback = () =>
        new Response('Offline and not cached', { status: 503, statusText: 'Service Unavailable' });

    // Network-first for HTML and JS files (ensures updates are seen quickly)
    if (event.request.destination === 'document' ||
        event.request.destination === 'script' ||
        url.pathname.endsWith('.html') ||
        url.pathname.endsWith('.js')) {
        event.respondWith(
            fetch(event.request)
                .then(cacheResponse)
                .catch(() => caches.match(event.request)
                    .then((cached) => cached || caches.match('./index.html'))
                    .then((cached) => cached || offlineFallback()))
        );
        return;
    }

    // Cache-first for static assets (CSS, images, fonts)
    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;
                return fetch(event.request).then(cacheResponse).catch(offlineFallback);
            })
    );
});
