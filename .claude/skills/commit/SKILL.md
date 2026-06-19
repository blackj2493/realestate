---
name: commit
description: Use when committing and pushing changes in this repo — especially with concurrent Claude sessions sharing the working directory. Triggers on "commit this", "commit and push", "ship this". Enforces branch verification, guarded-file exclusion, and pre-commit typecheck/lint/test.
---

# /commit — Safe commit & push

This repo is frequently worked on by **multiple concurrent Claude sessions in the same working directory**. That has repeatedly caused branch-switch collisions, lost edits, and amends landing on the wrong commit. This routine exists to prevent that. Follow it in order; do not skip steps under time pressure.

Use the Bash tool with **plain git** — never PowerShell-wrapped git (it mangles multiline messages and exit codes).

## 1. Establish ground truth — before staging anything

- `git branch --show-current` — confirm you are on the branch you think you are.
- `git status` — review every modified/untracked file.
- `git log --oneline -5` — confirm recent history is what you expect (detects another session's commits).

If the branch or recent history is NOT what you expected, **STOP**. Another session may have switched branches or committed. Surface it to the user; do not proceed.

## 2. Never run destructive ops on shared state without confirmation

`git reset`, `git commit --amend`, `git rebase`, `git push --force` can destroy a concurrent session's work. Before ANY of these:
- Confirm the target commit/branch is yours and untouched since you last looked.
- Ask the user explicitly — no exceptions, even if it "obviously" just fixes your own last commit.
- **Forgot a file in your last commit?** Prefer a NEW follow-up commit (`git add <file> && git commit`) over `--amend` — it's non-destructive, needs no confirmation, and history can be squashed at merge time.

## 3. Verify before committing

Run and confirm each PASSES before staging:
- `npm run typecheck`
- `npm run lint`
- `npm run test` (skip only if the change is docs-only — and say so)

If any fails, fix it or report — do not commit broken code.

## 4. Stage only relevant files — exclude guarded files

- `git add <path>` the specific files for THIS change. Do not `git add -A` blindly.
- NEVER stage `CLAUDE.md`, `.claude/settings.json`, `.claude/settings.local.json`, or `.env*` unless the user explicitly asked to change them this turn.
- If `git status` shows guarded files modified by another session, leave them and flag it.

## 5. Commit

- Clean, concern-separated commits — split entangled changes rather than bundling.
- Conventional message: `type(scope): summary`.
- End the message body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## 6. Push

- Push to the feature branch, NOT `main` (main is protected here).
- If push is rejected (non-fast-forward), a concurrent session pushed — STOP, fetch, and surface the divergence. Do not force-push to "fix" it.

## Red flags — STOP and re-check ground truth
- Branch name isn't what you expected
- `git log` shows a commit you didn't make
- Push rejected as non-fast-forward
- About to `--amend` / `reset` / `--force`
- A guarded file appears staged
