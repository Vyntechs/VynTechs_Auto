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
  heroPhone: null,
  // heroPhone: {
  //   src: '/marketing/screenshots/hero.png',
  //   alt: 'Active diagnostic session — Propose view with branches and confidence',
  // },

  motionPhone: [null, null, null, null, null],
  // motionPhone: [
  //   { src: '/marketing/screenshots/motion-01-open.png',     alt: 'Empty intake screen with vehicle field focused' },
  //   { src: '/marketing/screenshots/motion-02-research.png', alt: 'Research panel with TSB, AllData, forum, iATN sources' },
  //   { src: '/marketing/screenshots/motion-03-propose.png',  alt: 'Branch card with reasoning and confidence bar' },
  //   { src: '/marketing/screenshots/motion-04-confirm.png',  alt: 'Free-text confirm box and updated branch with raised confidence' },
  //   { src: '/marketing/screenshots/motion-05-lock.png',     alt: 'Locked diagnosis card with Phase 02 repair preview' },
  // ],

  laptopHero: null,
  // laptopHero: {
  //   src: '/marketing/screenshots/laptop-hero.png',
  //   alt: 'Vyntechs locked-diagnosis view on a laptop',
  // },
}
