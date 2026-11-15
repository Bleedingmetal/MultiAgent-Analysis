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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint so nothing flashes */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("massmutual-theme");var d=t==="dark"||((t==="system"||!t)&&matchMedia("(prefers-color-scheme: dark)").matches);if(d){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark"}}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
