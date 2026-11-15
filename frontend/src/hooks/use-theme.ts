"use client"

import { useCallback, useEffect, useState } from "react"

/*
 * Light / dark / system, with the choice kept per browser. The `dark` class on <html>
 * drives Tailwind's dark variant and the `.dark` token block in globals.css; an inline
 * script in the layout applies the same class before first paint so there is no flash.
 */

export type Theme = "light" | "dark" | "system"

export const THEME_KEY = "massmutual-theme"
const ORDER: Theme[] = ["light", "dark", "system"]

function systemDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return
  const dark = theme === "dark" || (theme === "system" && systemDark())
  document.documentElement.classList.toggle("dark", dark)
  document.documentElement.style.colorScheme = dark ? "dark" : "light"
}

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === "light" || v === "dark" || v === "system" ? v : "system"
  } catch {
    return "system"
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system")
  const [resolved, setResolved] = useState<"light" | "dark">("light")

  useEffect(() => {
    const initial = readTheme()
    setThemeState(initial)
    applyTheme(initial)
    setResolved(document.documentElement.classList.contains("dark") ? "dark" : "light")
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      if (readTheme() === "system") {
        applyTheme("system")
        setResolved(media.matches ? "dark" : "light")
      }
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* no storage: the choice lasts for this page */
    }
    setThemeState(next)
    applyTheme(next)
    setResolved(document.documentElement.classList.contains("dark") ? "dark" : "light")
  }, [])

  const cycle = useCallback(() => {
    setTheme(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length])
  }, [theme, setTheme])

  return { theme, resolved, setTheme, cycle }
}
