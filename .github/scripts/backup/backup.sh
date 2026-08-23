#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

readonly pg_dump_binary='/usr/lib/postgresql/17/bin/pg_dump'
readonly temporary_root=${RUNNER_TEMP:?RUNNER_TEMP must be set by GitHub Actions}
readonly backup_work_dir=$(mktemp -d "${temporary_root%/}/encrypted-db-backup.XXXXXX")
readonly ciphertext_path="$backup_work_dir/database.dump.age"
readonly readback_path="$backup_work_dir/database.readback.dump.age"

cleanup() {
  local status=$?
  if [[ -d "$backup_work_dir" ]] && ! rm -rf -- "$backup_work_dir"; then
    printf '%s\n' '::error title=Encrypted database backup cleanup failed::Temporary encrypted backup material could not be removed.' >&2
    return 1
  fi
  return "$status"
}
trap cleanup EXIT

backup_fail() {
  printf '%s\n' "encrypted backup failed: $1" >&2
  exit 1
}

[[ -x "$pg_dump_binary" ]] || backup_fail 'PostgreSQL 17 pg_dump is unavailable'
[[ -n "${DATABASE_URL:-}" ]] || backup_fail 'database backup credential is not configured'
[[ -n "${BACKUP_AGE_RECIPIENTS:-}" ]] || backup_fail 'age recipients variable is not configured'
[[ -n "${BLOB_READ_WRITE_TOKEN:-}" ]] || backup_fail 'private Blob credential is not configured'

readonly age_binary=$("$script_dir/install-age.sh" "$backup_work_dir")

declare -a age_recipient_args=()
while IFS= read -r recipient; do
  recipient=${recipient#"${recipient%%[![:space:]]*}"}
  recipient=${recipient%"${recipient##*[![:space:]]}"}
  [[ -n "$recipient" ]] || continue
  [[ "$recipient" == age1* ]] || backup_fail 'age recipients must be native public age recipients'
  age_recipient_args+=(--recipient "$recipient")
done < <(printf '%s\n' "$BACKUP_AGE_RECIPIENTS" | tr ',' '\n')
(( ${#age_recipient_args[@]} > 0 )) || backup_fail 'no usable age recipient was supplied'

readonly event_name=${GITHUB_EVENT_NAME:?GITHUB_EVENT_NAME must be set by GitHub Actions}
case "$event_name" in
  schedule)
    readonly backup_date=$(date -u +%F)
    readonly object_path="database-backups/daily/${backup_date:0:4}/${backup_date:5:2}/vyntechs-${backup_date}.dump.age"
    ;;
  workflow_dispatch)
    readonly manual_timestamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
    readonly run_id=${GITHUB_RUN_ID:?GITHUB_RUN_ID must be set for manual backups}
    [[ "$run_id" =~ ^[0-9]+$ ]] || backup_fail 'manual backup run identifier is invalid'
    readonly object_path="database-backups/manual/${manual_timestamp:0:4}/${manual_timestamp:5:2}/vyntechs-${manual_timestamp}-run-${run_id}.dump.age"
    ;;
  *)
    backup_fail 'backup may run only from the schedule or an explicit manual dispatch'
    ;;
esac

# pg_dump writes custom-format bytes only to age's stdin. No plaintext archive
# is named, stored, uploaded, cached, or emitted by this workflow.
if ! "$pg_dump_binary" \
  --format=custom \
  --compress=zstd:9 \
  --no-owner \
  --no-privileges \
  --quote-all-identifiers \
  "$DATABASE_URL" \
  2>"$backup_work_dir/pg-dump.error" \
  | "$age_binary" --encrypt --output "$ciphertext_path" "${age_recipient_args[@]}" \
  2>"$backup_work_dir/age.error"; then
  backup_fail 'PostgreSQL export or encryption did not complete'
fi
[[ -s "$ciphertext_path" ]] || backup_fail 'encrypted database archive is empty'

if ! node "$script_dir/backup.mjs" \
  "$ciphertext_path" \
  "$object_path" \
  "$readback_path" \
  >"$backup_work_dir/blob-operation.log" 2>"$backup_work_dir/blob-operation.error"; then
  backup_fail 'private encrypted upload, verification, or retention did not complete safely'
fi
