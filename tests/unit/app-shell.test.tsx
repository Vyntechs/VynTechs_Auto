import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdaptiveWorkbench } from '@/components/app-shell/adaptive-workbench'
import { ShopOsShell } from '@/components/app-shell/shop-os-shell'

vi.mock('@/components/app-shell/connection-status', () => ({
  ConnectionStatus: () => <p>Connection status control</p>,
}))

vi.mock('@/components/app-shell/pwa-update-status', () => ({
  PwaUpdateStatus: () => <p>Application update control</p>,
}))

const appShellDir = resolve(process.cwd(), 'components/app-shell')

describe('ShopOsShell', () => {
  it('keeps one accessible workspace target and one separate status region', () => {
    render(
      <ShopOsShell>
        <main>Current repair work</main>
      </ShopOsShell>,
    )

    expect(screen.getByRole('link', { name: 'Skip to current work' })).toHaveAttribute(
      'href',
      '#shop-os-workspace',
    )

    const workspace = document.querySelector('#shop-os-workspace')
    expect(workspace).toBeInTheDocument()
    expect(workspace).toHaveAttribute('tabindex', '-1')
    expect(within(workspace as HTMLElement).getByRole('main')).toHaveTextContent(
      'Current repair work',
    )

    const status = screen.getByRole('region', { name: 'Application status' })
    expect(status).not.toBe(workspace)
    expect(within(status).getByText('Connection status control')).toBeInTheDocument()
    expect(within(status).getByText('Application update control')).toBeInTheDocument()
    expect(document.querySelectorAll('#shop-os-workspace')).toHaveLength(1)
    expect(document.querySelector('[role="application"]')).not.toBeInTheDocument()
  })
})

describe('AdaptiveWorkbench', () => {
  it('always renders the labelled main region without empty optional rails', () => {
    const { container } = render(
      <AdaptiveWorkbench main={<p>Repair order</p>} mainLabel="Current repair order" />,
    )

    expect(screen.getByRole('region', { name: 'Current repair order' })).toHaveTextContent(
      'Repair order',
    )
    expect(container.querySelector('[data-workbench-region="navigation"]')).toBeNull()
    expect(container.querySelector('[data-workbench-region="queue"]')).toBeNull()
    expect(container.querySelector('[data-workbench-region="context"]')).toBeNull()
  })

  it('renders and labels only the optional regions that callers supply', () => {
    const { container } = render(
      <AdaptiveWorkbench
        navigation={<p>Shop navigation</p>}
        queue={<p>Three waiting jobs</p>}
        main={<p>Brake inspection</p>}
        context={<p>Vehicle context</p>}
        queueLabel="Work queue"
        mainLabel="Current repair order"
        contextLabel="Repair context"
      />,
    )

    expect(container.querySelector('[data-workbench-region="navigation"]')).toHaveTextContent(
      'Shop navigation',
    )
    expect(screen.getByRole('region', { name: 'Work queue' })).toHaveTextContent(
      'Three waiting jobs',
    )
    expect(screen.getByRole('region', { name: 'Current repair order' })).toHaveTextContent(
      'Brake inspection',
    )
    expect(screen.getByRole('region', { name: 'Repair context' })).toHaveTextContent(
      'Vehicle context',
    )
  })

  it('uses the approved adaptive, accessible shell contract without device detection', () => {
    const css = readFileSync(resolve(appShellDir, 'app-shell.module.css'), 'utf8')
    const source = [
      readFileSync(resolve(appShellDir, 'shop-os-shell.tsx'), 'utf8'),
      readFileSync(resolve(appShellDir, 'adaptive-workbench.tsx'), 'utf8'),
    ].join('\n')

    expect(css).toMatch(/container-type:\s*inline-size/)
    expect(css).toMatch(/840px/)
    expect(css).toMatch(/1280px/)
    expect(css).toMatch(/1680px/)
    expect(css).toMatch(/100dvh/)
    expect(css).toMatch(/env\(safe-area-inset-bottom\)/)
    expect(css).toMatch(/:focus-visible/)
    expect(css).toMatch(/outline:\s*(?!none)/)
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/)
    expect(css).toMatch(/min-(?:block-)?size:\s*44px/)
    expect(source).not.toMatch(/window\.innerWidth|navigator\.userAgent/i)
    expect(source).not.toMatch(/\b(phone|tablet|laptop|desktop|mobile)\b/i)
  })

  it('mounts the shell inside the existing signed-in header provider', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/(app)/layout.tsx'), 'utf8')

    expect(source).toMatch(/<AppHeaderProvider[\s\S]*<ShopOsShell>\{children\}<\/ShopOsShell>[\s\S]*<\/AppHeaderProvider>/)
    expect(source).toContain("import { ShopOsShell } from '@/components/app-shell/shop-os-shell'")
    expect(source).not.toMatch(/minHeight:\s*['"]100vh['"]/)
  })
})
