"use client"

import { useEffect, useLayoutEffect, useRef } from "react"

import { mountDesk } from "@/lib/hairline-desk"

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

type Props = {
  intensity?: number
  play?: boolean
  theme?: "auto" | "light" | "dark"
  label?: string
  className?: string
  style?: React.CSSProperties
}

/** Our own hairline figure: a support agent at the counter who answers the pointer. */
export function HairlineDesk({ intensity = 0.5, play = false, theme = "auto", label, className, style }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const figure = useRef<ReturnType<typeof mountDesk> | null>(null)
  useIsoLayoutEffect(() => {
    if (!el.current) return
    figure.current = mountDesk(el.current, { intensity, theme, label, play })
    return () => {
      figure.current?.destroy()
      figure.current = null
    }
    // mounted once; options below are pushed through update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useIsoLayoutEffect(() => {
    figure.current?.update({ intensity, play })
  }, [intensity, play])
  return <div ref={el} className={className} style={{ aspectRatio: "5 / 4", ...style }} />
}
