#!/usr/bin/env node

const path = require("node:path");
const { buildPublication } = require("./lib/build");

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

async function main() {
  const { pagesCount, outputDir: finalOutputDir, entryPath } =
    await buildPublication({
      sourceDir,
      outputDir,
      templatePath,
      navTemplatePath,
      stylesheets,
      scripts,
      serviceWorkerOutputPath,
      cacheManifestOutputPath,
    });

  console.log(`Converted ${pagesCount} Markdown files.`);
  console.log(`Output: ${finalOutputDir}`);
  console.log(`Open: ${entryPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
