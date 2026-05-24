#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const MarkdownIt = require("markdown-it");

const cwd = process.cwd();
const sourceArg = process.argv[2];
const outputArg = process.argv[3];

// CLI-контракт: папка источника обязательна, папка результата опциональна.
if (!sourceArg) {
  console.error("Usage: node build-html.js <source-dir> [output-dir]");
  process.exit(1);
}

const sourceDir = path.resolve(cwd, sourceArg);
const outputDir = path.resolve(
  cwd,
  outputArg || `${sourceArg.replace(/[\\/]$/, "")}-html`,
);
const templatePath = path.join(__dirname, "template.html");
const navTemplatePath = path.join(__dirname, "nav.html");
const stylesheets = [
  {
    sourcePath: path.join(__dirname, "main.css"),
    outputPath: "main.css",
  },
  {
    sourcePath: path.join(__dirname, "nav.css"),
    outputPath: "nav.css",
  },
  {
    sourcePath: path.join(__dirname, "article.css"),
    outputPath: "article.css",
  },
];
const scripts = [
  {
    sourcePath: path.join(__dirname, "publication.js"),
    outputPath: "publication.js",
  },
];
const serviceWorkerOutputPath = "sw.js";
const cacheManifestOutputPath = "offline-manifest.json";

const toPosix = (value) => value.split(path.sep).join(path.posix.sep);

// Значения для шаблонов и названия в навигации экранируются перед вставкой.
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const isExternalOrSpecialUrl = (url) =>
  !url ||
  url.startsWith("#") ||
  url.startsWith("//") ||
  /^[a-z][a-z0-9+.-]*:/i.test(url);

// Разделяет относительные URL без URL(), потому что ссылки могут быть простыми путями.
function splitUrlSuffix(url) {
  const hashIndex = url.indexOf("#");
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const queryIndex = beforeHash.indexOf("?");
  const pathname =
    queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : beforeHash.slice(queryIndex);

  return { pathname, query, hash };
}

// Переписываются только локальные Markdown-документы; ассеты и внешние URL не трогаются.
function rewriteMarkdownUrl(url) {
  if (isExternalOrSpecialUrl(url)) {
    return url;
  }

  const { pathname, query, hash } = splitUrlSuffix(url);

  if (path.posix.extname(pathname).toLowerCase() !== ".md") {
    return url;
  }

  return `${pathname.slice(0, -3)}.html${query}${hash}`;
}

// Markdown-it обрабатывает Markdown-ссылки; здесь ловятся raw HTML href/src внутри Markdown.
function rewriteHtmlMarkdownUrls(html) {
  return html.replace(
    /\b(href|src)(\s*=\s*)(["'])([^"']+)\3/gi,
    (match, attr, separator, quote, url) =>
      `${attr}${separator}${quote}${rewriteMarkdownUrl(url)}${quote}`,
  );
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Рекурсивно собирает все файлы: Markdown рендерится, остальные файлы копируются.
async function walkFiles(rootDir, currentDir = rootDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(rootDir, absolutePath)));
    } else if (entry.isFile()) {
      const relativePath = path.relative(rootDir, absolutePath);
      files.push({
        absolutePath,
        relativePath,
        posixRelativePath: toPosix(relativePath),
      });
    }
  }

  return files;
}

function markdownPathToHtmlPath(markdownPath) {
  return markdownPath.replace(/\.md$/i, ".html");
}

function isIndexPage(page) {
  return page.htmlPath === "index.html";
}

// Первый H1 становится title страницы и подписью в навигации.
function pageTitle(markdown, fallback) {
  const heading = markdown.match(/^#\s+(.+?)\s*$/m);

  if (heading) {
    return heading[1].replace(/[#*_`[\]]/g, "").trim();
  }

  return path.basename(fallback, path.extname(fallback));
}

// Каждая страница строит ссылки на общие файлы и другие страницы от своей папки.
function relativeHref(fromHtmlPath, toHtmlPath) {
  const fromDir = path.posix.dirname(fromHtmlPath);
  const href = path.posix.relative(fromDir, toHtmlPath);
  return href || path.posix.basename(toHtmlPath);
}

function createMarkdownRenderer() {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
  });

  const defaultLinkOpen =
    md.renderer.rules.link_open ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  const defaultImage =
    md.renderer.rules.image ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  // Переписывает [chapter](chapter.md) в ссылку на сгенерированный chapter.html.
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const hrefIndex = tokens[idx].attrIndex("href");

    if (hrefIndex >= 0) {
      tokens[idx].attrs[hrefIndex][1] = rewriteMarkdownUrl(
        tokens[idx].attrs[hrefIndex][1],
      );
    }

    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  // Применяет то же правило к src изображений, если там вдруг указан .md.
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const srcIndex = tokens[idx].attrIndex("src");

    if (srcIndex >= 0) {
      tokens[idx].attrs[srcIndex][1] = rewriteMarkdownUrl(
        tokens[idx].attrs[srcIndex][1],
      );
    }

    return defaultImage(tokens, idx, options, env, self);
  };

  return md;
}

