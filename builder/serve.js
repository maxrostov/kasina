const http = require('http');
const fs = require('fs');
const fsp = require('node:fs/promises');
const path = require('path');
const readline = require('node:readline');

const PORT = 3000;

function parseArgs(argv) {
  const args = argv.slice(2);
  const label = args.find((a) => !a.startsWith('-')) || null;
  return { label };
}

async function listBookLabels(booksDir) {
  const entries = await fsp.readdir(booksDir, { withFileTypes: true }).catch(() => []);
  const labels = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const mdDir = path.join(booksDir, entry.name, 'html');
    try {
      const st = await fsp.stat(mdDir);
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
    throw new Error('No built books found in ./books');
  }
  console.log('Select a book to serve:');
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

async function resolveDir() {
  const rootDir = path.resolve(__dirname, '..');
  const booksDir = path.join(rootDir, 'books');
  const { label: inputLabel } = parseArgs(process.argv);
  let label = inputLabel;
  if (!label) {
    const labels = await listBookLabels(booksDir);
    label = await promptForLabel(labels);
  }
  const dir = path.join(booksDir, label, 'html');
  return { dir, label };
}

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function start() {
  const { dir, label } = await resolveDir();

  const server = http.createServer((req, res) => {
    let filePath = path.join(dir, req.url === '/' ? 'index.html' : req.url);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>');
        return;
      }

      const ext = path.extname(filePath);
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });

  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Serving '${label}' from: ${dir}`);
  });
}

start().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
