# Current-production dependency audit closure

**Branch:** `security/ai-pii-penetration-audit-2026-07-19`  
**Reviewed production deployment:** `5b9fb0505a1f505eb8de8b0129b607e3d618ce4e`  
**Status:** The current lockfile is free of known production dependency advisories.

## Finding

A fresh `pnpm audit --prod` found two transitive advisories after the source fixes were complete:

- High: `ws` before `8.21.0` can exhaust memory from small WebSocket fragments and chunks (`CVE-2026-48779`, `GHSA-96hv-2xvq-fx4p`). The lockfile resolved `8.20.0` through Supabase Realtime and the test environment.
- Moderate: `postcss` before `8.5.10` can emit unescaped `</style>` text (`GHSA-qx2v-qp2m-jg93`). Next.js resolved `8.4.31`.

Primary references: [GitHub's reviewed `ws` advisory](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) and the [`ws` 8.21.1 release](https://github.com/websockets/ws/releases/tag/8.21.1).

## Closure

The root pnpm workspace now pins the patched transitive floors without changing the application-facing Supabase, Next.js, or test APIs:

- `ws` → `8.21.1`
- `postcss` → `8.5.16`

The lockfile resolves one patched copy of each package. No install script was newly approved or executed.

## Verification

- `pnpm why ws`: one copy, `8.21.1`.
- `pnpm why postcss`: one copy, `8.5.16`.
- `pnpm audit --prod`: **No known vulnerabilities found**.
- `pnpm build`: passed on Next.js `16.2.10`; 64 pages generated.
- Full bounded test-suite shards remain part of the final branch proof.
