---
name: ship
description: Implement a GitHub issue end-to-end following this repo's GitHub Flow — read the issue, branch from latest main, write tests first then implement, open a PR, and squash-merge once CI is green. Use when the user wants to work through an existing issue (e.g. "/ship 18", "issue 18 をやって", "#16 に取り掛かる").
argument-hint: <issue-number>
---

# Ship Issue

Take an existing GitHub issue from `gh issue view` through to a merged PR, following this repo's GitHub Flow. `main` is protected: changes land only via a PR with the `test` CI check green.

`$ARGUMENTS` is the issue number to ship. If it is empty, run `gh issue list` and ask which issue to ship.

## Steps

1. **Read the issue** — run `gh issue view $ARGUMENTS`. Restate the title and acceptance criteria (受け入れ基準) so the scope is explicit. If the issue is already closed or its scope is unclear, stop and confirm with the user before coding.
2. **Branch from latest main** — `git fetch origin`, then `git checkout -b <type>/<slug> origin/main`. Always branch from `origin/main`, never from a stale local branch. Use a descriptive name with a type prefix: `feat/`, `fix/`, `docs/`, `ci/`, `refactor/`.
3. **Write tests first** — translate each item of the issue's 受け入れ基準 into one or more test cases in `src/test/suite/extension.test.ts` (or the relevant test file), written against the *intended* behavior before touching implementation code. Run `npm run compile && npm test` and confirm the new tests fail for the expected reason (red because the behavior doesn't exist yet), not for an unrelated error like a typo. Skip this step only for changes with no testable behavior (pure docs/CI/chore issues) — say so explicitly instead of silently skipping.
4. **Implement** — read the target file and surrounding code before editing. Make the failing tests pass with the minimal change. Keep the change within the issue's scope; if you spot unrelated improvements, propose a separate issue rather than expanding this one. Match the surrounding code style and keep comments minimal (no line-number references or comments that restate what the code/test name already says).
5. **Update CHANGELOG** — if the change is user-facing (a new feature, a bug fix, a behavior or default change, an added/changed setting, a deprecation, or a packaging/perf change a user would feel), add a one-line entry under the `## [Unreleased]` section of `CHANGELOG.md` in the right Keep a Changelog group (Added / Changed / Deprecated / Removed / Fixed / Security). Create the group heading under `[Unreleased]` if it does not exist yet. `CHANGELOG.md` follows Keep a Changelog (declared in its header), so write the entry for humans — a readable summary of the change, not a commit-log line. Skip this for changes with no user-facing effect (internal refactors, build/CI, tests, docs, Claude skills) — say in the PR that no CHANGELOG entry is needed.
6. **Test (gate)** — run `npm run compile`, then `npm test`, then `npm run check:package`. This mirrors what the CI `test` job runs on every PR (`compile` → `test` → `check:package`), so green locally means CI should pass too — skipping `check:package` here lets a packaging regression slip through to a red CI. All must pass; the tests written in step 3 should now be green. If anything is red, fix it; do not open a PR on a failing build.
7. **Commit** — run `git status` / `git diff` to confirm only intended changes are staged, then commit with a concise message in the repo's style (a Japanese summary line) ending with `Closes #$ARGUMENTS`.
8. **Push & PR** — `git push -u origin <branch>`, then `gh pr create --base main` with a body that summarizes the change and ends with `Closes #$ARGUMENTS`.
9. **Wait for CI** — run `gh pr checks <pr> --watch --fail-fast` as a single foreground call with a long timeout (e.g. 600000 ms / 10 min). It blocks in one command until all checks finish and exits non-zero if any fails. Keep it one self-contained call — do not fire it in the background and continue across turns. That multi-turn pattern (background ack → resume later) is exactly where a tool-call syntax slip has repeatedly left the session stalled at CI-wait, and a passive "verify it dispatched" reminder does not prevent the slip. A single blocking call instead either returns, or comes back as a `malformed … retry` error you fix in place. If a check fails, inspect the run logs, fix, and push again.
10. **Merge** — `gh pr merge <pr> --squash --delete-branch` (allowed merge methods are squash/rebase only). Then `git checkout main && git pull` to sync local main.
11. **Report** — state the merged PR number, that the issue auto-closed via `Closes #N`, and the new `main` commit.

## Notes

- `main` is protected by a ruleset: no direct push, force-push, or deletion; a PR with a green `test` check is required. Never attempt to push to `main` directly.
- The `test` check runs on `windows-latest` and launches VS Code via `@vscode/test-cli`, so it takes a minute or two — that is expected, not a hang.
- One issue per PR. If the scope grows mid-implementation, split it into separate issues/PRs.
- This skill is for an issue that already exists. If the user describes new work without an issue, offer to `gh issue create` first, then ship it.
- The CI-wait and merge steps are where tool-call syntax slips have repeatedly stalled the session. Don't rely on noticing a non-dispatch after the fact — that reminder was tried and didn't hold. Instead structure those steps so they can't half-fire: one self-contained foreground call each — the blocking `gh pr checks --watch` above, and a single `gh pr merge` below — never a background fire-and-forget you depend on resuming across turns.
