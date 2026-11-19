// Service worker minimal : rend l'application installable et garde une copie
// des pages et ressources statiques pour un démarrage rapide. Les données
// Supabase ne sont jamais mises en cache.
const CACHE = "a-deux-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Réseau d'abord, copie locale en secours (hors ligne).
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && (url.pathname.includes("/_next/static/") || e.request.mode === "navigate")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || Response.error())),
  );
});

// Notifications push envoyées par la fonction « notify ».
self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data && e.data.text() };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "À deux", {
      body: d.body || "",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: d.url || "/planning/" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(String(e.notification.data?.url || "/planning/").replace(/^\//, ""), self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      if (open) return open.navigate(target).then((c) => (c || open).focus());
      return self.clients.openWindow(target);
    }),
  );
});
