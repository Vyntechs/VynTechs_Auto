'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Module } from './module'

type Props = {
  initialName: string
  initialPhone: string | null
  initialAddressLine1: string | null
  initialAddressLine2: string | null
  initialCity: string | null
  initialRegion: string | null
  initialPostalCode: string | null
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function ShopSection({
  initialName,
  initialPhone,
  initialAddressLine1,
  initialAddressLine2,
  initialCity,
  initialRegion,
  initialPostalCode,
}: Props) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [identity, setIdentity] = useState({
    phone: initialPhone ?? '',
    addressLine1: initialAddressLine1 ?? '',
    addressLine2: initialAddressLine2 ?? '',
    city: initialCity ?? '',
    region: initialRegion ?? '',
    postalCode: initialPostalCode ?? '',
  })
  const [identitySaveState, setIdentitySaveState] = useState<SaveState>('idle')
  const [identitySaveError, setIdentitySaveError] = useState<string | null>(null)

  const trimmed = name.trim()
  const dirty = trimmed !== initialName.trim()
  const canSave = dirty && trimmed.length > 0 && trimmed.length <= 80

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSave) return
    setSaveState('saving')
    setSaveError(null)
    try {
      const res = await fetch('/api/shop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setSaveError(humanizeSaveError(body.error))
        setSaveState('error')
        return
      }
      setSaveState('saved')
      // Re-runs the server-rendered (app) layout, which re-fetches the shop
      // row and feeds the new name through AppHeaderProvider → context →
      // AppHeaderShopName. No logout / hard reload required.
      router.refresh()
    } catch {
      setSaveError('Could not reach the server. Try again.')
      setSaveState('error')
    }
  }

  const normalizedIdentity = {
    phone: identity.phone.trim(),
    addressLine1: identity.addressLine1.trim(),
    addressLine2: identity.addressLine2.trim() || null,
    city: identity.city.trim(),
    region: identity.region.trim(),
    postalCode: identity.postalCode.trim(),
  }
  const initialNormalizedIdentity = {
    phone: initialPhone?.trim() ?? '',
    addressLine1: initialAddressLine1?.trim() ?? '',
    addressLine2: initialAddressLine2?.trim() || null,
    city: initialCity?.trim() ?? '',
    region: initialRegion?.trim() ?? '',
    postalCode: initialPostalCode?.trim() ?? '',
  }
  const identityDirty = JSON.stringify(normalizedIdentity) !== JSON.stringify(initialNormalizedIdentity)
  const identityLengthsValid = normalizedIdentity.phone.length <= 30
    && normalizedIdentity.addressLine1.length <= 120
    && (normalizedIdentity.addressLine2?.length ?? 0) <= 120
    && normalizedIdentity.city.length <= 80
    && normalizedIdentity.region.length <= 40
    && normalizedIdentity.postalCode.length <= 20
  const identityComplete = Boolean(
    normalizedIdentity.phone
    && normalizedIdentity.addressLine1
    && normalizedIdentity.city
    && normalizedIdentity.region
    && normalizedIdentity.postalCode,
  )
  const canSaveIdentity = identityDirty && identityComplete && identityLengthsValid

  async function saveIdentity(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSaveIdentity) return
    setIdentitySaveState('saving')
    setIdentitySaveError(null)
    try {
      const res = await fetch('/api/shop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(normalizedIdentity),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setIdentitySaveError(humanizeSaveError(body.error))
        setIdentitySaveState('error')
        return
      }
      setIdentitySaveState('saved')
      router.refresh()
    } catch {
      setIdentitySaveError('Could not reach the server. Try again.')
      setIdentitySaveState('error')
    }
  }

  function identityField(field: keyof typeof identity, value: string) {
    setIdentity((current) => ({ ...current, [field]: value }))
    if (identitySaveState !== 'idle') setIdentitySaveState('idle')
  }

  return (
    <Module num="01" label="Shop identity">
      <form onSubmit={save} noValidate>
        <div className="field">
          <label htmlFor="shop-name">Shop name</label>
          <input
            id="shop-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (saveState !== 'idle') setSaveState('idle')
            }}
            maxLength={80}
            placeholder="What customers see"
          />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 12,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSave || saveState === 'saving'}
          >
            {saveState === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {saveState === 'saved' && (
            <span
              role="status"
              style={{
                fontFamily: 'var(--vt-font-mono)',
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--vt-fg-3)',
              }}
            >
              Saved
            </span>
          )}
          {saveState === 'error' && saveError && (
            <span
              role="alert"
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontStyle: 'italic',
                fontSize: 13,
                color: 'var(--vt-risk-high, #b22)',
              }}
            >
              {saveError}
            </span>
          )}
        </div>
      </form>
      <form onSubmit={saveIdentity} noValidate style={{ marginTop: 28 }}>
        <div className="field">
          <label htmlFor="shop-phone">Shop phone</label>
          <input id="shop-phone" type="tel" value={identity.phone} maxLength={30}
            onChange={(event) => identityField('phone', event.target.value)} />
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="shop-address-line-1">Address line 1</label>
          <input id="shop-address-line-1" type="text" value={identity.addressLine1} maxLength={120}
            onChange={(event) => identityField('addressLine1', event.target.value)} />
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="shop-address-line-2">Address line 2</label>
          <input id="shop-address-line-2" type="text" value={identity.addressLine2} maxLength={120}
            onChange={(event) => identityField('addressLine2', event.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 12, marginTop: 12 }}>
          <div className="field">
            <label htmlFor="shop-city">City</label>
            <input id="shop-city" type="text" value={identity.city} maxLength={80}
              onChange={(event) => identityField('city', event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="shop-region">State or region</label>
            <input id="shop-region" type="text" value={identity.region} maxLength={40}
              onChange={(event) => identityField('region', event.target.value)} />
          </div>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="shop-postal-code">Postal code</label>
          <input id="shop-postal-code" type="text" value={identity.postalCode} maxLength={20}
            onChange={(event) => identityField('postalCode', event.target.value)} />
        </div>
        {!identityLengthsValid && (
          <p role="alert" style={{ color: 'var(--vt-risk-high, #b22)', marginTop: 10 }}>
            {normalizedIdentity.city.length > 80
              ? 'City must be 1–80 characters.'
              : 'One customer paperwork field is too long.'}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary" disabled={!canSaveIdentity || identitySaveState === 'saving'}>
            {identitySaveState === 'saving' ? 'Saving…' : 'Save customer paperwork'}
          </button>
          {identitySaveState === 'saved' && <span role="status">Customer paperwork saved</span>}
          {identitySaveState === 'error' && identitySaveError && <span role="alert">{identitySaveError}</span>}
        </div>
      </form>
    </Module>
  )
}

function humanizeSaveError(code: string | undefined): string {
  if (code === 'invalid_name') return 'Shop name must be 1–80 characters.'
  if (code?.startsWith('invalid_')) return 'Check the customer paperwork fields and try again.'
  if (code === 'forbidden') return 'Only admins can rename the shop.'
  if (code === 'no_shop') return 'No shop is assigned to your account.'
  if (code === 'paywall') return 'Subscription required to save changes.'
  if (code === 'unauthenticated') return 'Please sign in again.'
  return 'Could not save. Try again.'
}
