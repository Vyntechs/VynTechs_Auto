export type ScreenshotAsset = { src: string; alt: string }

export type ScreenshotsConfig = {
  heroPhone: ScreenshotAsset | null
  motionPhone: [null, null, null, null, null]
  laptopHero: ScreenshotAsset | null
}

// No product screenshots are published in this release. Re-enable only with
// current ShopOS captures and an explicit copy/asset truth review.
export const SCREENSHOTS: ScreenshotsConfig = {
  heroPhone: null,
  motionPhone: [null, null, null, null, null],
  laptopHero: null,
}
