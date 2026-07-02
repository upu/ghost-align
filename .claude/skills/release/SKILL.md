---
name: release
description: Cut a release of this extension — finalize the CHANGELOG's [Unreleased] section into a dated version, bump package.json, land it via PR, push the vX.Y.Z tag, then verify the tag-triggered Release workflow (GitHub Release + Marketplace publish) succeeded. Use when the user wants to release a version (e.g. "/release 0.1.0", "0.1.0 をリリース", "リリースして").
argument-hint: <x.y.z>
---

# Release a Version

Take the accumulated `[Unreleased]` CHANGELOG entries through to a tagged release, following this repo's GitHub Flow. `main` is protected: changes land only via a PR with the `test` CI check green. This skill is the counterpart to `/ship` (which adds entries) and follows the rules in `docs/changelog-guide.md` (Keep a Changelog 1.1.0 + SemVer).

`$ARGUMENTS` is the target version `x.y.z` (no leading `v`). If empty, propose the next version from the current `package.json` `version` and the nature of the `[Unreleased]` entries, and confirm with the user.

## Responsibility boundary

This skill goes **up to pushing the `vx.y.z` tag and confirming the release it triggers succeeded**. Publishing is delegated to the Release workflow (`.github/workflows/release.yml`, issue #12 — shipped) which fires on the tag push: it verifies the tag matches `package.json`, packages the VSIX, **always creates a GitHub Release with the `.vsix` attached**, **publishes to the VS Code Marketplace when the `VSCE_PAT` secret is present** (otherwise that one step is skipped, not failed), and **closes the matching `vx.y.z` milestone once all its issues are closed** (issue #168 — otherwise it leaves the milestone open and warns, without failing the release). In the unlikely case the workflow is absent, fall back to a manual publish (`npm run package` then `npx @vscode/vsce publish`, which needs `VSCE_PAT` / `vsce login`) and say so in the report.

## Steps

1. **Pre-checks** — confirm the working tree is clean and `origin/main` is up to date (`git fetch origin`). Read the `## [Unreleased]` section of `CHANGELOG.md`: if it has no entries, stop and confirm with the user (nothing to release). Restate the entries so the version scope is explicit.
2. **Confirm the version is SemVer-correct** — given the `[Unreleased]` entries, check `x.y.z` matches Semantic Versioning: breaking changes → major, new features (`Added`) → minor, only fixes → patch. If the requested number disagrees with the entries, flag it and confirm before proceeding.
3. **Branch from latest main** — `git checkout -b release/v<x.y.z> origin/main`.
4. **Finalize the CHANGELOG** — edit `CHANGELOG.md`:
   - Rename the current `## [Unreleased]` heading to `## [x.y.z] - YYYY-MM-DD` using today's date in ISO 8601 (`date +%F`).
   - Insert a fresh empty `## [Unreleased]` section above it (no entries).
   - Keep the newest version at the top; every released version must have an entry.
   - Update the link references at the bottom: set `[Unreleased]` to `.../compare/vx.y.z...HEAD`, and add `[x.y.z]: https://github.com/upu/ghost-align/releases/tag/vx.y.z`. Leave older version links in place.
   - (Only if yanking a release: mark it `## [x.y.z] - YYYY-MM-DD [YANKED]`.)
5. **Bump the version** — set `package.json` `"version"` to `x.y.z`.
6. **Test (gate)** — run `npm run compile`, `npm test`, then `npm run check:package`. All must pass; do not open a PR on a failing build.
7. **Commit** — confirm only intended changes are staged (`git status` / `git diff`), then commit with a Japanese summary line in the repo's style, e.g. `release: vx.y.z` (or `release: CHANGELOG を x.y.z に確定し version を bump`).
8. **Push & PR** — `git push -u origin release/v<x.y.z>`, then `gh pr create --base main`. Pass the body via `--body-file` (avoid backticks/`$()` in the inline command so the call matches the `gh pr *` allowlist) summarizing the release.
9. **Wait for CI** — run `set -o pipefail; gh pr checks <pr> --watch --fail-fast 2>&1 | tail -5` as a single foreground call with a long timeout (e.g. 600000 ms / 10 min); it blocks until all checks finish. The `tail -5` trims `--watch`'s 10-second reprints of the full check table (a context flood over many PRs); `set -o pipefail` keeps a failing check exiting non-zero through the pipe. Keep it one self-contained call rather than a background fire-and-forget resumed across turns — that multi-turn pattern is where a tool-call syntax slip has stalled the session at CI-wait. Fix and re-push if anything is red.
10. **Merge** — `gh pr merge <pr> --squash --delete-branch`, then `git checkout main && git pull` to sync local main.
11. **Tag & push** — on the synced `main` (which now carries the bumped `package.json`, so the workflow's tag-vs-version check passes), create the annotated tag and push it: `git tag -a vx.y.z -m "vx.y.z"` then `git push origin vx.y.z`. This triggers the Release workflow (#12).
12. **Verify the release** — the tag push starts `.github/workflows/release.yml`; confirm it actually succeeded rather than assuming. Get the run with `gh run list --workflow=release.yml -L 1`, then watch it with a single foreground `set -o pipefail; gh run watch <run-id> --exit-status 2>&1 | tail -20` call (long timeout, e.g. 600000 ms) — keep it one self-contained call, not a background watch resumed across turns; the `tail` trims the repeated job-progress reprints and `--exit-status` + `pipefail` preserve a red run's non-zero exit. A green run means the GitHub Release with the `.vsix` was created and, with `VSCE_PAT` set, the Marketplace publish ran. If it is red, inspect with `gh run view <run-id> --log-failed` — the most likely cause is a tag-vs-`package.json` version mismatch.
13. **Confirm the milestone closed** — `release.yml`'s "Close milestone" step (#168) closes the `vx.y.z` milestone automatically once the release succeeds, provided all its issues are closed; if issues remain open it leaves the milestone open and posts an `::warning::` in the run log instead of failing the release. Check the run log (from step 12) or `gh api repos/:owner/:repo/milestones --jq '.[] | select(.title=="vx.y.z") | .state'` to confirm the outcome. If it's still open because of leftover issues, report them so the user can decide (defer to the next version or pull them into this release) — do not close it manually to paper over open issues.
14. **Report** — state the merged PR number, the new `main` commit, the pushed tag, the Release workflow result (link the run), whether the Marketplace publish ran or was skipped, and whether the milestone was closed.

## Notes

- `main` is protected (no direct push/force-push/delete); always go through a PR with the green `test` check.
- One release per PR. Do not bundle unrelated changes into the release PR — it should contain only the CHANGELOG finalization and the version bump.
- The release commit itself is not a user-facing change, so it gets no new `[Unreleased]` entry — it *creates* the released section.
- Tags are not protected like `main`, but never force-update a published tag; if a release is wrong, cut a new patch version instead.
- The CI-wait, merge, and release-verify steps are where tool-call syntax slips have repeatedly stalled the session. Don't rely on noticing a non-dispatch after the fact — that reminder was tried and didn't hold. Instead structure those steps so they can't half-fire: one self-contained foreground call each (the blocking `gh pr checks --watch`, the single `gh pr merge`, the single `gh run watch`) — never a background fire-and-forget you depend on resuming across turns.
