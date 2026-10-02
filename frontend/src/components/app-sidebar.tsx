"use client"

import {
  BarChart3,
  Database,
  GitCompareArrows,
  History,
  SlidersHorizontal,
} from "lucide-react"

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const navigation = [
  {
    title: "Overview",
    url: "/",
    icon: BarChart3,
  },
  {
    title: "Compare",
    url: "/compare",
    icon: GitCompareArrows,
  },
  {
    title: "Benchmarks",
    url: "/benchmarks",
    icon: Database,
  },
  {
    title: "Configurations",
    url: "/configurations",
    icon: SlidersHorizontal,
  },
  {
    title: "Runs",
    url: "/runs",
    icon: History,
  },
]

export function AppSidebar() {
  const pathname = usePathname()

  function isActive(url: string) {
    if (url === "/") {
      return pathname === "/"
    }
    return pathname.startsWith(url)
  }

  return (
    <Sidebar
      collapsible="offcanvas"
      className="border-r border-sidebar-border"
    >
      <SidebarHeader className="gap-0 border-b border-sidebar-border px-5 py-5">
        <Link href="/" className="flex min-w-0 flex-col gap-3">
          <img
            src="/massmutual-logo.webp"
            alt="MassMutual"
            className="h-8 w-auto max-w-[168px] object-contain object-left"
          />
          <div>
            <p className="text-sm font-semibold text-white">
              Agent Evaluation
            </p>
            <p className="mt-1 text-[11px] text-white/55">
              Single vs multi-agent
            </p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 py-4">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {navigation.map((item) => {
                const Icon = item.icon
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      render={(props) => (
                        <Link href={item.url} {...props} />
                      )}
                      isActive={isActive(item.url)}
                      className="h-10 w-full px-3 data-active:bg-sidebar-accent data-active:text-white"
                    >
                      <Icon className="size-4 shrink-0 opacity-90" />
                      <span className="min-w-0 truncate font-medium">
                        {item.title}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-5 py-4">
        <p className="text-[11px] text-white/50">WPI MQP · MassMutual</p>
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
