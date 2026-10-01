import { Outlet, useLocation } from "react-router"
import { Play } from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

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

function App() {
  const location = useLocation()

  const title =
    pageTitles[location.pathname] ?? "Agent Evaluation"

  return (
    <SidebarProvider>
      <AppSidebar />

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="-ml-1" />

            <Separator
              orientation="vertical"
              className="h-4"
            />

            <span className="text-sm font-medium">
              {title}
            </span>
          </div>
        </header>

        <main className="flex-1 bg-muted/20 p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App