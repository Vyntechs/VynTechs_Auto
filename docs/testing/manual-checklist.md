# Vyntechs — Manual Test Checklist

Print this. Walk through it. Check the boxes.

The automated suite (`pnpm test:all`) catches "did the page render" and "did the database accept this." This checklist catches everything machines can't reliably check: UX, AI answer quality, money flows, what a real customer would do.

**Cadence:**
- Persona 1 (customer) — before each Stage release.
- Persona 2 (user) — once a week, or after touching the session/intake/AI code.
- Persona 3 (owner / curator) — once a week (Monday morning aligns with the calibration cron).
- Persona 4 (tester / regression) — before every PR merge to main.

**Prep:**
- Have a real browser open (Chrome).
- Be signed out of any Vyntechs account before starting Persona 1.
- Have Stripe test cards handy (last section of this doc).
- Open dev tools (Cmd-Opt-I) so console errors are visible.

---

## Persona 1 — Customer (first-time sign-up)

You are a shop owner who heard about Vyntechs. You went to the website to check it out. You have never used the product.

| # | Action | Expected | If broken |
|---|---|---|---|
| 1 | Visit `https://vyntechs.dev` | Landing page renders. h1: "AI master tech for the bay." Sub: about decision trees and confidence. Two links: "Sign in" and "Create account". | Check `pnpm test:smoke https://vyntechs.dev` — if that passes the page is live; if it fails, check Vercel deploy logs. |
| 2 | Click "Create account" | `/sign-up` loads. Email + password fields, button "Create account". | If form doesn't render, the build is broken. |
| 3 | Fill: email = `your-test+{timestamp}@gmail.com`, password = anything 8+ chars. Submit. | Either redirects to `/today` (signed in) or shows an error inline (e.g., "Email already in use"). | If 500: check `/api/health` for `pingError`. |
| 4 | Land on `/today` | Heading "Today". Empty state ("No sessions yet" or similar). "New diagnosis" button visible. | If you land somewhere else, the post-signup redirect logic regressed. |
| 5 | Open dev tools → Network tab → search for "stripe" | A POST to `/api/auth/...` or webhook should have created a Stripe customer. Check Stripe Dashboard → Customers → look for your test email. | If no Stripe customer: Stripe ensure-customer hook silently failed. Check `lib/stripe.ts` and unit tests. |
| 6 | Click profile / sign-out option | Returns to a signed-out state. | If sign-out doesn't clear cookies, the auth cookie management is buggy. |
| 7 | Visit `/today` while signed out | Redirects to `/sign-in`. | If you can read `/today` as anon, the page-level auth gate is broken. |
| 8 | Visit `/curator/drift` while signed out | Redirects to `/sign-in`. | If 404, curator console isn't deployed. If 200 with content, the role gate is broken. |

**Cleanup:** Delete the test account from Supabase Auth dashboard (Authentication → Users) after the run, and delete the corresponding Stripe customer.

---

## Persona 2 — User (tech, daily)

You are a tech in the bay. Signed in as `brandon@vyntechs.com` (which has `role='owner'`, so passes both tech and curator gates). You want to diagnose a vehicle.

| # | Action | Expected | If broken |
|---|---|---|---|
| 1 | Sign in via `/sign-in`, lands on `/today` | "Today" header. Lists in-progress + closed-today sessions if any. | If h1 missing: AppHeader is rendered as `div`, not `h1` — known a11y issue. |
| 2 | Click "New diagnosis" | `/sessions/new` loads with intake form. | Form should accept VIN, year/make/model, complaint. |
| 3 | Fill the intake form with a real vehicle (or made-up fields) and submit | Redirects to `/sessions/{id}` with the AI's first question or step. | If hangs > 30s, check Anthropic API status + retry. |
| 4 | Read the AI's first response. Does it make domain sense? | The AI should ask a sensible diagnostic question or propose a low-risk first action. | **This is human judgment** — there is no automated test for "AI gave a good answer." Note any weird responses for the AI eval suite. |
| 5 | Reply with a short answer ("yes", "the noise is from the front", etc.) | The AI continues the conversation. | If the chat freezes, check the network tab for failed `/api/sessions/{id}/advance` requests. |
| 6 | When the AI proposes an action with a high risk class — does it gate? | If risk × confidence is below threshold, you should see a "Decline / Defer / Gather more" decision. | If high-risk actions just execute without gating, the gating system is broken (regression). |
| 7 | Capture an artifact (photo) if prompted | Should accept an image upload, show extraction status, then resume the chat. | If upload 500s, check `/api/sessions/{id}/capture` route + storage bucket policy. |
| 8 | Close the session via the outcome screen | Lands on `/today`, the closed session appears in "Closed today" list. | If the session stays "open", `closeSession` handler probably failed silently. |
| 9 | Open dev tools console during all of the above | No red errors. Yellow warnings (hydration, source maps) are fine. | Red errors = real bug. Note the message. |
| 10 | Check `/sessions` index | Closed session is visible there too, listed with vehicle + complaint. | If missing, `listSessionsForShop` is filtering it out. |

---

## Persona 3 — Owner / Curator (weekly review, Monday morning)

You are Brandon. The calibration cron ran on Monday 6am UTC. You sit down to triage the week.