function markOriginalLanguage(html) {
  return html.replace(
    /^<([a-z][a-z0-9-]*)(\s[^>]*)?>/i,
    (match, tagName, attributes = "") => `<${tagName} lang="en"${attributes}>`,
  );
}

function unwrapTranslationParagraph(html) {
  const paragraph = html.match(/^<p>([\s\S]*)<\/p>$/);
  return paragraph ? paragraph[1] : html;
}

function markTranslationLanguage(html) {
  return html
    .replace(
      /<blockquote>\n([\s\S]*?)\n<\/blockquote>/g,
      (match, translation) =>
        `<blockquote lang="ru">\n${unwrapTranslationParagraph(translation)}\n</blockquote>`,
    )
    .replace(
      /<blockquote lang="ru">\n([\s\S]*?)\n<\/blockquote>/g,
      (match, translation) =>
        `<blockquote lang="ru">\n${unwrapTranslationParagraph(translation)}\n</blockquote>`,
    );
}

// Оригинал и перевод остаются соседними блоками без служебной обвязки.
function addContentLanguage(html) {
  const originalBlock =
    String.raw`(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>|<p[^>]*>[\s\S]*?<\/p>|<ul[^>]*>[\s\S]*?<\/ul>|<ol[^>]*>[\s\S]*?<\/ol>)`;
  const translationPairPattern = new RegExp(
    `${originalBlock}\\n<blockquote>\\n([\\s\\S]*?)\\n<\\/blockquote>`,
    "g",
  );

  const pairedHtml = html.replace(
    translationPairPattern,
    (match, original, translation) =>
      `${markOriginalLanguage(original)}\n<blockquote>\n${translation}\n</blockquote>`,
  );

  return markTranslationLanguage(pairedHtml);
}

// Разметка навигации лежит в nav.html; здесь собирается только список ссылок.
function renderNav({ template, pages, currentPage }) {
  const items = pages
    .map((page) => {
      const href = relativeHref(currentPage.htmlPath, page.htmlPath);
      const isCurrent = page.htmlPath === currentPage.htmlPath;

      return `<li><a href="${escapeHtml(href)}"${isCurrent ? ' aria-current="page"' : ""}>${escapeHtml(page.title)}</a></li>`;
    })
    .join("\n");

  return template
    .replaceAll(
      "{{indexHref}}",
      escapeHtml(relativeHref(currentPage.htmlPath, "index.html")),
    )
    .replaceAll("{{items}}", items);
}

// Оболочка страницы лежит в template.html; плейсхолдеры намеренно простые.
function renderPage({
  template,
  title,
  stylesheetLinks,
  scriptTags,
  serviceWorkerRegistration,
  body,
  nav,
  contentModeAttributes,
}) {
  return template
    .replaceAll("{{title}}", escapeHtml(title))
    .replaceAll("{{stylesheets}}", stylesheetLinks)
    .replaceAll("{{scripts}}", scriptTags)
    .replaceAll("{{serviceWorker}}", serviceWorkerRegistration)
    .replaceAll("{{contentModeAttributes}}", contentModeAttributes)
    .replaceAll("{{nav}}", nav)
    .replaceAll("{{body}}", body);
}

