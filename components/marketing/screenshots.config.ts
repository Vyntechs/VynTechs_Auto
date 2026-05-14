/* ============================================================
   Vyntechs marketing — screenshot swap config

   This is the ONE file to edit when real screenshots land.
   Each slot below is `null` while we're shipping placeholder
   mini-app shells. Flip a slot to an object literal and the
   corresponding device frame on the marketing page swaps
   automatically to <Image>. No other file needs to change.

   ── How to swap ────────────────────────────────────────────
   1. Drop the PNG in public/marketing/screenshots/{filename}.
   2. Replace `null` below with:
        { src: '/marketing/screenshots/{filename}', alt: '…' }
   3. Save. The next dev/build will use the real image.
   4. (Optional) Remove the corresponding Screen* placeholder
      from screens.tsx once all 5 motion slots are real.

   ── Asset spec ─────────────────────────────────────────────
   Phone (6 slots):   1170 × 2532 px PNG, no rounded corners.
                      Capture at iPhone 14/15/16 Pro retina 3x
                      via real device or DevTools device mode.
   Laptop (1 slot):   2560 × 1600 px PNG, no rounded corners.
                      Capture at MacBook retina 16:10 aspect
                      (1280×800 logical × 2). The frame chrome
                      adds the laptop titlebar — capture the
                      app surface only.
   ──────────────────────────────────────────────────────────── */

export type ScreenshotAsset = {
  src: string
  alt: string
}

export type ScreenshotsConfig = {
  /** Hero phone — Propose view recommended. Slot 1 of 6 phone. */
  heroPhone: ScreenshotAsset | null
  /** Motion §04 — 5 phone screens in order: open, research, propose, confirm, lock. Slots 2–6. */
  motionPhone: [
    ScreenshotAsset | null,
    ScreenshotAsset | null,
    ScreenshotAsset | null,
    ScreenshotAsset | null,
    ScreenshotAsset | null,
  ]
  /** OnLaptop section — locked-diagnosis or session-list view recommended. */
  laptopHero: ScreenshotAsset | null
}

export const SCREENSHOTS: ScreenshotsConfig = {
  heroPhone: {
    src: '/marketing/screenshots/hero.png',
    alt: 'Active diagnostic session — Step 01 with reasoning, 97% confidence, and a 14-step plan on a 2015 Ford F-150 cylinder 4 misfire',
  },

  motionPhone: [
    {
      src: '/marketing/screenshots/motion-01-open.png',
      alt: 'Intake form with the vehicle and customer complaint typed in plain text',
    },
    {
      src: '/marketing/screenshots/motion-02-research.png',
      alt: 'AI putting together the diagnostic plan — pulling reference info for the exact car',
    },
    {
      src: '/marketing/screenshots/motion-03-propose.png',
      alt: 'Active step with reasoning, confidence bar, and the 14-step plan preview',
    },
    {
      src: '/marketing/screenshots/motion-04-confirm.png',
      alt: 'Tree updated after the tech logged an observation — Step 02 active, plan refined to 12 steps, honest gap disclosure visible',
    },
    {
      src: '/marketing/screenshots/motion-05-lock.png',
      alt: 'Locked case summary showing root cause, repair done, verification, and notes for next time',
    },
  ],

  laptopHero: {
    src: '/marketing/screenshots/laptop-hero.png',
    alt: 'Locked diagnosis view on a laptop — same diagnostic surface, bigger screen',
  },
}
