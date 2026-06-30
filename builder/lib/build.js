const fs = require("node:fs/promises");
const path = require("node:path");
const {
  toPosix,
  escapeHtml,
  markdownPathToHtmlPath,
  pageTitle,
  addContentLanguage,
  rewriteHtmlMarkdownUrls,
  isIndexPage,
  relativeHref,
} = require("./utils");
const { createMarkdownRenderer } = require("./markdown");
const { renderNav, renderPage } = require("./templates");
const {
  createCacheManifest,
  renderServiceWorker,
  renderServiceWorkerRegistration,
} = require("./service-worker");

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

async function emptyOutputDirectory(targetDir, sourceDir) {
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

async function buildPublication({
  sourceDir,
  outputDir,
  templatePath,
  navTemplatePath,
  stylesheets,
  scripts,
  staticAssets = [],
  serviceWorkerOutputPath,
  cacheManifestOutputPath,
}) {
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

  await emptyOutputDirectory(outputDir, sourceDir);

  const md = createMarkdownRenderer();
  const template = await fs.readFile(templatePath, "utf8");
  const navTemplate = await fs.readFile(navTemplatePath, "utf8");
  const cachePaths = [];

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

  for (const asset of staticAssets) {
    const sourceStats = await fs.stat(asset.sourcePath);
    const targetPath = path.join(outputDir, asset.outputPath);

    if (sourceStats.isDirectory()) {
      const assetFiles = await walkFiles(asset.sourcePath);

      for (const file of assetFiles) {
        const outputPath = toPosix(path.join(asset.outputPath, file.relativePath));
        const outputFilePath = path.join(outputDir, outputPath);
        await fs.mkdir(path.dirname(outputFilePath), { recursive: true });
        await fs.copyFile(file.absolutePath, outputFilePath);
        cachePaths.push(outputPath);
      }
    } else if (sourceStats.isFile()) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(asset.sourcePath, targetPath);
      cachePaths.push(asset.outputPath);
    }
  }

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
    renderServiceWorker(cacheManifest.version, cacheManifestOutputPath),
    "utf8",
  );

  const indexPath = path.join(outputDir, "index.html");
  const entryPath = (await pathExists(indexPath))
    ? indexPath
    : path.join(outputDir, pages[0].htmlPath);

  return { pagesCount: pages.length, outputDir, entryPath };
}

module.exports = {
  buildPublication,
  pathExists,
};
