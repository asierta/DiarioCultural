const CACHE    = 'diario-cultural-v3';
const PRECACHE = [
  '/DiarioCultural/',
  '/DiarioCultural/index.html',
  '/DiarioCultural/style.css',
  '/DiarioCultural/app.js',
  '/DiarioCultural/manifest.json',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Outfit:wght@300;400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

// ── Install ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: stale-while-revalidate for app shell ──
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname.includes('supabase.co'))                              return;
  if (url.hostname.includes('googleapis.com') && url.pathname.includes('/maps/api')) return;
  const isSameOrigin = url.origin === self.location.origin;
  const isCDN = url.hostname.includes('jsdelivr.net') ||
                url.hostname.includes('fonts.gstatic.com') ||
                url.hostname.includes('fonts.googleapis.com');
  if (!isSameOrigin && !isCDN) return;

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const fresh = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fresh;
      })
    )
  );
});

// ── Periodic background sync → ping open clients to check notifications ──
self.addEventListener('periodicsync', e => {
  if (e.tag === 'dc-event-reminders') {
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        if (list.length) {
          list[0].postMessage({ type: 'CHECK_NOTIFICATIONS' });
        }
      })
    );
  }
});

// ── Notification click → focus or open the app ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('/DiarioCultural/') && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('/DiarioCultural/');
    })
  );
});
