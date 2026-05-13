// Dev-only memory monitor.
//
// Renderer was crashing every 1–2 hours during long dev sessions
// (SIGTRAP/EXC_BREAKPOINT in Electron Helper (Renderer)). This logs
// `performance.memory` once a minute so the leak trend is visible in
// devtools and we can correlate growth with user actions.
//
// Enabled by default in dev. Disable with VITE_MEMORY_MONITOR=0.

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize: number
    totalJSHeapSize: number
    jsHeapSizeLimit: number
  }
}

const INTERVAL_MS = 60_000
const MB = 1024 * 1024

function format(bytes: number | undefined): string {
  if (typeof bytes !== "number") return "?"
  return `${(bytes / MB).toFixed(1)}MB`
}

let started = false
let baseline: number | null = null

export function startMemoryMonitor(): void {
  if (started) return
  if (!import.meta.env.DEV) return
  if (import.meta.env.VITE_MEMORY_MONITOR === "0") return

  const perf = performance as PerformanceWithMemory
  if (!perf.memory) {
    return
  }
  started = true

  const sample = () => {
    const mem = perf.memory
    if (!mem) return
    if (baseline === null) baseline = mem.usedJSHeapSize
    const deltaMb = ((mem.usedJSHeapSize - baseline) / MB).toFixed(1)
    console.log(
      `[mem] used=${format(mem.usedJSHeapSize)} total=${format(mem.totalJSHeapSize)} ` +
        `limit=${format(mem.jsHeapSizeLimit)} Δ=${deltaMb}MB`,
    )
  }

  sample()
  setInterval(sample, INTERVAL_MS)
}
