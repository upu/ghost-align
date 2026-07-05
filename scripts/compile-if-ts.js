// PostToolUse hook command: run `npm run compile` only when the edited file
// can affect TypeScript compilation (see #252). The hook matcher can only
// match on tool names, so the file-path filtering lives here: the harness
// passes the tool payload as JSON on stdin, and edits to docs/skills/config
// exit immediately instead of paying for a full tsc run.
"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

/**
 * Whether an edited file warrants a tsc run. Only a file path that clearly
 * is not TypeScript skips the compile — a missing or malformed path
 * compiles anyway, so a payload-format change can never silently disable
 * the hook.
 */
function shouldCompile(filePath) {
  if (typeof filePath !== "string") {
    return true;
  }
  return /\.ts$/i.test(filePath.trim()) || filePath.trim() === "";
}

function main() {
  let filePath;
  try {
    const payload = JSON.parse(fs.readFileSync(0, "utf8"));
    filePath = payload?.tool_input?.file_path;
  } catch {
    filePath = undefined;
  }

  if (!shouldCompile(filePath)) {
    process.exit(0);
  }
  const result = spawnSync("npm", ["run", "compile"], {
    stdio: "inherit",
    shell: true,
  });
  process.exit(result.status ?? 1);
}

module.exports = { shouldCompile };

if (require.main === module) {
  main();
}
