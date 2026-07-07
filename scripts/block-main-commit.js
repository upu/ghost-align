// PreToolUse hook command: block `git commit` while the working tree is on
// main. GitHub's ruleset already refuses the push, but committing locally
// first still forces a manual recovery (reset the commit, branch, recommit)
// that this hook exists to skip entirely.
"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

/**
 * The first non-flag token of a `git` invocation, skipping global options
 * that consume their own value (-C <dir>, -c <name=value>).
 */
function gitSubcommand(tokens) {
  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === "-C" || token === "-c") {
      i += 2;
      continue;
    }
    if (token.startsWith("-")) {
      i += 1;
      continue;
    }
    return token;
  }
  return undefined;
}

/**
 * Whether a shell command string contains a `git commit` invocation, in any
 * segment of a compound command (&&, ||, ;, |, or newline separated).
 */
function isGitCommitCommand(command) {
  if (typeof command !== "string") {
    return false;
  }
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => segment.trim())
    .filter((segment) => /^git\b/.test(segment))
    .some((segment) => gitSubcommand(segment.split(/\s+/)) === "commit");
}

function currentBranch() {
  const result = spawnSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  });
  return (result.stdout || "").trim();
}

function main() {
  let command;
  try {
    const payload = JSON.parse(fs.readFileSync(0, "utf8"));
    command = payload?.tool_input?.command;
  } catch {
    command = undefined;
  }

  if (!isGitCommitCommand(command)) {
    process.exit(0);
  }

  if (currentBranch() !== "main") {
    process.exit(0);
  }

  process.stdout.write(
    JSON.stringify({
      systemMessage:
        "main ブランチ上での git commit をブロックしました（Ghost Align の運用ルール）。",
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "main ブランチに直接コミットしようとしています。作業ブランチを作成してからコミットしてください（例: git checkout -b <branch-name>）。push 自体は GitHub 側の ruleset で防がれていますが、ローカルでの無駄なコミット・手戻りを避けるためのガードです。",
      },
    }),
  );
  process.exit(0);
}

module.exports = { isGitCommitCommand };

if (require.main === module) {
  main();
}
