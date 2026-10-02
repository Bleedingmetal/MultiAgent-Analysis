import type { Metadata } from "next"

import { AppShell } from "./app-shell"

import "./globals.css"

export const metadata: Metadata = {
  title: "MassMutual · Architecture Comparison",
  description:
    "Compare single- and multi-agent architectures on success, cost, and latency.",
  icons: {
    icon: "/MassMutual-meta.webp",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
