"use client"

/*
  A field of small navy dots behind every page. Each dot breathes on its own slow cycle,
  and the ones near the pointer brighten, turn blue and drift away from it a little, so
  the ground answers the cursor without competing with the data on top of it.
  Canvas, one requestAnimationFrame loop, paused when the tab is hidden; still and
  pointer-blind under prefers-reduced-motion.
*/

import { useEffect, useRef } from "react"

const SPACING = 26
const BASE_ALPHA = 0.11
const NEAR_ALPHA = 0.5
const REACH = 170 // px around the pointer that reacts
const PUSH = 7 // px a dot moves away from the pointer at most
const INK = [0, 46, 107] as const // navy
const CHARGE = [2, 101, 255] as const // the accent, only near the pointer

export function BackgroundField() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const pointer = { x: -9999, y: -9999 }
    let width = 0
    let height = 0
    let frame = 0
    let running = true

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas!.width = Math.floor(width * dpr)
      canvas!.height = Math.floor(height * dpr)
      canvas!.style.width = `${width}px`
      canvas!.style.height = `${height}px`
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (reduce) draw(0)
    }

    function draw(t: number) {
      ctx!.clearRect(0, 0, width, height)
      const cols = Math.ceil(width / SPACING) + 1
      const rows = Math.ceil(height / SPACING) + 1
      const seconds = t / 1000
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let x = c * SPACING + SPACING / 2
          let y = r * SPACING + SPACING / 2
          // slow breathing, out of phase across the field
          const phase = reduce ? 0 : Math.sin(seconds * 0.9 + (c * 0.35 + r * 0.55))
          let alpha = BASE_ALPHA + phase * 0.035
          let radius = 1.15 + phase * 0.2
          let color: readonly [number, number, number] = INK

          if (!reduce) {
            const dx = x - pointer.x
            const dy = y - pointer.y
            const d = Math.hypot(dx, dy)
            if (d < REACH) {
              const k = 1 - d / REACH // 1 at the pointer, 0 at the reach
              const ease = k * k * (3 - 2 * k)
              alpha = BASE_ALPHA + (NEAR_ALPHA - BASE_ALPHA) * ease
              radius = 1.15 + 1.6 * ease
              color = CHARGE
              if (d > 0.001) {
                x += (dx / d) * PUSH * ease
                y += (dy / d) * PUSH * ease
              }
            }
          }
          ctx!.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha})`
          ctx!.beginPath()
          ctx!.arc(x, y, radius, 0, Math.PI * 2)
          ctx!.fill()
        }
      }
    }

    function loop(t: number) {
      if (!running) return
      draw(t)
      frame = requestAnimationFrame(loop)
    }

    function onMove(e: PointerEvent) {
      pointer.x = e.clientX
      pointer.y = e.clientY
    }
    function onLeave() {
      pointer.x = -9999
      pointer.y = -9999
    }
    function onVisibility() {
      running = !document.hidden
      if (running && !reduce) frame = requestAnimationFrame(loop)
      else cancelAnimationFrame(frame)
    }

    resize()
    window.addEventListener("resize", resize)
    if (!reduce) {
      window.addEventListener("pointermove", onMove, { passive: true })
      window.addEventListener("pointerleave", onLeave)
      document.addEventListener("visibilitychange", onVisibility)
      frame = requestAnimationFrame(loop)
    }
    return () => {
      running = false
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", resize)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerleave", onLeave)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
    />
  )
}
