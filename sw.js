// Calcular el BASE dinámicamente desde donde vive este sw.js
// Si está en /DiarioCultural/sw.js → BASE = '/DiarioCultural'
// Si está en /sw.js               → BASE = ''
const BASE  = self.location.pathname.replace(/\/sw\.js$/, '');
const CACHE = 'diario-cultural-v4';

const APP_SHELL = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/style.css',
  BASE + '/app.js',
  BASE + '/manifest.json',
];

const EXTRAS = [
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Outfit:wght@300;400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

// ── Install: pre-cachear app shell ──────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async cache => {
      // Cada archivo por separado: si uno falla no rompe el resto
      await Promise.allSettled(
        [...APP_SHELL, ...EXTRAS].map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: borrar cachés antiguas ────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Nunca interceptar Supabase ni Google Maps API
  if (url.hostname.includes('supabase.co')) return;
  if (url.hostname.includes('googleapis.com') && url.pathname.includes('/maps/api')) return;

  const isSameOrigin = url.origin === self.location.origin;
  const isCDN = url.hostname.includes('jsdelivr.net') ||
                url.hostname.includes('fonts.gstatic.com') ||
                url.hostname.includes('fonts.googleapis.com');
  if (!isSameOrigin && !isCDN) return;

  // ── Navegación (reload / apertura de la app) ──────────────────────────────
  // Estrategia: red primero → si falla, servir desde caché
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        })
        .catch(async () => {
          // Intentar varias claves de caché en orden de preferencia
          return (
            await caches.match(e.request) ||
            await caches.match(BASE + '/index.html') ||
            await caches.match(BASE + '/') ||
            new Response(offlinePage(), { headers: { 'Content-Type': 'text/html;charset=utf-8' } })
          );
        })
    );
    return;
  }

  // ── Recursos estáticos: caché primero, red en segundo plano ──────────────
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const fromNet = fetch(e.request)
          .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
          .catch(() => null);
        return cached || fromNet.then(r => r || new Response('', { status: 503 }));
      })
    )
  );
});

// ── Periodic sync → notificaciones ──────────────────────────────────────────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'dc-event-reminders') {
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(list => { if (list.length) list[0].postMessage({ type: 'CHECK_NOTIFICATIONS' }); })
    );
  }
});

// ── Click en notificación ────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(BASE + '/');
    })
  );
});

// ── Página de error offline (último recurso) ─────────────────────────────────
function offlinePage() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Diario Cultural — Sin conexión</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;
         background:#09080a;color:#857e88;font-family:system-ui,sans-serif;padding:2rem;text-align:center}
    h1{font-family:Georgia,serif;font-weight:300;font-size:2rem;color:#eee8df;margin-bottom:.5rem}
    h1 em{font-style:italic;color:#e4b96a}
    p{font-size:.9rem;line-height:1.7;margin-top:.75rem;max-width:340px}
    .icon{font-size:3rem;margin-bottom:1.25rem;filter:grayscale(.4)}
    button{margin-top:1.5rem;background:#c9943a;border:none;border-radius:10px;
           padding:.7rem 1.75rem;color:#1a1000;font-size:.9rem;font-weight:500;cursor:pointer}
  </style>
</head>
<body>
  <div>
    <div class="icon">🎭</div>
    <h1>Diario <em>Cultural</em></h1>
    <p>Estás sin conexión y la app aún no está guardada en caché.</p>
    <p>Ábrela <strong>una vez con conexión</strong> para que funcione offline en el futuro.</p>
    <button onclick="location.reload()">Reintentar</button>
  </div>
</body>
</html>`;
}
