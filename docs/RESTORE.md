# Restoring Vyntechs from an Encrypted Database Backup

This is the controlled recovery procedure for the encrypted database-backup
candidate in `.github/workflows/daily-db-backup.yml`. At the time of this
document, the workflow remains disabled and no backup store, credential, age
identity, or production restore is created or authorized by this source change.

## What is protected

- Each archive is a PostgreSQL 17 custom-format, compressed dump encrypted with
  [age](https://age-encryption.org/) before it leaves the GitHub runner.
- The private Blob store can upload, read, list, and delete ciphertext, but it
  cannot decrypt it. It is deliberately separate from the offline age identity.
- Scheduled objects use the deterministic private path
  `database-backups/daily/YYYY/MM/vyntechs-YYYY-MM-DD.dump.age`. Manual objects
  include the UTC timestamp and GitHub run ID under `database-backups/manual/`.
- The store retains objects for 90 days. An existing deterministic scheduled
  path is a failed duplicate, never an overwrite.

Do not place an age identity, a Blob credential, a database URL, or an object
URL in GitHub, chat, source control, a shell history, or a ticket.

## Before any restore

1. Obtain explicit authority for the target and restore operation. A production
   restore is destructive and remains an A5-only decision.
2. Select one exact private object using authenticated Vercel access. Prefer a
   short-lived signed download at execution time where the authorized store
   supports it; otherwise use a least-privilege, time-bounded operator session.
3. Obtain one offline age identity from the documented custody process. The
   Blob operator must not also be the sole holder of this identity.
4. Prepare a fresh synthetic/non-production PostgreSQL target first. Confirm
   that it is isolated and can be discarded after validation.
5. Work only in an encrypted, access-controlled environment with a protected
   temporary directory. Keep terminals, shell history, logs, and screen shares
   clear of credentials, object URLs, and decrypted data.

## Download and authenticate the ciphertext

Use the documented, locked `@vercel/blob@2.8.0` SDK to save the selected
ciphertext to the controlled temporary directory after obtaining credentials
through the approved custody channel. Its authenticated `get()` call must use
the exact pathname with `access: 'private'` and `useCache: false`; continue
only after it returns status `200` and a complete stream is written to
`./controlled-temp/backup.dump.age`.

Do not use a public URL, GitHub Release, Actions artifact, cache, or alternate
storage sink. Confirm the command completed successfully before proceeding.

## Decrypt completely before any database mutation

Age authenticates ciphertext only when decryption completes. It can write
unauthenticated partial output before reporting a later integrity failure, so
never pipe `age` directly into `pg_restore` or any mutable database command.

```bash
umask 077
mkdir -p ./controlled-temp
age --decrypt \
  --identity ./offline-custody/authorized-backup-identity.txt \
  --output ./controlled-temp/backup.restore-input \
  ./controlled-temp/backup.dump.age

pg_restore --list ./controlled-temp/backup.restore-input >/dev/null
createdb -T template0 vyntechs_restore_synthetic
pg_restore \
  --clean --if-exists \
  --no-owner --no-privileges \
  --dbname vyntechs_restore_synthetic \
  ./controlled-temp/backup.restore-input
```

Do not run `createdb`, `pg_restore`, or any equivalent command against
production without its separate A5 authorization. First inspect the synthetic
restore, validate schema/data integrity, run the agreed application smoke
checks, and record only non-sensitive evidence.

### Zero-media reconciliation before reopening

Operational object storage is intentionally absent from the restored
environment. Old database backups may restore dormant media metadata rows, but never media bytes.
Complete the Row 49 zero-media reconciliation before reopening the restored environment.
This database backup must not be described or used as a media backup.

### Wrong key or integrity failure

If `age --decrypt` exits non-zero, treat the archive as unauthenticated or the
identity as unauthorized. Do not invoke `pg_restore`, retry against another
database, or stream partial output anywhere. Securely remove the partial file,
record a non-sensitive failure receipt, and escalate through the key-custody
process.

## Key custody and rotation

- A5 must establish at least one offline primary identity and a separately
  controlled recovery identity. Only their public recipients belong in the
  GitHub Actions variable.
- Store private identities outside GitHub, Vercel, the runner, source control,
  and ordinary chat. Recovery access must require the documented dual-control
  process.
- Before rotating recipients, add the successor recipient under controlled
  authority and prove it with a synthetic archive. Retain every retired private
  identity until the final object encrypted for it has aged out of the 90-day
  retention window.
- Test a wrong-key decrypt during the A4 synthetic proof. It must fail before
  any restore mutation.

## Cleanup, rollback, and re-enable gates

After an authorized synthetic restore, securely remove the decrypted archive
and its temporary directory according to the encrypted-host policy (use a
verified secure-delete mechanism where supported; otherwise destroy the
encrypted ephemeral volume). Retain ciphertext only under the configured
private-store retention rule.

If backup behavior is unsafe or uncertain, disable the workflow before any
further run, revoke the backup-only Blob credential and database credential,
and preserve existing ciphertext until an authorized retention decision. Do
not delete a store, overwrite an archive, or publish a replacement backup as a
rollback shortcut.

This source candidate requires A4 synthetic proof of private upload, denied
unauthenticated access, authorized decrypt/restore, wrong-key refusal,
duplicate protection, partial-upload behavior, retention, alert delivery, and
disable/revoke rollback. Connecting a store, issuing credentials or identities,
enabling the workflow, or restoring production remains A5-only.
