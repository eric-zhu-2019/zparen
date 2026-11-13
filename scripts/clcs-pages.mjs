// Makes the Common Lisp Community Spec's pages small enough to carry in the app.
// Each page of the site repeats the whole table of contents, a search box and
// their scripts, which make the site 224 MB. The Docs panel needs only the
// entry itself: this keeps each page's previous/up/next links and its content,
// and links ZParen's own stylesheet, clcs.css, which docs.rs serves. It also
// writes symbols.json: each Common Lisp symbol's name, in upper case, and its
// page.
//
// Usage: node scripts/clcs-pages.mjs <unpacked site> <out dir>
import { mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error("usage: node scripts/clcs-pages.mjs <unpacked site> <out dir>");
  process.exit(2);
}

// When a name has several pages, as function and nil do, the first of these kinds wins.
const KINDS = ["Function", "Macro", "Special Operator", "Accessor", "Standard Generic Function", "Local Macro", "Local Function",
  "Variable", "Constant Variable", "Declaration", "Type Specifier", "Type", "Class", "System Class", "Condition Type"];
const rank = (kind) => (kind === null ? -1 : KINDS.indexOf(kind) < 0 ? KINDS.length : KINDS.indexOf(kind));
const symbol = /^[^\s]+$/;
const fromTitles = new Map();

mkdirSync(join(out, "pages"), { recursive: true });
let bytes = 0;
const pages = readdirSync(join(src, "pages")).filter((f) => f.endsWith(".html"));
for (const name of pages) {
  const html = readFileSync(join(src, "pages", name), "utf8");
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? name;
  // "mapc, mapcar, mapcan (CLCS)" or "function (Special Operator) (CLCS)".
  const m = title.replace(/ \(CLCS\)$/, "").match(/^(.*?)(?: \(([^()]+)\))?$/);
  for (const n of m[1].split(", ").map((x) => x.trim())) {
    if (!symbol.test(n)) continue;
    const seen = fromTitles.get(n.toUpperCase());
    if (!seen || rank(m[2] ?? null) < rank(seen.kind)) fromTitles.set(n.toUpperCase(), { page: `pages/${name}`, kind: m[2] ?? null });
  }
  const start = html.indexOf('<div class="nav">');
  const end = html.lastIndexOf("</body>");
  if (start < 0 || end < start) throw new Error(`clcs-pages: ${name} does not have the expected layout`);
  // The content ends with the closing tags of the three wrappers around it. A
  // few old pages, which nothing links to, have no wrappers.
  let body = html.slice(start, end).replace('<div class="bl-placeholder"></div>', "").trimEnd();
  const wrappers = html.includes('class="body__inner"') ? 3 : 0;
  for (let i = 0; i < wrappers; i++) {
    if (!body.endsWith("</div>")) throw new Error(`clcs-pages: ${name} does not end as expected`);
    body = body.slice(0, -"</div>".length).trimEnd();
  }
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<link href="../clcs.css" rel="stylesheet"/>
</head>
<body>
<main class="clcs">
${body}
</main>
</body>
</html>
`;
  writeFileSync(join(out, "pages", name), page);
  bytes += page.length;
}
// The site's own index first, then what the titles name.
const symbols = {};
for (const [n, page] of Object.entries(JSON.parse(readFileSync(join(src, "searchable_terms.json"), "utf8")))) {
  if (symbol.test(n)) symbols[n.toUpperCase()] = `pages/${page}`;
}
for (const [n, { page }] of fromTitles) symbols[n] ??= page;
// Symbols with no entry of their own, sent where the standard defines them, as the HyperSpec does.
const DEFINED_IN = {
  "lambda_002dlist_002dkeywords.html": ["&ALLOW-OTHER-KEYS", "&AUX", "&BODY", "&ENVIRONMENT", "&KEY", "&OPTIONAL", "&REST", "&WHOLE"],
  "optimize.html": ["COMPILATION-SPEED", "DEBUG", "SAFETY", "SPACE", "SPEED"],
  "documentation.html": ["COMPILER-MACRO", "STRUCTURE", "VARIABLE"],
  "case.html": ["OTHERWISE"],
  "Standard-Method-Combination.html": ["STANDARD"],
};
for (const [page, names] of Object.entries(DEFINED_IN)) {
  if (!pages.includes(page)) throw new Error(`clcs-pages: ${page} is missing`);
  for (const n of names) symbols[n] ??= `pages/${page}`;
}
writeFileSync(join(out, "symbols.json"), JSON.stringify(symbols, null, 0));
copyFileSync(join(src, "LICENSE"), join(out, "LICENSE"));
console.log(`clcs-pages: ${pages.length} pages, ${(bytes / 1e6).toFixed(1)} MB`);
