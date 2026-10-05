/**
 * Hits main App Router pages so first user navigation isn't a cold compile.
 * Used only in local `npm run dev`.
 */
const BASE = process.env.WARMUP_BASE_URL ?? "http://localhost:3000"

const ROUTES = [
  "/",
  "/compare",
  "/benchmarks",
  "/configurations",
  "/runs",
]

async function waitForServer(timeoutMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE, { redirect: "manual" })
      if (res.ok || res.status === 307 || res.status === 308) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`Server not ready at ${BASE}`)
}

async function warm() {
  console.log(`[warmup] waiting for ${BASE}`)
  await waitForServer()
  console.log("[warmup] compiling routes…")
  for (const route of ROUTES) {
    const t0 = Date.now()
    try {
      const res = await fetch(`${BASE}${route}`)
      console.log(`[warmup] ${route} -> ${res.status} (${Date.now() - t0}ms)`)
    } catch (err) {
      console.warn(`[warmup] ${route} failed`, err)
    }
  }
  console.log("[warmup] done")
}

warm().catch((err) => {
  console.warn("[warmup] skipped:", err.message ?? err)
  process.exit(0)
})
