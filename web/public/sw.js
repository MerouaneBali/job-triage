/* Minimal service worker — makes the app installable; network stays live. */
const VERSION = "job-triage-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("job-triage-") && k !== VERSION).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // Never cache API / pipeline streams — always hit the machine.
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        return (
          (await caches.match("/")) ||
          new Response("Offline — open when the triage host is reachable.", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          })
        );
      }
      throw new Error("offline");
    })
  );
});
