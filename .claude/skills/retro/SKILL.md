---
name: retro
description: Run a post-release retrospective for this extension and turn the lessons into mechanism changes. Look back at the release that just shipped — what went well and is worth codifying, what caused friction and needs a countermeasure, plus Claude's own observations and ways to use Claude Code better — then route each agreed improvement to the right place (GitHub issue / memory / hook / rule / skill / CLAUDE.md). Use this after a release (a milestone closed or a vX.Y.Z tag pushed) or whenever the user wants to reflect (e.g. "リリースの振り返り", "ふりかえりしよう", "KPT", "retrospective", "今回の開発どうだった"). This is backward-looking process kaizen — distinct from /plan-next, which plans forward-looking product features.
argument-hint: "[released version, e.g. 0.1.0]"
---

# Post-Release Retrospective

Look back at the release that just shipped and convert what you learn into durable improvements to how the project works. The point is not to vent or to write a feel-good summary — it is to notice what the release actually taught us and to land each lesson in the mechanism that will make next time better. This skill sits after `dev-flow:release` in the workflow (`/plan-next` → `dev-flow:ship` → `dev-flow:release` → `/retro`).

`$ARGUMENTS` is the version just released (e.g. `0.1.0`). If empty, infer it from the latest tag (`git tag --sort=-creatordate | head -1`) and confirm with the user.

## Mechanisms — where improvements go

The value of a retrospective is lost if good ideas stay as talk. Each agreed improvement should land in the **lightest mechanism that actually makes it stick**. Use this to route — and say *why* a given target fits, because the same idea can belong in different places depending on whether it's a one-off, a preference, or a hard rule:

| If the lesson is… | Route to | Why / how |
| --- | --- | --- |
| A repeated multi-step manual workflow | **skill** (`.claude/skills/`, new or edit) | so it becomes one `/command` instead of re-derived each time |
| "From now on, whenever X happens, always do Y" (deterministic, every time) | **hook** in `.claude/settings.json` | the harness enforces it — memory/preferences can't, because they rely on Claude remembering. Configure via `/update-config` |
| A reusable preference or judgment that should survive across sessions | **memory** (`feedback` / `project` / `reference`) | persists and is recalled automatically; include the why |
| A guardrail specific to certain files/paths | **path-scoped rule** (`.claude/rules/*.md` with `paths` frontmatter) | scoped and version-controlled — preferred over inline settings globs (see `.claude/rules/readme-user-facing.md` for the shape) |
| A project-wide principle or constraint | **CLAUDE.md** | always in context for this repo |
| An independent, delegable investigation that recurs | **agent** (`.claude/agents/`) | can run in parallel / be handed off |
| A concrete piece of deferred work | **GitHub issue** (label + milestone, per `/plan-next`) | this repo is issue-driven; nothing gets lost |

Don't force every observation into a mechanism. If something was a genuine one-off, naming it in the discussion is enough — over-codifying adds noise that future-you has to read past.

## Steps

1. **Reconstruct what actually happened** — base the retro on evidence, not memory. For the released version gather:
   - The CHANGELOG section for `x.y.z` (what shipped, in user terms).
   - The milestone's issues: `gh issue list --milestone "vX.Y.Z" --state all --json number,title,labels,state`. Note which were planned vs added mid-flight, and anything deferred out.
   - The change range since the previous release: find the prior tag (`git tag --sort=-creatordate` → the one before this) and read `git log <prev-tag>..vX.Y.Z --oneline` and the merged PRs (`gh pr list --state merged --base main --search "merged:>=<prev-release-date>"`).
   - Friction signals: CI reruns or failures on those PRs (`gh run list`), PRs that took several pushes to go green, scope that grew mid-PR.
   - Claude Code usage data: ask the user to run `/insights` and share what it shows. `/insights` is an interactive built-in command (REPL-only) — you can't run it yourself or via Bash, so prompt the user for it and read the highlights they relay (session / tool / token patterns, where time and permission prompts went). This grounds the "Claude Code usage" angle below in real numbers instead of impressions. Treat it as best-effort: if the user skips it, proceed without it.

2. **Form your own observations first** — the user explicitly wants you to bring what *you* noticed, not just facilitate. Before the discussion, prepare concrete, release-specific points (each tied to a real event above, not generic advice):
   - **Keep**: what went well and is worth codifying into a mechanism.
   - **Problem**: what caused friction, with a proposed countermeasure and where it would live.
   - **Claude Code usage**: read the `/insights` highlights together with what you observed, and turn the patterns into concrete improvements — e.g. repeated permission prompts for the same commands → a settings allowlist (the `/fewer-permission-prompts` skill does exactly this); a recurring multi-step manual sequence → a skill or hook; things that needed re-explaining each session → a memory note. Tie each suggestion to a specific pattern in the data, not generic "use Claude Code better" advice.
   - **Surprises**: anything that didn't match expectations (a workflow assumption that was wrong, an environment gotcha worth recording to memory).

3. **Discuss with the user** — present your observations and invite theirs. Frame it as Keep / Problem (their words: "うまくいったから仕組みに反映したいこと" / "うまくいかなかったから対策を仕組みに反映したいこと") plus your Claude Code usage ideas and anything that surprised you. Keep it a conversation, not a lecture — the user knows context you can't see. When there are many candidates, use `AskUserQuestion` to converge on which ones are worth acting on now.

4. **Route each agreed improvement** — for every item the user wants to act on, name the target mechanism from the table and the concrete change you'd make, and *why that mechanism*. Show this as a short plan and get a yes before creating anything — don't file issues or write files mid-discussion.

5. **Apply after approval** — once the user signs off, make each change in its place:
   - **Memory**: write the file + add the one-line `MEMORY.md` pointer directly (no PR — memory lives outside the repo).
   - **Issue**: `gh issue create` with the right type + priority label and milestone, following `/plan-next`'s conventions.
   - **Hook / settings**: propose the exact `settings.json` change via `/update-config` (the harness owns hooks).
   - **Skill / rule / CLAUDE.md edits**: these are tracked files, so follow this repo's GitHub Flow — branch from latest `origin/main`, edit, PR, merge once CI is green (as `dev-flow:ship` does). Group related mechanism edits into one PR.
   Confirm before anything outward-facing.

6. **Report** — list each improvement and where it landed (issue number, memory file, PR, hook), and note anything consciously deferred (with a pointer so it isn't lost).

## Notes

- **Not `/plan-next`.** `/plan-next` decides *what product features to build next*; `/retro` improves *how we work* based on the release just finished. A retro can still produce issues, but they're process/tooling improvements, not features. When the user wants to pick the next version's scope, hand off to `/plan-next`.
- One concern per artifact, so each can be acted on independently — same reason `/plan-next` files one issue per item.
- Prefer the lightest durable mechanism. A hook that fires every time beats a memory note that hopes Claude remembers; but a one-line preference doesn't need a hook. Match the weight to how often and how strictly the lesson must apply.
- If the retro surfaces work that's too big for this session, file it as an issue (no milestone if it's not slotted yet) rather than letting it evaporate — this repo's default is issue-driven.
