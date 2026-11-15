"use client"

import { Desktop, Moon, Sun } from "@phosphor-icons/react"

import { useTheme, type Theme } from "@/hooks/use-theme"

const LABEL: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" }
const NEXT: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" }

/** A tiny icon button that cycles light → dark → system. Sits at the sidebar's foot. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, cycle } = useTheme()
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Desktop
  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${LABEL[theme]}. Click for ${LABEL[NEXT[theme]].toLowerCase()}.`}
      aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[NEXT[theme]].toLowerCase()}`}
      className={
        "inline-flex size-7 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 " +
        className
      }
    >
      <Icon weight="regular" className="size-[15px]" />
    </button>
  )
}
