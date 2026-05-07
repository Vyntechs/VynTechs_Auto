#!/bin/bash
# Security audit: dependency CVEs + scan tracked files for accidentally
# committed secrets and .env.local files.
#
# Usage: pnpm test:audit
# Exit code: 0 = clean, 1 = high/critical CVE or any matching secret/env file.

set -uo pipefail

red='\033[31m'
green='\033[32m'
reset='\033[0m'
fail=0

echo ""
echo "[1/3] pnpm audit (high+ severity)..."
if pnpm audit --audit-level=high 2>&1 | tail -20; then
  printf "  ${green}✓${reset} no high or critical vulnerabilities\n"
else
  printf "  ${red}✗${reset} high or critical vulnerabilities found — see above\n"
  fail=1
fi

echo ""
echo "[2/3] secret-pattern scan in tracked files..."
# Patterns that indicate a real secret if found in source.
# Excludes .env.example, AGENTS.md, and the audit script itself
# (which mentions the pattern names by definition).
patterns='(SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|ANTHROPIC_API_KEY|VOYAGE_API_KEY)=[A-Za-z0-9_+/=-]{16,}'
if matches=$(git ls-files \
    | grep -vE '^(\.env\.example|AGENTS\.md|scripts/test-audit\.sh|docs/superpowers/specs/2026-05-07-testing-pipeline-design\.md|docs/superpowers/plans/2026-05-07-testing-pipeline-implementation\.md)$' \
    | xargs grep -lE "$patterns" 2>/dev/null); then
  if [ -n "$matches" ]; then
    printf "  ${red}✗${reset} secret-shaped values found in tracked files:\n"
    echo "$matches" | sed 's/^/      /'
    fail=1
  else
    printf "  ${green}✓${reset} no secret-shaped values in tracked files\n"
  fi
else
  printf "  ${green}✓${reset} no secret-shaped values in tracked files\n"
fi

echo ""
echo "[3/3] .env / .env.local commit check..."
if env_files=$(git ls-files | grep -E '^\.env(\.[a-z]+)?(\.local)?$' | grep -v '\.env\.example$'); then
  if [ -n "$env_files" ]; then
    printf "  ${red}✗${reset} env files committed (should be gitignored):\n"
    echo "$env_files" | sed 's/^/      /'
    fail=1
  else
    printf "  ${green}✓${reset} no .env or .env.local committed\n"
  fi
else
  printf "  ${green}✓${reset} no .env or .env.local committed\n"
fi

echo ""
if [ "$fail" -eq 0 ]; then
  printf "${green}audit passed${reset}\n\n"
  exit 0
else
  printf "${red}audit failed — see findings above${reset}\n\n"
  exit 1
fi
