// Builds the GitHub Pages site into a folder: the landing page in site/, a page
// for each file in docs/, and the screenshots and icon they show.
// Usage: node scripts/build-site.mjs [out-dir]   (default _site)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Marked } from "marked";

const SITE = "https://eric-zhu-2019.github.io/zparen/";
const REPO = "https://github.com/eric-zhu-2019/zparen";
const out = process.argv[2] ?? "_site";

// The order the README's documentation table lists them in.
const DOCS = [
  "getting-started",
  "run-and-debug",
  "editing",
  "projects",
  "coalton",
  "learn",
  "assistant",
  "plugins",
  "architecture",
  "development",
  "built-with-claude-code",
];

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plain = (md) => md.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();

// GitHub's heading IDs, so links such as editing.md#keys keep working.
function slugger() {
  const seen = new Map();
  return (text) => {
    const base = plain(text).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

/** A link in a doc, as the page must write it: other docs become pages, and files outside docs/ go to GitHub. */
function linkTarget(href) {
  if (/^[a-z]+:|^#/i.test(href)) return href;
  const [path, hash] = href.split("#");
  const name = path.replace(/^\.\//, "").replace(/\.md$/, "");
  if (path.endsWith(".md") && DOCS.includes(name)) return `${name}.html${hash ? `#${hash}` : ""}`;
  if (path.startsWith("screenshots/")) return `../${path}`;
  return `${REPO}/blob/main/${path.replace(/^\.\.\//, "")}${hash ? `#${hash}` : ""}`;
}

function render(md) {
  const slug = slugger();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        const id = slug(text);
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}${depth > 1 ? ` <a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : ""}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const target = linkTarget(href);
        const external = /^https?:/.test(target) && !target.startsWith(SITE);
        return `<a href="${escape(target)}"${title ? ` title="${escape(title)}"` : ""}${external ? ' rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`;
      },
      image({ href, title, text }) {
        return `<img src="${escape(linkTarget(href))}" alt="${escape(text)}"${title ? ` title="${escape(title)}"` : ""}>`;
      },
    },
  });
  return marked.parse(md);
}

const docs = DOCS.map((name) => {
  const md = readFileSync(join("docs", `${name}.md`), "utf8");
  const title = plain(md.match(/^# (.+)$/m)?.[1] ?? name);
  const intro = md.split(/\n\s*\n/).find((p) => p.trim() && !/^(#|!\[|\||```|-|\d+\.)/.test(p.trim())) ?? "";
  const description = plain(intro).slice(0, 200);
  return { name, md, title, description };
});

function page({ name, md, title, description }) {
  const url = `${SITE}docs/${name}.html`;
  const index = DOCS.indexOf(name);
  const [prev, next] = [docs[index - 1], docs[index + 1]];
  const nav = docs
    .map((d) => `<li><a href="${d.name}.html"${d.name === name ? ' aria-current="page"' : ""}>${escape(d.title)}</a></li>`)
    .join("\n        ");
  const data = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    description,
    url,
    about: { "@type": "SoftwareApplication", name: "ZParen", url: SITE },
    isPartOf: { "@type": "WebSite", name: "ZParen", url: SITE },
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · ZParen</title>
<meta name="description" content="${escape(description)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escape(title)} · ZParen">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}screenshots/debugger.png">
<link rel="canonical" href="${url}">
<link rel="icon" href="../icon.png">
<link rel="stylesheet" href="../style.css">
<script type="application/ld+json">
${JSON.stringify(data, null, 2)}
</script>
</head>
<body>
<header class="nav">
  <a class="brand" href="../"><img src="../icon.png" alt="" width="28" height="28">ZParen</a>
  <nav>
    <a href="../#features">Features</a>
    <a href="../#install">Install</a>
    <a href="getting-started.html">Docs</a>
    <a href="${REPO}">GitHub</a>
  </nav>
</header>

<div class="doc-layout">
  <aside class="doc-nav" aria-label="Documentation">
    <p class="doc-nav-title">Documentation</p>
    <ul>
        ${nav}
    </ul>
  </aside>
  <main class="doc">
    <article>
${render(md)}
    </article>
    <nav class="doc-pager" aria-label="Previous and next">
      ${prev ? `<a class="prev" href="${prev.name}.html"><span>Previous</span>${escape(prev.title)}</a>` : "<span></span>"}
      ${next ? `<a class="next" href="${next.name}.html"><span>Next</span>${escape(next.title)}</a>` : "<span></span>"}
    </nav>
    <p class="doc-source"><a href="${REPO}/blob/main/docs/${name}.md">Edit this page on GitHub</a></p>
  </main>
</div>

<footer>
  <p>ZParen is open source under the <a href="${REPO}/blob/main/LICENSE">MIT License</a>. Built with Rust, Tauri, React, CodeMirror and SBCL.</p>
</footer>
</body>
</html>
`;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "docs"), { recursive: true });
cpSync("site", out, { recursive: true });
cpSync("docs/screenshots", join(out, "screenshots"), { recursive: true });
cpSync("assets/icon.png", join(out, "icon.png"));
for (const d of docs) writeFileSync(join(out, "docs", `${d.name}.html`), page(d));
const urls = ["", ...docs.map((d) => `docs/${d.name}.html`)];
writeFileSync(join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
console.log(`built ${out}: the landing page and ${docs.length} doc pages`);
