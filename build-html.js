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
const templatePath = path.join(__dirname, "template.html");
const navTemplatePath = path.join(__dirname, "nav.html");
const stylesPath = path.join(__dirname, "styles.css");
const stylesheetOutputPath = "publication.css";

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

function renderPage({ template, title, stylesheetHref, body, nav }) {
  return template
    .replaceAll("{{title}}", escapeHtml(title))
    .replaceAll("{{stylesheetHref}}", escapeHtml(stylesheetHref))
    .replaceAll("{{nav}}", nav)
    .replaceAll("{{body}}", body);
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
  const template = await fs.readFile(templatePath, "utf8");
  const navTemplate = await fs.readFile(navTemplatePath, "utf8");

  for (const file of files) {
    if (path.extname(file.relativePath).toLowerCase() === ".md") {
      continue;
    }

    const targetPath = path.join(outputDir, file.relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(file.absolutePath, targetPath);
  }

  await fs.copyFile(stylesPath, path.join(outputDir, stylesheetOutputPath));

  for (const page of pages) {
    const body = rewriteHtmlMarkdownUrls(md.render(page.markdown));
    const html = renderPage({
      template,
      title: page.title,
      stylesheetHref: relativeHref(page.htmlPath, stylesheetOutputPath),
      body,
      nav: renderNav({ template: navTemplate, pages, currentPage: page }),
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
