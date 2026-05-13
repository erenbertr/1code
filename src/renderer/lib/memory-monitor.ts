// Dev-only memory monitor + memory-pressure-driven tab eviction.
//
// V8 caps the renderer heap around 4GB (pointer compression). With multiple
// chat tabs open, each holding full message + tool-result state, the renderer
// drifts toward that cap and aborts (SIGTRAP / EXC_BREAKPOINT).
//
// This monitor:
//   1. Logs `performance.memory` once a minute so leak trends are visible.
//   2. When used heap rises past HIGH_PRESSURE_BYTES, reduces the mounted
//      sub-chat tab limit to 1 — only the active tab stays in memory. The
//      eviction effect in active-chat.tsx releases the others.
//   3. When pressure clears (back under LOW_PRESSURE_BYTES), restores the
//      default tab limit so tab switching is instant again.
//
// Disable with VITE_MEMORY_MONITOR=0.

import { appStore } from "./jotai-store"
import {
  DEFAULT_MAX_MOUNTED_TABS,
  maxMountedTabsAtom,
} from "../features/agents/atoms"

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize: number
    totalJSHeapSize: number
    jsHeapSizeLimit: number
  }
}

const INTERVAL_MS = 60_000
const MB = 1024 * 1024
const HIGH_PRESSURE_BYTES = 2.5 * 1024 * MB // 2.5GB
const LOW_PRESSURE_BYTES = 1.5 * 1024 * MB // 1.5GB
const EVICTED_TAB_LIMIT = 1

function format(bytes: number | undefined): string {
  if (typeof bytes !== "number") return "?"
  return `${(bytes / MB).toFixed(1)}MB`
}

let started = false
let baseline: number | null = null
let evicting = false

function applyMemoryPressure(usedBytes: number): void {
  if (!evicting && usedBytes > HIGH_PRESSURE_BYTES) {
    evicting = true
    appStore.set(maxMountedTabsAtom, EVICTED_TAB_LIMIT)
    console.warn(
      `[mem] high pressure (used=${format(usedBytes)}) → evicting background tabs ` +
        `(maxMountedTabs=${EVICTED_TAB_LIMIT}). Switching tabs may show a brief reload.`,
    )
    return
  }

  if (evicting && usedBytes < LOW_PRESSURE_BYTES) {
    evicting = false
    appStore.set(maxMountedTabsAtom, DEFAULT_MAX_MOUNTED_TABS)
    console.log(
      `[mem] pressure cleared (used=${format(usedBytes)}) → restoring ` +
        `maxMountedTabs=${DEFAULT_MAX_MOUNTED_TABS}`,
    )
  }
}

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

    applyMemoryPressure(mem.usedJSHeapSize)
  }

  sample()
  setInterval(sample, INTERVAL_MS)
}
