# Shop OS Row 24 — Simple Work UI Design

**Date:** 2026-07-11
**Status:** Pre-code design for independent review

## Outcome

Give an assigned technician a fast, honest place to execute approved repair or maintenance work: start it, save a short work note, attach proof, complete it, or record a newly discovered concern as a separate diagnostic job. The UI uses the deployed Row 23 contract and does not change diagnostic-engine behavior.

The technician must never be forced through diagnostic topology for work that is already known, such as installing a customer-supplied lift kit. “Found another concern” is optional and creates an unstarted, unassigned diagnostic job; it does not imply diagnosis, urgency, customer approval, a repair recommendation, or any new start restriction. Existing diagnostic claim/start behavior remains unchanged.

## Smallest coherent surface

Row 24 adds one assigned-work destination at `/tickets/:ticketId/jobs/:jobId/work` and replaces the disabled repair/maintenance control on Today with an honest link:

- assigned open or in-progress repair/maintenance with recorded customer/vehicle identity: `Open work`;
- assigned simple work missing customer/vehicle identity: `Review work order`, linking to the ticket instead of an unusable work page;
- assigned blocked repair/maintenance: `Review blocked work`, linking to the ticket because Row 23 does not mutate blocked work;
- diagnostics keep their current start/open behavior unchanged;
- unassigned jobs keep their current claim behavior unchanged.

When customer and vehicle identity are complete, the ticket ledger also links the assigned actor to the work destination for open, in-progress, and done repair/maintenance jobs. Identity-incomplete work gets no dead work-route link because the ticket ledger is already its honest context surface. This makes eligible completed notes and proof reachable without widening Today to completed work.

The server page reauthorizes/paywalls the current profile, loads the hardened Row 23 workspace, and composes only the bounded ticket identity needed in the bay: repair-order number, customer name, and year/make/model. It fails closed for missing customer/vehicle identity, closed non-completed tickets, canceled/blocked work, session-linked repair/maintenance, reassignment, and tenant mismatch; completed history remains readable after ticket closure. The client never receives shop IDs, storage paths, quote snapshots/events, contact details, or another technician’s work truth.

## Interaction model

The screen leads with what is true now, not a future step tree.

### Awaiting approval

Show `Work not approved` and explain only that work has not been authorized to start. This covers quote-not-built, quote-ready, sent, and stale exact-proof states without falsely claiming the customer has already received it. No start, note, upload, completion, or escalation controls render. A ticket link remains available for context.

### Declined

Show the distinct read-only state `Customer declined this work`. Do not describe it as waiting, and do not render start, note, upload, completion, or escalation controls.

### Ready to start

Show one primary 44px `Start work` control. It posts the Row 23 `start` action. The UI does not optimistically claim the work started; it changes only after the server confirms persisted truth.

### In progress

Show three compact modules in working order:

1. `Work note` — a 1–2,000 character textarea and explicit `Save note`. No fake autosave. An exact saved note is a safe no-op. A conflicting edit refreshes server truth and asks the tech to review it.
2. `Proof` — `Take proof photo` is the primary bay path (`capture=environment`), with a secondary `Add file` for supported photos, videos, PDF, or plain text. Files stay selected after network failure; the same request key is reused for an exact retry. The UI rejects empty, unsupported, or over-4-MiB files before transport and never exposes a storage path or signed URL.
3. `Complete work` — enabled only when the server-confirmed workspace has a non-empty saved note and `hasCompletionProof=true`. Row 24 adds this privacy-safe boolean to the Row 23 workspace, computed by the same authoritative uploader/path/MIME/size rule as completion; attachment display metadata alone is never treated as proof eligibility. It posts the current `expectedUpdatedAt`; success becomes a read-only completed state.

Every mutation has one pending owner, disables duplicate submission, announces status/error accessibly, and retains typed or selected input until confirmed. Network failure says `Not saved — check your connection and retry`; it never says saved, uploaded, or complete without a successful response.

### Found another concern

A collapsed, optional `Found another concern` disclosure sits below the primary work flow. Opening it reveals:

