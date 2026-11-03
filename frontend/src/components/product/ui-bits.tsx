"use client"

import Link from "next/link"
import { motion, useReducedMotion } from "motion/react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

const ease = [0.16, 1, 0.3, 1] as const

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const reduce = useReducedMotion()

  if (reduce) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.7, delay, ease }}
    >
      {children}
    </motion.div>
  )
}

export function RevealInView({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const reduce = useReducedMotion()

  if (reduce) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 22, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.65, delay, ease }}
    >
      {children}
    </motion.div>
  )
}

export function Bezel({
  children,
  className,
  coreClassName,
}: {
  children: ReactNode
  className?: string
  coreClassName?: string
}) {
  return (
    <div className={cn("bezel", className)}>
      <div className={cn("bezel-core", coreClassName)}>{children}</div>
    </div>
  )
}

export function MetricTile({
  label,
  value,
  hint,
  className,
  large,
}: {
  label: string
  value: ReactNode
  hint?: string
  className?: string
  large?: boolean
}) {
  return (
    <div
      className={cn(
        "surface relative overflow-hidden",
        large ? "p-6 md:p-7" : "p-5",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-mm-charge/5 blur-2xl"
      />
      <p className="text-[12px] font-medium tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-3 font-data font-medium tracking-tight text-mm-dark",
          large ? "text-[40px] md:text-[44px]" : "text-[28px]",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-2 max-w-[28ch] text-[12px] leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function DeltaPill({
  value,
  tone = "neutral",
}: {
  value: string
  tone?: "up" | "down" | "neutral"
}) {
  const toneClass =
    tone === "up"
      ? "bg-mm-green/12 text-[#2f7a1f]"
      : tone === "down"
        ? "bg-mm-orange/12 text-[#b34800]"
        : "bg-muted text-muted-foreground"

  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        toneClass,
      )}
    >
      {value}
    </span>
  )
}

export function SectionTitle({
  title,
  action,
}: {
  title: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <h2 className="text-[17px] font-semibold tracking-tight text-mm-dark">
        {title}
      </h2>
      {action}
    </div>
  )
}

export function IslandLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <Link href={href} className="island-cta group">
      <span>{children}</span>
      <span className="island-cta-icon" aria-hidden>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 7h8M7.5 3.5 11 7l-3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </Link>
  )
}
