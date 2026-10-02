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
  "/configurations": "Configurations",
  "/runs": "Runs",
  "/benchmarks": "Benchmarks",
  "/compare": "Compare",
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
      ? "Configurations"
      : "Agent Evaluation")

  return (
    <SidebarProvider>
      <AppSidebar />

      <SidebarInset className="bg-transparent">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border/80 bg-[#f4f7fb]/90 px-4 backdrop-blur-md md:px-6">
          <SidebarTrigger className="-ml-1 text-mm-blue" />
          <span className="text-sm font-medium text-mm-dark">{title}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            Mock data
          </span>
        </header>

        <main className="flex-1 p-4 md:p-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
