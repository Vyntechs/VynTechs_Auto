# Log Observation Button — Loading Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Claude design's three-state narrating Log Observation button to the live `active-step-form.tsx`, faithful 1:1, with new `LogButton` primitive and minimal form-side state-machine integration.

**Architecture:** New presentational `<LogButton>` component (`components/vt/log-button.tsx`) + companion CSS (`components/vt/log-button.css`) ported verbatim from `/Volumes/Creativity/dev/projects/vyntechs/log-observation-loading/`. Form (`active-step-form.tsx`) owns I/O and a small `useTransition`+`phase` state machine that drives the button's `state` prop and holds the `done` face for 700ms before calling `router.refresh()`.

**Tech Stack:** React 19, Next.js 16 App Router, TypeScript, Vitest + @testing-library/react + happy-dom, CSS via design tokens in `app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-05-10-log-button-loading-animation-design.md`

**Source design (read-only reference, NOT to be edited):** `/Volumes/Creativity/dev/projects/vyntechs/log-observation-loading/log-button.jsx` and `log-button.css`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `components/vt/log-button.tsx` | CREATE | Presentational button primitive — three states, three variants, stage cycler. No I/O. |
| `components/vt/log-button.css` | CREATE | Verbatim CSS port of design's `log-button.css`. Imported via `app/globals.css`. |
| `app/globals.css` | MODIFY | (a) Add `--vt-amber-200/300/400/500` tokens. (b) Add `@import` for `log-button.css` (or move definitions inline if globals.css is the canonical place — see Task 2). |
| `components/screens/active-step-form.tsx` | MODIFY | Replace inline `<button class="btn btn-primary">` with `<LogButton>`. Add `phase` state and 700ms done-state hold before `router.refresh()`. |
| `tests/unit/log-button.test.tsx` | CREATE | Unit tests for `LogButton`: idle/loading/done rendering, stage cycling, freezeStage pin, disabled prop. |
| `tests/unit/active-step-form.test.tsx` | CREATE (or MODIFY if already exists) | Integration test: submit → loading → done state held → refresh fires. |

---

## Phase A — Setup

### Task A1: Set up worktree and verify baseline

**Files:** None (workspace operation)

- [ ] **Step 1: Create worktree on Loading-animation branch**

```bash
git worktree add .worktrees/loading-animation Loading-animation
```

Expected: New worktree at `.worktrees/loading-animation/` checked out to the existing `Loading-animation` branch (no commits ahead of `main`).

- [ ] **Step 2: Move into worktree**

```bash
cd .worktrees/loading-animation
```

- [ ] **Step 3: Install dependencies (if needed)**

```bash
pnpm install
```

Expected: Lockfile in sync. If install isn't needed (worktree shares node_modules via pnpm symlinks), this is a no-op.

- [ ] **Step 4: Confirm baseline tests pass**

```bash
pnpm test
```

Expected: All existing tests pass (or whatever the baseline is — note any pre-existing failures so we can distinguish them from regressions later).

- [ ] **Step 5: Confirm baseline typecheck passes**

```bash
pnpm exec tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 6: Bring spec doc into this branch**

Copy the spec file from the parent worktree (it was authored on the brainstorming session's branch and not yet committed to `Loading-animation`):

```bash
cp ../../docs/superpowers/specs/2026-05-10-log-button-loading-animation-design.md docs/superpowers/specs/2026-05-10-log-button-loading-animation-design.md
mkdir -p docs/superpowers/plans
cp ../../docs/superpowers/plans/2026-05-10-log-button-loading-animation.md docs/superpowers/plans/2026-05-10-log-button-loading-animation.md
```

- [ ] **Step 7: Commit setup**

```bash
git add docs/superpowers/specs/2026-05-10-log-button-loading-animation-design.md docs/superpowers/plans/2026-05-10-log-button-loading-animation.md
git commit -m "docs(loading-animation): add spec and plan"
```

---

## Phase B — Design tokens

### Task B1: Add amber color tokens to globals.css

**Files:** Modify `app/globals.css`

- [ ] **Step 1: Locate the color-token block in globals.css**

Look for the `--vt-signal-*` and `--vt-elem-*` scales (around lines that already exist). The amber scale should be added immediately after (or alongside) the signal scale to match the design system's organization.

- [ ] **Step 2: Add amber tokens**

Insert these lines into `app/globals.css` in the color-token block:

```css
  --vt-amber-200: oklch(94% 0.08   90);
  --vt-amber-300: oklch(89% 0.14   88);
  --vt-amber-400: oklch(84% 0.19   82);
  --vt-amber-500: oklch(80% 0.215  78);   /* canonical brand ignition */
