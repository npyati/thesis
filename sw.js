// Service worker with network-first strategy for HTML/JS and cache-first for static assets
// Cache version is bumped automatically when files change

const CACHE_NAME = 'thesis-v2';
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
    './favicon.ico',
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
    const url = new URL(event.request.url);

    // Network-first for HTML and JS files (ensures updates are seen quickly)
    if (event.request.destination === 'document' ||
        event.request.destination === 'script' ||
        url.pathname.endsWith('.html') ||
        url.pathname.endsWith('.js')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Clone and cache the fresh response
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => {
                    // Fall back to cache when offline
                    return caches.match(event.request);
                })
        );
        return;
    }

    // Cache-first for static assets (CSS, images, fonts)
    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;
                return fetch(event.request).then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return response;
                });
            })
    );
});
