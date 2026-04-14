import type { Metadata } from "next"
import "./globals.css"
import { ThemeProvider } from "@/components/ui/ThemeProvider"

export const metadata: Metadata = {
  title: "Marketspace 2.0",
  description: "Аналитика рекламы и продаж",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Lato:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
