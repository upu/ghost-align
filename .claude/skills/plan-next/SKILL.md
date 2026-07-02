---
name: plan-next
description: Plan the next release of this extension — review the source, surface improvements and new feature ideas, decide priorities with the user, then file the chosen items as GitHub issues assigned to a release milestone. Use this whenever the user is deciding what to build next rather than implementing or shipping: starting a planning phase, scoping a version, building a roadmap, choosing which items go into the next version, or turning improvement ideas into prioritized issues under a milestone (e.g. "次バージョンの計画", "次に何を作るか決めたい", "ロードマップ整理して issue 化", "v0.3 のスコープを決めたい", "what should we build next"). Not for implementing an already-filed issue (use /ship) or cutting and tagging a release (use /release).
argument-hint: "[target version, e.g. 0.2.0]"
---

# Plan Next Release

Run the planning phase for the next version: read the code, propose improvements and new features, agree on priorities with the user, and file the chosen items as issues under a release milestone. This is the front door that feeds `/ship` (implementation) and `/release` (cutting the release).

`$ARGUMENTS` is the target version (e.g. `0.2.0`). If empty, infer the next version from the current `package.json` `version` and recent milestones, and confirm it with the user.

## Steps

1. **Gather current state** — read `src/extension.ts`, `package.json` (`contributes.configuration`), and `src/test/**`. Run `gh issue list --state open` and `gh api repos/:owner/:repo/milestones` to see what is already tracked. Don't re-propose things that already have an open issue.

2. **Review the code for improvements** — read before judging. Look for correctness bugs (especially in languages already enabled by default), behavior gaps, and scalability concerns. Tie each finding to a concrete location in the source. Separate real bugs from nice-to-haves.

3. **Propose new features** — suggest features that fit the project's concept ("コードを変えずに、表示上で整える"). Keep proposals aligned with the "将来の方針" in `CLAUDE.md`. Mark which are children of existing tracking issues (e.g. #19).

4. **Present and prioritize with the user** — show the findings and feature ideas as a table with a recommended priority (high / med / low) and a recommended cut for the target version. Use `AskUserQuestion` to confirm that cut and adjust it — e.g. accept the recommendation, drop specific items, or rebalance priorities. With many candidates, ask about the recommendation as a whole rather than one question per item (`AskUserQuestion` is capped at a few questions). Do not file issues until the user has chosen.

5. **Set up the milestone and labels** — the milestone title is `v$ARGUMENTS` (prepend the `v`; `$ARGUMENTS` has none). Re-running this skill must not error or duplicate, so check before creating:
   - Milestone: list existing titles (`gh api repos/:owner/:repo/milestones --jq '.[].title'`); only if `vX.Y.Z` is absent, create it (`gh api repos/:owner/:repo/milestones -f title="vX.Y.Z" -f state="open" -f description="..."`). Creating a duplicate title returns 422 — never blind-create.
   - Labels: every issue gets one type label (`bug`, `enhancement`, `documentation`, `ci`, `chore`) and one priority label (`priority:high` / `priority:med` / `priority:low`). As of now all of these already exist in this repo; still confirm with `gh label list` and create only genuinely missing ones — `gh label create` errors on an existing label. Match the type to the issue's title prefix: `fix:`→bug, `feat:`→enhancement, `docs:`→documentation, `ci:`→ci, and `build:`/`workflow:`/`chore:`→chore.

6. **File the chosen issues** — for each selected item, write a body with sections: 背景 / 期待する挙動 / 設計メモ / 受け入れ基準. Create with `gh issue create --milestone "vX.Y.Z" --label <type> --label <priority>`. For a child of a tracking issue, reference the parent (`関連: #N`) and add a comment to the parent linking the new child.
   - When the design has more than one plausible approach, don't pick one at planning time: list the candidate approaches in 設計メモ (e.g. 案1/案2/案3 with trade-offs, marking a recommendation if there is one) and add "実装時にどれかを選ぶ（PR で決定を明記）". This lets `/ship` implement autonomously without blocking on a question, and keeps the decision auditable in the PR (worked well for #139/#140/#147 in v0.3.0). Treat the issue's analysis as a hypothesis — `/ship`'s test-first step is what verifies it.

7. **Report** — list the created issue numbers with their priority, the milestone URL, and a suggested order of work. Note that `/ship <n>` implements each, and the milestone is done when all its issues close (hand off to `/release`).

## Notes

- This is a planning skill: its output is issues + a milestone, not code. Do not start implementing here — that is `/ship`.
- One concern per issue so each can be shipped independently.
- Three label axes: type (`bug`/`enhancement`/`documentation`/`ci`/`chore`) + priority (`priority:high`/`med`/`low`) + milestone (which release). Keep that split; every issue gets one type label and one priority label.
- If a finding is out of scope for the target version, still file it as an issue (no milestone) so it is not lost, per this repo's issue-driven workflow.
- Verify each `gh` call actually dispatched, especially the milestone / label / issue creation in steps 5–6. A dispatched call returns one of: a tool result, a "running in background" ack, or a "malformed … please retry" error. If your turn ends with none of these and the user speaks next, the call did not dispatch (a syntax slip) — re-issue it with corrected syntax rather than asking the user.
