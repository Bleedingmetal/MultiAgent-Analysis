"use client"

import {
  ChartBar,
  ChatText,
  Database,
  ClockCounterClockwise,
  GitDiff,
  SlidersHorizontal,
} from "@phosphor-icons/react"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { ThemeToggle } from "@/components/theme-toggle"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const navigation = [
  { title: "Overview", url: "/", icon: ChartBar },
  { title: "Lab", url: "/compare", icon: GitDiff },
  { title: "Benchmarks", url: "/benchmarks", icon: Database },
  { title: "Configurations", url: "/configurations", icon: SlidersHorizontal },
  { title: "Agent prompts", url: "/agent-prompts", icon: ChatText },
  { title: "Runs", url: "/runs", icon: ClockCounterClockwise },
]

export function AppSidebar() {
  const pathname = usePathname()

  function isActive(url: string) {
    if (url === "/") return pathname === "/"
    return pathname.startsWith(url)
  }

  return (
    <Sidebar collapsible="offcanvas" className="border-r-0">
      <SidebarHeader className="gap-0 px-6 pt-8 pb-9">
        <Link href="/" className="block" aria-label="Agent Evaluation home">
          {/* The brand mark in white so it reads on the navy ground */}
          <img
            src="/massmutual-logo.webp"
            alt="MassMutual"
            className="h-7 w-auto max-w-[160px] object-contain object-left brightness-0 invert"
          />
          <p className="mt-4 text-[15px] font-semibold tracking-tight text-white">
            Agent Evaluation
          </p>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3">
        <SidebarMenu className="gap-0.5">
          {navigation.map((item) => {
            const Icon = item.icon
            const active = isActive(item.url)
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  render={(props) => <Link href={item.url} {...props} />}
                  isActive={active}
                  className="h-9 w-full rounded-lg px-3 text-[14px] text-white/60 hover:bg-white/[0.04] hover:text-white data-active:bg-white/[0.08] data-active:text-white"
                >
                  <Icon weight="regular" className="size-[17px] shrink-0" />
                  <span className="truncate">{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="px-6 pb-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-white/60">WPI MQP × MassMutual</p>
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