| # | Action | Expected | If broken |
|---|---|---|---|
| 1 | Sign in, go to `/curator` | Redirects to `/curator/drift`. Sidebar visible with all 5 nav items. | If redirected to `/`, you don't have a curator-passing role. Run `SELECT role FROM profiles WHERE user_id = '<your-uuid>';` — should be `'owner'` or `'curator'`. |
| 2 | `/curator/drift` queue | Either rows of pending threshold-change recommendations, or "Queue empty." | If shows "Queue empty" when you expect rows: check `drift_alerts` table directly via Supabase, look for rows with `decision IS NULL`. |
| 3 | Click into a drift alert (if any) | Per-cell drill-down: shows the historical samples + comeback rate. | If 404: drift_alerts row was deleted between page loads. |
| 4 | Click "Apply" on one drift alert | Sets `confidence_calibration` to the new threshold for that (risk × vehicle × symptom) cell. Status updates to "applied." | If silently no-op, check `applyDriftAlert` handler and `decision IS NULL` filter. |
| 5 | Click "Dismiss" on a drift alert | Marks decision='dismissed'. | Same as above. |
| 6 | `/curator/calibration` dashboard | Heatmap or table of all (risk × vehicle × symptom) cells with their current thresholds. | If empty: `confidence_calibration` table is empty. Seed via spec §8.3 starting values. |
| 7 | Click a cell to drill down to per-category history | Shows the last 6 calibration recommendations for that cell. | If 404 with valid risk class: `parseRisk` rejection — check URL params. |
| 8 | `/curator/deferred` queue | Lists sessions techs deferred to you with vehicle + complaint. | If "No deferred cases" when you expect rows: check `sessions` table for status='deferred'. |
| 9 | `/curator/novel` queue | Lists novel-pattern alerts (sessions whose embedding score was below corpus threshold). | If always empty: novel-pattern trigger may not have fired — check `closeSession` handler wiring (Phase P Task 13 fix). |
| 10 | `/curator/corpus` list | Shows curator-authored corpus entries. | If empty: no entries authored yet. Click "+ New entry" to add one. |
| 11 | "+ New entry" form: fill vehicle + symptom + root cause + tree fragment, submit | Creates a `corpus_entries` row with `is_curator_entry=true`. | If POST 422: validation error — see the response body for which field. |
| 12 | Sign out, open private window, visit `/curator/drift` | Redirects to `/sign-in`. | If you see the page, the middleware role gate is broken. **Critical security issue.** |

---

## Persona 4 — Tester (pre-merge regression)

You are about to merge a PR. You want one minute of confidence.

| # | Action | Expected | Notes |
|---|---|---|---|
| 1 | `git pull && pnpm install` | Deps install clean. | If lockfile mismatch, regen with `pnpm install --no-frozen-lockfile`. |
| 2 | `pnpm test:all` | All 6 stages green: typecheck, unit, build, e2e, integration, audit. | ~5 minutes total. Fail-fast: any red stops the run. |
| 3 | `pnpm test:smoke` (against prod) | All checks green against `https://vyntechs.dev`. | Run this BEFORE merging — catches "is prod healthy right now?" If prod is broken, don't pile a merge on top. |
| 4 | After merge: wait for Vercel preview/prod deploy | Vercel UI shows READY. | If failed, check deploy logs. Roll back via Vercel UI if necessary. |
| 5 | `pnpm test:smoke https://<preview>.vercel.app` against the new deploy | All green. | If 500s on `/api/health`, the build picked up bad env or schema-out-of-sync. |
| 6 | Walk Persona 3 (curator weekly) on the new deploy | All 12 steps green. | If a screen stopped rendering, regression. Revert. |
| 7 | Optional: `pnpm test:perf` against the preview | LCP < 2500ms, CLS < 0.1, perf score >= 0.9. | Requires `pnpm add -D lighthouse chrome-launcher` first. Vercel Speed Insights also tracks this. |

---

## Stripe test cards (for billing flow)

When testing the billing/checkout path, use Stripe's test cards (Test mode only).

| Card number | Exp | CVC | Behavior |
|---|---|---|---|
| `4242 4242 4242 4242` | any future | any 3 digits | Successful charge (Visa) |
| `4000 0000 0000 0002` | any future | any 3 digits | Declined (generic) |
| `4000 0000 0000 9995` | any future | any 3 digits | Declined (insufficient funds) |
| `4000 0027 6000 3184` | any future | any 3 digits | Requires 3D Secure (authentication) |
| `5555 5555 5555 4444` | any future | any 3 digits | Successful charge (Mastercard) |

Full reference: https://docs.stripe.com/testing

For testing the webhook locally (`POST /api/stripe/webhook`):
```bash
stripe listen --forward-to http://localhost:3000/api/stripe/webhook
# In another terminal:
stripe trigger checkout.session.completed
```

---

## Reporting issues

When something fails on this checklist, capture:

1. **Which step** (persona + number).
2. **Expected vs actual** in one sentence each.
3. **Console errors** (if any) from dev tools.
4. **Network failures** (if any) from dev tools.
5. **What you typed / clicked** to trigger it.

Drop that into a GitHub issue with the label `qa-regression` and tag the most recent PR.
