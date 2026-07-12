# Shop OS Row 24 — Simple Work UI Execution Plan

> Execute on `feat/shop-os-row24-simple-work-ui` from deployed `main`. Follow project `AGENTS.md`, `tasks/lessons.md`, the active Shop OS plan, the interaction doctrine, and the Row 24 design. One writer owns source; review lanes are read-only.

**Goal:** Ship the technician UI for deployed simple-work, proof, and found-concern handlers without forcing diagnostic topology or changing schema, provider, quote, production-data, or diagnostic-engine behavior.

**Architecture:** A server-authenticated assigned-work page composes the exact Row 23 workspace with bounded repair-order identity. A strict client adapter validates every response and file before a single stateful workspace renders authorization, start, note, proof, completion, and optional escalation. Today and ticket detail add links only; Row 23 stays authoritative.

---

### Task 1: Strict client contract

**Files:**

- Modify: `lib/shop-os/simple-work.ts`
- Create: `lib/shop-os/simple-work-ui.ts`
- Modify: `tests/unit/shop-os-simple-work.test.ts`
- Create: `tests/unit/shop-os-simple-work-ui.test.ts`

1. Write failing domain tests for persisted open/closed/canceled ticket status, session-linked denial, closed completed history, forged/wrong-uploader proof exclusion, and genuine Row 23 proof eligibility. Add only a privacy-safe `hasCompletionProof` workspace boolean and real ticket/session validation; do not weaken mutation authority.
2. Write failing tests for strict workspace/mutation/attachment/escalation response parsing, safe display fields only, canonical supported files, non-empty ≤4 MiB limits, and no storage-path acceptance.
3. Write failing tests for retry state that stores one UUID beside the selected `File` object and kind. The same object retains its key through uncertainty; a new selection/kind rotates it even when file metadata matches. Concern+tier uses the same exact-signature rule.
4. Implement the smallest domain projection and client-only adapter; run focused Row 23/UI contract tests, TypeScript, and diff check.
5. Commit: `Add simple work UI contract`.

### Task 2: Assigned-work page and state machine

**Files:**

- Create: `app/(app)/tickets/[id]/jobs/[jobId]/work/page.tsx`
- Create: `components/screens/simple-work-workspace.tsx`
- Create: `components/screens/simple-work-workspace.module.css`
- Create: `tests/unit/shop-os-simple-work-page.test.tsx`
- Create: `tests/unit/shop-os-simple-work-workspace.test.tsx`

1. Write failing server-page tests for authentication, access, exact assigned workspace denial, missing customer/vehicle, bounded ticket identity, closed non-done denial, session-linked denial, and closed done history.
2. Write failing UI tests for not-approved, declined, confirmed start, optimistic-concurrency refresh, explicit note save, retained offline input, bounded proof upload/exact retry, proxy-only proof links, server-derived proof gating, completion replay, and read-only done state.
3. Write failing optional escalation tests proving no default interruption, strict concern/tier, stable retry, honest `unassigned and unstarted` success copy, source work unchanged, and existing diagnostic claim/start behavior unchanged.
4. Implement the server page, client state machine, and responsive accessible styling. Do not add autosave, background mutation, topology, AI, or provider calls.
5. Run focused page/workspace/Row 23 route tests, TypeScript, build, and diff check.
6. Commit: `Add assigned simple work workspace`.

### Task 3: Honest entry points

**Files:**

- Modify: `components/screens/today-jobs-board.tsx`
- Modify: `components/screens/ticket-detail.tsx`
- Modify: `app/(app)/tickets/[id]/page.tsx`
- Modify: `tests/unit/shop-os-today-jobs-board.test.tsx`
- Modify: `tests/unit/shop-os-ticket-detail.test.tsx`

1. Replace the assigned simple-work disabled control with `Open work` for identity-complete open/in-progress work and `Review work order`/`Review blocked work` to the ticket for missing identity or blocked work.
2. Add an assigned-actor link from ticket detail for open/in-progress/done simple work only when both customer and vehicle identity are complete. Identity-incomplete, unassigned, and other-actor jobs expose no work-route link.
3. Prove diagnostics retain their existing start/open behavior (without adding approval gates), open jobs retain claim behavior, Today never claims authorization truth, identity-incomplete ticket detail has no dead work link, and all targets are ≥44px.
4. Run focused Today/ticket/page/workspace tests, TypeScript, build, and diff check.
5. Commit: `Connect simple work entry points`.

### Task 4: Converge, review, and ship Row 24

1. Run the Row 24 focused suite plus Row 14/17/21/22/23 regressions.
2. Run once, serializing heavy commands:

   ```bash
   pnpm exec vitest run --maxWorkers=4 --testTimeout=30000 --hookTimeout=30000
   pnpm exec tsc --noEmit
   pnpm run build
   git diff origin/main --check
   ```

3. Independently review tenant/actor truth, authorization copy, response parsing, retry identities, offline honesty, concurrency refresh, file privacy, proof completion gate, optional escalation semantics, diagnostic/claim regressions, accessibility, responsive behavior, and scope.
4. Resolve every Critical, Important, and Minor finding; rerun affected proof.
5. Browser-verify 320/375/1440 widths, keyboard order, 44px controls, no overflow, no console errors, and honest non-mutating states without fabricating production data.
6. Update the active plan and driver, open a ready PR, wait for checks, merge, wait for production Ready, run signed smoke/fresh error logs, and record the deployed checkpoint with row 25 or the next safe non-gated row selected from current evidence.

## Done when

An assigned technician can reach simple work in one tap, see exact authorization truth, start approved work, persist a note and private proof, complete only with server-confirmed evidence, and optionally create one honest unstarted diagnostic concern. The UI never forces topology onto known work, never claims uncertain writes succeeded, preserves current diagnostic/claim/quote behavior, is independently approved, fully verified, merged, deployed, and recorded.
