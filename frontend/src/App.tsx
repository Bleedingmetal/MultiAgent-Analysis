import { Play } from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
import Dashboard from "@/pages/dashboard"
import Configurations from "@/pages/configurations"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

function App() {
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
              Overview
            </span>
          </div>

          <Button size="sm">
            <Play data-icon="inline-start" />
            Run Evaluation
          </Button>
        </header>

        <main className="flex-1 bg-muted/20 p-4 md:p-6">
          <Dashboard />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App