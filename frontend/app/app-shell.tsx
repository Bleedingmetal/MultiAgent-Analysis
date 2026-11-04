"use client"

import { usePathname } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import { BackgroundField } from "@/components/product/background-field"
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
  "/agent-prompts": "Agent prompts",
  "/runs": "Runs",
}

export function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const pathname = usePathname()

  // Deeper pages take their section's name (/runs/e2e/… is under Runs)
  const section = Object.keys(pageTitles).find(
    (path) => path !== "/" && pathname.startsWith(path),
  )
  const title =
    pageTitles[pathname] ?? (section ? pageTitles[section] : "Agent Evaluation")

  return (
    <SidebarProvider>
      <BackgroundField />
      <AppSidebar />
      <SidebarInset className="relative z-[1] min-w-0 bg-transparent">
        <header className="flex h-14 items-center gap-3 px-4 md:px-8">
          <SidebarTrigger className="-ml-1.5 text-mm-blue" />
          <h1 className="min-w-0 flex-1 truncate text-[14px] font-medium text-muted-foreground">
            {title}
          </h1>
        </header>
        <main className="min-w-0 flex-1 px-4 pt-2 pb-12 md:px-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
