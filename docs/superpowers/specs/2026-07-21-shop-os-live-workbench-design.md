# ShopOS Live Workbench Design

**Status:** Approved by the active goal on 2026-07-21.

## Intent

- **Project:** ShopOS mounted living repair order, with Build quote as the first interaction wedge.
- **Plain-language outcome:** Every permitted role can tap a quote action and immediately understand what opened, what is being saved, what changed, and what to do next without leaving the repair order or losing typed work.
- **Done when:** The mounted quote workspace behaves as one local, responsive workbench at 390×844 and 1440×900; editors open at the invoking job, long content never creates horizontal overflow, accidental reload restores a bounded per-user draft, server-confirmed changes update in place, and the next available or blocked action is explicit.
- **Hard no:** No new page, schema, dependency, diagnostic or media entrance, global redesign, decorative animation, optimistic money, background autosave, or production/customer-data mutation.

## Product vision

The repair order is the bench. A user should never leave the vehicle to find the tool they just picked up. Tapping **Add part**, **Add labor**, or **Add fee** reveals that editor directly beneath the controls for the same job. Saving replaces the draft with server-confirmed ledger truth and updates the quote tape in the same mounted surface.

The experience should feel like a positive mechanical detent: immediate, certain, and calm. The single signature interaction is the **bay pulse**—a short cobalt edge on the exact job or line confirmed by the server. It is functional orientation, not ornament. Reduced-motion mode replaces motion with the same static emphasis.

## Evidence from current main

Current main already provides the correct structural base:

- the repair order remains mounted while `InlineQuoteWorkspace` loads;
- quote mutations refresh strict server truth without `router.refresh()`;
- dirty-editor switches and close attempts require explicit discard;
- focus returns to the server-confirmed line;
- the mobile prepare bar becomes non-fixed while an editor is open;
- long mobile job titles wrap;
- every shop role can build a quote while approval and close authority stay role-shaped.

The remaining problems are interaction seams:

1. The editor is rendered after the diagnostic story, not immediately after the tapped controls, so a tap can still appear inert.
2. Add controls do not expose which editor is active or what region they control.
3. Successful local refresh has focus evidence but no concise visible/live confirmation tying action to result.
4. React state protects drafts within the mounted surface, but an accidental browser reload loses the open line draft.
5. Long-content coverage is mostly CSS-source assertion rather than rendered overflow evidence at target viewports.

## Approaches considered

### A. Contextual inline workbench — selected

Keep the existing mounted repair order. An action becomes visibly active and expands one editor immediately after that job's action row. The editor receives focus only once, scrolls only enough to become visible, and retains the existing explicit-discard guard. A successful server refresh closes the editor, focuses the confirmed row, updates totals locally, and emits one concise live status plus the bay pulse.

This is the smallest design that works equally well on phone and desktop and preserves spatial context.

### B. Mobile bottom sheet — rejected

It makes controls reachable on a phone but detaches the input from the job being priced, adds a second interaction model on desktop, and risks hidden content behind virtual keyboards.

### C. Desktop side inspector — rejected

It is dense on wide screens but becomes another quasi-page, performs poorly on phones, and duplicates navigation/focus behavior the mounted workspace already solves.

## Interaction contract

### Opening an editor

- The invoking button has `aria-expanded`, `aria-controls`, and an active visual state.
- Its label changes from `Add part` to `Adding part` while that editor is open.
- Exactly one line editor is open at a time.
- The editor is rendered directly after the same job's action row, before any story or secondary workspace.
- The editor heading is programmatically named and its first field receives focus once.
- If the editor is already wholly visible, the page does not make a gratuitous scroll jump.

### Editing and switching

- Clean editor switches are immediate.
- Dirty editor switches use the existing one-step discard confirmation.
- Canceling a clean or dirty editor returns focus to its invoker and clears only that draft.
- Closing the mounted quote with dirty work uses the existing explicit discard confirmation.

### Draft continuity

- Only an authenticated production caller that supplies `actorId` gets reload recovery.
- Storage uses `sessionStorage`, scoped by normalized actor ID plus ticket ID; it does not cross browser tabs or users.
- The payload is versioned, bounded, schema-validated, and contains only the line-editor fields, job/line identity, kind, mode, idempotency key, and timestamp.
- Corrupt, oversized, expired, wrong-ticket, wrong-actor, missing-job, or missing-line drafts are deleted and ignored.
- A valid dirty draft restores only after current server truth loads, reopens at the original job, and announces `Unsaved part restored` (or labor/fee).
- Save success, explicit discard, or disappearance of the referenced job/line clears storage.
- The server remains authoritative. Recovery never creates or prices work until the user presses **Save line**.

### Saving and local truth

- The submit control says `Saving…` and all conflicting quote mutations are disabled during the request.
- Money and ledger rows remain on last confirmed server truth until the strict refresh succeeds.
- Success closes the editor, inserts or updates only the relevant React-rendered row and totals, focuses that row, announces the result, and applies the bay pulse.
- Failure leaves the draft intact and presents the existing retry-safe message.

### Next action

- The quote tape remains the single next-action surface.
- When blocked, it names the concrete prerequisite; controls never look enabled while inert.
- When ready, **Prepare quote** remains the one dominant action.
- The sticky mobile action never covers an open editor, keyboard target, error, or confirmation.

## Responsive and visual contract

- Supported evidence viewports are 390×844 and 1440×900; layout remains fluid between them.
- Job titles, concerns, line descriptions, part numbers, brands, fitment, money labels, and action labels wrap or truncate intentionally within their own column.
- Interactive targets remain at least 44 CSS pixels.
- No document-level horizontal scrolling is permitted.
- The bay pulse uses the existing signal color, lasts no more than 220 ms, runs only after server confirmation, and never loops.
- No toast stack, confetti, new icon language, gradients, glass effects, or ornamental motion is added.

## Role and authority contract

All four current shop roles may build and inspect quotes. This design changes no server authority:

- technician and parts may build/view but cannot record customer approval or close a ticket;
- advisor and owner retain approval and close authority;
- every role receives the same clear local editor behavior and server-confirmed quote truth;
- hidden or forbidden controls remain absent rather than disabled theater.

## Verification

1. Pure draft-parser tests reject malformed, oversized, expired, cross-ticket, and cross-actor payloads.
2. Component tests prove local editor placement, active action semantics, focus restoration, recovery, clearing, retry retention, live status, and bay-pulse targeting.
3. Rendered phone and desktop tests use deliberately long content and prove zero horizontal document overflow, visible active controls, editor proximity, and unobscured actions.
4. Existing quote, ticket-detail, role-command, approval, story, sourcing, and Golden Shop Day tests remain green.
5. TypeScript, production build, diff guards, accessibility checks, and serialized full-suite shards pass.
6. Authenticated synthetic owner/advisor/technician/parts journeys pass at both target viewports and leave zero operational QA rows.

## Rollback and stop conditions

All behavior is client-side and reversible through Git. Draft storage is removed by deleting its scoped key and never changes server truth. Stop and re-plan if correct behavior requires a schema, a new operational page, durable cross-device drafts, diagnostic/media enablement, global navigation changes, or a new Critical/Important defect unrelated to the repair.
