# ShopOS Authenticated Golden Shop Day Design

**Status:** Approved by the active goal on 2026-07-20.

## Intent

- **Project:** ShopOS living repair order.
- **Plain-language outcome:** Prove the Golden Shop Day through four real authenticated browser sessions on a phone viewport and a desktop viewport, then repair only friction the browser journey actually exposes.
- **Why now:** Row 54 proves the domain sequence and rendered component contracts, but it deliberately does not prove Supabase authentication, hosted cookies, navigation, focus, browser layout, or reload continuity.
- **Done when:** One isolated synthetic shop completes the same repair-order journey through owner, advisor, technician, and parts browser contexts at 390×844 and 1440×900; accessibility, authority, reload, draft-preservation, and responsive receipts pass; every run cleans up its synthetic operational rows; any observed defect is fixed and protected by a regression test.
- **Hard no:** No real customer data, new operational page, diagnostic or media entrance, production auth bypass, provider call, email delivery, schema change, external purchase, or unrelated redesign.

## Product vision

The browser should feel like one repair order moving through one shop, not four disconnected pages. Each role signs in normally, finds the same repair order from Today, performs only its intended next move inside Today or the mounted repair order, and returns to fresh server truth without losing typed work. Phone and desktop are two views of the same living object, not separate workflows.

The embarrassing failure is not merely a crash. It is a successful action that appears to vanish, a control offered to the wrong role, a mobile action hidden below or behind another surface, a draft lost on a local transition, or a full-page-feeling jump where the mounted repair order should remain present.

## Capability map

| Capability | Status before this slice | Evidence | This slice |
| --- | --- | --- | --- |
| Four-role domain journey | working | Row 54 hermetic Golden gate | Reuse as the state contract |
| Authenticated browser identity | partial | Curator storage state and one owner test that can skip | Establish isolated QA identities |
| Hosted cookie/session path | unproved for ShopOS roles | Production anonymous redirects only | Prove through normal sign-in |
| Phone browser continuity | partial | Component/CSS assertions | Prove at 390×844 |
| Desktop browser continuity | partial | Component/CSS assertions | Prove at 1440×900 |
| Reload and draft preservation | partial | Unit/component coverage | Exercise in a real browser |
| Accessibility | partial | Component semantics | Run rendered axe and keyboard/focus checks |
| Repeatable cleanup | missing | Hermetic test disposes its own database only | Add run-scoped synthetic cleanup |

## Approaches considered

### A. Persistent isolated production QA tenant with run-scoped work — selected

Create one synthetic shop and four confirmed Supabase users. Keep their random passwords outside Git in macOS Keychain. The shop is comped only to bypass billing, has diagnostics explicitly disabled, has no Stripe customer, and uses no operational media. Every browser run creates uniquely tagged synthetic customer/vehicle/ticket rows, owns only those rows, and removes them after evidence is captured.

This is the smallest path that proves the exact deployed authentication, cookie, middleware, database, and rendering chain. The current active goal is the authority that supersedes Row 54's earlier deferral of a production canary, but only for this isolated synthetic tenant.

### B. Recreate every auth user on every run — rejected

It minimizes persistent identities but makes authentication lifecycle and cleanup the dominant failure mode. Four accounts are stable infrastructure; repair-order rows are the disposable test payload.

### C. Separate Supabase staging project — deferred

This offers stronger physical isolation but introduces spend, migration synchronization, environment ownership, and deployment drift. The account currently has no Vyntechs staging project or local Supabase stack, so it would delay evidence without improving the product flow under test.

## Identity and secret boundary

- Shop name: `Vyntechs Golden Browser QA`.
- Four fixed synthetic roles: owner, advisor, technician tier 3, and parts.
- Emails use the IANA-reserved `.invalid` namespace and are administratively confirmed; no message is sent.
- Passwords are generated independently with cryptographic randomness and stored under dedicated macOS Keychain service names.
- Committed code accepts credentials only through environment variables. It never contains, prints, snapshots, traces, or serializes passwords, service-role keys, database URLs, tokens, or authenticated cookies.
- Setup uses the existing Supabase Admin API and existing database schema. It is local test tooling, never a product route.
- The provisioning command is idempotent and refuses to adopt any shop or auth user whose exact synthetic identifiers do not match the expected QA contract.

