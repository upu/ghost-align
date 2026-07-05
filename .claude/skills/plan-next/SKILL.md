---
name: plan-next
description: Plan the next release of this extension — review the source, surface improvements and new feature ideas, decide priorities with the user, then file the chosen items as GitHub issues assigned to a release milestone. Use this whenever the user is deciding what to build next rather than implementing or shipping: starting a planning phase, scoping a version, building a roadmap, choosing which items go into the next version, or turning improvement ideas into prioritized issues under a milestone (e.g. "次バージョンの計画", "次に何を作るか決めたい", "ロードマップ整理して issue 化", "v0.3 のスコープを決めたい", "what should we build next"). Not for implementing an already-filed issue (use /ship) or cutting and tagging a release (use /release).
argument-hint: "[target version, e.g. 0.2.0]"
---

# Plan Next Release

Run the planning phase for the next version: read the code, propose improvements and new features, agree on priorities with the user, and file the chosen items as issues under a release milestone. This is the front door that feeds `/ship` (implementation) and `/release` (cutting the release).

`$ARGUMENTS` is the target version (e.g. `0.2.0`). If empty, infer it from the current `package.json` `version` and the final selection — a breaking change bumps major, any `enhancement` bumps minor, otherwise patch — and confirm it with the user.

## Steps

