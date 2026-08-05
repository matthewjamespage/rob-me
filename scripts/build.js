// Build script. Produces dist/ROB-ME.html from src/index.html by inlining
// style.css, app.js, and the vendored libraries into one self-contained
// file with no external file references. This single output is both the
// downloadable standalone app and the file deployed to GitHub Pages, so
// there's nothing else to keep in sync.
// Run with: node scripts/build.js
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");
fs.mkdirSync(distDir, { recursive: true });

let html = fs.readFileSync(path.join(srcDir, "index.html"), "utf-8");
const css = fs.readFileSync(path.join(srcDir, "style.css"), "utf-8");
const csvShared = fs.readFileSync(path.join(srcDir, "csv-shared.js"), "utf-8");
const appJs = fs.readFileSync(path.join(srcDir, "app.js"), "utf-8");
const exceljs = fs.readFileSync(path.join(srcDir, "vendor", "exceljs.min.js"), "utf-8");
const docx = fs.readFileSync(path.join(srcDir, "vendor", "docx.iife.js"), "utf-8");
const html2canvas = fs.readFileSync(path.join(srcDir, "vendor", "html2canvas.min.js"), "utf-8");

function replaceOrThrow(text, pattern, replacement) {
  if (!pattern.test(text)) throw new Error(`Build failed: pattern not found: ${pattern}`);
  return text.replace(pattern, replacement);
}

html = replaceOrThrow(
  html,
  /<link rel="stylesheet" href="style\.css">/,
  () => `<style>\n${css}\n</style>`
);
// Filled into inert type="text/plain" placeholders (see src/index.html),
// not live <script> tags - app.js's loadVendorLib() evaluates each one's
// text content lazily, only once the export that needs it is first used.
html = replaceOrThrow(
  html,
  /<script type="text\/plain" id="lib-exceljs" data-src="vendor\/exceljs\.min\.js"><\/script>/,
  () => `<script type="text/plain" id="lib-exceljs">\n${exceljs}\n</script>`
);
html = replaceOrThrow(
  html,
  /<script type="text\/plain" id="lib-docx" data-src="vendor\/docx\.iife\.js"><\/script>/,
  () => `<script type="text/plain" id="lib-docx">\n${docx}\n</script>`
);
html = replaceOrThrow(
  html,
  /<script type="text\/plain" id="lib-html2canvas" data-src="vendor\/html2canvas\.min\.js"><\/script>/,
  () => `<script type="text/plain" id="lib-html2canvas">\n${html2canvas}\n</script>`
);
html = replaceOrThrow(html, /<script src="csv-shared\.js"><\/script>/, () => `<script>\n${csvShared}\n</script>`);
html = replaceOrThrow(html, /<script src="app\.js"><\/script>/, () => `<script>\n${appJs}\n</script>`);

// Set by the release workflow (.github/workflows/deploy-pages.yml) to the
// tag it just created, e.g. "v0.4.0"; "dev" for local/unreleased builds.
const version = process.env.ROBME_VERSION || "dev";
html = html.replace(/__ROBME_VERSION__/g, version);

const outPath = path.join(distDir, "ROB-ME.html");
fs.writeFileSync(outPath, html, "utf-8");
console.log(`Built ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);

// A blank rob-me_progress.csv, generated from the same shared field list the
// app itself uses (see src/csv-shared.js) — never hand-maintained, so it
// can't silently go stale as fields are added/renamed. The in-app
// "Download a blank template save file" button (Instructions page) produces
// this same content client-side; this copy is the one that ships as a
// standalone file alongside the app on GitHub Pages / in the starter pack.
const { getAllVarnames, encodeCsv } = require(path.join(srcDir, "csv-shared.js"));
const templateRows = [["varname", "value"], ["robme_version", version]];
getAllVarnames(1, 1).forEach((varname) => {
  templateRows.push([varname, varname === "n_ma" ? 1 : ""]);
});
fs.writeFileSync(
  path.join(distDir, "ROB-ME_template_progress.csv"),
  "﻿" + encodeCsv(templateRows),
  "utf-8"
);
console.log("Generated ROB-ME_template_progress.csv in dist/");
