/* PEREHVAT 7.8 — lightweight offline shell: do not download the entire game at startup. */
const CACHE_NAME = 'perehvat-duo-v78-render-lite';
const CORE = [
 '/', '/duo', '/offline', '/manifest.webmanifest',
 '/static/duo.css', '/static/release-v5.css', '/static/styles.css',
 '/static/duo.js', '/static/app.js', '/static/favicon.svg',
 '/static/audio-director.js', '/static/audio-cinema.css',
 '/static/social-v7.css', '/static/task-layout.css', '/static/task-layout.js',
 '/static/story-ar-v77.css', '/static/cinematic.css'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('perehvat-') && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline')));
    return;
  }
  if (CORE.includes(url.pathname)) {
    event.respondWith(caches.match(req, {ignoreSearch: true}).then(hit => hit || fetch(req)));
  }
});
