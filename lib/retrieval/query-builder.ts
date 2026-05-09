import type { RetrievalContext } from './types'

/**
 * Builds a tight, keyword-rich search query from a RetrievalContext.
 *
 * Why this exists: techs write complaints in natural language ("Customer states,
 * when driving down the highway, light throttle, the truck shakes and vibrates
 * at tip in / light throttle maintaining speed"). Throwing that whole sentence
 * at a web-search API matches the noise more than the signal — articles about
 * "TCC shudder" or "transmission shudder" don't surface against a query laden
 * with conversational filler.
 *
 * The builder strips stopwords + conversational filler and keeps:
 * - vehicle metadata (year, make, model, engine)
 * - DTC codes verbatim
 * - symptom-bearing words from the complaint and current observation
 *
 * Validated 2026-05-09 against session 9f7b004c (2015 F-150 6R80 TCC shudder),
 * where the prior whole-sentence query returned 0 web-search results.
 */
const STOP_WORDS = new Set([
  // Articles, conjunctions, prepositions
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'this', 'that', 'these', 'those', 'and', 'or', 'but', 'so', 'because',
  'when', 'while', 'where', 'why', 'how', 'what', 'which', 'who', 'whom',
  'in', 'on', 'at', 'to', 'from', 'with', 'by', 'for', 'of', 'as',
  'into', 'onto', 'upon', 'about', 'under', 'over', 'between', 'among',
  // Pronouns + determiners
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'them', 'their', 'his',
  'her', 'my', 'your', 'me', 'us', 'him', 'someone', 'something',
  'anyone', 'anything', 'everything', 'nothing',
  // Common verbs that don't disambiguate symptoms
  'feels', 'feel', 'felt', 'seems', 'seem', 'seemed',
  'going', 'getting', 'making', 'doing', 'looks', 'looking',
  'come', 'comes', 'came', 'go', 'goes', 'went', 'gone',
  // Conversational filler / report framing
  'customer', 'states', 'said', 'says', 'saying',
  'note', 'notes', 'noted', 'tells', 'told',
  'sometimes', 'always', 'often', 'usually', 'occasionally', 'rarely',
  'maybe', 'perhaps', 'might', 'could', 'just', 'really', 'very',
  'quite', 'pretty', 'actually', 'basically',
  'like', 'such', 'around', 'near', 'close',
  // Vehicle words (already in metadata)
  'truck', 'car', 'vehicle', 'auto', 'automobile',
  // Counting / time
  'first', 'second', 'third', 'last', 'next', 'previous',
  'time', 'times', 'morning', 'afternoon', 'evening', 'night',
  'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
  'minute', 'minutes', 'hour', 'hours',
  // Comparison
  'more', 'less', 'most', 'least', 'better', 'worse', 'best', 'worst',
  // Generic adverbs
  'then', 'now', 'still', 'already', 'yet', 'also', 'too', 'either',
  'though', 'although', 'whether', 'unless',
])

const MAX_QUERY_LEN = 200

export function buildSearchQuery(ctx: RetrievalContext): string {
  const parts: string[] = []

  parts.push(String(ctx.vehicleYear), ctx.vehicleMake, ctx.vehicleModel)
  if (ctx.vehicleEngine) parts.push(ctx.vehicleEngine)
  if (ctx.dtcs?.length) parts.push(...ctx.dtcs)

  const complaintTerms = extractSymptomTerms(ctx.complaintText)
  parts.push(...complaintTerms)

  if (ctx.observation) {
    const obsTerms = extractSymptomTerms(ctx.observation)
    parts.push(...obsTerms)
  }

  // Dedupe on lowercase form, preserve first-occurrence original case + order.
  const seen = new Set<string>()
  const unique = parts.filter((t) => {
    const lower = t.toLowerCase()
    if (seen.has(lower)) return false
    seen.add(lower)
    return true
  })

  const query = unique.join(' ').replace(/\s+/g, ' ').trim()
  return query.length > MAX_QUERY_LEN ? query.slice(0, MAX_QUERY_LEN).trim() : query
}

function extractSymptomTerms(text: string): string[] {
  return text
    .toLowerCase()
    // Replace anything that isn't word-character, whitespace, or hyphen with a space.
    // Preserves DTCs (P0299), part-number-like tokens (5W30), and hyphenated terms (tip-in).
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .filter((w) => !STOP_WORDS.has(w))
    // Drop pure-digit tokens (mileage, "5%", "3000 RPM" → keep "rpm" but drop "3000").
    .filter((w) => !/^\d+$/.test(w))
}
