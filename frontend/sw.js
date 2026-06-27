// BLDE(DU) EDC — Service Worker v25.0
const CACHE_NAME = 'blde-edc-v25';
const OFFLINE_ASSETS = [
  '/index.html',
  '/survey.html',
  '/manifest.json'
];

// Install — cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching offline assets');
      return cache.addAll(OFFLINE_ASSETS.map(url => new Request(url, { cache: 'reload' })));
    }).catch(err => console.log('[SW] Cache failed (dev mode):', err))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, cache fallback
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go to network for API calls
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/') || url.port === '3001' || url.port === '3002') {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline', message: 'No internet connection' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // For fonts and external resources — network first, no cache fallback needed
  if (url.hostname !== location.hostname && url.hostname !== 'localhost') {
    event.respondWith(
      fetch(event.request).catch(() => new Response('', { status: 408 }))
    );
    return;
  }

  // For app files — network first, cache fallback, then offline page fallback
  event.respondWith(
    fetch(event.request).then(response => {
      // Cache successful responses for HTML/JS/CSS
      if (response.ok && ['text/html', 'application/javascript', 'text/css'].some(t => response.headers.get('content-type')?.includes(t))) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => {
      // Fallback to cache
      return caches.match(event.request).then(cached => {
        if (cached) return cached;
        // Offline fallback for HTML requests
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Background sync — trigger sync when back online
self.addEventListener('sync', event => {
  if (event.tag === 'blde-sync-records') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SYNC_TRIGGERED' }));
      })
    );
  }
});

// Push notifications (future use)
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'BLDE EDC Alert', {
      body: data.body || '',
      icon: '/manifest.json',
      badge: '/manifest.json',
      tag: data.tag || 'blde-alert',
      data: data
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow(event.notification.data?.url || '/index.html')
  );
});

console.log('[SW] BLDE(DU) EDC Service Worker v18 loaded');
