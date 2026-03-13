var CACHE_NAME = "kakeibo-v3";
var ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./db.js",
  "./chart.js",
  "../../style.css",
  "../../shared/form-utils.js",
  "../../images/icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; })
             .map(function (n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  // GAS API はキャッシュしない
  if (e.request.url.indexOf("script.google.com") !== -1) return;
  // Chart.js CDN はネットワーク優先
  if (e.request.url.indexOf("cdn.jsdelivr.net") !== -1) return;

  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request).then(function (response) {
        // 成功レスポンスをキャッシュに追加
        if (response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      });
    })
  );
});
