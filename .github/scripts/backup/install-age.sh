#!/usr/bin/env bash
set -Eeuo pipefail

readonly AGE_VERSION='1.3.1'
readonly AGE_ARCHIVE_URL="https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-amd64.tar.gz"
readonly AGE_ARCHIVE_SHA256='bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377'

fail() {
  printf '%s\n' "encrypted backup setup failed: $1" >&2
  exit 1
}

[[ $# -eq 1 ]] || fail 'install-age.sh requires one controlled temporary directory'
readonly work_dir=$1
[[ -d "$work_dir" ]] || fail 'controlled temporary directory is unavailable'

readonly archive_path="$work_dir/age-v${AGE_VERSION}-linux-amd64.tar.gz"
readonly extracted_dir="$work_dir/age"
readonly age_binary="$extracted_dir/age"

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$AGE_ARCHIVE_URL" \
  --output "$archive_path"

readonly actual_sha256=$(sha256sum "$archive_path" | awk '{print $1}')
[[ "$actual_sha256" == "$AGE_ARCHIVE_SHA256" ]] || fail 'age archive checksum did not match the pinned release'

tar -xzf "$archive_path" -C "$work_dir"
[[ -x "$age_binary" ]] || fail 'pinned age archive did not contain the expected executable'
"$age_binary" --version >/dev/null

printf '%s\n' "$age_binary"