1. **Gather current state** — read `src/extension.ts`, `package.json` (`contributes.configuration`), and `src/test/**`. Run `gh issue list --state open --limit 1000 --json number,title,labels,milestone` and `gh api repos/:owner/:repo/milestones --paginate --jq '.[] | {title,state,number}'` (this is an inventory — always pass `--limit`/`--paginate` so the default page size doesn't hide issues or milestones). Don't re-propose things that already have an open issue.

2. **Review the code for improvements** — read before judging. Look for correctness bugs (especially in languages already enabled by default), behavior gaps, and scalability concerns. Tie each finding to a concrete location in the source. Separate real bugs from nice-to-haves.

3. **Propose new features** — suggest features that fit the project's concept ("コードを変えずに、表示上で整える"). Keep proposals aligned with the "将来の方針" in `CLAUDE.md`. Mark which are children of existing tracking issues (e.g. #19).

4. **Map dependencies and a cheap order among the candidates** — before asking the user, work out how the candidates relate:
   - Strict dependencies (X must land before Y): read existing issue bodies for `関連: #N` / `前提: #N` hints and check native sub-issue links (`gh api repos/:owner/:repo/issues/<n>/sub_issues`). A candidate whose prerequisite is neither selected nor closed cannot go in — surface that conflict to the user instead of silently dropping it.
   - Cost-saving order (お得な順序): not a hard dependency, but doing X first makes Y cheaper — e.g. a foundation refactor that shrinks the diff of the features touching the same code (the v0.7.1 lesson: 土台リファクタを先に). Record these; they feed the recommended order in steps 6 and 8, not the selection itself.

5. **Present and prioritize with the user** — show the findings and feature ideas as a table with a recommended priority (high / med / low), prerequisites/ordering notes from step 4, and a recommended cut for the target version. Use `AskUserQuestion` to confirm that cut and adjust it — e.g. accept the recommendation, drop specific items, or rebalance priorities. With many candidates, ask about the recommendation as a whole rather than one question per item (`AskUserQuestion` is capped at a few questions). Do not file issues until the user has chosen.

6. **Set up the milestone and labels** — the milestone title is `v$ARGUMENTS` (prepend the `v`; `$ARGUMENTS` has none). Re-running this skill must not error or duplicate:
   - Milestone: try the create directly and branch on the result instead of listing first — `gh api repos/:owner/:repo/milestones -f title="vX.Y.Z" -f state="open" -f description="<one-line theme>"`. On success, use it. On `422` (duplicate title), fetch it with `gh api "repos/:owner/:repo/milestones?state=all" --jq '.[] | select(.title=="vX.Y.Z")'`: if its `state` is `open`, reuse it (re-run safety); if `closed`, that version already shipped (or was closed by mistake) — stop and report to the user instead of reusing it.
   - The full description is written in step 8, after the new issue numbers exist; the create only needs the one-line theme.
   - Labels: every issue gets one type label (`bug`, `enhancement`, `documentation`, `ci`, `chore`) and one priority label (`priority:high` / `priority:med` / `priority:low`). As of now all of these already exist in this repo; still confirm with `gh label list` and create only genuinely missing ones — `gh label create` errors on an existing label. Match the type to the issue's title prefix: `fix:`→bug, `feat:`→enhancement, `docs:`→documentation, `ci:`→ci, and `build:`/`workflow:`/`chore:`→chore.

7. **File the chosen issues** — for each selected item, write a body with sections: 背景 / 期待する挙動 / 設計メモ / 受け入れ基準. Create with `gh issue create --milestone "vX.Y.Z" --label <type> --label <priority>`.
   - When the design has more than one plausible approach, don't pick one at planning time: list the candidate approaches in 設計メモ (e.g. 案1/案2/案3 with trade-offs, marking a recommendation if there is one) and add "実装時にどれかを選ぶ（PR で決定を明記）". This lets `/ship` implement autonomously without blocking on a question, and keeps the decision auditable in the PR (worked well for #139/#140/#147 in v0.3.0). Treat the issue's analysis as a hypothesis — `/ship`'s test-first step is what verifies it.
   - Encode the step-4 relations in GitHub itself, not just in prose:
     - A strict order dependency gets a `前提: #N` line in the dependent issue's body (GitHub auto-links it).
     - A true parent/child split of a tracking issue gets a native sub-issue link: `gh api repos/:owner/:repo/issues/<parent-number>/sub_issues -F sub_issue_id=<child-id>` where `<child-id>` is the child's `id` from `gh api repos/:owner/:repo/issues/<child-number> --jq .id` (gh 2.86 has no `--add-sub-issue` flag on `gh issue edit`; use the API). Also add a comment on the parent linking the new child.

8. **Write the milestone description as a shared brief** — once all issues exist, update the description so a later session or skill (`/ship`, `/release`) can pick up the plan without re-asking the user:
   - One line: the release's theme/goal.
   - The recommended work order of the selected issues — strict dependencies first, then cost-saving order, then priority. E.g. `1. #244 → 2. #283（#244 と同じ配線を触るため後） → 3. #235 → …`, with the reason in parentheses where the order isn't obvious.
   - Items considered but deferred, with the reason (prerequisite unmet, pushed to a later version, …).
   Write the multiline text to a scratchpad file with the Write tool and pass it as `gh api --method PATCH repos/:owner/:repo/milestones/<number> -F description=@<file>` — `--method PATCH` is required (`-f`/`-F` flips the default to POST), and the file avoids PowerShell multiline-quoting breakage.

9. **Report** — list the created issue numbers with their priority, the milestone URL, and the recommended order of work. Note that `/ship <n>` implements each, the milestone description holds the handoff brief, and the milestone is done when all its issues close (hand off to `/release`).

## Notes

- This is a planning skill: its output is issues + a milestone, not code. Do not start implementing here — that is `/ship`.
- One concern per issue so each can be shipped independently.
- Three label axes: type (`bug`/`enhancement`/`documentation`/`ci`/`chore`) + priority (`priority:high`/`med`/`low`) + milestone (which release). Keep that split; every issue gets one type label and one priority label.
- Prefer GitHub's own mechanisms over inventing a handoff format: narrative and order live in the milestone `description`, parent/child in native sub-issues, simple order dependencies as auto-linked `前提: #N` text. Any future session can then rebuild the plan just by reading the milestone and its issues.
- If a finding is out of scope for the target version, still file it as an issue (no milestone) so it is not lost, per this repo's issue-driven workflow.
- Verify each `gh` call actually dispatched, especially the milestone / label / issue creation in steps 6–8. A dispatched call returns one of: a tool result, a "running in background" ack, or a "malformed … please retry" error. If your turn ends with none of these and the user speaks next, the call did not dispatch (a syntax slip) — re-issue it with corrected syntax rather than asking the user.
