// Verify the set of files vsce would package against an expected allowlist, so
// an unintended inclusion (e.g. out/test/**, see #45/#56) fails CI instead of
// being noticed by chance. When you intentionally add or remove a packaged
// file, update EXPECTED below in the same change.
//
// Also verify that every .vsix path referenced in the tag-triggered Release
// workflow matches the `npm run package` output path. release.yml only runs
// on tag pushes, so a stale reference there survives PR CI and breaks the
// next release (see #132/#134) — this check makes it fail in PR CI instead.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const EXPECTED = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "media/icon.png",
  "out/extension.js",
  "package.json",
];

function listPackagedFiles() {
  const output = execSync("npx vsce ls", { encoding: "utf8" });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
}

function checkReleaseWorkflowVsixPath() {
  const root = path.join(__dirname, "..");
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  );
  const outMatch = /--out\s+(\S+\.vsix)/.exec(pkg.scripts?.package ?? "");
  if (!outMatch) {
    console.error(
      'Could not find a "--out <path>.vsix" in the package.json "package"' +
        " script; update checkReleaseWorkflowVsixPath in" +
        " scripts/check-package-contents.js to match the new layout."
    );
    process.exit(1);
  }
  const packageOut = outMatch[1];

  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "release.yml"),
    "utf8"
  );
  const refs = workflow.match(/[^\s"']+\.vsix/g) ?? [];
  if (refs.length === 0) {
    console.error(
      "release.yml no longer references any .vsix path; update" +
        " checkReleaseWorkflowVsixPath in scripts/check-package-contents.js" +
        " to match the new workflow."
    );
    process.exit(1);
  }
  const stale = refs.filter((ref) => ref !== packageOut);
  if (stale.length > 0) {
    console.error(
      `release.yml references .vsix paths that differ from the "package"` +
        ` script output (${packageOut}):`
    );
    for (const ref of stale) {
      console.error(`  - ${ref}`);
    }
    console.error(
      "\nAlign release.yml with the package output path (or vice versa) so" +
        " the tag-triggered release does not fail (see #132/#134)."
    );
    process.exit(1);
  }
  console.log(
    `Release workflow vsix path OK (${refs.length} reference(s) to ${packageOut}).`
  );
}

checkReleaseWorkflowVsixPath();

const actual = listPackagedFiles();
const expected = [...EXPECTED].sort();

const unexpected = actual.filter((f) => !expected.includes(f));
const missing = expected.filter((f) => !actual.includes(f));

if (unexpected.length === 0 && missing.length === 0) {
  console.log(`Package contents OK (${actual.length} files).`);
  process.exit(0);
}

console.error("Package contents differ from the expected set:");
for (const f of unexpected) {
  console.error(`  + unexpected: ${f}`);
}
for (const f of missing) {
  console.error(`  - missing:    ${f}`);
}
console.error(
  "\nFix .vscodeignore, or if the change is intentional update EXPECTED in" +
    " scripts/check-package-contents.js."
);
process.exit(1);
