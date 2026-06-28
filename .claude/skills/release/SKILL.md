---
name: release
description: Cut a release of this extension — finalize the CHANGELOG's [Unreleased] section into a dated version, bump package.json, land it via PR, then create and push the vX.Y.Z tag. Use when the user wants to release a version (e.g. "/release 0.1.0", "0.1.0 をリリース", "リリースして").
argument-hint: <x.y.z>
---

# Release a Version

Take the accumulated `[Unreleased]` CHANGELOG entries through to a tagged release, following this repo's GitHub Flow. `main` is protected: changes land only via a PR with the `test` CI check green. This skill is the counterpart to `/ship` (which adds entries) and follows the rules in `docs/changelog-guide.md` (Keep a Changelog 1.1.0 + SemVer).

`$ARGUMENTS` is the target version `x.y.z` (no leading `v`). If empty, propose the next version from the current `package.json` `version` and the nature of the `[Unreleased]` entries, and confirm with the user.

## Responsibility boundary

This skill goes **up to creating and pushing the `vx.y.z` tag**. Publishing to the Marketplace is delegated to the release workflow (`.github/workflows/release.yml`, issue #12) which triggers on the tag push. If that workflow does not exist yet, fall back to a manual publish (`npm run package` then `vsce publish`, which needs `VSCE_PAT` / `vsce login`) and say so in the report.

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
9. **Wait for CI** — `gh pr checks <pr> --watch --fail-fast` (launch with `run_in_background` for multi-minute runs; you are re-invoked when it exits). Fix and re-push if anything is red.
10. **Merge** — `gh pr merge <pr> --squash --delete-branch`, then `git checkout main && git pull` to sync local main.
11. **Tag & push** — on the synced `main`, create the annotated tag and push it: `git tag -a vx.y.z -m "vx.y.z"` then `git push origin vx.y.z`. This is what triggers the release workflow (#12).
12. **Report** — state the merged PR number, the new `main` commit, the pushed tag, and whether publishing happened automatically (release.yml) or needs the manual fallback.

## Notes

- `main` is protected (no direct push/force-push/delete); always go through a PR with the green `test` check.
- One release per PR. Do not bundle unrelated changes into the release PR — it should contain only the CHANGELOG finalization and the version bump.
- The release commit itself is not a user-facing change, so it gets no new `[Unreleased]` entry — it *creates* the released section.
- Tags are not protected like `main`, but never force-update a published tag; if a release is wrong, cut a new patch version instead.
