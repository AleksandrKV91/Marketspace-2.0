import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Marketspace Dashboard',
  description: 'Аналитика рекламы WB',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}