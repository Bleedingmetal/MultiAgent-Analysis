"use client"

import {
  ChartBar,
  Database,
  ClockCounterClockwise,
  GitDiff,
  SlidersHorizontal,
} from "@phosphor-icons/react"

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
  { title: "Overview", url: "/", icon: ChartBar },
  { title: "Compare", url: "/compare", icon: GitDiff },
  { title: "Benchmarks", url: "/benchmarks", icon: Database },
  { title: "Configurations", url: "/configurations", icon: SlidersHorizontal },
  { title: "Runs", url: "/runs", icon: ClockCounterClockwise },
]

export function AppSidebar() {
  const pathname = usePathname()

  function isActive(url: string) {
    if (url === "/") return pathname === "/"
    return pathname.startsWith(url)
  }

  return (
    <Sidebar
      collapsible="offcanvas"
      className="border-r border-sidebar-border"
    >
      <SidebarHeader className="gap-0 border-b border-sidebar-border px-5 py-7">
        <Link href="/" className="flex flex-col gap-5">
          <img
            src="/massmutual-logo.webp"
            alt="MassMutual"
            className="h-8 w-auto max-w-[170px] object-contain object-left"
          />
          <div>
            <p className="text-[16px] font-semibold tracking-tight text-white">
              Agent Evaluation
            </p>
            <p className="mt-1.5 text-[12px] leading-snug text-mm-light/75">
              Single vs multi-agent tradeoffs
            </p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 py-5">
        <SidebarGroup className="p-0">
          <p className="mb-2.5 px-3 text-[11px] font-medium tracking-wide text-white/35">
            Workspace
          </p>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">
              {navigation.map((item) => {
                const Icon = item.icon
                const active = isActive(item.url)
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      render={(props) => (
                        <Link href={item.url} {...props} />
                      )}
                      isActive={active}
                      className="h-11 w-full rounded-xl px-3 text-[13.5px] data-active:bg-white/8 data-active:text-white data-active:shadow-[inset_3px_0_0_0_#4dc7eb]"
                    >
                      <Icon
                        weight={active ? "fill" : "light"}
                        className="size-[18px] shrink-0 opacity-90"
                      />
                      <span className="truncate font-medium">{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-5 py-5">
        <p className="text-[11px] font-medium text-mm-light/70">
          WPI MQP · MassMutual
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-white/35">
          Architecture comparison harness
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
