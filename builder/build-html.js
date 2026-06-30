#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");
const { buildPublication } = require("./lib/build");

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("-")));
  const label = args.find((a) => !a.startsWith("-")) || null;
  return { flags, label };
}

async function listBookLabels(booksDir) {
  const entries = await fs.readdir(booksDir, { withFileTypes: true }).catch(() => []);
  const labels = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const mdDir = path.join(booksDir, entry.name, "md");
    try {
      const st = await fs.stat(mdDir);
      if (st.isDirectory()) labels.push(entry.name);
    } catch {
      // ignore
    }
  }
  return labels.sort((a, b) => a.localeCompare(b));
}

function askQuestion(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function promptForLabel(labels) {
  if (labels.length === 0) {
    throw new Error("No books found in ./books");
  }
  console.log("Select a book to build:");
  labels.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const answer = await askQuestion("Enter number: ");
    const idx = Number.parseInt(answer, 10);
    if (Number.isInteger(idx) && idx >= 1 && idx <= labels.length) {
      return labels[idx - 1];
    }
    console.log("Invalid selection. Try again.");
  }
}

async function buildOne({
  label,
  templatePath,
  navTemplatePath,
  stylesheets,
  scripts,
  staticAssets,
  serviceWorkerOutputPath,
  cacheManifestOutputPath,
  rootDir,
}) {
  const sourceDir = path.join(rootDir, "books", label, "md");
  const outputDir = path.join(rootDir, "books", label, "html");

  const { pagesCount, outputDir: finalOutputDir, entryPath } = await buildPublication({
    sourceDir,
    outputDir,
    templatePath,
    navTemplatePath,
    stylesheets,
    scripts,
    staticAssets,
    serviceWorkerOutputPath,
    cacheManifestOutputPath,
  });

  console.log(`\n[${label}] Converted ${pagesCount} Markdown files.`);
  console.log(`[${label}] Output: ${finalOutputDir}`);
  console.log(`[${label}] Open: ${entryPath}`);
}

async function main() {
  const { flags, label: inputLabel } = parseArgs(process.argv);
  const rootDir = path.resolve(__dirname, "..");
  const booksDir = path.join(rootDir, "books");
  const templateDir = path.join(rootDir, "template");

  const templatePath = path.join(templateDir, "template.html");
  const navTemplatePath = path.join(templateDir, "nav.html");
  const stylesheets = [
    { sourcePath: path.join(templateDir, "main.css"), outputPath: "main.css" },
    { sourcePath: path.join(templateDir, "nav.css"), outputPath: "nav.css" },
    { sourcePath: path.join(templateDir, "article.css"), outputPath: "article.css" },
  ];
  const scripts = [
    { sourcePath: path.join(templateDir, "publication.js"), outputPath: "publication.js" },
  ];
  const staticAssets = [
    { sourcePath: path.join(templateDir, "site.webmanifest"), outputPath: "site.webmanifest" },
    { sourcePath: path.join(templateDir, "icons"), outputPath: "icons" },
  ];
  const serviceWorkerOutputPath = "sw.js";
  const cacheManifestOutputPath = "offline-manifest.json";

  if (flags.has("--help") || flags.has("-h")) {
    console.log(
      "Usage: node build-html.js [<label>] [--all]\n\n" +
        "- <label>  Build a single book from books/<label>/md to books/<label>/html\n" +
        "- --all    Build all books under books/\n" +
        "If <label> is omitted, you will be prompted to select a book.",
    );
    process.exit(0);
  }

  if (flags.has("--all")) {
    const labels = await listBookLabels(booksDir);
    if (labels.length === 0) {
      throw new Error("No books found to build.");
    }
    for (const label of labels) {
      await buildOne({
        label,
        templatePath,
        navTemplatePath,
        stylesheets,
        scripts,
        staticAssets,
        serviceWorkerOutputPath,
        cacheManifestOutputPath,
        rootDir,
      });
    }
    return;
  }

  let label = inputLabel;
  if (!label) {
    const labels = await listBookLabels(booksDir);
    label = await promptForLabel(labels);
  }

  await buildOne({
    label,
    templatePath,
    navTemplatePath,
    stylesheets,
    scripts,
    staticAssets,
    serviceWorkerOutputPath,
    cacheManifestOutputPath,
    rootDir,
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
