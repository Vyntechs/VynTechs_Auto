import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vyntechs',
    short_name: 'Vyntechs',
    description: 'AI master tech for the bay.',
    start_url: '/today',
    display: 'standalone',
    background_color: '#0d0d10',
    theme_color: '#0d0d10',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
