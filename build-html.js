#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const MarkdownIt = require("markdown-it");

const cwd = process.cwd();
const sourceArg = process.argv[2];
const outputArg = process.argv[3];

if (!sourceArg) {
  console.error("Usage: node build-html.js <source-dir> [output-dir]");
  process.exit(1);
}

const sourceDir = path.resolve(cwd, sourceArg);
const outputDir = path.resolve(
  cwd,
  outputArg || `${sourceArg.replace(/[\\/]$/, "")}-html`,
);

const toPosix = (value) => value.split(path.sep).join(path.posix.sep);

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

function pageTitle(markdown, fallback) {
  const heading = markdown.match(/^#\s+(.+?)\s*$/m);

  if (heading) {
    return heading[1].replace(/[#*_`[\]]/g, "").trim();
  }

  return path.basename(fallback, path.extname(fallback));
}

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

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const hrefIndex = tokens[idx].attrIndex("href");

    if (hrefIndex >= 0) {
      tokens[idx].attrs[hrefIndex][1] = rewriteMarkdownUrl(
        tokens[idx].attrs[hrefIndex][1],
      );
    }

    return defaultLinkOpen(tokens, idx, options, env, self);
  };

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

function renderNav(pages, currentPage) {
  const items = pages
    .map((page) => {
      const href = relativeHref(currentPage.htmlPath, page.htmlPath);
      const isCurrent = page.htmlPath === currentPage.htmlPath;

      return `<li><a href="${escapeHtml(href)}"${isCurrent ? ' aria-current="page"' : ""}>${escapeHtml(page.title)}</a></li>`;
    })
    .join("\n");

  return `<nav class="site-nav" aria-label="Publication chapters">
  <a class="site-title" href="${escapeHtml(relativeHref(currentPage.htmlPath, "index.html"))}">The Fire Kasina</a>
  <ol>
${items}
  </ol>
</nav>`;
}

function renderPage({ title, body, nav }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <script defer src="https://cdn.jsdelivr.net/npm/@alpinejs/persist@3.x.x/dist/cdn.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f4ee;
      --panel: #fffdf8;
      --text: #1f2523;
      --muted: #66706b;
      --border: #ded6ca;
      --accent: #8f3f27;
      --accent-contrast: #ffffff;
      --quote-bg: #efe7da;
      --shadow: 0 18px 45px rgba(54, 42, 30, 0.08);
    }

    [data-theme="dark"] {
      color-scheme: dark;
      --bg: #151817;
      --panel: #1f2422;
      --text: #ece7dd;
      --muted: #b5ada0;
      --border: #343c38;
      --accent: #e39b6f;
      --accent-contrast: #1d120d;
      --quote-bg: #292f2c;
      --shadow: 0 18px 45px rgba(0, 0, 0, 0.28);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Georgia, "Times New Roman", serif;
      line-height: 1.65;
    }

    a {
      color: var(--accent);
      text-decoration-thickness: 0.08em;
      text-underline-offset: 0.16em;
    }

    .layout {
      min-height: 100vh;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      justify-content: flex-end;
      padding: 0.75rem clamp(1rem, 4vw, 2.5rem);
      background: color-mix(in srgb, var(--bg) 88%, transparent);
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(12px);
    }

    .theme-toggle {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0.45rem 0.75rem;
      background: var(--panel);
      color: var(--text);
      font: 600 0.9rem/1.2 system-ui, sans-serif;
      cursor: pointer;
    }

    .theme-toggle:hover {
      border-color: var(--accent);
    }

    .shell {
      display: grid;
      grid-template-columns: minmax(14rem, 18rem) minmax(0, 48rem);
      gap: clamp(1.5rem, 5vw, 4rem);
      align-items: start;
      max-width: 75rem;
      margin: 0 auto;
      padding: clamp(1.25rem, 5vw, 4rem);
    }

    .site-nav {
      position: sticky;
      top: 4.25rem;
      max-height: calc(100vh - 5.5rem);
      overflow: auto;
      padding: 1.25rem;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: var(--shadow);
      font-family: system-ui, sans-serif;
      line-height: 1.35;
    }

    .site-title {
      display: inline-block;
      margin-bottom: 1rem;
      color: var(--text);
      font-weight: 750;
      text-decoration: none;
    }

    .site-nav ol {
      display: grid;
      gap: 0.45rem;
      margin: 0;
      padding-left: 1.25rem;
      color: var(--muted);
    }

    .site-nav a {
      color: var(--muted);
      text-decoration: none;
    }

    .site-nav a:hover,
    .site-nav a[aria-current="page"] {
      color: var(--accent);
    }

    main {
      min-width: 0;
      padding: clamp(1.25rem, 4vw, 3rem);
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }

    main > :first-child {
      margin-top: 0;
    }

    main > :last-child {
      margin-bottom: 0;
    }

    h1,
    h2,
    h3 {
      line-height: 1.2;
      letter-spacing: 0;
    }

    h1 {
      font-size: clamp(2rem, 6vw, 3.2rem);
      margin: 0 0 1.5rem;
    }

    h2 {
      margin-top: 2.2rem;
      font-size: 1.55rem;
    }

    h3 {
      margin-top: 1.8rem;
      font-size: 1.2rem;
    }

    p,
    ul,
    ol,
    blockquote {
      margin: 1rem 0;
    }

    blockquote {
      margin-left: 0;
      padding: 0.75rem 1rem;
      background: var(--quote-bg);
      border-left: 4px solid var(--accent);
      color: var(--text);
    }

    code {
      padding: 0.12rem 0.28rem;
      border-radius: 4px;
      background: var(--quote-bg);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
    }

    pre {
      overflow: auto;
      padding: 1rem;
      border-radius: 8px;
      background: var(--quote-bg);
    }

    pre code {
      padding: 0;
      background: transparent;
    }

    @media (max-width: 820px) {
      .shell {
        grid-template-columns: 1fr;
      }

      .site-nav {
        position: static;
        max-height: none;
      }
    }
  </style>
</head>
<body x-data="{ theme: $persist('light').as('kasina-theme') }" x-bind:data-theme="theme">
  <div class="layout">
    <header class="topbar">
      <button class="theme-toggle" type="button" x-on:click="theme = theme === 'dark' ? 'light' : 'dark'" x-text="theme === 'dark' ? 'Light theme' : 'Dark theme'"></button>
    </header>
    <div class="shell">
      ${nav}
      <main>
${body}
      </main>
    </div>
  </div>
</body>
</html>
`;
}

async function emptyOutputDirectory(targetDir) {
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

  for (const file of files) {
    if (path.extname(file.relativePath).toLowerCase() === ".md") {
      continue;
    }

    const targetPath = path.join(outputDir, file.relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(file.absolutePath, targetPath);
  }

  for (const page of pages) {
    const body = rewriteHtmlMarkdownUrls(md.render(page.markdown));
    const html = renderPage({
      title: page.title,
      body,
      nav: renderNav(pages, page),
    });
    const targetPath = path.join(outputDir, page.htmlPath);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, html, "utf8");
  }

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
