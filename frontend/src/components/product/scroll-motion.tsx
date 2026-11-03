"use client"

/*
  Scroll-driven motion for the Overview, Apple style: tied to scroll position rather than to a timer,
  so it moves with the finger and runs backwards when you scroll up. Transform and opacity only,
  smoothed with a spring, and everything sits still under prefers-reduced-motion.
*/

import {
  animate,
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react"
import { useEffect, useRef, useState, type ReactNode } from "react"

const SPRING = { stiffness: 120, damping: 24, mass: 0.6 }
export const EASE = [0.22, 1, 0.36, 1] as const

function useSmooth(v: MotionValue<number>) {
  return useSpring(v, SPRING)
}

/*
  Settles into place as it scrolls in: fades, rises 28px and scales from 0.97.
  The animation is finished once the element's top is 55% of the way up the screen,
  and it scrubs back if the viewer scrolls up again.
*/
export function Settle({
  children,
  className,
  delay = 0,
  as = "div",
}: {
  children: ReactNode
  className?: string
  /* 0–1 shift along the scroll window, used to stagger siblings */
  delay?: number
  as?: "div" | "section" | "article" | "header" | "aside"
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: [`start ${96 - delay * 10}%`, `start ${62 - delay * 10}%`],
  })
  const p = useSmooth(scrollYProgress)
  const opacity = useTransform(p, [0, 1], [0, 1])
  const y = useTransform(p, [0, 1], [28, 0])
  const scale = useTransform(p, [0, 1], [0.97, 1])
  const Tag = motion[as]
  return (
    <Tag
      ref={ref}
      className={className}
      style={reduce ? undefined : { opacity, y, scale }}
    >
      {children}
    </Tag>
  )
}

/* the page header: stays a little behind the scroll and fades as it leaves the top of the screen */
export function HeroDrift({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] })
  const p = useSmooth(scrollYProgress)
  const y = useTransform(p, [0, 1], [0, 56])
  const opacity = useTransform(p, [0, 0.9], [1, 0])
  return (
    <motion.div ref={ref} className={className} style={reduce ? undefined : { y, opacity }}>
      {children}
    </motion.div>
  )
}

/* the first screen's entrance on load: one soft rise, staggered by order */
export function Enter({
  children,
  className,
  order = 0,
}: {
  children: ReactNode
  className?: string
  order?: number
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, delay: 0.05 + order * 0.09, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

/* a figure that counts up once when it is first seen; the final text is the formatted value */
export function CountUp({
  value,
  format,
  delay = 0,
  duration = 1.2,
}: {
  value: number
  format: (v: number) => string
  delay?: number
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const reduce = useReducedMotion()
  const [shownValue, setShownValue] = useState(reduce ? value : 0)

  useEffect(() => {
    if (reduce) {
      setShownValue(value)
      return
    }
    if (!inView) return
    const controls = animate(0, value, { duration, delay, ease: EASE, onUpdate: setShownValue })
    return () => controls.stop()
  }, [inView, value, delay, duration, reduce])

  return (
    <span ref={ref} aria-label={format(value)}>
      <span aria-hidden>{format(shownValue)}</span>
    </span>
  )
}

/* a bar that grows to its ratio as it scrolls into view */
export function ScrollBar({ ratio, className }: { ratio: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 92%", "start 65%"] })
  const p = useSmooth(scrollYProgress)
  const scaleX = useTransform(p, [0, 1], [0, 1])
  return (
    <motion.span
      ref={ref}
      className={className}
      style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, scaleX: reduce ? 1 : scaleX, transformOrigin: "left center" }}
    />
  )
}

/* text that crossfades when its key changes, for a value that switches metric */
export function Swap({ k, children, className }: { k: string; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion()
  if (reduce) return <span className={className}>{children}</span>
  return (
    <motion.span
      key={k}
      className={className}
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      {children}
    </motion.span>
  )
}
