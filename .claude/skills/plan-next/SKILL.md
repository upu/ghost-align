---
name: plan-next
description: Plan the next release of this extension — review the source, surface improvements and new feature ideas, decide priorities with the user, then file the chosen items as GitHub issues assigned to a release milestone. Use when starting a planning phase (e.g. "次バージョンの計画", "/plan-next", "次に何を作るか決めたい").
argument-hint: "[target version, e.g. 0.2.0]"
---

# Plan Next Release

Run the planning phase for the next version: read the code, propose improvements and new features, agree on priorities with the user, and file the chosen items as issues under a release milestone. This is the front door that feeds `/ship` (implementation) and `/release` (cutting the release).

`$ARGUMENTS` is the target version (e.g. `0.2.0`). If empty, infer the next version from the current `package.json` `version` and recent milestones, and confirm it with the user.

## Steps

1. **Gather current state** — read `src/extension.ts`, `package.json` (`contributes.configuration`), and `src/test/**`. Run `gh issue list --state open` and `gh api repos/:owner/:repo/milestones` to see what is already tracked. Don't re-propose things that already have an open issue.

2. **Review the code for improvements** — read before judging. Look for correctness bugs (especially in languages already enabled by default), behavior gaps, and scalability concerns. Tie each finding to a concrete location in the source. Separate real bugs from nice-to-haves.

3. **Propose new features** — suggest features that fit the project's concept ("コードを変えずに、表示上で整える"). Keep proposals aligned with the "将来の方針" in `CLAUDE.md`. Mark which are children of existing tracking issues (e.g. #19).

4. **Present and prioritize with the user** — show the findings and feature ideas with a recommended priority (high / med / low) and a recommended cut for the target version. Use `AskUserQuestion` to converge on: which items go into this version, and the priority of each. Do not file issues until the user has chosen.

5. **Set up the milestone and labels** — ensure a milestone for the target version exists (`gh api repos/:owner/:repo/milestones -f title="vX.Y.Z" -f state="open" -f description="..."`). Ensure `priority:high` / `priority:med` / `priority:low` labels exist (create with `gh label create` if missing). For type, label every issue with one of: `bug`, `enhancement`, `documentation`, `ci`, `chore` (match the issue's title prefix — `fix:`→bug, `feat:`→enhancement, `docs:`→documentation, `ci:`→ci, and `build:`/`workflow:`/`chore:`→chore). Create any missing type label with `gh label create`.

6. **File the chosen issues** — for each selected item, write a body with sections: 背景 / 期待する挙動 / 設計メモ / 受け入れ基準. Create with `gh issue create --milestone "vX.Y.Z" --label <type> --label <priority>`. For a child of a tracking issue, reference the parent (`関連: #N`) and add a comment to the parent linking the new child.

7. **Report** — list the created issue numbers with their priority, the milestone URL, and a suggested order of work. Note that `/ship <n>` implements each, and the milestone is done when all its issues close (hand off to `/release`).

## Notes

- This is a planning skill: its output is issues + a milestone, not code. Do not start implementing here — that is `/ship`.
- One concern per issue so each can be shipped independently.
- Three label axes: type (`bug`/`enhancement`/`documentation`/`ci`/`chore`) + priority (`priority:high`/`med`/`low`) + milestone (which release). Keep that split; every issue gets one type label and one priority label.
- If a finding is out of scope for the target version, still file it as an issue (no milestone) so it is not lost, per this repo's issue-driven workflow.
