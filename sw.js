// Offline-Hülle: App-Dateien werden zwischengespeichert, Rezepte hält Firestore selbst offline vor.
const CACHE = "kochbuch-v12";
const SHELL = ["./", "index.html", "app.js", "vendor/jspdf.umd.min.js", "firebase-config.js", "manifest.webmanifest", "fonts/YoungSerif-Light.otf", "icons/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const own = url.origin === location.origin;
  const staticLib = url.hostname === "www.gstatic.com" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!own && !staticLib) return;
  if (own) {
    // Netz zuerst, damit Updates sofort ankommen; ohne Netz aus dem Zwischenspeicher.
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
  } else {
    // Versionierte Bibliotheken und Schriften: Zwischenspeicher zuerst.
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
