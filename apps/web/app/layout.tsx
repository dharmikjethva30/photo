import '@photu/tokens/css'
import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'photu',
  description: 'Shared albums at original quality. You only see the photos you appear in.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  // data-palette pins the shipping palette (quiet), matching the mobile default so the
  // two surfaces read as one product. The tokens CSS provides every --var off this.
  return (
    <html data-palette="quiet" lang="en">
      <body>{children}</body>
    </html>
  )
}
