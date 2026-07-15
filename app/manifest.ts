import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vyntechs',
    short_name: 'Vyntechs',
    description: 'ShopOS for automotive work orders, assignments, quotes, and job status.',
    start_url: '/today',
    display: 'standalone',
    background_color: '#fdfaf4',
    theme_color: '#fdfaf4',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
