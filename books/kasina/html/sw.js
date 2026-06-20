const BUILD_VERSION = "d91124ef31bc4cdb";
const CACHE_PREFIX = "kasina-publication-";
const MANIFEST_URL = new URL("offline-manifest.json", self.location.href);

let activeCacheName = `${CACHE_PREFIX}${BUILD_VERSION}`;

async function publicationCacheNames() {
  const names = await caches.keys();
  return names.filter((name) => name.startsWith(CACHE_PREFIX));
}

async function cacheNameForRead() {
  const names = await publicationCacheNames();
  return names.includes(activeCacheName) ? activeCacheName : names.sort().at(-1);
}

async function matchFromPublicationCaches(request) {
  const names = await publicationCacheNames();

  for (const name of names.reverse()) {
    const cache = await caches.open(name);
    const response = await cache.match(request);

    if (response) {
      return response;
    }
  }

  return null;
}

async function fetchManifest() {
  const response = await fetch(MANIFEST_URL, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Offline manifest request failed: ${response.status}`);
  }

  return response.json();
}

async function precachePublication() {
  const manifest = await fetchManifest();
  activeCacheName = `${CACHE_PREFIX}${manifest.version}`;
  const cache = await caches.open(activeCacheName);
  const urls = manifest.files.map((file) => new URL(file.url, self.location.href));

  await cache.addAll(urls.map((url) => new Request(url, { cache: "reload" })));
  await cache.put(MANIFEST_URL, new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/json" },
  }));
}

async function cleanupOldCaches() {
  const names = await publicationCacheNames();
  await Promise.all(
    names
      .filter((name) => name !== activeCacheName)
      .map((name) => caches.delete(name)),
  );
}

function isSameOriginRequest(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

function isHtmlRequest(request) {
  if (request.mode === "navigate") {
    return true;
  }

  const accept = request.headers.get("Accept") || "";
  const url = new URL(request.url);

  return request.method === "GET" && (accept.includes("text/html") || url.pathname.endsWith(".html"));
}

function isScopeRoot(url) {
  return url.href === self.registration.scope || url.href === new URL(".", self.registration.scope).href;
}

async function networkFirst(request) {
  const cacheName = activeCacheName || (await cacheNameForRead());

  try {
    const response = await fetch(request);

    if (response.ok && cacheName) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    const cached =
      (await matchFromPublicationCaches(request)) ||
      (isScopeRoot(new URL(request.url))
        ? await matchFromPublicationCaches(new URL("index.html", self.location.href))
        : null);

    if (cached) {
      return cached;
    }

    throw error;
  }
}

async function updateStaticCache(request) {
  const cacheName = activeCacheName || (await cacheNameForRead());

  if (!cacheName) {
    return null;
  }

  const response = await fetch(request);

  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }

  return response;
}

async function cacheFirstWithUpdate(request, event) {
  const cached = await matchFromPublicationCaches(request);

  if (cached) {
    event.waitUntil(updateStaticCache(request).catch(() => undefined));
    return cached;
  }

  return updateStaticCache(request);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precachePublication().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanupOldCaches().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);

  if (!isSameOriginRequest(requestUrl)) {
    return;
  }

  if (isHtmlRequest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirstWithUpdate(request, event));
});
