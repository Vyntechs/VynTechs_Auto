'use client'
import { useRef, useState, type CSSProperties } from 'react'
import { Module } from './module'

// Shape matches publicVendorAccount from lib/shop-os/parts (scope: 'all',
// so disabled suppliers appear here too — unlike the sourcing panel).
export type SupplierAccount = {
  id: string
  displayName: string
  mode: 'manual'
  enabled: boolean
  updatedAt: string
}

type Props = { initialAccounts: SupplierAccount[] }

function parseAccount(value: unknown): SupplierAccount | null {
  if (value === null || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (
    typeof row.id !== 'string'
    || typeof row.displayName !== 'string'
    || row.displayName.trim() !== row.displayName
    || row.displayName.length === 0
    || row.displayName.length > 120
    || row.mode !== 'manual'
    || typeof row.enabled !== 'boolean'
    || typeof row.updatedAt !== 'string'
  ) return null
  return {
    id: row.id,
    displayName: row.displayName,
    mode: 'manual',
    enabled: row.enabled,
    updatedAt: row.updatedAt,
  }
}

function parseMutation(value: unknown): SupplierAccount | null {
  if (value === null || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (typeof body.changed !== 'boolean') return null
  return parseAccount(body.vendorAccount)
}

// Matches the server list ordering: displayName asc, then id asc.
function compareAccounts(a: SupplierAccount, b: SupplierAccount): number {
  if (a.displayName !== b.displayName) return a.displayName < b.displayName ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function humanizeFailure(status: number): string {
  if (status === 401) return 'Please sign in again.'
  if (status === 404) return 'Only owners can manage suppliers.'
  if (status === 409) return 'This supplier changed in another window. Refresh the page and try again.'
  if (status === 422) return 'Enter a supplier name between 1 and 120 characters.'
  return 'Could not save. Try again.'
}

const introStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--vt-fg-2)',
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginTop: 12,
  flexWrap: 'wrap',
}

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: '16px 0 0',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const itemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  borderTop: '1px solid var(--vt-line, rgba(128,128,128,0.25))',
  paddingTop: 8,
}

const offTagStyle: CSSProperties = {
  fontFamily: 'var(--vt-font-mono)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--vt-fg-3)',
  marginLeft: 8,
}

const messageStyle: CSSProperties = {
  fontFamily: 'var(--vt-font-mono)',
  fontSize: 11,
  letterSpacing: '0.04em',
  color: 'var(--vt-fg-3)',
}

const countStyle: CSSProperties = {
  fontFamily: 'var(--vt-font-mono)',
  fontSize: 11,
  color: 'var(--vt-fg-3)',
}

export function SuppliersSection({ initialAccounts }: Props) {
  const [accounts, setAccounts] = useState(() => [...initialAccounts].sort(compareAccounts))
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // One create key per distinct trimmed name, so a network retry cannot
  // double-create while a changed name gets a fresh key (same contract the
  // canned-jobs editor uses).
  const keyRef = useRef<{ name: string; key: string } | null>(null)
  const inFlightRef = useRef(false)

  const trimmedName = name.trim()
  const canAdd = trimmedName.length >= 1 && trimmedName.length <= 120

  function upsert(account: SupplierAccount) {
    setAccounts((current) =>
      [...current.filter((row) => row.id !== account.id), account].sort(compareAccounts),
    )
  }

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canAdd || inFlightRef.current) return
    if (keyRef.current?.name !== trimmedName) {
      keyRef.current = { name: trimmedName, key: crypto.randomUUID() }
    }
    inFlightRef.current = true
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/shop/vendor-accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientKey: keyRef.current.key, displayName: trimmedName }),
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage(humanizeFailure(response.status))
        return
      }
      const bodyRecord = body as { changed?: unknown } | null
      const account = parseMutation(body)
      const statusMatchesChanged = bodyRecord !== null
        && ((response.status === 201 && bodyRecord.changed === true)
          || (response.status === 200 && bodyRecord.changed === false))
      if (!account || !statusMatchesChanged) {
        setMessage('The saved response could not be verified. Refresh before continuing.')
        return
      }
      upsert(account)
      setName('')
      keyRef.current = null
      setMessage(response.status === 201 ? 'Supplier added.' : 'Supplier already saved.')
    } catch {
      setMessage('Could not reach the server. Try again with the same name.')
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  async function patch(
    account: SupplierAccount,
    next: { displayName: string; enabled: boolean },
    successMessage: string,
  ): Promise<boolean> {
    if (inFlightRef.current) return false
    inFlightRef.current = true
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/shop/vendor-accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: next.displayName,
          enabled: next.enabled,
          expectedUpdatedAt: account.updatedAt,
        }),
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage(humanizeFailure(response.status))
        return false
      }
      const updated = parseMutation(body)
      if (!updated || updated.id !== account.id) {
        setMessage('The saved response could not be verified. Refresh before continuing.')
        return false
      }
      upsert(updated)
      setMessage(successMessage)
      return true
    } catch {
      setMessage('Could not reach the server. Try again.')
      return false
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  async function toggle(account: SupplierAccount) {
    await patch(
      account,
      { displayName: account.displayName, enabled: !account.enabled },
      account.enabled ? 'Supplier turned off.' : 'Supplier turned on.',
    )
  }

  async function saveRename(account: SupplierAccount) {
    if (!editing) return
    const nextName = editing.name.trim()
    if (nextName.length < 1 || nextName.length > 120) {
      setMessage('Enter a supplier name between 1 and 120 characters.')
      return
    }
    if (nextName === account.displayName) {
      setEditing(null)
      return
    }
    const saved = await patch(
      account,
      { displayName: nextName, enabled: account.enabled },
      'Supplier renamed.',
    )
    if (saved) setEditing(null)
  }

  const enabledCount = accounts.filter((account) => account.enabled).length

  return (
    <Module num="04" label="Suppliers" status={<span style={countStyle}>{enabledCount} on</span>}>
      <p style={introStyle}>
        The stores and warehouses your shop orders parts from. Whoever sources a
        part picks from this list — only owners can change it.
      </p>
      <form onSubmit={add} noValidate>
        <div className="field">
          <label htmlFor="supplier-name">Add a supplier</label>
          <input
            id="supplier-name"
            value={name}
            maxLength={120}
            placeholder="e.g. O'Reilly First Call"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div style={rowStyle}>
          <button type="submit" className="btn btn-primary" disabled={!canAdd || busy}>
            Add supplier
          </button>
          {message && (
            <span role="status" style={messageStyle}>
              {message}
            </span>
          )}
        </div>
      </form>
      {accounts.length === 0 ? (
        <p style={{ ...introStyle, margin: '16px 0 0' }}>
          No suppliers yet. Add the ones your shop orders from so sourcing a
          part never stalls.
        </p>
      ) : (
        <ul style={listStyle}>
          {accounts.map((account) => (
            <li key={account.id} style={itemStyle}>
              {editing?.id === account.id ? (
                <>
                  <input
                    aria-label={`Rename ${account.displayName}`}
                    value={editing.name}
                    maxLength={120}
                    onChange={(e) => setEditing({ id: account.id, name: e.target.value })}
                    style={{ flex: 1, minWidth: 180 }}
                  />
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void saveRename(account)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 14, color: 'var(--vt-fg)' }}>
                    {account.displayName}
                    {!account.enabled && <span style={offTagStyle}>off</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => setEditing({ id: account.id, name: account.displayName })}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => void toggle(account)}
                    >
                      {account.enabled ? 'Turn off' : 'Turn on'}
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Module>
  )
}
