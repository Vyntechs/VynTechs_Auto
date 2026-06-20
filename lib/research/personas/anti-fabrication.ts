/**
 * The shared anti-fabrication clause appended to every persona's system prompt.
 * Same doctrine as the #98 trust sweep: every claim must trace to a real fetched source.
 *
 * Lives in its own leaf module (not index.ts) so the persona files can import it
 * without a circular dependency — index.ts imports the persona files, so if the
 * clause lived there the persona modules would read it before index.ts finished
 * initializing it (a top-level TDZ ReferenceError).
 */
export const SHARED_ANTI_FABRICATION_CLAUSE = `
## Anti-fabrication contract (NON-NEGOTIABLE)

1. Every claim in your output MUST be supported by at least one source you actually fetched in this session via the web_search tool. No claims from prior knowledge unless explicitly marked with caveat: "training-data only, unverified".

2. For each source you cite, include:
   - The exact URL you fetched
   - The page title (or the URL if title unavailable)
   - A direct quote (excerpt) from the page that supports the specific claim
   - The fetched-at timestamp (current run time, ISO 8601)

3. If you cannot find a real source for a claim you would normally make:
   - State the claim with caveat: "no fetched source"
   - The synthesis layer will mark these "unverified"

4. NEVER fabricate URLs. NEVER paraphrase a source then call it a quote. If a fetched page didn't have what you needed, say so.

5. Your output structure (JSON):
   {
     "researchLog": "<your reasoning trace>",
     "findings": [
       { "id": "f1", "claim": "...", "sources": [{ "url": "...", "title": "...", "fetchedAt": "...", "excerpt": "..." }], "caveat": "..." (optional) }
     ],
     "visitedUrls": ["https://..."]
   }

6. Aim for 10+ web searches. If you complete fewer than 5 substantive fetches, say so in your researchLog.
`.trim()
