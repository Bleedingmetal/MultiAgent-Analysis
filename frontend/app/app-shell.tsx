"use client"

import { usePathname } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

const pageTitles: Record<string, string> = {
  "/": "Overview",
  "/compare": "Compare",
  "/benchmarks": "Benchmarks",
  "/configurations": "Configurations",
  "/runs": "Runs",
}

export function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const pathname = usePathname()

  const title =
    pageTitles[pathname] ??
    (pathname.startsWith("/configurations")
      ? "Configuration"
      : "Agent Evaluation")

  return (
    <SidebarProvider>
      <div className="grain" aria-hidden />
      <AppSidebar />
      <SidebarInset className="bg-transparent">
        <header className="sticky top-0 z-10">
          <div className="mx-3 mt-3 rounded-2xl border border-border/70 bg-white/75 shadow-[0_8px_30px_rgba(0,23,53,0.04)] backdrop-blur-xl md:mx-5 md:mt-4">
            <div className="flex h-14 items-center gap-3 px-4 md:px-5">
              <SidebarTrigger className="text-mm-blue" />
              <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-mm-dark">
                {title}
              </h1>
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-7 md:px-8 md:py-9">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
