import {
  BarChart3,
  Database,
  GitCompareArrows,
  History,
  SlidersHorizontal,
} from "lucide-react"

import {
  Link,
  useLocation,
} from "react-router"

import {
  Sidebar,
  SidebarContent,
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
    title: "Configurations",
    url: "/configurations",
    icon: SlidersHorizontal,
  },
  {
    title: "Runs",
    url: "/runs",
    icon: History,
  },
  {
    title: "Benchmarks",
    url: "/benchmarks",
    icon: Database,
  },
  {
    title: "Compare",
    url: "/compare",
    icon: GitCompareArrows,
  },
]

export function AppSidebar() {
  const location =
    useLocation()

  function isActive(
    url: string,
  ) {
    if (url === "/") {
      return (
        location.pathname === "/"
      )
    }

    return location.pathname.startsWith(
      url,
    )
  }

  return (
    <Sidebar
      collapsible="offcanvas"
      className="border-r border-sidebar-border"
    >
      <SidebarHeader className="border-b border-sidebar-border px-5 py-5">
        <Link
          to="/"
          className="
            flex min-w-0
            items-center
          "
        >
          <img
            src="/massmutual-logo.webp"
            alt="MassMutual"
            className="
              h-9
              w-auto
              max-w-[190px]
              object-contain
              object-left
            "
          />
        </Link>

        <p
          className="
            mt-2
            whitespace-nowrap
            text-[11px]
            font-medium
            text-muted-foreground
          "
        >
          Agent Evaluation
        </p>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {navigation.map(
                (item) => {
                  const Icon =
                    item.icon

                  return (
                    <SidebarMenuItem
                      key={
                        item.title
                      }
                    >
                      <SidebarMenuButton
                        asChild
                        isActive={isActive(
                          item.url,
                        )}
                        className="
                          h-10
                          w-full
                          px-3
                        "
                      >
                        <Link
                          to={
                            item.url
                          }
                          className="
                            flex
                            w-full
                            min-w-0
                            flex-row
                            items-center
                            gap-3
                            whitespace-nowrap
                          "
                        >
                          <Icon
                            className="
                              size-4
                              shrink-0
                            "
                          />

                          <span
                            className="
                              min-w-0
                              truncate
                            "
                          >
                            {
                              item.title
                            }
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                },
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

export default AppSidebar