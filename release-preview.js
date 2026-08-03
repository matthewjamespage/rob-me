// Local helper for the "preview before pushing" workflow. Builds the app,
// prints the path to the built file so it can be opened for a look, and
// shows what the given description will look like as the public GitHub
// Release notes (deploy-pages.yml generates release notes from the commit
// message) - all before anything is committed or pushed. Run again with
// --push once the preview has been reviewed and approved, to actually
// commit (using the same description) and push.
//
// Note: this script can't open the browser for you itself - when run from
// an automated/sandboxed session (e.g. an AI assistant's shell) there's no
// visible desktop to open a window on, so it silently does nothing there.
// Open the printed path yourself instead.
//
// Usage:
//   node release-preview.js "Description of this update"          (preview only)
//   node release-preview.js "Description of this update" --push   (commit + push)
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const message = process.argv[2];
const doPush = process.argv.includes("--push");

if (!message) {
  console.error('Usage: node release-preview.js "Description of this update" [--push]');
  process.exit(1);
}

console.log("Building the app...");
execSync("node build.js", { stdio: "inherit" });

// Mirrors the version-bump logic in .github/workflows/deploy-pages.yml, so
// the preview shows the same version number the real push will be tagged as.
// Reads from the remote (not local `git tag`) since tags are created by the
// CI workflow on GitHub and this clone never fetches them on its own.
let nextVersion = "v0.1.0";
try {
  const remoteTags = execSync("git ls-remote --tags origin", { encoding: "utf-8" })
    .split("\n")
    .map((line) => line.match(/refs\/tags\/(v\d+\.\d+\.\d+)$/))
    .filter(Boolean)
    .map((m) => m[1]);
  remoteTags.sort((a, b) => {
    const pa = a.replace(/^v/, "").split(".").map(Number);
    const pb = b.replace(/^v/, "").split(".").map(Number);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
  });
  if (remoteTags.length) {
    const latest = remoteTags[remoteTags.length - 1];
    const [major, minor, patch] = latest.replace(/^v/, "").split(".").map(Number);
    nextVersion = `v${major}.${minor}.${patch + 1}`;
  }
} catch (err) {
  // No tags yet, or no network reachable right now - fall back to v0.1.0.
}

console.log("\n" + "=".repeat(64));
console.log(`This push will be released as ${nextVersion}.`);
console.log("Public description (this becomes the GitHub Release notes):\n");
console.log("  " + message.split("\n").join("\n  "));
console.log("=".repeat(64));

const changes = execSync("git status --short", { encoding: "utf-8" }).trim();
console.log("\nChanges about to be committed:");
console.log(changes || "  (none - nothing to commit)");

const builtFile = path.join(__dirname, "dist", "ROB-ME.html");
console.log(`\nOpen this file to preview it (double-click it, or open in your browser):\n  ${builtFile}`);

if (!doPush) {
  console.log("\nThis was a preview only - nothing was committed or pushed.");
  console.log("Once approved, the same description will be used to commit and push.");
  process.exit(0);
}

if (!changes) {
  console.log("\nNothing to commit - skipping push.");
  process.exit(0);
}

console.log("\nCommitting and pushing...");
execSync("git add -A", { stdio: "inherit" });
const tmpMsgFile = path.join(os.tmpdir(), `robme-commit-msg-${Date.now()}.txt`);
fs.writeFileSync(tmpMsgFile, message, "utf-8");
try {
  execSync(`git commit -F "${tmpMsgFile}"`, { stdio: "inherit" });
} finally {
  fs.unlinkSync(tmpMsgFile);
}
execSync("git push origin main", { stdio: "inherit" });
console.log(`\nPushed. GitHub Actions will build, tag as ${nextVersion}, and deploy to Pages automatically.`);
