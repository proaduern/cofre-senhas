/* ============================================================
   sw.js - service worker
   ------------------------------------------------------------
   Guarda apenas o "casco" do app (HTML/CSS/JS/icones) para que
   ele abra sem internet. NENHUM dado do cofre passa por aqui:
   o conteudo vive no IndexedDB, cifrado.
   ============================================================ */

const CACHE = 'cofre-v1.2.0';

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/crypto.js',
  './js/store.js',
  './js/vault.js',
  './js/drive.js',
  './js/importer.js',
  './js/keep.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // chamadas ao Google (login e Drive) nunca sao cacheadas
  if (url.origin !== location.origin) return;

  ev.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        // revalida em segundo plano para pegar atualizacoes do app
        fetch(req)
          .then((res) => {
            if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          })
          .catch(() => {});
        return hit;
      }
      return fetch(req)
        .then((res) => {
          if (res && res.ok && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