async function fileHash(filePath) {
  const contents = await fs.readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

async function createCacheManifest(outputDir, cachePaths) {
  const files = await Promise.all(
    Array.from(new Set(cachePaths))
      .sort((a, b) => a.localeCompare(b))
      .map(async (url) => ({
        url,
        revision: await fileHash(path.join(outputDir, url)),
      })),
  );
  const version = createHash("sha256")
    .update(JSON.stringify(files))
    .digest("hex")
    .slice(0, 16);

  return { version, files };
}

function renderServiceWorker(buildVersion) {
  return `const BUILD_VERSION = ${JSON.stringify(buildVersion)};
const CACHE_PREFIX = "kasina-publication-";
const MANIFEST_URL = new URL(${JSON.stringify(cacheManifestOutputPath)}, self.location.href);

let activeCacheName = \`\${CACHE_PREFIX}\${BUILD_VERSION}\`;

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
    throw new Error(\`Offline manifest request failed: \${response.status}\`);
  }

  return response.json();
}

async function precachePublication() {
  const manifest = await fetchManifest();
  activeCacheName = \`\${CACHE_PREFIX}\${manifest.version}\`;
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
`;
}

function renderServiceWorkerRegistration(serviceWorkerHref) {
  return `  <script>
    if ("serviceWorker" in navigator && window.isSecureContext && /^(https?:)$/.test(window.location.protocol)) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register(${JSON.stringify(serviceWorkerHref)}).catch(function () {});
      });
    }
  </script>`;
}

async function emptyOutputDirectory(targetDir) {
  // Папка результата удаляется при каждой сборке, поэтому опасные пути запрещены.
  if (targetDir === path.parse(targetDir).root) {
    throw new Error("Output directory cannot be the filesystem root.");
  }

  if (sourceDir === targetDir) {
    throw new Error("Output directory must be different from source directory.");
  }

  if (sourceDir.startsWith(`${targetDir}${path.sep}`)) {
    throw new Error("Output directory cannot be a parent of source directory.");
  }

  if (targetDir.startsWith(`${sourceDir}${path.sep}`)) {
    throw new Error("Output directory cannot be inside source directory.");
  }

  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
}

async function main() {
  const sourceStats = await fs.stat(sourceDir).catch(() => null);

  if (!sourceStats || !sourceStats.isDirectory()) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  const files = await walkFiles(sourceDir);
  const markdownFiles = files
    .filter((file) => path.extname(file.relativePath).toLowerCase() === ".md")
    .sort((a, b) => {
      if (a.posixRelativePath === "index.md") return -1;
      if (b.posixRelativePath === "index.md") return 1;
      return a.posixRelativePath.localeCompare(b.posixRelativePath);
    });

  if (markdownFiles.length === 0) {
    throw new Error(`No Markdown files found in ${sourceDir}`);
  }

  const pages = await Promise.all(
    markdownFiles.map(async (file) => {
      const markdown = await fs.readFile(file.absolutePath, "utf8");

      return {
        ...file,
        markdown,
        title: pageTitle(markdown, file.posixRelativePath),
        htmlPath: markdownPathToHtmlPath(file.posixRelativePath),
      };
    }),
  );

  await emptyOutputDirectory(outputDir);

  const md = createMarkdownRenderer();
  // HTML-шаблоны относятся к генератору, а не к содержимому публикации.
  const template = await fs.readFile(templatePath, "utf8");
  const navTemplate = await fs.readFile(navTemplatePath, "utf8");
  const cachePaths = [];

  // Копирует будущие картинки, шрифты, PDF и другие ассеты с сохранением структуры.
  for (const file of files) {
    if (path.extname(file.relativePath).toLowerCase() === ".md") {
      continue;
    }

    const targetPath = path.join(outputDir, file.relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(file.absolutePath, targetPath);
    cachePaths.push(file.posixRelativePath);
  }

  for (const stylesheet of stylesheets) {
    await fs.copyFile(
      stylesheet.sourcePath,
      path.join(outputDir, stylesheet.outputPath),
    );
    cachePaths.push(stylesheet.outputPath);
  }

  for (const script of scripts) {
    await fs.copyFile(script.sourcePath, path.join(outputDir, script.outputPath));
    cachePaths.push(script.outputPath);
  }

  // Рендерит каждый Markdown-документ в самостоятельную HTML-страницу.
  for (const page of pages) {
    const body = addContentLanguage(
      rewriteHtmlMarkdownUrls(md.render(page.markdown)),
    );
    const stylesheetLinks = stylesheets
      .map((stylesheet) => {
        const href = relativeHref(page.htmlPath, stylesheet.outputPath);
        return `  <link rel="stylesheet" href="${escapeHtml(href)}">`;
      })
      .join("\n");
    const scriptTags = scripts
      .map((script) => {
        const src = relativeHref(page.htmlPath, script.outputPath);
        return `  <script defer src="${escapeHtml(src)}"></script>`;
      })
      .join("\n");
    const serviceWorkerRegistration = renderServiceWorkerRegistration(
      relativeHref(page.htmlPath, serviceWorkerOutputPath),
    );
    const html = renderPage({
      template,
      title: page.title,
      stylesheetLinks,
      scriptTags,
      serviceWorkerRegistration,
      body,
      contentModeAttributes: isIndexPage(page)
        ? 'data-content-mode-disabled="true"'
        : 'data-content-mode="bilingual"',
      nav: renderNav({ template: navTemplate, pages, currentPage: page }),
    });
    const targetPath = path.join(outputDir, page.htmlPath);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, html, "utf8");
    cachePaths.push(page.htmlPath);
  }

  const cacheManifest = await createCacheManifest(outputDir, cachePaths);
  await fs.writeFile(
    path.join(outputDir, cacheManifestOutputPath),
    `${JSON.stringify(cacheManifest, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(outputDir, serviceWorkerOutputPath),
    renderServiceWorker(cacheManifest.version),
    "utf8",
  );

  const indexPath = path.join(outputDir, "index.html");
  const entryPath = (await pathExists(indexPath))
    ? indexPath
    : path.join(outputDir, pages[0].htmlPath);

  console.log(`Converted ${pages.length} Markdown files.`);
  console.log(`Output: ${outputDir}`);
  console.log(`Open: ${entryPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
