# Session handoff — 2026-08-01

Written for a fresh agent with no memory of the session that produced this.
Git is the authority. Where this file and the repo disagree, believe the repo.

Working tree clean, everything below is pushed.

---

## What shipped to production today

Three pull requests merged to `main` and deployed to `https://vyntechs.dev`,
verified by re-measuring the running site — not by trusting a report.

- **#236 — the legal notice covered the submit button.** On a 390×844 phone
  the "Terms and Privacy update" notice was pinned to the bottom of the
  viewport and so was `.vt-form__footer`. Hit-testing measured the notice as
  the topmost element over **99% of both "Cancel" and "Create repair order"**.
  A phone user could not start a repair order without dismissing it first.
  The status region now publishes how much of the viewport bottom it occupies
  as `--vt-status-region-clearance`; the sticky footer and the workspace's
  bottom padding both consume it. New component
  `components/app-shell/status-region.tsx`.

- **#237 — plain words, and a real figure-ground.** A rename sweep across
  `components/screens/`, `components/vt/`, `app/`, and the marketing pages,
  plus a depth pass. The visual fault was one inverted relationship: cards
  were painted *darker* than the page, so nothing could read as raised no
  matter what shadow was applied. Cards now sit lighter on a slightly darker
  warm canvas. `counter-intake.tsx` → `write-up.tsx`. An orphaned
  `counter-work-order-confirm.tsx` was deleted; it had zero importers and
  three prior audits had flagged it as shipping a claim the product could not
  back.

- **#238 — sign-in could put a typed password in the address bar.** Before
  React hydrates, `/sign-in` was a plain HTML form with named `email` and
  `password` inputs and **no `method`**, so a press that outran hydration
  performed a native GET and serialised both fields into the URL — address
  bar, browser history, and the outgoing `Referer`. Reproduced against
  production. The form now declares `method="post"` and the submit button
  stays disabled until a mount effect runs. Only `/sign-in` was exposed;
  `reset-password` does not render its form until a client effect verifies the
  token, and `forgot-password` disables its button while its controlled email
  state is empty.

Verified with JavaScript disabled — exactly the pre-hydration document:

| | form method | submit | fields a GET would expose |
|---|---|---|---|
| production before | none → GET | enabled | email, password |
| production now | post | disabled | none |

---

## The open lane that matters: the hosted journeys are red

**This is the one thing genuinely unfinished.** #237 renamed a large number of
user-facing strings and its author reported the specs were updated in lockstep.
They were not, entirely. Unit tests pass on renamed strings; browsers do not.

```
node scripts/shop-os-golden-browser.mjs test --base-url https://vyntechs.dev
```

fails against production. The first stale label
(`New work order` → `New repair order`, three specs) is fixed on branch
`fix/e2e-stale-button-name` at `10015d4` — **pushed, no PR opened**. The run
then gets further and dies at `tests/e2e/golden-shop-day.spec.ts:141`:

```
waiting for getByRole('article', { name: /Ticket 1:/ })
          .getByRole('button', { name: 'Assign work' })
```

`Assign work` still exists in the source, so it is the board row `article`'s
accessible name that changed. A scan comparing every quoted locator in
`golden-shop-day.spec.ts` against current source found these strings no longer
present anywhere in `components/`, `app/`, or `lib/` — treat as leads, several
are composed at runtime or are role names rather than text:

```
Add labor line · Adding labor · Record phone approval? · Ring out · Scope source
Approved · V1 · Canceled · Written up · Closed · Written up · Open · Written up
Deferred · follow up · V1 · Work · Blocked · $120.00 · textbox
```

**The rule for finishing it:** update the spec to the shipped words, never
weaken an assertion to go green. No loosening an exact string to a regex, no
deleting a step, no relaxing a status-code check. If a journey fails because
the product actually broke, fix the product.

Three suites (`golden`, `post-diagnosis`, `vin-decode`) and two projects
(`golden-phone`, `golden-desktop`) all need to pass. **The runner stops at the
first failing project, so a green phone run does not mean desktop passes.**

**Start from PR #240** (`fix/e2e-plain-words-sweep`), titled "INCOMPLETE" on
purpose. An agent was mid-remap when the session ended and was told to push
what it had rather than finish. Its PR body carries the old→new string map
applied so far, the exact locator where the run currently fails, which suites
and projects are and are not proven, and — worth noting — **a real product
contrast defect it found and fixed** rather than a stale word. Read that body
before touching the specs; it supersedes the lead list above wherever the two
disagree.

Where #240 actually stands: the shop-day journey now walks sign-in → write-up →
assignment → the two-job quote → approve-one/decline-one → the tech's work →
the hold → cancel-and-reopen, and then stops at `golden-shop-day.spec.ts:371`
on **a real production defect, not a stale word**. The "Customer said no" stamp
renders at **4.34:1 contrast where WCAG AA requires 4.5:1**, and the axe gate
fails it. The branch fixes it in `app/globals.css`
(`--vt-status-declined` 56% → 54%, measured 4.74:1 on the band it sits on), so
**the journey cannot go green against production until that deploys.** Deploy
first, then re-run.

Still entirely unrun on that branch, and it says so plainly: `golden-desktop`,
both `post-diagnosis` projects, both `vin-decode` projects,
`node scripts/test-shards.mjs`, and the production build. The other two suites
were only scanned statically against source — paper, not a run. It also found
nine further missed `Ticket`-word strings and deliberately left them; they are
listed in the PR body. The QA tenant was left verified clean.

---

## PR #239 — the demo shop, open and mergeable, not merged

