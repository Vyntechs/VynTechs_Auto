// Known-slug catalog — the canonical platform/symptom vocabulary the curator
// can author against. This is where referential integrity lives now that the
// slug decision removed the FK to platforms(id)/symptoms(id). The picker
// (PR-N2 /curator/flows/new) and the publish gate (validateFlowForPublish)
// both read from here, so a flow can NEVER be published against a slug that
// is not real. The slugs match the N1 resolver output exactly:
//   - resolvePlatformSlug() (lib/diagnostics/resolve-platform.ts)
//   - COMPLAINT_PATTERNS slugs (lib/diagnostics/symptom-resolver.ts)
// When the resolvers gain a new platform/symptom, add the matching entry here
// (the slug-catalog.test.ts coverage check enforces this for platforms).

export type SlugChoice = { slug: string; display: string }

const PLATFORM_CHOICES: readonly SlugChoice[] = [
  { slug: 'ford-super-duty-3rd-gen-60-psd', display: '2003–2007 Ford Super Duty (6.0L PSD)' },
  { slug: 'ford-super-duty-3rd-gen-67-psd', display: '2011–2016 Ford Super Duty (6.7L PSD)' },
  { slug: 'ford-super-duty-4th-gen-67-psd', display: '2017–2022 Ford Super Duty (6.7L PSD)' },
] as const

const SYMPTOM_CHOICES: readonly SlugChoice[] = [
  { slug: 'cranks-no-start', display: 'Cranks, no start' },
  {
    slug: 'no-start-cranks-normally-fuel-system-suspect',
    display: 'No start, cranks normally — fuel system suspect',
  },
  {
    slug: 'reduced-power-limp-mode-emissions-suspect',
    display: 'Reduced power / limp mode — emissions (DEF/SCR) suspect',
  },
] as const

const PLATFORM_SLUGS = new Set(PLATFORM_CHOICES.map((c) => c.slug))
const SYMPTOM_SLUGS = new Set(SYMPTOM_CHOICES.map((c) => c.slug))

export function isKnownPlatformSlug(slug: string | null | undefined): boolean {
  return !!slug && PLATFORM_SLUGS.has(slug)
}

export function isKnownSymptomSlug(slug: string | null | undefined): boolean {
  return !!slug && SYMPTOM_SLUGS.has(slug)
}

export function listPlatformChoices(): SlugChoice[] {
  return [...PLATFORM_CHOICES]
}

export function listSymptomChoices(): SlugChoice[] {
  return [...SYMPTOM_CHOICES]
}

export function platformDisplayName(slug: string): string {
  return PLATFORM_CHOICES.find((c) => c.slug === slug)?.display ?? slug
}

export function symptomDisplayName(slug: string): string {
  return SYMPTOM_CHOICES.find((c) => c.slug === slug)?.display ?? slug
}
