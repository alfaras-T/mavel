/* ══════════════════════════════════════════════════════════
   マーベル観る地図 — オフライン用サービスワーカー

   ・HTML は「2.5秒だけネットワークを待つ」方式。圏外や
     電波が弱いときは保存済みの版をすぐ出します。
   ・アイコンなどはキャッシュ優先。
   ・ファイル構成を変えたときだけ VERSION を上げてください。
   ══════════════════════════════════════════════════════════ */
const VERSION = "v4";
const CACHE   = "marvel-watch-log-" + VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

const wait = ms => new Promise(r => setTimeout(r, ms));

/* リダイレクト済みレスポンスはそのまま保存できないことがあるので、
   中身を取り出して作り直してから入れる */
async function storable(res){
  const body = await res.blob();
  const h = new Headers();
  const ct = res.headers.get("Content-Type");
  if (ct) h.set("Content-Type", ct);
  return new Response(body, { status: 200, statusText: "OK", headers: h });
}

async function keep(cache, url){
  const res = await fetch(new Request(url, { cache: "reload" }));
  if (!res || !res.ok) throw new Error("取得失敗: " + url);
  await cache.put(url, await storable(res));
}

/* ── インストール ───────────────────────────────── */
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1つ失敗しても全体を巻き添えにしない
    await Promise.allSettled(SHELL.map(url => keep(cache, url)));
  })());
});

/* ── 有効化：古い版を捨てて、すぐ制御下に置く ────── */
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

/* ── ページからの指示 ───────────────────────────── */
self.addEventListener("message", event => {
  if (event.data === "skip-waiting") self.skipWaiting();
  if (event.data === "recache") {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled(SHELL.map(url => keep(cache, url)));
    })());
  }
});

/* ── 取得 ───────────────────────────────────────── */
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  const wantsHTML =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  /* HTML：保存済みがあれば 2.5 秒だけ新しい版を待つ */
  if (wantsHTML) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);

      const net = fetch(req).then(async res => {
        if (res && res.ok) {
          const copy = await storable(res.clone());
          await cache.put("./index.html", copy.clone());
          await cache.put("./", copy);
        }
        return res;
      }).catch(() => null);

      const hit = (await cache.match("./index.html")) || (await cache.match("./"));
      if (!hit) {
        return (await net) || new Response(
          "オフラインです。一度オンラインで開いてから、もう一度お試しください。",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }
      const winner = await Promise.race([net, wait(2500).then(() => null)]);
      return winner || hit;
    })());
    return;
  }

  /* その他：キャッシュ優先 */
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === "basic") {
        await cache.put(req, await storable(res.clone()));
      }
      return res;
    } catch (e) {
      return new Response("", { status: 504 });
    }
  })());
});
