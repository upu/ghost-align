// Verify the set of files vsce would package against an expected allowlist, so
// an unintended inclusion (e.g. out/test/**, see #45/#56) fails CI instead of
// being noticed by chance. When you intentionally add or remove a packaged
// file, update EXPECTED below in the same change.
const { execSync } = require("node:child_process");

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
