---
name: ship
description: Implement a GitHub issue end-to-end following this repo's GitHub Flow — read the issue, branch from latest main, implement with tests, open a PR, and squash-merge once CI is green. Use when the user wants to work through an existing issue (e.g. "/ship 18", "issue 18 をやって", "#16 に取り掛かる").
argument-hint: <issue-number>
---

# Ship Issue

Take an existing GitHub issue from `gh issue view` through to a merged PR, following this repo's GitHub Flow. `main` is protected: changes land only via a PR with the `test` CI check green.

`$ARGUMENTS` is the issue number to ship. If it is empty, run `gh issue list` and ask which issue to ship.

## Steps

1. **Read the issue** — run `gh issue view $ARGUMENTS`. Restate the title and acceptance criteria (受け入れ基準) so the scope is explicit. If the issue is already closed or its scope is unclear, stop and confirm with the user before coding.
2. **Branch from latest main** — `git fetch origin`, then `git checkout -b <type>/<slug> origin/main`. Always branch from `origin/main`, never from a stale local branch. Use a descriptive name with a type prefix: `feat/`, `fix/`, `docs/`, `ci/`, `refactor/`.
3. **Implement** — read the target file and surrounding code before editing. Keep the change within the issue's scope; if you spot unrelated improvements, propose a separate issue rather than expanding this one. Match the surrounding code style and keep comments minimal (no line-number references or comments that restate what the code/test name already says).
4. **Test (gate)** — run `npm run compile`, then `npm test`. All tests must pass. When the acceptance criteria call for it, add or extend tests to prove the behavior. If anything is red, fix it; do not open a PR on a failing build.
5. **Commit** — run `git status` / `git diff` to confirm only intended changes are staged, then commit with a concise message in the repo's style (a Japanese summary line) ending with `Closes #$ARGUMENTS`.
6. **Push & PR** — `git push -u origin <branch>`, then `gh pr create --base main` with a body that summarizes the change and ends with `Closes #$ARGUMENTS`.
7. **Wait for CI** — run `gh pr checks <pr> --watch --fail-fast`. This blocks in a single command until all checks finish (no hand-rolled sleep loop); it exits non-zero if a check fails. For runs that take a few minutes, launch it with `run_in_background` so it does not block — you are re-invoked when it exits. If a check fails, inspect the run logs, fix, and push again.
8. **Merge** — `gh pr merge <pr> --squash --delete-branch` (allowed merge methods are squash/rebase only). Then `git checkout main && git pull` to sync local main.
9. **Report** — state the merged PR number, that the issue auto-closed via `Closes #N`, and the new `main` commit.

## Notes

- `main` is protected by a ruleset: no direct push, force-push, or deletion; a PR with a green `test` check is required. Never attempt to push to `main` directly.
- The `test` check runs on `windows-latest` and launches VS Code via `@vscode/test-cli`, so it takes a minute or two — that is expected, not a hang.
- One issue per PR. If the scope grows mid-implementation, split it into separate issues/PRs.
- This skill is for an issue that already exists. If the user describes new work without an issue, offer to `gh issue create` first, then ship it.
