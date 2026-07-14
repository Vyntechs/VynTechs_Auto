#!/usr/bin/env bash

# Read-only context bootstrap for Claude Code startup, resume, clear, and
# compaction. It refreshes remote refs and prints a bounded Git snapshot into
# Claude's context. It never changes the checked-out branch or working files.

set -u

project_root="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "$project_root" ]]; then
  project_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

if ! cd "$project_root" 2>/dev/null; then
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

fetch_state="current"
if ! git fetch origin main --prune --quiet >/dev/null 2>&1; then
  fetch_state="fetch failed; cached origin/main shown"
fi

branch="$(git branch --show-current 2>/dev/null)"
if [[ -z "$branch" ]]; then
  branch="detached"
fi

head_sha="$(git rev-parse --short=12 HEAD 2>/dev/null || printf 'unavailable')"
main_sha="$(git rev-parse --short=12 origin/main 2>/dev/null || printf 'unavailable')"
divergence="$(git rev-list --left-right --count HEAD...origin/main 2>/dev/null || printf 'unavailable')"
working_state="$(git status --short --untracked-files=all 2>/dev/null | sed -n '1,30p')"
if [[ -z "$working_state" ]]; then
  working_state="clean"
fi

recent_main="$(git log -5 --oneline origin/main 2>/dev/null || printf 'unavailable')"

open_prs=""
if command -v gh >/dev/null 2>&1; then
  open_prs="$(gh pr list --state open --limit 20 \
    --json number,title,headRefName,baseRefName \
    --template '{{range .}}{{printf "#%v %s -> %s | %s\n" .number .headRefName .baseRefName .title}}{{end}}' \
    2>/dev/null || true)"
fi
if [[ -z "$open_prs" ]]; then
  open_prs="not available from this hook; inspect with Claude Code's GitHub tools before acting"
fi

coordination_log="unavailable"
coordination_path="docs/operations/2026-07-14-autoeye-lane-coordination.md"
if [[ -f "$coordination_path" ]]; then
  coordination_log="$(sed -n '/^## Log/,$p' "$coordination_path" | tail -n 80)"
fi

driver_state="unavailable"
driver_path="docs/strategy/SHOP_OS_DRIVER_STATE.md"
if [[ -f "$driver_path" ]]; then
  driver_state="$(sed -n '1,80p' "$driver_path")"
fi

plan_stamp="unavailable"
plan_path="docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md"
if [[ -f "$plan_path" ]]; then
  plan_stamp="$(sed -n '1,8p' "$plan_path")"
fi

printf '%s\n' "AUTO-GENERATED REPOSITORY CONTEXT"
printf '%s\n' "Git is the durable authority; conversation summaries may be stale."
printf 'Project: %s\nBranch: %s\nHEAD: %s\norigin/main: %s\nFetch: %s\nDivergence (HEAD-only, main-only): %s\n' \
  "$project_root" "$branch" "$head_sha" "$main_sha" "$fetch_state" "$divergence"
printf '\nWorking tree (bounded to 30 paths):\n%s\n' "$working_state"
printf '\nRecent origin/main commits:\n%s\n' "$recent_main"
printf '\nOpen PRs:\n%s\n' "$open_prs"
printf '\nShop OS plan stamp:\n%s\n' "$plan_stamp"
printf '\nShop OS driver state:\n%s\n' "$driver_state"
printf '\nCross-session coordination Log (latest bounded entries):\n%s\n' "$coordination_log"
printf '%s\n' "END AUTO-GENERATED REPOSITORY CONTEXT"

exit 0
