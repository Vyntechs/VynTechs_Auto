import { type Ref, type KeyboardEvent } from 'react'
import { Glyph, Kbd, ScanBtn } from './rows'

export function Bar({
  value,
  focused,
  onChange,
  onFocus,
  onKeyDown,
  ariaControls,
  ariaExpanded,
  activeDescendant,
  inputRef,
}: {
  value: string
  focused: boolean
  onChange: (v: string) => void
  onFocus: () => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  ariaControls: string
  ariaExpanded: boolean
  activeDescendant?: string
  inputRef: Ref<HTMLInputElement>
}) {
  return (
    <div className={`pis__bar ${focused ? 'pis__bar--focused' : ''}`}>
      <Glyph />
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={ariaExpanded}
        aria-controls={ariaControls}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        className="pis__input"
        placeholder="Customer name, phone, VIN, plate, year/make/model…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
      <ScanBtn />
      <Kbd>⌘ K</Kbd>
    </div>
  )
}
