# ROB-ME

A standalone, client-side risk-of-bias assessment tool. No backend, no
accounts — everything runs in the browser and autosaves to `localStorage`.

## Project structure

```
src/            Source files (edit these)
  index.html
  style.css
  app.js
  vendor/       Third-party libraries (exceljs, docx, html2canvas)
build.js        Bundles src/ into dist/ROB-ME.html
dist/           Build output — generated, not committed (see .gitignore)
```

## Building locally

```
node build.js
```

Produces `dist/ROB-ME.html`, a single self-contained file with no external
references (all in-app guidance, including the CSV field codebook, lives on
its own Instructions page rather than a separate file). Open it directly in
a browser to test.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy-pages.yml`, which runs
`node build.js` and publishes `dist/` to GitHub Pages automatically. There is
nothing to build or push manually — edit `src/`, commit, push, and the live
site updates within a minute or two.

The same `dist/ROB-ME.html` file also works as a standalone download: anyone
can save it from the Pages URL and open it locally/offline, since it has no
external dependencies.

## Making changes

1. Edit files under `src/`.
2. Run `node build.js` and open `dist/ROB-ME.html` in a browser to sanity-check.
3. Commit with a message that describes what changed — it becomes the release notes — and push to `main`.

## Versioning

Every push to `main` is tagged automatically (`v0.1.0`, `v0.1.1`, …, patch
number incremented each time) and published as a
[GitHub Release](../../releases), with release notes auto-generated from the
commit messages since the previous tag and `dist/ROB-ME.html` attached as a
downloadable asset. The built app also shows its version number in the
top-left corner. There is no changelog file to hand-maintain — the Releases
page is the changelog.
