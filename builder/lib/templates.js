const { escapeHtml, relativeHref } = require("./utils");

function renderAnalytics() {
  return `  <script>
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  </script>
  <script defer src="/_vercel/insights/script.js"></script>`;
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
    .replaceAll("{{analytics}}", renderAnalytics())
    .replaceAll("{{serviceWorker}}", serviceWorkerRegistration)
    .replaceAll("{{contentModeAttributes}}", contentModeAttributes)
    .replaceAll("{{nav}}", nav)
    .replaceAll("{{body}}", body);
}

module.exports = {
  renderNav,
  renderPage,
  renderAnalytics,
};
