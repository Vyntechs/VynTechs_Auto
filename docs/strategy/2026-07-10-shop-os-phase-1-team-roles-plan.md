# Shop OS Phase-1 Team Roles Implementation Plan

**Goal:** Expand the shop team model from Tech/Admin to the approved tech/advisor/parts/owner roles with explicit skill tiers, centralized capabilities, and race-safe last-owner protection.

**Smallest viable path:** Keep `profiles.role` as text and reuse the existing team routes and screen. Add one pure capability module, move database mutations into injected handlers, extend the existing invite/update contracts, and preserve founder/curator as a separate content-authority axis.

**Stop boundary:** No production schema/data writes, billing changes, diagnostic-engine changes, or external account actions.

## Acceptance criteria

- [ ] Pure `can*` helpers encode the active plan's capability matrix; shop code no longer invents new scattered role checks.
- [ ] Invite accepts only `tech|advisor|parts|owner`, validates nullable skill tier `1|2|3`, and stores both values.
- [ ] Team update changes role and skill tier together, rejects cross-shop and invalid input, and preserves legacy curator profiles.
- [ ] Demoting or deactivating an active owner uses a transaction-scoped lock and cannot remove the last active owner under concurrent requests.
- [ ] Team settings expose all four roles and the nullable A/B/C-tech tier without fake controls.
- [ ] Focused capability, handler, route, and UI tests prove positive, negative, tenant, last-owner, and founder paths.
- [ ] Full tests, TypeScript, build, diff review, independent review, and GitHub checks pass before merge.

## Verification

```bash
pnpm test tests/unit/shop-os-capabilities.test.ts tests/unit/team-invite-route.test.ts tests/unit/team-role-route.test.ts tests/unit/team-deactivate-route.test.ts
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

