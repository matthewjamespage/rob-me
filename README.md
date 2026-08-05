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
scripts/        Build and release-preview scripts
  build.js            Bundles src/ into dist/ROB-ME.html
  release-preview.js  Preview a build + its release notes before pushing
dist/           Build output — generated, not committed (see .gitignore)
```

## Building locally

```
node scripts/build.js
```

Produces `dist/ROB-ME.html`, a single self-contained file with no external
references (all in-app guidance, including the CSV field codebook, lives on
its own Instructions page rather than a separate file). Open it directly in
a browser to test.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy-pages.yml`, which runs
`node scripts/build.js` and publishes `dist/` to GitHub Pages automatically. There is
nothing to build or push manually — edit `src/`, commit, push, and the live
site updates within a minute or two.

The same `dist/ROB-ME.html` file also works as a standalone download: anyone
can save it from the Pages URL and open it locally/offline, since it has no
external dependencies.

## Making changes

1. Edit files under `src/`.
2. Run `node scripts/build.js` and open `dist/ROB-ME.html` in a browser to sanity-check.
3. Commit with a message that describes what changed — it becomes the release notes — and push to `main`.

## Docs folder

`docs/` holds the project's planning/reference files. Each one has an HTML
comment at its own top marking whether it's a permanent "log file" (stays in
`docs/`, keeps getting updated) or a candidate for archiving once resolved.

| File | Function |
|---|---|
| `ROB-ME_design_decisions.md` | **Session log.** Chronological, dated record of every decision and change made in each working session — same role as a `session_log.md` in other projects. Newest entries at the bottom. Read this first to see what's happened and why. |
| `ROB-ME_user_tasks.md` | Open action items only Phoebe can do (decisions, external accounts, manual verification). Checked off and moved to the completed file once confirmed done. |
| `ROB-ME_user_tasks_completed.md` | Append-only historical record of everything already done, moved out of `ROB-ME_user_tasks.md` to keep that file short. |
| `ROB-ME_app_architecture.md` | Current architecture reference — standalone vs. online modes, save file format, auth design. |
| `ROB-ME_style_guide.md` | Visual design reference (colors, typography, spacing, components) for the app and all exported/standalone documents. |
| `ROB-ME_future_additions.md` | Ideas and changes explicitly tabled for a later round, not part of the current build. |
| `docs/.archive/` | Fully-resolved or superseded docs, kept for history but no longer actively maintained. |

## Versioning

Every push to `main` is tagged automatically (`v0.1.0`, `v0.1.1`, …, patch
number incremented each time) and published as a
[GitHub Release](../../releases), with release notes auto-generated from the
commit messages since the previous tag and `dist/ROB-ME.html` attached as a
downloadable asset. The built app also shows its version number in the
top-left corner. There is no changelog file to hand-maintain — the Releases
page is the changelog.
