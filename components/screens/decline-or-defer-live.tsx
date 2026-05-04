'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { DeclineOrDefer } from './decline-or-defer'

type GateOption = 'gather_more_low_risk' | 'decline' | 'defer'
type RiskClass = 'low' | 'medium' | 'high' | 'destructive'

type Option = {
  number: 1 | 2 | 3
  title: string
  description: string
  emphasized?: boolean
  reason: 'gather' | 'decline' | 'defer'
}

const OPTIONS_BY_REASON: Record<GateOption, Option> = {
  gather_more_low_risk: {
    number: 1,
    title: 'Gather more low-risk data',
    description: 'Try a non-destructive observation that could close the gap.',
    reason: 'gather',
  },
  decline: {
    number: 2,
    title: 'Decline this job',
    description: 'Customer-facing language: refer to dealer or marque specialist.',
    reason: 'decline',
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
  whatWouldClose?: string
  riskClass: RiskClass
  optionKeys: GateOption[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState<1 | 2 | 3 | null>(null)
  const [error, setError] = useState<string | null>(null)

  const options = props.optionKeys.map((k) => {
    const base = OPTIONS_BY_REASON[k]
    if (k === 'gather_more_low_risk' && props.whatWouldClose) {
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
    />
  )
}
