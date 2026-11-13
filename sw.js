// Service worker: permite abrir la app sin conexión una vez instalada.
// Estrategia "red primero": con conexión siempre sirve la última versión (sin cachés
// obsoletas tras un despliegue); sin conexión, la última copia guardada.
// Solo se registra en HTTPS fuera de localhost (ver src/app.js), así no interfiere en desarrollo.

const CACHE = 'habitos-v12';
const SHELL = [
  './', 'index.html', 'styles.css', 'themes/classic.css', 'themes/holo.css', 'themes/hud.css', 'themes/gold.css', 'fonts/space-grotesk-latin.woff2', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'src/app.js', 'src/store.js', 'src/demo.js', 'src/backup.js',
  'src/domain/dates.js', 'src/domain/habits.js', 'src/domain/streaks.js',
  'src/domain/gamification.js', 'src/domain/stats.js', 'src/domain/messages.js', 'src/domain/workouts.js',
  'src/ui/dom.js', 'src/ui/charts.js', 'src/ui/today.js', 'src/ui/habitForm.js',
  'src/ui/habitDetail.js', 'src/ui/progress.js', 'src/ui/settings.js', 'src/ui/install.js',
  'src/ui/sheet.js', 'src/ui/workoutSheet.js', 'src/ui/confetti.js',
  'src/domain/finance.js', 'src/ui/finance/overview.js', 'src/ui/finance/transactions.js',
  'src/ui/finance/accounts.js', 'src/ui/finance/entrySheet.js', 'src/ui/theme.js', 'src/ui/symbols.js', 'src/ui/swipe.js',
  'src/domain/inbox.js', 'src/inbox/gmail.js', 'src/inbox/ai.js', 'src/inbox/state.js',
  'src/ui/home.js', 'src/ui/inbox/overview.js', 'src/ui/inbox/list.js', 'src/ui/inbox/connect.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./'))),
  );
});
