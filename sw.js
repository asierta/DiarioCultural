const CACHE    = 'diario-cultural-v2';
const PRECACHE = [
  '/DiarioCultural/',
  '/DiarioCultural/index.html',
  '/DiarioCultural/style.css',
  '/DiarioCultural/app.js',
  '/DiarioCultural/manifest.json',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Outfit:wght@300;400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

// ── Install: pre-cache app shell ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch strategy ──
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Never intercept Supabase API or auth calls — let them fail naturally offline
  if (url.hostname.includes('supabase.co')) return;

  // Never intercept Google Maps API
  if (url.hostname.includes('googleapis.com') && url.pathname.includes('/maps/api')) return;

  const isSameOrigin = url.origin === self.location.origin;
  const isCDN = url.hostname.includes('jsdelivr.net') ||
                url.hostname.includes('fonts.gstatic.com') ||
                url.hostname.includes('fonts.googleapis.com');

  if (!isSameOrigin && !isCDN) return;

  // Stale-while-revalidate for app shell
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request)
          .then(res => {
            if (res.ok && res.status < 400) {
              cache.put(e.request, res.clone());
            }
            return res;
          })
          .catch(() => cached); // return cached if network fails
        return cached || fetchPromise;
      })
    )
  );
});
