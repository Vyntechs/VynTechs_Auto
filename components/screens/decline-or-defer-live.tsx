'use client'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { DeclineOrDefer } from './decline-or-defer'
import type { WhatWouldClose } from '@/lib/ai/tree-engine'

// "decline" was removed 2026-05-09 — only Gather and Defer remain.
type GateOption = 'gather_more_low_risk' | 'defer'
type RiskClass = 'low' | 'medium' | 'high' | 'destructive'

type Option = {
  number: 1 | 2 | 3
  title: string
  description: string
  emphasized?: boolean
  reason: 'gather' | 'defer'
}

const OPTIONS_BY_REASON: Record<GateOption, Option> = {
  gather_more_low_risk: {
    number: 1,
    title: 'Gather more low-risk data',
    description: 'Try a non-destructive observation that could close the gap.',
    reason: 'gather',
  },
  defer: {
    number: 3,
    title: 'Defer for curator review',
    description: '24–72 hr turnaround. Customer keeps the vehicle. Answer goes into your shop history.',
    emphasized: true,
    reason: 'defer',
  },
}

export function DeclineOrDeferLive(props: {
  sessionId: string
  vehicleName: string
  vehicleVin: string
  timer: string
  gap: string
  confidenceGap?: string
  whatWouldClose?: string | WhatWouldClose
  riskClass: RiskClass
  optionKeys: GateOption[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState<1 | 2 | 3 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [heroBusy, setHeroBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const wwc = props.whatWouldClose
  const wwcObj = wwc && typeof wwc === 'object' ? wwc : null

  // Best-effort gate release — the user just took an action on the Decline
  // screen, so the *currently displayed* gate should not bounce them right
  // back here on the next /sessions/:id load. Fire-and-forget: even if this
  // 4xx's the navigation still proceeds; the next observation re-runs gating
  // naturally. Non-2xx responses log to the console so a stale-gate redirect
  // loop isn't completely silent in dev tools.
  async function releaseGate(): Promise<void> {
    try {
      const res = await fetch(`/api/sessions/${props.sessionId}/release-gate`, {
        method: 'POST',
      })
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `release-gate returned ${res.status}; navigation will continue but the gate may persist on the next page load`,
        )
      }
    } catch {
      // Network glitch on release shouldn't block navigation.
    }
  }

  async function handleConfirm(answer: 'Yes' | 'No') {
    if (!wwcObj || wwcObj.kind !== 'confirm') return
    setHeroBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/${props.sessionId}/advance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          observation: `${answer} — ${wwcObj.prompt}`,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `${res.status}`)
      }
      await releaseGate()
      router.push(`/sessions/${props.sessionId}`)
    } catch (err) {
      setHeroBusy(false)
      setError(err instanceof Error ? err.message : 'Request failed')
    }
  }

  function handleSnap() {
    fileInputRef.current?.click()
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setHeroBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', 'photo')
      const res = await fetch(`/api/sessions/${props.sessionId}/capture`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `${res.status}`)
      }
      await releaseGate()
      router.push(`/sessions/${props.sessionId}`)
    } catch (err) {
      setHeroBusy(false)
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const options = props.optionKeys.map((k) => {
    const base = OPTIONS_BY_REASON[k]
    // For legacy string whatWouldClose, surface the prompt as the gather spoke
    // description. For structured shapes the hero card handles the prompt, so
    // the spoke keeps its default copy to avoid on-screen duplication.
    if (k === 'gather_more_low_risk' && typeof props.whatWouldClose === 'string') {
      return { ...base, description: props.whatWouldClose }
    }
    return base
  })
  const riskLabel = `Gating · ${props.riskClass} class`

  async function handleSelect(num: 1 | 2 | 3) {
    const opt = options.find((o) => o.number === num)
    if (!opt) return
    setPending(num)
    setError(null)

    if (opt.reason === 'gather') {
      // Release the stale gate so the session-routing layer doesn't bounce
      // us right back here. The active-step view will show the AI's question
      // inline; the tech can log a new observation and gating re-runs.
      await releaseGate()
      router.push(`/sessions/${props.sessionId}`)
      return
    }

    try {
      const res = await fetch(`/api/sessions/${props.sessionId}/decline-or-defer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason: opt.reason,
          gap: props.gap,
          riskClass: props.riskClass,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `${res.status}`)
      }
      router.push('/sessions')
    } catch (err) {
      setPending(null)
      setError(err instanceof Error ? err.message : 'Request failed')
    }
  }

  return (
    <>
      {wwcObj?.kind === 'photo' && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
        />
      )}
      <DeclineOrDefer
        vehicleName={props.vehicleName}
        vehicleVin={props.vehicleVin}
        timer={props.timer}
        riskLabel={riskLabel}
        gap={props.gap}
        confidenceGap={props.confidenceGap}
        options={options}
        onSelectOption={handleSelect}
        pending={pending}
        error={error}
        back={{ href: `/sessions/${props.sessionId}`, label: 'Diagnosis' }}
        confirmAsk={
          wwcObj?.kind === 'confirm'
            ? {
                prompt: wwcObj.prompt,
                yesLabel: wwcObj.yesLabel,
                noLabel: wwcObj.noLabel,
                onYes: () => handleConfirm('Yes'),
                onNo: () => handleConfirm('No'),
                busy: heroBusy,
              }
            : undefined
        }
        photoAsk={
          wwcObj?.kind === 'photo'
            ? {
                prompt: wwcObj.prompt,
                onSnap: handleSnap,
                busy: heroBusy,
              }
            : undefined
        }
      />
    </>
  )
}
