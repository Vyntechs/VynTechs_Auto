import type { KnowledgeType } from '@/lib/knowledge/constants'

const svgProps = {
  width: 16,
  height: 16,
  stroke: 'currentColor',
  fill: 'none',
  strokeWidth: 1.25,
  xmlns: 'http://www.w3.org/2000/svg',
} as const

export function TypeGlyph({ type }: { type: KnowledgeType }) {
  switch (type) {
    case 'pinout':
      return (
        <svg viewBox="0 0 16 16" {...svgProps}>
          <rect x="2" y="3" width="12" height="10" rx="1" />
          <circle cx="5" cy="6" r="0.9" fill="currentColor" />
          <circle cx="8" cy="6" r="0.9" fill="currentColor" />
          <circle cx="11" cy="6" r="0.9" fill="currentColor" />
          <circle cx="6.5" cy="10" r="0.9" fill="currentColor" />
          <circle cx="9.5" cy="10" r="0.9" fill="currentColor" />
        </svg>
      )
    case 'connector':
      return (
        <svg viewBox="0 0 16 16" {...svgProps}>
          <path d="M2 6 H6 V4 H10 V6 H14 V12 H2 Z" />
          <line x1="6" y1="9" x2="10" y2="9" />
        </svg>
      )
    case 'wiring_diagram':
      return (
        <svg viewBox="0 0 16 16" {...svgProps}>
          <rect x="1.5" y="3.5" width="4" height="3" />
          <rect x="10.5" y="9.5" width="4" height="3" />
          <path d="M5.5 5 H8 V11 H10.5" />
        </svg>
      )
    case 'theory_of_operation':
      return (
        <svg viewBox="0 0 16 16" {...svgProps}>
          <path d="M3 3 H13 V13 H3 Z" />
          <line x1="5" y1="6" x2="11" y2="6" />
          <line x1="5" y1="8.5" x2="11" y2="8.5" />
          <line x1="5" y1="11" x2="9" y2="11" />
        </svg>
      )
    case 'cause_fix':
      return (
        <svg viewBox="0 0 16 16" {...svgProps}>
          <path d="M3 13 L8 3 L13 13 Z" />
          <line x1="8" y1="6.5" x2="8" y2="10" />
          <circle cx="8" cy="11.5" r="0.6" fill="currentColor" />
        </svg>
      )
    case 'bulletin':
      return (
        <svg viewBox="0 0 16 16" {...svgProps}>
          <path d="M3 4 H13 V12 H3 Z" />
          <line x1="3" y1="6.5" x2="13" y2="6.5" />
          <circle cx="5" cy="5.25" r="0.5" fill="currentColor" />
        </svg>
      )
    case 'note':
      return (
        <svg viewBox="0 0 16 16" {...svgProps}>
          <path d="M4 2.5 H12 V13.5 L9 11.5 L4 13.5 Z" />
        </svg>
      )
    case 'reference_doc':
      return (
        <svg viewBox="0 0 16 16" {...svgProps}>
          <path d="M3 4 H13 M3 8 H13 M3 12 H10" />
        </svg>
      )
  }
}
