/* ══════════════════════════════════════════════════════════
   マーベル観る地図 — オフライン用サービスワーカー

   ・HTML はネットワーク優先。作品リストを更新したら次に
     オンラインで開いた時点で自動的に新しくなります。
   ・アイコンなどはキャッシュ優先。機内モードでも開けます。
   ・アイコンやファイル構成を変えたときだけ、下の VERSION を
     上げてください（v1 → v2）。古いキャッシュが破棄されます。
   ══════════════════════════════════════════════════════════ */
const VERSION = "v1";
const CACHE   = "marvel-watch-log-" + VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png"
];

/* ── インストール：土台をためこむ ────────────────── */
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1つ失敗しても全体を巻き添えにしない
    await Promise.allSettled(SHELL.map(url => cache.add(url)));
  })());
});

/* ── 有効化：古い版を捨てる ──────────────────────── */
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n.startsWith("marvel-watch-log-") && n !== CACHE)
           .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

/* ── ページから「今すぐ切り替えて」と言われたら ──── */
self.addEventListener("message", event => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

/* ── 取得 ────────────────────────────────────────── */
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  const wantsHTML =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  /* HTML：新しいものを取りにいき、圏外ならキャッシュを出す */
  if (wantsHTML) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE);
        return (await cache.match(req))
            || (await cache.match("./index.html"))
            || (await cache.match("./"))
            || new Response("オフラインです。一度オンラインで開いてください。", {
                 status: 503,
                 headers: { "Content-Type": "text/plain; charset=utf-8" }
               });
      }
    })());
    return;
  }

  /* その他：キャッシュ優先、なければ取りにいってためる */
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    } catch (e) {
      return new Response("", { status: 504 });
    }
  })());
});
