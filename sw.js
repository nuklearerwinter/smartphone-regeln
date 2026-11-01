// Service Worker: immer zuerst die aktuelle Version vom Server holen, bei
// Problemen aber still auf die gespeicherte Version zurückfallen.
//
// Fehlerfälle, die NICHT zu einer sichtbaren Störung führen sollen:
//  - keine Verbindung / DNS-Fehler          → gespeicherte Version
//  - Server antwortet langsam (> TIMEOUT)    → gespeicherte Version, Update läuft im Hintergrund weiter
//  - Server antwortet mit 404/5xx o. Ä.      → gespeicherte Version; Fehlerseiten werden nie gespeichert
const CACHE = "smartphone-regeln-__APP_VERSION__"; // beim Deploy gestempelt
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon.svg"];
const TIMEOUT = 4000;

self.addEventListener("install", e => {
  // Schlägt das Vorab-Laden fehl (z. B. 404), bleibt der bisherige Service Worker samt Cache aktiv.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("smartphone-regeln-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/version.json")) return; // nie cachen; die Seite behandelt Fehler selbst
  e.respondWith(handle(e, req));
});

async function fromCache(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  if (req.mode === "navigate") {
    return (await caches.match("./index.html")) || (await caches.match("./"));
  }
  return undefined;
}

async function handle(event, req) {
  // cache: "no-cache" fragt beim Server nach (ETag) statt den 10-min-HTTP-Cache von GitHub Pages zu nutzen.
  const network = fetch(new Request(req, { cache: "no-cache" })).then(async res => {
    if (res.ok && res.type === "basic") {
      const copy = res.clone();
      const cache = await caches.open(CACHE);
      await cache.put(req, copy);
    }
    return res;
  });
  network.catch(() => {}); // kein "unhandled rejection", wenn der Timeout gewinnt
  event.waitUntil(network.catch(() => {})); // Cache-Update darf nach dem Timeout fertig laufen

  const timeout = new Promise(resolve => setTimeout(resolve, TIMEOUT, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res && res.ok) return res;
    const cached = await fromCache(req);
    if (cached) return cached;
    if (res) return res;  // Fehlerantwort, aber nichts gespeichert: dann eben die Antwort
    return await network; // Timeout und nichts gespeichert: auf das Netz warten
  } catch (err) {
    const cached = await fromCache(req);
    if (cached) return cached;
    return new Response("", { status: 504, statusText: "Offline" });
  }
}
