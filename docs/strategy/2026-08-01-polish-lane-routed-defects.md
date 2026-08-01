# Found by the polish lane, not fixed by it

## 1. `--vt-fg-1` is referenced eighteen times and defined nowhere — OPEN

`--vt-fg-1` appears in `components/screens/ring-out-section.module.css`,
`components/screens/ticket-detail.module.css`, `components/vt/vt.css`,
`components/screens/closed-case-summary.tsx` and
`components/vt/desktop/viewport-gate.tsx`. It is defined in no stylesheet and in
no inline style. `app/globals.css` declares `--vt-fg`, `--vt-fg-2` and
`--vt-fg-3`, and never `--vt-fg-1`.

Seventeen of the eighteen uses are `color:`. An unresolvable `var()` on `color`
makes the declaration invalid at computed-value time, so the element inherits its
parent's colour — usually the ink it wanted anyway. That is why nobody has ever
noticed.

The eighteenth was a `background`. `.closeButton` in
`components/screens/ring-out-section.module.css` set
`background: var(--vt-fg-1)` with `color: var(--vt-bone-50)`, so the fill
resolved to nothing and a bone label sat on the bone page. Measured with axe at
**1.08:1** against a required 4.5:1 — the advisor's "Mark paid and close" was
effectively invisible. **That one is fixed** in the polish lane's depth commit,
which points the button at the real accent tokens.

**The other seventeen are still unintentional.** They should either get a real
token in `app/globals.css` or be repointed at `--vt-fg`. Repointing is the
smaller change but it is not a no-op: any of the seventeen that currently inherit
a colour *other* than `--vt-fg` will visibly change, so each needs a look. That
is why the polish lane fixed only the one that was actually broken.

No migration, no schema change, no owner gate. Perhaps an hour, mostly looking at
seventeen renders.

## 2. The legal notice covering the submit button — FIXED ELSEWHERE

Recorded here only so the trail is complete and nobody re-opens it.

At 390×844 on `/intake`, the fixed status region carrying the legal update notice
sat in the same place as `.vt-form__footer`, which is `position: sticky;
bottom: 0`. Hit-testing at the bottom of the page put the notice on top of 99% of
both `Cancel` and `Create repair order`.

Fixed on branch `fix/notice-covers-submit` (PR #236), which publishes the
region's occupied height as `--vt-status-region-clearance` and has the sticky
footer and the workspace padding consume it. The polish lane is rebased on that
branch and did not touch those files.

**A correction worth keeping:** the first report of this defect described it as
the notice overlapping the VEHICLE section and covering the VIN and `Decode VIN`
controls. That was an artifact of a full-page screenshot — a `position: fixed`
element is composited into the middle of a stitched full-page capture. The real
fault was at the bottom of the page and was worse. Re-check a fixed-position
defect in a real viewport with hit-testing before describing where it is.

## 3. Anything the depth pass pins to the viewport must clear the region

The polish lane added no new fixed-position element, so nothing in it needs the
offset today. If a later visual change pins something to the bottom of the
viewport, it has to subtract `--vt-status-region-clearance` the same way
`.vt-form__footer` now does, or it will land under the notice.
