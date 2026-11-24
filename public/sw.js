// Graahak service worker: makes the customer card installable ("Add to Home Screen").
// - Pages (HTML) always come from the network, so every deploy is picked up immediately; offline we
//   show a friendly page instead.
// - Build files under /assets/ have a unique hash in their name and never change, so they are kept on
//   the phone (cache-first). Repeat visits load the app's code without downloading it again.
// - API calls are never cached.
const ASSET_CACHE = "graahak-assets-v1";
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>You're offline</title><style>
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;background:#f5f5ff;color:#18181b}
main{max-width:340px;padding:24px;text-align:center}h1{font-size:22px;margin:12px 0 8px}p{color:#52525b;line-height:1.5}
button{margin-top:16px;height:48px;padding:0 24px;border:0;border-radius:12px;background:#5b5bd6;color:#fff;font-size:16px;font-weight:600}
.box{margin-top:20px;padding:14px;border-radius:14px;background:#fff;font-size:14px;color:#3f3f46;box-shadow:0 1px 2px rgba(0,0,0,.06)}
</style></head><body><main><div style="font-size:44px">📶</div><h1>You're offline</h1>
<p>Your card's QR code needs internet to stay secure. Please turn on mobile data or Wi-Fi.</p>
<div class="box">No internet at the shop? Tell the staff your <b>mobile number</b> and they can add your stamp.</div>
<button onclick="location.reload()">Try again</button></main></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== ASSET_CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          await cache.put(req, res.clone());
          // Old versions' files pile up after deploys: keep only the most recent 80.
          const keys = await cache.keys();
          for (const old of keys.slice(0, Math.max(0, keys.length - 80))) await cache.delete(old);
        }
        return res;
      }),
    );
    return;
  }
  // Pages only; API calls and images go straight to the network as usual.
  if (req.mode !== "navigate") return;
  event.respondWith(
    fetch(req).catch(() => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })),
  );
});
