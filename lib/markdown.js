const MarkdownIt = require("markdown-it");
const { rewriteMarkdownUrl } = require("./utils");

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

module.exports = {
  createMarkdownRenderer,
};
