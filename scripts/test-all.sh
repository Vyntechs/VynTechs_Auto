#!/bin/bash
# Run the full local testing pipeline. Fail-fast — any stage that fails
# stops the run.
#
# Usage: pnpm test:all
#
# Sequence (~5 min total on a clean machine):
#   1. typecheck
#   2. unit tests (vitest)
#   3. build
#   4. e2e (Playwright)
#   5. integration (live Supabase RLS check)
#   6. audit
#
# NOT included (run separately):
#   - test:smoke   — needs a deployed URL
#   - test:perf    — needs a running dev server + lighthouse installed

set -e

start=$(date +%s)
green='\033[32m'
blue='\033[34m'
reset='\033[0m'

step() {
  printf "\n${blue}→ %s${reset}\n" "$1"
}

step "1/6 typecheck"
pnpm exec tsc --noEmit

step "2/6 unit tests"
pnpm test

step "3/6 build"
pnpm build

step "4/6 e2e (Playwright)"
pnpm test:e2e

step "5/6 integration (RLS)"
pnpm test:integration

step "6/6 audit"
pnpm test:audit

end=$(date +%s)
elapsed=$((end - start))
printf "\n${green}✓ all green${reset} (%ds)\n\n" "$elapsed"
