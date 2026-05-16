/* ============================================================
   Vyntechs marketing — screenshot swap config

   This is the ONE file to edit when real screenshots land.
   Drop new PNGs at the same paths and the marketing surface
   picks them up — no other code change required.

   ── How to swap ────────────────────────────────────────────
   1. Drop the PNG in public/marketing/screenshots/{filename}.
   2. If the alt is wrong for the new shot, update it here.
   3. Save. The next dev/build will use the real image.

   ── Asset spec ─────────────────────────────────────────────
   Phone (6 slots):   1170 × 2532 px PNG, no rounded corners.
                      Capture at iPhone 14/15/16 Pro retina 3x
                      via real device or DevTools device mode.
                      The PhoneFrame adds the notch, bezel, and
                      status bar.
   Laptop (1 slot):   2560 × 1600 px PNG, no browser chrome.
                      Capture at MacBook retina 16:10 aspect
                      (1280×800 logical × 2). The LaptopFrame
                      adds the titlebar + traffic lights + URL.

   ── Scenarios per slot (see marketing-visuals/BRIEF.md §1) ──
   Hero phone           — A · AC pressure + auto-pulled humidity/temp · 2022 Tahoe
   Motion 01 — Open     — D · Vibration intake · 2017 Ram 1500
   Motion 02 — Research — B · Electrical citations · 2019 F-150
   Motion 03 — Propose  — B · Electrical reasoning · 2019 F-150 (same session as 02)
   Motion 04 — Confirm  — C · Oil leak observation · 2014 BMW 328i
   Motion 05 — Lock     — D · Vibration locked · 2017 Ram 1500 (same session as 01)
   Laptop  hero         — D · Vibration locked-case summary · 2017 Ram 1500
                          (same session as Motion 01 + 05)
   ──────────────────────────────────────────────────────────── */

export type ScreenshotAsset = {
  src: string
  alt: string
}

export type ScreenshotsConfig = {
  /** Hero phone — Scenario A · AC pressure with auto-pulled ambient. */
  heroPhone: ScreenshotAsset | null
  /** Phone motion — 5 screens, Open / Research / Propose / Confirm / Lock. */
  motionPhone: [
    ScreenshotAsset | null,
    ScreenshotAsset | null,
    ScreenshotAsset | null,
    ScreenshotAsset | null,
    ScreenshotAsset | null,
  ]
  /** OnLaptop section — locked-diagnosis view, Ram 1500 vibration session. */
  laptopHero: ScreenshotAsset | null
}

export const SCREENSHOTS: ScreenshotsConfig = {
  heroPhone: {
    src: '/marketing/screenshots/hero.png',
    alt:
      'Active AC pressure diagnostic on a 2022 Chevy Tahoe — reading 210 PSI on the high-side with an ambient panel showing 84°F, 67% RH, and a 165–185 PSI target band auto-computed for those conditions. Reasoning calls out the 25 PSI overshoot and suggests checking condenser airflow before recovery.',
  },

  motionPhone: [
    {
      src: '/marketing/screenshots/motion-01-open.png',
      alt:
        'Intake on a 2017 Ram 1500 — complaint typed in plain English: "Vibration between 55–65 mph, feels like wheel hop, worse on right turns." Vehicle decoded from the VIN, ready to start the session.',
    },
    {
      src: '/marketing/screenshots/motion-02-research.png',
      alt:
        'Research phase on a 2019 Ford F-150 cyl 4 misfire — four sources surfaced inline, including Ford TSB 21-2156, a wiring diagram for the build-date-specific injector pinout, and a 23-reply forum thread that resolved to a harness pigtail.',
    },
    {
      src: '/marketing/screenshots/motion-03-propose.png',
      alt:
        'Propose phase on the same 2019 F-150 session — active step is the pin 2 voltage-drop measurement under crank, with the reasoning paragraph citing the TSB and 78% confidence. The full 14-step plan is visible below.',
    },
    {
      src: '/marketing/screenshots/motion-04-confirm.png',
      alt:
        'Confirm phase on a 2014 BMW 328i oil leak — the tech typed the observation "oil at PCV grommet on driver side, valve cover dry." The plan refined from 14 steps to 9 focused on PCV grommet replacement.',
    },
    {
      src: '/marketing/screenshots/motion-05-lock.png',
      alt:
        'Locked finding on the 2017 Ram 1500 vibration session — root cause: right rear wheel bearing with heat-induced play above 50 mph. The operator note calls out that the customer-described "wheel hop" matched bearing failure, not tire balance.',
    },
  ],

  laptopHero: {
    src: '/marketing/screenshots/laptop-hero.png',
    alt:
      'Closed-case summary on a laptop — the 2017 Ram 1500 vibration session, locked at a right rear wheel bearing finding. Diagnosis, repair action (Mopar bearing unit), verification, and operator notes all visible. Same diagnostic surface as the phone, rendered wide.',
  },
}
