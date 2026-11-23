// Graahak service worker: makes the customer card installable ("Add to Home Screen").
// It deliberately caches nothing, so every deploy is picked up immediately. Its only job is to
// show a friendly page when a page is opened with no internet connection.
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
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only page navigations; API calls, scripts and images go straight to the network as usual.
  if (req.mode !== "navigate" || req.method !== "GET") return;
  event.respondWith(
    fetch(req).catch(() => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })),
  );
});
