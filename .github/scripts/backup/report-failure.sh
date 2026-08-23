#!/usr/bin/env bash
set -Eeuo pipefail

: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY must be set by GitHub Actions}"

printf '%s\n' '::error title=Encrypted database backup failed::No backup was marked successful. Follow the controlled restore and rollback runbook; do not create or publish a plaintext archive.'
cat >>"$GITHUB_STEP_SUMMARY" <<'EOF'
## Encrypted database backup failed

No backup was marked successful. Check the GitHub Actions configuration and
the controlled restore/rollback runbook before another authorized attempt.
Do not create, upload, cache, or publish a plaintext database archive.
EOF
