#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const browserSync = require('browser-sync').create();
const { buildPublication } = require('./lib/build');

function parseArgs(argv) {
  const args = argv.slice(2);
  const label = args.find((a) => !a.startsWith('-')) || null;
  return { label };
}

async function listBookLabels(booksDir) {
  const entries = await fs.readdir(booksDir, { withFileTypes: true }).catch(() => []);
  const labels = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const mdDir = path.join(booksDir, entry.name, 'md');
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
    throw new Error('No books found in ./books');
  }
  console.log('Select a book to develop:');
  labels.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const answer = await askQuestion('Enter number: ');
    const idx = Number.parseInt(answer, 10);
    if (Number.isInteger(idx) && idx >= 1 && idx <= labels.length) {
      return labels[idx - 1];
    }
    console.log('Invalid selection. Try again.');
  }
}

async function promptForWatchScope() {
  const options = [
    { id: 'template', label: 'Только template/' },
    { id: 'book', label: 'Только books/<label>/md' },
    { id: 'both', label: 'Оба каталога' },
  ];
  console.log('Что отслеживать?');
  options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt.label}`));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const answer = await askQuestion('Введите номер: ');
    const idx = Number.parseInt(answer, 10);
    if (Number.isInteger(idx) && idx >= 1 && idx <= options.length) {
      return options[idx - 1].id;
    }
    console.log('Неверный выбор. Попробуйте еще раз.');
  }
}

async function buildOne({ label, templateDir, rootDir }) {
  const templatePath = path.join(templateDir, 'template.html');
  const navTemplatePath = path.join(templateDir, 'nav.html');
  const stylesheets = [
    { sourcePath: path.join(templateDir, 'main.css'), outputPath: 'main.css' },
    { sourcePath: path.join(templateDir, 'nav.css'), outputPath: 'nav.css' },
    { sourcePath: path.join(templateDir, 'article.css'), outputPath: 'article.css' },
  ];
  const scripts = [
    { sourcePath: path.join(templateDir, 'publication.js'), outputPath: 'publication.js' },
  ];
  const serviceWorkerOutputPath = 'sw.js';
  const cacheManifestOutputPath = 'offline-manifest.json';

  const { pagesCount, outputDir, entryPath } = await buildPublication({
    sourceDir: path.join(rootDir, 'books', label, 'md'),
    outputDir: path.join(rootDir, 'books', label, 'html'),
    templatePath,
    navTemplatePath,
    stylesheets,
    scripts,
    serviceWorkerOutputPath,
    cacheManifestOutputPath,
  });

  console.log(`\n[${label}] Converted ${pagesCount} Markdown files.`);
  console.log(`[${label}] Output: ${outputDir}`);
  console.log(`[${label}] Entry: ${entryPath}`);
}

async function main() {
  const { label: inputLabel } = parseArgs(process.argv);
  const rootDir = path.resolve(__dirname, '..');
  const booksDir = path.join(rootDir, 'books');
  const templateDir = path.join(rootDir, 'template');

  let label = inputLabel;
  if (!label) {
    const labels = await listBookLabels(booksDir);
    label = await promptForLabel(labels);
  }

  const watchScope = await promptForWatchScope();

  // Initial build
  try {
    await buildOne({ label, templateDir, rootDir });
  } catch (error) {
    console.error(`[${label}] Initial build failed: ${error.message}`);
  }

  const baseDir = path.join(rootDir, 'books', label, 'html');

  browserSync.init({
    server: { baseDir },
    port: 3000,
    ui: { port: 3001 },
    open: false,
    notify: false,
    ghostMode: false,
    reloadOnRestart: true,
    cors: true,
    // Strip SW registration in dev to avoid caching issues
    rewriteRules: [
      {
        match: /<script[^>]*>[\s\S]*?navigator\.serviceWorker\.register\([\s\S]*?<\/script>/gi,
        replace: '',
      },
    ],
    middleware: [
      function noStore(req, res, next) {
        const url = req.url.split('?')[0];
        const ext = path.extname(url).toLowerCase();
        if (ext === '.html' || ext === '' || url.endsWith('/') || ext === '.css' || ext === '.js') {
          res.setHeader('Cache-Control', 'no-store');
        }
        next();
      },
    ],
  }, () => {
    console.log(`Server running at http://localhost:3000/`);
    console.log(`Serving '${label}' from: ${baseDir}`);
  });

  // Watch according to chosen scope
  const globs = [];
  if (watchScope === 'template' || watchScope === 'both') {
    globs.push(path.join(rootDir, 'template', '**', '*'));
  }
  if (watchScope === 'book' || watchScope === 'both') {
    globs.push(path.join(rootDir, 'books', label, 'md', '**', '*'));
  }

  let building = false;
  let debounceTimer = null;
  let rebuildQueued = false;

  function scheduleRebuild(reasonPath) {
    rebuildQueued = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runRebuild, 200);
  }

  async function runRebuild() {
    if (building) return;
    if (!rebuildQueued) return;
    building = true;
    rebuildQueued = false;

    console.log(`[${label}] Rebuilding...`);
    try {
      await buildOne({ label, templateDir, rootDir });
      console.log(`[${label}] Rebuild complete. Reloading...`);
      browserSync.reload();
    } catch (error) {
      console.error(`[${label}] Build failed: ${error.message}`);
    } finally {
      building = false;
      if (rebuildQueued) {
        // Another change came in while building
        scheduleRebuild();
      }
    }
  }

  if (globs.length > 0) {
    const watcher = browserSync.watch(globs, { ignoreInitial: true });
    watcher.on('all', (event, filePath) => {
      const rel = path.relative(rootDir, filePath || '');
      console.log(`[watch] ${event}: ${rel}`);
      scheduleRebuild(filePath);
    });
  } else {
    console.log('No watch globs selected; server running without rebuild.');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