- a trimmed 5–500 character concern;
- an explicit A/B/C skill tier;
- `Create diagnostic job`.

The client holds one stable UUID for the exact concern+tier signature and reuses it after uncertain responses. Changing either field creates a new identity. Success states only persisted truth: `Diagnostic job added. It is unassigned and unstarted.` Existing claim/start behavior is unchanged. The source work remains unchanged and the form can reset for another concern.

## Honest edge behavior

- A tech performing known work never sees topology or diagnostic questions.
- A tech who does not use the optional concern form is not interrupted or nagged.
- A diagnostic job continues through the existing diagnostic UI; Row 24 does not wrap or alter it.
- A blocked/canceled/reassigned/cross-shop/session-linked/stale page fails closed to the ticket or not-found surface. A mutation-time 404 replaces the stale page with its ticket context rather than leaving active-looking controls mounted.
- A completed simple job is read-only and shows persisted note/proof metadata.
- Attachment previews use only the authenticated Row 23 byte proxy. Photo thumbnails are optional progressive detail; text labels remain the accessible source of truth.
- The UI does not infer approval from Today’s lightweight row. The work page renders the Row 23 exact authorization projection.
- Browser refresh loses no confirmed data. Unconfirmed local input is never described as persisted.

## Component and data boundaries

- `app/(app)/tickets/[id]/jobs/[jobId]/work/page.tsx` — authenticated/paywalled server composition and not-found boundary.
- `components/screens/simple-work-workspace.tsx` + module CSS — stateful technician surface.
- `lib/shop-os/simple-work-ui.ts` — strict response parsing, file classification/bounds, safe display types, and retry-state helpers. File retry state stores the UUID beside the selected `File` object and kind; the same object retains its key through uncertain responses, while any new selection or kind change rotates it even when name/type/size/lastModified match. No database access.
- `lib/shop-os/simple-work.ts` — harden workspace ticket/session truth and add only the privacy-safe `hasCompletionProof` projection; mutation rules remain authoritative and unchanged.
- `components/screens/today-jobs-board.tsx` — replace only the simple-work disabled control.
- `components/screens/ticket-detail.tsx` — add an assigned-actor work/history link without changing advisor quote behavior.

Row 23 domain/routes remain authoritative. No schema, migration, production data, provider, AI, notification, quote-decision, feature-flag, or diagnostic-session semantic changes are in scope.

## Accessibility and responsive contract

- Every interactive target is at least 44×44 CSS pixels.
- The working order and focus order match.
- Status uses polite live regions; failed mutations use alerts.
- File inputs have visible labels and accepted-format/size copy.
- The screen has no horizontal overflow at 320/375px and remains bounded at 1440px.
- Pending controls keep their width and use truthful verb phrases (`Saving note…`, `Uploading proof…`, `Completing…`).
- Reduced-motion users receive no required animation.

## Verification contract

- Unit tests for strict response/file helpers and File-object-bound retry identities, including different bytes with identical file metadata.
- Domain tests for real open/closed/canceled ticket status, session-linked denial, completed closed-ticket history, forged/wrong-uploader proof exclusion, and genuine Row 23 proof eligibility.
- Client tests for not-approved/declined/start/in-progress/done states, note concurrency, exact retry retention, server-derived proof gating, optional escalation, honest failures, stale-page replacement, focus/live regions, and no duplicate fetches.
- Server page tests for auth, paywall, assignment/tenant denial, missing identity, bounded identity composition, and done history; ticket-detail tests prove identity-incomplete jobs expose no dead work link.
- Today/ticket regressions proving diagnostic/claim/quote behavior stays unchanged.
- 320/375/1440 browser checks, keyboard focus, 44px controls, and no horizontal overflow.
- Full suite, TypeScript, production build, independent whole-branch review, PR checks, merge, Ready deployment, signed non-mutating production smoke, and fresh error logs.

## Rollback and stop conditions

Rollback is the Row 24 source commit/PR; Row 23 APIs remain useful and unchanged. Stop for any required schema/production-data change, engine/topology change, provider/AI call, external credential/spend, destructive action, or product decision that would force diagnostics onto simple work.