A full day of work now exists in the product: **16 repair orders, 5 people,
built entirely through the real domain code** rather than hand-inserted rows,
so it cannot show a state the product could not itself reach.

- `scripts/seed-demo-shop.mjs` + `scripts/demo-shop-day.ts` — re-runnable,
  idempotent, **local only**; refuses non-local URLs and the shared `postgres`
  database, and has no `--production` door.
- **85 captures** at 390×844 and 1440×900 for every role, in
  `.design-shots/demo-shop/` with its own `README.md`. Note: **this repo is
  public**, so those images are world-readable on GitHub. They contain
  invented data only. If that is unwanted, delete the directory — nothing
  depends on it.
- `main` has been merged into this branch and the conflicts resolved: kept the
  shipped #238 sign-in fix, kept the branch's `reset-password` hardening,
  unioned `tasks/lessons.md`. Typecheck clean; sign-in and status-region tests
  green (18/18).

**Local development works** — worth knowing, because it was previously believed
to be a dead end. The repo's *default* local database is a different project's
Supabase and is 13 migrations behind. Build a fresh database and apply the
migration folder from empty instead; the demo lane did exactly that and reached
`recorded: 51 · pending: 0`.

### What the full shop exposed — the real value of #239

An empty board was hiding all of these. Ranked by how much they hurt:

1. **A declined job sits in a technician's *Available* lane with a "Claim job"
   button next to the words CUSTOMER SAID NO.** #231 fixed `workAvailable` for
   one lane; this is another.
2. **`approvalState === 'sent'` is read in four places and written in none** —
   the wall's "Waiting on customer" lane is structurally dead and can never
   fill.
3. **No elapsed time anywhere.** A vehicle silent for 3 days and one written up
   42 minutes ago look identical. This matters more than it sounds: the design
   premise is that this shop has no due dates, and the two clocks meant to
   replace them — time since the customer last heard anything, and time since
   the job last learned something — exist on no screen.
4. "Record approval" mounts the entire quote builder; the yes/no buttons sit
   below it.
5. The legal notice still owns the pixel under "Prepare quote" at 390×844 —
   hit-tested. **#236 did not cover this case.** Verify before assuming.
6. The repair-order screen prints the customer's name three times before
   showing a job.
7. Phone board density; quote-screen jargon; a partial-approval total nobody
   owes; "Take payment" with no amount; a broken header logo; overlapping
   Save/Deactivate in Team; "Intake" surviving in vehicle history; and no way
   to hand the customer anything.

**Could not be seeded, which is itself the finding:** a waiter and a comeback
have no representation in the product; `addTicketJob` has no route; the
write-up screen cannot request a specific skill tier; `/intake` 404s when its
flag is off while the board links to it unconditionally.

Full detail: `docs/strategy/2026-08-01-polish-lane-routed-defects.md`.

---

## The owner, and how to work with him

He is non-technical and directs agents. He does not read code — **screenshots
and real test output are his eyes.** Lead every reply with three lines: what
happened, what matters, what you need from him. Detail goes below that, or in
a file.

Standing rules he has stated, each of which cost real friction to learn:

- **Defects are yours.** Fix, prove, ship. Never hand him a captured bug — that
  makes him the queue.
- **Plain words only.** Every user-facing word must mean on screen what it
  means on a shop floor. A word that has to be taught has already failed. His
  readers are skilled professionals — not engineers, and not language people.
- **Don't invent his shop.** No counter, no numbered bays, no due dates, no
  appointments. If he did not say the word, it does not go on a screen.
- **Go look before you theorize.** Sign in and photograph the live product;
  report measured pixels, not what the source implies.

His shop: five people. The **owner/manager is the front of house** and handles
customers personally — they know him by name. The **lead tech** is the only
person who does hard diagnosis; "I'm stuck" routes to him. **Two other
technicians** take the obvious and visual work. **One parts/errand person** is
the supply line between the techs and the owner and does not deal with
customers. The product's `advisor` role is unused in this shop. **No
appointments.** **Waiters are under 1% of cars** — handle the case, never
feature it. The specialty is **problem children** bounced between shops, which
is exactly why promise dates would be dishonest.

---

## Environment gotchas that will otherwise waste your time

- **`pnpm` is not on PATH.** `scripts/test-shards.mjs` was fixed to run the
  installed Vitest directly and now fails loudly on a spawn error. If an older
  copy prints `0 tests passed across 8 shards / FAILED shards: 1..8`, that
  means **nothing ran** — not that everything failed.
- **`git rebase` needs `-c core.checkStat=minimal`** on this volume; plain git
  falsely reports local changes against a clean tree. The same applies to
  `checkout`, `add`, and `commit` inside the worktrees here.
- **Playwright's bundled chromium-1217 is broken** (missing framework). Launch
  with `channel: 'chrome'` against installed Google Chrome.
- **Full-page screenshots lie about `position: fixed` elements** — they stitch
  into the middle of the image. Re-verify any visual defect in a real viewport
  with hit-testing before reporting it. That mistake produced one wrong bug
  report today.
- Production browser proof runs through `scripts/shop-os-golden-browser.mjs`
  with the fixed QA tenant and Keychain credentials. Never touch real shop
  data.

## Verification receipts from this session

```
node scripts/test-shards.mjs        3787 tests passed across 8 shards, exit 0
npx tsc --noEmit                    exit 0
CI on #236 / #237 / #238            8/8 shards + verify green on each
production deploy                   success, re-measured live
hosted golden journeys              RED — see the open lane above
```