## Browser architecture

One Playwright spec owns each device journey. It opens four isolated browser contexts against the same deployed base URL and signs each role in through the real `/sign-in` form.

```text
PHONE 390×844 or DESKTOP 1440×900
│
├── ADVISOR signs in
│   └── creates one tagged Counter repair order
├── OWNER signs in
│   └── finds the same order and verifies dispatch authority
├── ADVISOR assigns TECH and prepares/approves the quote
├── TECH signs in
│   └── records findings, reloads, performs work, and requests a text-only part
├── PARTS signs in
│   └── sees Parts needed and resolves the request
├── TECH resumes the mounted order and completes work
└── OWNER records synthetic payment, closes, and verifies terminal truth
```

The journey uses accessible roles and visible labels rather than CSS selectors where the product exposes semantics. It reloads Today or the mounted repair order at each handoff so optimistic client state cannot satisfy the test.

## Required browser receipts

At every role handoff the harness records assertions, not customer data:

- current URL and mounted repair-order identity;
- intended Today lane and primary action;
- forbidden controls for the current role;
- no diagnostic or media affordance;
- no horizontal document overflow;
- no element outside the viewport when it is the current primary action;
- no framework error overlay or unexpected console error;
- no serious or critical axe violation;
- keyboard focus reaches the primary action and remains visible;
- reload preserves committed truth;
- an unsaved quote/work draft triggers the existing guard rather than silently disappearing.

Screenshots and traces may contain only the synthetic fixture. They stay in ignored Playwright output and are not committed.

## Synthetic data lifecycle

The persistent shop and four profiles remain available for future release checks. Each run uses a unique marker in the synthetic customer name and work concern. Cleanup resolves the run's ticket IDs from the QA shop plus marker, deletes child rows in foreign-key-safe order inside one transaction, deletes the run's tickets/vehicles/customers, and proves zero remaining rows for that marker.

Cleanup runs after success and failure. If cleanup cannot prove ownership or encounters an unexpected dependency, it stops without deleting and emits only table/count identifiers. It never operates outside the fixed QA shop ID. A separate teardown command can remove the four auth users and QA shop only when intentionally retiring the canary.

## Error handling and repair boundary

- Authentication failure stops the journey and rotates/reprovisions only the affected synthetic identity.
- Tenant or role mismatch stops before any operational mutation.
- Cleanup failure is a release-gate failure, not a warning.
- Browser failures capture a synthetic-only screenshot, trace, console summary, current URL, viewport, and checkpoint.
- Any product repair begins with a regression test that reproduces the observed defect.
- Repairs stay inside Today, the mounted repair order, or their existing server handlers. New pages, diagnostics, media, general refactors, and speculative polish remain out of scope.
- Two failed repair approaches trigger a re-plan rather than another patch.

## Verification and release gate

1. Provisioning is idempotent and proves exact shop, role, tier, membership, comp, and diagnostics-off state without printing secrets.
2. The complete Golden journey passes once at 390×844 and once at 1440×900 through normal hosted sign-in.
3. Both runs pass the required browser receipts and leave zero run-scoped operational rows.
4. The existing hermetic Golden test stays green so browser selectors do not become the only proof of state correctness.
5. Every observed defect has a focused regression test and passes a phone/desktop re-run.
6. Focused tests, serialized full suite, TypeScript, production build, diff guards, static/security/runtime review, GitGuardian, and Vercel pass before merge.
7. The exact merged production revision passes the authenticated Golden journey again; teardown proves no run rows remain.

## Rollback and stop conditions

Runtime repairs revert normally through Git. The browser harness and provisioning code are test-only and introduce no application route or schema. The QA canary can be retired by deleting its exact four auth user IDs and fixed shop ID after a zero-dependent-row proof.

Stop and re-plan if the goal requires real customer data, any diagnostic/media enablement, a new operational page, a schema migration, customer messaging, a provider call, a purchase, or mutation outside the fixed synthetic QA tenant.
