import Link from 'next/link'

type Section = {
  href: string
  label: string
  desc: string
  adminOnly: boolean
}

const SECTIONS: ReadonlyArray<Section> = [
  { href: '/settings/account', label: 'My Account', desc: 'Name and password', adminOnly: false },
  { href: '/settings/shop',    label: 'Shop',       desc: 'Rename your shop', adminOnly: true  },
  { href: '/settings/team',    label: 'Team',       desc: 'Members and roles', adminOnly: true  },
  { href: '/settings/billing', label: 'Billing',    desc: 'Subscription',     adminOnly: true  },
]

export function SettingsList({ isAdmin }: { isAdmin: boolean }) {
  const visible = SECTIONS.filter((s) => !s.adminOnly || isAdmin)
  return (
    <nav aria-label="Settings sections">
      {visible.map((s) => (
        <Link key={s.href} href={s.href} className="vt-settings-list-row">
          <div className="vt-settings-list-row__text">
            <div className="vt-settings-list-row__label">{s.label}</div>
            <div className="vt-settings-list-row__desc">{s.desc}</div>
          </div>
          <span className="vt-settings-list-row__chevron" aria-hidden="true">›</span>
        </Link>
      ))}
    </nav>
  )
}
