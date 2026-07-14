# Vendored Diagnostic Evidence Receipt contract v0

Canonical source: the `Vyntechs/AUTOEYE` repository —
`schemas/evidence_receipt.schema.json`,
`docs/product/EVIDENCE_RECEIPT_CONTRACT_v0.md`, and
`artifacts/fixtures/evidence_receipt/`. That repo is the single source of
truth for the contract; this directory is a byte-for-byte vendored copy for
consumption only. Updates come ONLY from the canonical repo — never edit the
schema or fixtures here by hand.

The fixtures under `fixtures/` are the five `valid_*` receipts from the v0
conformance corpus. They are entirely SYNTHETIC: no real vehicle, customer,
shop, or repair-order data of any kind (identifiers use `*-SYNTH-*` style
opaque ids; timestamps are fixed constants).

Contract boundaries this consumer must preserve (see the contract doc and the
decision of record,
`docs/strategy/2026-07-14-autoeye-first-diagnostic-and-paid-api-wedge.md`):

- A receipt is evidence only. It carries no diagnosis, ranking, confidence,
  next-test prescription, or repair direction, and the consumer must not
  fabricate or imply any.
- Descriptive absences and material unknowns are unordered and descriptive
  only — never rendered as actions, priorities, questions, recommendations,
  or implied tests.
- Blocked/unsupported entries are always visibly rendered; unsupported never
  means silently discarded.
- `contract_version` must be exactly `"0"`; any other shape is rejected whole
  (`parse.ts`) — a non-conforming receipt is never partially rendered.
