"use client"

import { usePathname } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

const pageCopy: Record<string, { title: string; subtitle: string }> = {
  "/": {
    title: "Overview",
    subtitle: "Tradeoffs across architectures and task structures",
  },
  "/compare": {
    title: "Compare",
    subtitle: "Rank architectures by the metric that matters",
  },
  "/benchmarks": {
    title: "Benchmarks",
    subtitle: "Task sets that drive discrimination",
  },
  "/configurations": {
    title: "Configurations",
    subtitle: "Architectures ready for evaluation",
  },
  "/runs": {
    title: "Runs",
    subtitle: "Logged evaluation evidence",
  },
}

export function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const pathname = usePathname()

  const meta =
    pageCopy[pathname] ??
    (pathname.startsWith("/configurations")
      ? pageCopy["/configurations"]
      : {
          title: "Agent Evaluation",
          subtitle: "MassMutual · WPI MQP",
        })

  return (
    <SidebarProvider>
      <div className="grain" aria-hidden />
      <AppSidebar />
      <SidebarInset className="bg-transparent">
        <header className="sticky top-0 z-10">
          <div className="mx-3 mt-3 rounded-2xl border border-border/70 bg-white/70 shadow-[0_8px_30px_rgba(0,23,53,0.04)] backdrop-blur-xl md:mx-5 md:mt-4">
            <div className="flex h-[3.75rem] items-center gap-4 px-4 md:px-5">
              <SidebarTrigger className="text-mm-blue" />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[15px] font-semibold tracking-tight text-mm-dark">
                  {meta.title}
                </h1>
                <p className="truncate text-[12px] text-muted-foreground">
                  {meta.subtitle}
                </p>
              </div>
              <span className="hidden rounded-full border border-border bg-white/80 px-3 py-1 text-[11px] font-medium text-mm-blue sm:inline-flex">
                Mock data
              </span>
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-7 md:px-8 md:py-9">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