```

Source: original `colors_and_type.css` from the prior Claude design system, lines 64–67.

- [ ] **Step 3: Verify no token collision**

```bash
grep -n "vt-amber" app/globals.css
```

Expected: Exactly the four lines just added; no other `--vt-amber-*` definitions before this PR.

- [ ] **Step 4: Confirm typecheck still clean**

```bash
pnpm exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css
git commit -m "feat(tokens): add --vt-amber-200/300/400/500 scale"
```

---

## Phase C — `<LogButton>` primitive (TDD)

### Task C1: Write failing tests for LogButton

**Files:** Create `tests/unit/log-button.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LogButton, DEFAULT_STAGES } from '@/components/vt/log-button'

describe('LogButton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders idle face by default', () => {
    render(<LogButton />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveTextContent('Log observation')
    expect(btn).toHaveAttribute('aria-busy', 'false')
    expect(btn.className).not.toMatch(/is-loading/)
    expect(btn.className).not.toMatch(/is-done/)
  })

  it('shows custom idle label when provided', () => {
    render(<LogButton label="Save note" />)
    expect(screen.getByRole('button')).toHaveTextContent('Save note')
  })

  it('enters loading state with first stage label and aria-busy', () => {
    render(<LogButton state="loading" />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(btn.className).toMatch(/is-loading/)
    expect(btn).toHaveTextContent(DEFAULT_STAGES[0].label) // "Recording observation"
  })

  it('cycles to next stage label after first stage duration elapses', async () => {
    render(<LogButton state="loading" />)
    expect(screen.getByRole('button')).toHaveTextContent(DEFAULT_STAGES[0].label)

    // advance past first stage (600ms) into second stage window
    await act(async () => {
      vi.advanceTimersByTime(DEFAULT_STAGES[0].ms + 50)
    })

    expect(screen.getByRole('button')).toHaveTextContent(DEFAULT_STAGES[1].label) // "Parsing photo · 3 frames"
  })

  it('pins to specific stage when freezeStage is set, regardless of timer', async () => {
    render(<LogButton state="loading" freezeStage={3} />)
    expect(screen.getByRole('button')).toHaveTextContent(DEFAULT_STAGES[3].label) // "Re-scoring confidence"

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.getByRole('button')).toHaveTextContent(DEFAULT_STAGES[3].label)
  })

  it('renders done face with check and "Logged · advancing" label', () => {
    render(<LogButton state="done" />)
    const btn = screen.getByRole('button')
    expect(btn.className).toMatch(/is-done/)
    expect(btn).toHaveTextContent('Logged · advancing')
  })

  it('fires onClick when idle and clicked', async () => {
    const onClick = vi.fn()
    vi.useRealTimers() // userEvent needs real timers
    const user = userEvent.setup()
    render(<LogButton onClick={onClick} />)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('respects disabled prop', async () => {
    const onClick = vi.fn()
    vi.useRealTimers()
    const user = userEvent.setup()
    render(<LogButton onClick={onClick} disabled />)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    await user.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('exposes stages count in counter region', () => {
    render(<LogButton state="loading" />)
    const btn = screen.getByRole('button')
    // counter shows e.g. "01/05" — verify the total
    const totalPadded = String(DEFAULT_STAGES.length).padStart(2, '0')
    expect(btn.textContent).toContain(totalPadded)
  })
})
```

- [ ] **Step 2: Add @testing-library/user-event if missing**

```bash
pnpm add -D @testing-library/user-event
```

Expected: Package installed (already a peer of testing-library/react ^16, so this should be a no-op or near-no-op).

- [ ] **Step 3: Run tests, expect all FAIL with module-not-found**

```bash
pnpm test tests/unit/log-button.test.tsx
```

Expected: All tests fail because `@/components/vt/log-button` does not exist yet.

- [ ] **Step 4: Commit failing tests**

```bash
git add tests/unit/log-button.test.tsx package.json pnpm-lock.yaml
git commit -m "test(log-button): failing tests for three-state narrating button"
```

### Task C2: Add `log-button.css`

**Files:** Create `components/vt/log-button.css`, modify `app/globals.css`

- [ ] **Step 1: Copy CSS verbatim from design**

Read `/Volumes/Creativity/dev/projects/vyntechs/log-observation-loading/log-button.css` and write its contents — unchanged — to `components/vt/log-button.css`.

The full file content is provided by Read on the source path. Do not reformat, rename selectors, or alter values.

- [ ] **Step 2: Wire CSS into the app**

Append to `app/globals.css` (somewhere near other component-CSS imports if any exist; otherwise at the bottom of the file, before the last closing brace of any block):

```css
@import './../components/vt/log-button.css';
```

Note: if `app/globals.css` is loaded via `import './globals.css'` in `app/layout.tsx`, the relative path from `app/globals.css` to the component CSS is `../components/vt/log-button.css`.

If the project pattern is to inline component CSS into globals (check by looking for any other `.css` files in `components/`), replicate that pattern instead — paste the entire `log-button.css` content into `app/globals.css` directly.

- [ ] **Step 3: Verify CSS loads**

```bash
pnpm exec tsc --noEmit
```

Expected: No type errors. (Visual verification deferred to Vercel preview.)

- [ ] **Step 4: Commit**

```bash
git add components/vt/log-button.css app/globals.css
git commit -m "feat(log-button): add component CSS (verbatim port of design)"
```

### Task C3: Implement `LogButton` component

**Files:** Create `components/vt/log-button.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export type LogButtonStage = { label: string; ms: number }

export const DEFAULT_STAGES: LogButtonStage[] = [
  { label: 'Recording observation', ms: 600 },
  { label: 'Parsing photo · 3 frames', ms: 900 },
  { label: 'Updating retrieval ladder', ms: 900 },
  { label: 'Re-scoring confidence', ms: 800 },
  { label: 'Promoting next step', ms: 700 },
]

export type LogButtonState = 'idle' | 'loading' | 'done'
export type LogButtonVariant = 'graphite' | 'amber' | 'paper'

export type LogButtonProps = {
  stages?: LogButtonStage[]
  state?: LogButtonState
  freezeStage?: number | null
  variant?: LogButtonVariant
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  label?: string
  type?: 'button' | 'submit'
  disabled?: boolean
}

export function LogButton({
  stages = DEFAULT_STAGES,
  state = 'idle',
  freezeStage = null,
  variant = 'graphite',
  onClick,
  label = 'Log observation',
  type = 'button',
  disabled = false,
}: LogButtonProps) {
  const [stageIdx, setStageIdx] = useState(0)
  const [progress, setProgress] = useState(0)
  const startedAtRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  const totalMs = useMemo(
    () => stages.reduce((a, s) => a + s.ms, 0),
    [stages],
  )

  useEffect(() => {
    if (state !== 'loading' || freezeStage != null) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      startedAtRef.current = null
      return
    }
    startedAtRef.current = performance.now()
    const tick = (now: number) => {
      const start = startedAtRef.current ?? now
      const elapsed = (now - start) % totalMs
      let acc = 0
      let idx = 0
      for (let i = 0; i < stages.length; i++) {
        if (elapsed < acc + stages[i].ms) {
          idx = i
          break
        }
        acc += stages[i].ms
      }
      setStageIdx(idx)
      setProgress(elapsed / totalMs)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [state, freezeStage, totalMs, stages])

  useEffect(() => {
    if (freezeStage != null) {
      const idx = Math.max(0, Math.min(stages.length - 1, freezeStage))
      setStageIdx(idx)
      let acc = 0
      for (let i = 0; i <= idx; i++) acc += stages[i].ms
      setProgress(Math.min(1, acc / totalMs))
    }
  }, [freezeStage, totalMs, stages])

  const isLoading = state === 'loading'
  const isDone = state === 'done'
  const currentStage = stages[stageIdx]

  return (
    <button
      type={type}
      className={`lb lb--${variant} ${isLoading ? 'is-loading' : ''} ${
        isDone ? 'is-done' : ''
      }`}
      onClick={onClick}
      disabled={disabled}
      aria-live="polite"
      aria-busy={isLoading}
    >
      <span className="lb__shimmer" aria-hidden="true"></span>

      <span className="lb__progress" aria-hidden="true">
        <span
          className="lb__progress-fill"
          style={{ transform: `scaleX(${progress})` }}
        ></span>
      </span>

      <span className="lb__content">
        <span
          className={`lb__face lb__face--idle ${
            isLoading || isDone ? 'is-out' : ''
          }`}
        >
          <span className="lb__label">{label}</span>
          <span className="lb__chevron" aria-hidden="true">
            <svg
              viewBox="0 0 12 12"
              width="11"
              height="11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                d="M3.5 3 L8 6 L3.5 9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </span>

        {isDone && (
          <span className="lb__face lb__face--done">
            <span className="lb__check" aria-hidden="true">
              <svg
                viewBox="0 0 14 14"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path
                  d="M3 7.5 L6 10.2 L11 4.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="lb__label">Logged · advancing</span>
          </span>
        )}

        {isLoading && (
          <span className="lb__face lb__face--loading" key={stageIdx}>
            <span className="lb__dot" aria-hidden="true"></span>
            <span className="lb__narration">
              <span className="lb__narration-text">{currentStage.label}</span>
              <span className="lb__narration-dots" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </span>
            </span>
            <span className="lb__counter" aria-hidden="true">
              <span className="lb__counter-num">
                {String(stageIdx + 1).padStart(2, '0')}
              </span>
              <span className="lb__counter-sep">/</span>
              <span className="lb__counter-tot">
                {String(stages.length).padStart(2, '0')}
              </span>
            </span>
          </span>
        )}
      </span>
    </button>
  )
}
```

This is a 1:1 conversion of `log-button.jsx` from the design package — same logic, same DOM, same class names, same SVG paths. Differences from source:
- ESM imports instead of `const { useState: useStateLB } = React;` destructuring
- TypeScript types (no behavior change)
- Added `type='button' | 'submit'` and `disabled` props (only additions; required for form integration)
- Removed `window.LogButton = LogButton` global assignment (not needed in app context)

- [ ] **Step 2: Run tests — expect all PASS**

```bash
pnpm test tests/unit/log-button.test.tsx
```

Expected: All 9 tests in `log-button.test.tsx` pass.

If a test fails on the timer-cycling test (`cycles to next stage label`), the cause is likely that `requestAnimationFrame` is not advanced by `vi.advanceTimersByTime` in happy-dom by default. Fix: in the component test, add a setup line to mock rAF:

```ts
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number,
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
```

(Add this only if the cycling test fails; happy-dom's rAF behavior varies by version.)

- [ ] **Step 3: Commit**

```bash
git add components/vt/log-button.tsx
git commit -m "feat(log-button): port three-state narrating button from design"
```

---

## Phase D — Form integration (TDD)

### Task D1: Write failing tests for active-step-form done-state hold

**Files:** Create `tests/unit/active-step-form.test.tsx`

First, check if this file already exists:

```bash
ls tests/unit/active-step-form.test.tsx 2>&1
```

If it exists, MODIFY (add new test cases). If not, CREATE.

- [ ] **Step 1: Write the test file (or append cases)**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn(), replace: vi.fn() }),
}))

import { ActiveStepForm } from '@/components/screens/active-step-form'

describe('ActiveStepForm — log-button integration', () => {
  beforeEach(() => {
    refreshMock.mockReset()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows the LogButton in idle state by default', () => {
    render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    const btn = screen.getByRole('button', { name: /log observation/i })
    expect(btn).toHaveAttribute('aria-busy', 'false')
  })

  it('disables the LogButton when textarea is empty', () => {
    render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    expect(
      screen.getByRole('button', { name: /log observation/i }),
    ).toBeDisabled()
  })

  it('enters loading state on submit, then done state, then refreshes after 700ms hold', async () => {
    let resolveFetch: (v: Response) => void
    const fetchPromise = new Promise<Response>((res) => {
      resolveFetch = res
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(fetchPromise),
    )

    render(<ActiveStepForm sessionId="s1" nodeId="n1" />)

    const textarea = screen.getByPlaceholderText(/log what you observed/i)
    fireEvent.change(textarea, { target: { value: 'left front squeal' } })

    const btn = screen.getByRole('button', { name: /log observation/i })
    fireEvent.click(btn)

    // loading
    await waitFor(() => {
      expect(btn).toHaveAttribute('aria-busy', 'true')
    })

    // resolve fetch successfully
    await act(async () => {
      resolveFetch!(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )
    })

    // done state held — refresh NOT called yet
    await waitFor(() => {
      expect(btn.className).toMatch(/is-done/)
    })
    expect(refreshMock).not.toHaveBeenCalled()

    // advance past the 700ms hold
    await act(async () => {
      vi.advanceTimersByTime(750)
    })

    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('returns to idle on error, does NOT show done flash, refresh NOT called', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'nope' }), { status: 400 }),
      ),
    )

    render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    const textarea = screen.getByPlaceholderText(/log what you observed/i)
    fireEvent.change(textarea, { target: { value: 'left front squeal' } })

    const btn = screen.getByRole('button', { name: /log observation/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('nope')
    })

    expect(btn.className).not.toMatch(/is-done/)
    expect(refreshMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — expect new tests FAIL**

```bash
pnpm test tests/unit/active-step-form.test.tsx
```

Expected: The first 2 tests (idle render, disabled-when-empty) might pass since the existing form already does that. The 3rd test (`enters loading state... refreshes after 700ms hold`) MUST fail because the form does not yet hold the done state — current code calls `router.refresh()` immediately on success.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/unit/active-step-form.test.tsx
git commit -m "test(active-step-form): expect 700ms done-state hold before refresh"
```

### Task D2: Wire LogButton into active-step-form.tsx

**Files:** Modify `components/screens/active-step-form.tsx`

- [ ] **Step 1: Read the current file to confirm shape**

```bash
cat components/screens/active-step-form.tsx
```

Confirm lines 123–140 contain the inline `<button class="btn btn-primary">` block.

- [ ] **Step 2: Apply the edit**

Replace the file contents with:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DotsThree } from '@phosphor-icons/react/dist/ssr'
import { PhotoCapture } from '@/components/session/photo-capture'
import { AudioCapture } from '@/components/session/audio-capture'
import { VideoCapture } from '@/components/session/video-capture'
import { LogButton } from '@/components/vt/log-button'

type RequestedArtifact = {
  kind: 'photo' | 'scan_screen' | 'wiring_diagram' | 'audio' | 'video'
  prompt: string
}

type Props = {
  sessionId: string
  nodeId: string
  requestedArtifact?: RequestedArtifact
}

const DONE_HOLD_MS = 700

export function ActiveStepForm({ sessionId, nodeId, requestedArtifact }: Props) {
  const [observation, setObservation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'done'>('idle')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const buttonState: 'idle' | 'loading' | 'done' = isPending ? 'loading' : phase

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!observation.trim()) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/advance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ observation: observation.trim() }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setError(body.error ?? `Failed (${res.status})`)
          return
        }
        setObservation('')
        setPhase('done')
        setTimeout(() => {
          setPhase('idle')
          router.refresh()
        }, DONE_HOLD_MS)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error')
      }
    })
  }

  return (
    <form onSubmit={submit}>
      {requestedArtifact && (
        <div style={{ marginBottom: 12 }}>
          {(requestedArtifact.kind === 'photo' ||
            requestedArtifact.kind === 'scan_screen' ||
            requestedArtifact.kind === 'wiring_diagram') && (
            <PhotoCapture
              sessionId={sessionId}
              nodeId={nodeId}
              kind={requestedArtifact.kind}
              label={requestedArtifact.prompt}
              onUploaded={() => router.refresh()}
            />
          )}
          {requestedArtifact.kind === 'audio' && (
            <AudioCapture
              sessionId={sessionId}
              nodeId={nodeId}
              prompt={requestedArtifact.prompt}
              onUploaded={() => router.refresh()}
            />
          )}
          {requestedArtifact.kind === 'video' && (
            <VideoCapture
              sessionId={sessionId}
              nodeId={nodeId}
              label={requestedArtifact.prompt}
              onUploaded={() => router.refresh()}
            />
          )}
        </div>
      )}
      <label htmlFor={`obs-${sessionId}`} className="vt-sr-only">
        Observation
      </label>
      <textarea
        id={`obs-${sessionId}`}
        value={observation}
        onChange={(e) => setObservation(e.target.value)}
        placeholder="Log what you observed."
        rows={2}
        disabled={isPending}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: 'var(--vt-bone-100)',
          border: '0.5px solid var(--vt-rule-strong)',
          borderRadius: 'var(--vt-radius-2)',
          padding: '10px 12px',
          fontFamily: 'var(--vt-font-serif)',
          fontSize: 15,
          color: 'var(--vt-fg)',
          resize: 'none',
          outline: 0,
          marginBottom: 8,
          letterSpacing: '-0.005em',
        }}
      />
      {error && (
        <div
          role="alert"
          style={{
            fontFamily: 'var(--vt-font-sans)',
            fontSize: 12,
            color: 'var(--vt-risk-destructive)',
            marginBottom: 8,
          }}
        >
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <LogButton
            type="submit"
            state={buttonState}
            disabled={isPending || !observation.trim()}
            label="Log observation"
            variant="graphite"
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label="More options"
          disabled={isPending}
        >
          <DotsThree size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}
```

Notes on the change:
- `LogButton` is wrapped in `<div style={{ flex: 1 }}>` to preserve the original layout's `flex: 1` on the primary button (the design's `.lb` already has `width: 100%` so the wrapper alone handles the flex grow).
- `phase` is kept separate from `useTransition`'s `isPending`. The combined `buttonState` derivation makes the state machine readable: pending wins over phase; when not pending, `phase` is the source of truth. Returning to idle is explicit (the timeout sets `phase='idle'`).
- `setObservation('')` is called before `setPhase('done')` so the textarea visibly clears as the success animation plays; this matches the spec's promise that the form resets atomically with the success state.
- The `<DotsThree>` "more options" button is unchanged.

- [ ] **Step 3: Run the tests, expect all PASS**

```bash
pnpm test tests/unit/active-step-form.test.tsx
```

Expected: All four tests in `active-step-form.test.tsx` pass, including the 700ms hold case.

- [ ] **Step 4: Run the full test suite to confirm no regressions**

```bash
pnpm test
```

Expected: Full suite green. Per Brandon's standing rule (`Vitest fork-pool flake on cold cache`), if 50+ "PGlite is closed" errors appear on first run after a fresh shell, rerun once before treating as regression.

- [ ] **Step 5: Commit**

```bash
git add components/screens/active-step-form.tsx
git commit -m "feat(active-step-form): wire LogButton with 700ms done-state hold"
```

---

## Phase E — Verification

### Task E1: Lint, typecheck, build

**Files:** None (verification only)

- [ ] **Step 1: Typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Production build**

```bash
pnpm build
```

Expected: Build completes successfully. Watch for any CSS-import errors (the `@import` of `log-button.css` from `globals.css` should resolve).

If the project does not have a `lint` script (verified in plan write-up — package.json has only `dev/build/start/test/test:e2e/db:*`), skip lint. Build covers most static-analysis concerns.

- [ ] **Step 3: Visual smoke test in dev**

```bash
pnpm dev
```

Then manually navigate to a session with an active step and confirm the button renders correctly in idle state. Don't try to validate loading/done states locally — those need the real API behind the Vercel preview to feel right.

Stop the dev server before continuing.

### Task E2: Push and open PR

**Files:** None

- [ ] **Step 1: Push branch**

```bash
git push -u origin Loading-animation
```

Expected: Branch pushed. Vercel should kick off a preview deployment automatically.

- [ ] **Step 2: Open PR**

```bash
gh pr create --base main --title "feat(ui): three-state narrating Log Observation button" --body "$(cat <<'EOF'
## Summary
- Ports the Claude design's three-state Log Observation button (`idle` / `loading` / `done`) into the live `active-step-form.tsx`.
- Adds reusable `<LogButton>` primitive at `components/vt/log-button.tsx` with all three variants (graphite / amber / paper) and the design's `freezeStage` preview prop.
- Adds `--vt-amber-200/300/400/500` color tokens to `app/globals.css`.
- Form holds the success "Logged · advancing" state for 700ms before `router.refresh()` so the user can see the confirmation before the next step renders.

Faithful 1:1 port of the design at `log-observation-loading/log-button.{jsx,css}` — labels, timings, easings, and animations are unchanged.

## Test plan
- [x] `pnpm test tests/unit/log-button.test.tsx` — green
- [x] `pnpm test tests/unit/active-step-form.test.tsx` — green
- [x] `pnpm test` — full suite green
- [x] `pnpm exec tsc --noEmit` — clean
- [x] `pnpm build` — clean
- [ ] Manual on Vercel preview (Brandon): idle/loading/done states feel right on a real iPhone in shop-light context

Spec: `docs/superpowers/specs/2026-05-10-log-button-loading-animation-design.md`
Plan: `docs/superpowers/plans/2026-05-10-log-button-loading-animation.md`

DO NOT MERGE — Brandon validates and squash-merges himself.
EOF
)"
```

Expected: PR opened against `main`, returns a URL.

- [ ] **Step 3: Confirm Vercel preview URL is live**

```bash
gh pr view --json statusCheckRollup
```

Wait for the Vercel preview check to flip from `PENDING` to `SUCCESS`, then post the preview URL to Brandon for validation.

- [ ] **Step 4: Hand off**

Reply to Brandon with: PR URL, Vercel preview URL, and explicit reminder: "DO NOT MERGE — over to you to validate on the preview and squash/merge when ready."

---

## Done criteria

- [ ] All tests in `tests/unit/log-button.test.tsx` and `tests/unit/active-step-form.test.tsx` pass.
- [ ] Full `pnpm test` suite green.
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm build` clean.
- [ ] PR opened on `Loading-animation` branch against `main`, awaiting Brandon's manual validation on Vercel preview.
- [ ] No commits or merges to `main`.
