# Topology Guidance — Brainstorm Mockups

Disposable, throwaway HTML mockups for the guided diagnostic walk on the interactive topology. **Not production code.** These exist so the design conversation has something concrete to point at before the spec is finalized.

## How to view

From the repo root:

```
cd mockups/topology-guidance
python3 -m http.server 8765
```

Then open <http://localhost:8765>.

## What's here (round 1)

- `index.html` — landing page with links into the scenarios
- `mid-walk.html` — desktop scenario at 1280px+, the design-deciding screen
- `mid-walk-mobile.html` — same scenario in a 390px iPhone frame with a bottom-sheet active panel
- `styles.css` — design tokens mirrored from `app/globals.css` so the mockup feels native

Other scenarios (walk start, branch transition, fail terminal, all-passes ending, reload-resume) are stubs that light up after round 1 sign-off.

## Real data

Pulled from the live Supabase project (`ynmtszuybeenjbigxdyl`) for the 2017 F-350 / P0087 cache-hit: 10 implicated components, real `branch_logic.condition` strings, real `nextAction` text. Mock data is honest mock data.

## When this goes away

Once the design is locked into `docs/superpowers/specs/2026-05-22-topology-guided-walk-design.md` and the real React implementation ships, this directory gets deleted in a cleanup PR.
