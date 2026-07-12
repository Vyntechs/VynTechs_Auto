# Backlog intake — 2026-07-11 (three founder requests)

Captured in an isolated intake lane (fresh clone of `origin/main`; no shared checkout touched) so the Shop OS control lane (row 23) is not interrupted. Each request = one brief + one evidence annex. Nothing here changes shipped code; every lane carries its own Brandon gate. `tasks/todo.md` is gitignored by repo policy (`.gitignore:86` — root task files retired), so this doc is the index.

| # | Request | Brief | Evidence | Gate before any build |
|---|---|---|---|---|
| 1 | Never tax labor wrongly (quote/invoice tax rule) | `2026-07-11-brief-labor-tax-rule.md` | `2026-07-11-annex-labor-tax-research.md` | Brandon picks the tax model |
| 2 | Every word reduces friction (terminology + customer story) | `2026-07-11-brief-plain-language-terminology.md` | `2026-07-11-annex-terminology-audit.md` + proposed standard `2026-07-11-plain-language-and-trust-copy-standard.md` | Brandon approves the standard |
| 3 | Landing page 100% remodel (Figma-first) | `2026-07-11-brief-landing-remodel.md` | `2026-07-11-annex-landing-current-state.md` + scope `2026-07-11-landing-remodel-scope.md` + brand personality `2026-07-11-vyntechs-personality.md` | Brandon approves scope + personality, then the Figma prototype (v2 live in the file; v1 superseded after his red-line) |

**One thing the control lane should read before shipping more quote math:** the tax brief. Verified on `main`: every quote line — labor included — defaults `taxable: true` and the math ignores line kind. Research says ~18–20 states do tax repair labor and ~30 don't, so the default is wrong for most shops and right for some; the fix is per-kind, per-shop configuration, not a constant. Details + state matrix in the annex.

**Cross-lane decisions surfaced for Brandon (owner gates, not engineering calls):**
1. **Brand:** live site + app say **Vyntechs**; "PlainWrench" exists only in the `influence` exploration repo as a *different, unbuilt* product. Which name does the remodeled landing page carry?
2. **Pricing story:** marketing + ToS sell **$100/technician-seat**; README + customer-interaction doctrine describe **per-shop** licensing. The landing remodel and the terms page need one truth.
3. **Tax model:** minimal per-shop labor-tax toggle now vs state-aware defaults (needs a shop-state field — none exists today).
