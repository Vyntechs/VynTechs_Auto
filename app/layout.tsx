import { Inter_Tight, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import '@/components/vt/vt.css'
import '@/components/vt/v2.css'
import '@/components/vt/v2-instruments.css'
import { SwRegister } from '@/components/sw-register'

const interTight = Inter_Tight({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter-tight',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata = {
  title: 'Vyntechs',
  description: 'AI-led diagnostic assistant for automotive repair shops.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${interTight.variable} ${jetbrainsMono.variable}`}>
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  )
}
