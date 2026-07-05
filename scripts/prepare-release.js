// Deterministically finalizes CHANGELOG.md's [Unreleased] section into a
// dated release and bumps package.json's version, so /release only judges
// SemVer and confirms scope instead of hand-editing these files every time
// (see #257). Fails with no writes to either file if the version argument is
// invalid, not newer than the current version, or [Unreleased] is empty.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_URL = "https://github.com/upu/ghost-align";
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const UNRELEASED_HEADING = "## [Unreleased]";

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** Collapse CRLF/CR to LF so line-splitting is correct even if a file has stray mixed newlines. */
function normalizeToLf(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i];
    }
  }
  return 0;
}

/** Today's date as YYYY-MM-DD in local time (matches `date +%F`, not UTC). */
function todayIso(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The [Unreleased] section's body lines and whether any are non-blank. */
function findUnreleasedBody(changelogText) {
  const eol = detectEol(changelogText);
  const lines = normalizeToLf(changelogText).split("\n");
  const startIdx = lines.findIndex((l) => l.trim() === UNRELEASED_HEADING);
  if (startIdx === -1) {
    throw new Error(`Could not find "${UNRELEASED_HEADING}" heading in CHANGELOG.md`);
  }
  let endIdx = lines.findIndex((l, i) => i > startIdx && /^## \[/.test(l));
  if (endIdx === -1) {
    endIdx = lines.length;
  }
  const body = lines.slice(startIdx + 1, endIdx);
  return { lines, eol, startIdx, hasEntries: body.some((l) => l.trim().length > 0) };
}

/**
 * Validate a release request against the current version and CHANGELOG
 * state. Returns an error message, or null when the request is valid.
 */
function validate(version, currentVersion, changelogText) {
  if (!version || !SEMVER_RE.test(version)) {
    return `Version must be in x.y.z form (got: ${version || "(none)"})`;
  }
  if (compareSemver(version, currentVersion) <= 0) {
    return `${version} is not greater than the current version ${currentVersion}`;
  }
  let unreleased;
  try {
    unreleased = findUnreleasedBody(changelogText);
  } catch (err) {
    return err.message;
  }
  if (!unreleased.hasEntries) {
    return "The [Unreleased] section in CHANGELOG.md has no entries; nothing to release";
  }
  return null;
}

/**
 * Rename `[Unreleased]` to `[version] - date`, reinsert a fresh empty
 * `[Unreleased]` above it, and update the link references at the bottom
 * (repoint `[Unreleased]` to the new compare URL, add a `[version]` link).
 */
function finalizeChangelog(changelogText, version, date = todayIso()) {
  const { lines, eol, startIdx } = findUnreleasedBody(changelogText);
  const withHeading = [
    ...lines.slice(0, startIdx),
    UNRELEASED_HEADING,
    "",
    `## [${version}] - ${date}`,
    ...lines.slice(startIdx + 1),
  ];

  const linkRefRe = /^\[([^\]]+)\]:\s*(\S+)$/;
  const unreleasedLinkIdx = withHeading.findIndex((l) => {
    const m = linkRefRe.exec(l);
    return m !== null && m[1] === "Unreleased";
  });
  if (unreleasedLinkIdx === -1) {
    throw new Error('Could not find the "[Unreleased]: ..." link reference at the bottom of CHANGELOG.md');
  }
  withHeading[unreleasedLinkIdx] = `[Unreleased]: ${REPO_URL}/compare/v${version}...HEAD`;
  withHeading.splice(unreleasedLinkIdx + 1, 0, `[${version}]: ${REPO_URL}/releases/tag/v${version}`);

  return withHeading.join(eol);
}

/** Replace only the `"version"` field's value, preserving all other formatting. */
function bumpPackageJsonVersion(packageJsonText, version) {
  const versionFieldRe = /^(\s*"version":\s*")[^"]*(")/m;
  if (!versionFieldRe.test(packageJsonText)) {
    throw new Error('Could not find a "version" field in package.json');
  }
  return packageJsonText.replace(versionFieldRe, `$1${version}$2`);
}

function main() {
  const version = process.argv[2];
  const root = path.join(__dirname, "..");
  const changelogPath = path.join(root, "CHANGELOG.md");
  const packageJsonPath = path.join(root, "package.json");

  const packageJsonText = fs.readFileSync(packageJsonPath, "utf8");
  const currentVersion = JSON.parse(packageJsonText).version;
  const changelogText = fs.readFileSync(changelogPath, "utf8");

  const error = validate(version, currentVersion, changelogText);
  if (error) {
    console.error(`::error::${error}`);
    process.exit(1);
  }

  // Compute both new file contents before writing either, so a failure in
  // either transform leaves both files untouched.
  let newChangelog;
  let newPackageJson;
  try {
    newChangelog = finalizeChangelog(changelogText, version);
    newPackageJson = bumpPackageJsonVersion(packageJsonText, version);
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }

  fs.writeFileSync(changelogPath, newChangelog);
  fs.writeFileSync(packageJsonPath, newPackageJson);
  console.log(`Prepared release ${version} (from ${currentVersion}): CHANGELOG.md finalized, package.json bumped.`);
}

module.exports = {
  compareSemver,
  todayIso,
  validate,
  finalizeChangelog,
  bumpPackageJsonVersion,
};

if (require.main === module) {
  main();
}
