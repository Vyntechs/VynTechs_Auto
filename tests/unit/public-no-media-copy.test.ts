import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isDiagnosticsGatedRoute, isPaywallExempt } from '@/lib/auth-access'

const root = process.cwd()
const read = (relative: string) => readFile(path.join(root, relative), 'utf8')

const expectedHomeSections = [
  'nav',
  'hero',
  'strip',
  'why',
  'ladder',
  'gate',
  'pricing',
  'compare',
  'faq',
  'final-cta',
  'footer',
]

const retiredScreenshots = [
  'hero.png',
  'laptop-hero.png',
  'motion-01-open.png',
  'motion-02-research.png',
  'motion-03-propose.png',
  'motion-04-confirm.png',
  'motion-05-lock.png',
]

async function exists(relative: string): Promise<boolean> {
  return access(path.join(root, relative)).then(() => true, () => false)
}

async function appAndComponentSources(): Promise<string> {
  const roots = ['app', 'components']
  const files: string[] = []
  async function walk(relative: string) {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(child)
    }
  }
  for (const relative of roots) await walk(relative)
  return (await Promise.all(files.map(read))).join('\n')
}

describe('public current-release truth', () => {
  it('scans the complete landing composition and bans retired product promises', async () => {
    const page = await read('app/page.tsx')
    const imports = [...page.matchAll(/@\/components\/marketing\/([^'\"]+)/g)]
      .map((match) => match[1])
      .filter((name) => name !== 'marketing.css')
      .sort()
    expect(imports).toEqual([...expectedHomeSections].sort())

    const publicSources = await Promise.all([
      read('app/layout.tsx'),
      read('app/manifest.ts'),
      read('app/page.tsx'),
      read('app/(auth)/sign-in/page.tsx'),
      read('components/screens/subscribe-client.tsx'),
      ...expectedHomeSections.map((name) => read(`components/marketing/${name}.tsx`)),
      read('components/marketing/hero-terminal.tsx'),
      read('components/marketing/screenshots.config.ts'),
      read('components/marketing/reel.tsx'),
      read('app/privacy/page.tsx'),
      read('app/terms/page.tsx'),
    ])
    const copy = publicSources.join('\n')

    const banned = [
      'Files you upload',
      'stores the files you upload',
      'uploaded file contents',
      'snap a photo of the screen',
      'Direct capture’s on the list',
      'AI-led diagnostic assistant',
      'AI master tech for the bay',
      'Unlimited diagnostic sessions',
      'The full diagnostic',
      'A diagnostic for working technicians',
      'Knows how the system works',
      'confidence line',
      'questions max before it defers',
      'Session log',
      'your sessions',
      'back to diagnosing',
      'Every closed case sharpens it',
    ]
    for (const phrase of banned) expect(copy).not.toContain(phrase)

    for (const truth of [
      'work orders',
      'assignments',
      'quotes',
      'status',
      'manual findings',
      'text work notes',
    ]) expect(copy.toLowerCase()).toContain(truth)
    expect(copy).toContain('Operational file intake is unavailable in this release.')
    expect(copy).toContain('The diagnostic engine is unavailable in this release.')
  })

  it('removes the public design fixture and retired diagnostic screenshots without touching shell assets', async () => {
    expect(await exists('app/design/page.tsx')).toBe(false)
    expect(isPaywallExempt('/design')).toBe(false)
    expect(isDiagnosticsGatedRoute('/design')).toBe(false)
    for (const file of retiredScreenshots) {
      expect(await exists(`public/marketing/screenshots/${file}`)).toBe(false)
    }
    const source = await appAndComponentSources()
    for (const file of retiredScreenshots) expect(source).not.toContain(`/marketing/screenshots/${file}`)
    expect(await exists('public/brand/lockup.png')).toBe(true)
    expect(await exists('public/icons/icon-192.png')).toBe(true)
  })

  it('publishes accurate interim privacy and paid-service terms for the pre-purge state', async () => {
    const privacy = await read('app/privacy/page.tsx')
    const terms = await read('app/terms/page.tsx')

    expect(privacy).toContain('Revised July 15, 2026')
    expect(privacy).toContain('Effective when published with in-app notice')
    expect(terms).toContain('Revised July 15, 2026')
    expect(terms).toContain('Effective for new acceptances when published; for existing subscribers 30 days after the in-app notice.')
    expect(privacy).toContain('New operational uploads are unavailable.')
    expect(privacy).toContain('Historical uploaded submissions or related metadata may remain until the separately authorized production purge is verified.')
    expect(privacy).toContain('We do not claim deletion from provider temporary systems or infrastructure backups.')
    expect(privacy).toContain('Anthropic receives selected technician observation text only when an authorized user requests AI-assisted evidence selection for a customer-story draft.')
    expect(privacy).toContain('We show this notice in the app the first time a signed-in browser sees this version.')
    expect(privacy).not.toMatch(/all media (?:is|has been) deleted|no historical uploads remain|backups.*purged/i)
    expect(terms).toContain('paid ShopOS service')
    expect(terms).toContain('work orders, assignments, quotes, status, manual findings, and text work notes')
    expect(terms).toContain('Technicians and shops remain responsible')
    expect(terms).toContain('Existing subscribers keep their prior Terms until 30 days after this version is first shown in the signed-in app.')
  })
})
