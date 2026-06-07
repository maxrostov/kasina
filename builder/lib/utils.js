const path = require("node:path");

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

function markdownPathToHtmlPath(markdownPath) {
  return markdownPath.replace(/\.md$/i, ".html");
}

function isIndexPage(page) {
  return page.htmlPath === "index.html";
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

module.exports = {
  toPosix,
  escapeHtml,
  isExternalOrSpecialUrl,
  splitUrlSuffix,
  rewriteMarkdownUrl,
  rewriteHtmlMarkdownUrls,
  markdownPathToHtmlPath,
  isIndexPage,
  pageTitle,
  relativeHref,
  markOriginalLanguage,
  unwrapTranslationParagraph,
  markTranslationLanguage,
  addContentLanguage,
};
