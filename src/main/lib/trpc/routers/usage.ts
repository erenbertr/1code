import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { publicProcedure, router } from "../index"

type DailyActivity = {
  date: string
  messageCount?: number
  sessionCount?: number
  toolCallCount?: number
}

type DailyModelTokensEntry = {
  date: string
  tokensByModel?: Record<string, number>
}

type ClaudeStatsCache = {
  dailyActivity?: DailyActivity[]
  dailyModelTokens?: DailyModelTokensEntry[]
}

export type ClaudeTodayUsage = {
  tokens: number
  sessions: number
  messages: number
  toolCalls: number
}

export type CodexTodayUsage = {
  tokens: number
  inputTokens: number
  outputTokens: number
  sessions: number
}

export type UsageTodayResult = {
  claude: ClaudeTodayUsage | null
  codex: CodexTodayUsage | null
  date: string
}

function todayLocalISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function todayLocalParts(): { year: string; month: string; day: string } {
  const d = new Date()
  return {
    year: String(d.getFullYear()),
    month: String(d.getMonth() + 1).padStart(2, "0"),
    day: String(d.getDate()).padStart(2, "0"),
  }
}

async function readClaudeToday(): Promise<ClaudeTodayUsage | null> {
  const path = join(homedir(), ".claude", "stats-cache.json")
  if (!existsSync(path)) return null

  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch {
    return null
  }

  let parsed: ClaudeStatsCache
  try {
    parsed = JSON.parse(raw) as ClaudeStatsCache
  } catch {
    return null
  }

  const today = todayLocalISO()
  const activity = parsed.dailyActivity?.find((entry) => entry.date === today)
  const modelTokensEntry = parsed.dailyModelTokens?.find(
    (entry) => entry.date === today,
  )

  let tokens = 0
  for (const value of Object.values(modelTokensEntry?.tokensByModel ?? {})) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      tokens += value
    }
  }

  return {
    tokens,
    sessions: activity?.sessionCount ?? 0,
    messages: activity?.messageCount ?? 0,
    toolCalls: activity?.toolCallCount ?? 0,
  }
}

type CodexLastTokenUsage = {
  inputTokens: number | null
  cachedInputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null
}

async function readLatestCodexUsage(filePath: string): Promise<CodexLastTokenUsage | null> {
  let content: string
  try {
    content = await readFile(filePath, "utf8")
  } catch {
    return null
  }

  const lines = content.split("\n")
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim()
    if (!line) continue

    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }

    if (
      typeof event !== "object" ||
      event === null ||
      (event as { type?: unknown }).type !== "event_msg"
    ) {
      continue
    }

    const payload = (event as { payload?: unknown }).payload
    if (
      typeof payload !== "object" ||
      payload === null ||
      (payload as { type?: unknown }).type !== "token_count"
    ) {
      continue
    }

    const info = (payload as { info?: unknown }).info
    if (typeof info !== "object" || info === null) continue

    const usage = (info as { last_token_usage?: unknown }).last_token_usage
    if (typeof usage !== "object" || usage === null) continue

    const u = usage as Record<string, unknown>
    return {
      inputTokens: pickNumber(u.input_tokens),
      cachedInputTokens: pickNumber(u.cached_input_tokens),
      outputTokens: pickNumber(u.output_tokens),
      totalTokens: pickNumber(u.total_tokens),
    }
  }

  return null
}

async function readCodexToday(): Promise<CodexTodayUsage | null> {
  const { year, month, day } = todayLocalParts()
  const dayDir = join(homedir(), ".codex", "sessions", year, month, day)
  if (!existsSync(dayDir)) return null

  let entries: string[]
  try {
    entries = await readdir(dayDir)
  } catch {
    return null
  }

  const jsonlFiles = entries.filter((name) => name.endsWith(".jsonl"))
  if (jsonlFiles.length === 0) {
    return { tokens: 0, inputTokens: 0, outputTokens: 0, sessions: 0 }
  }

  const usages = await Promise.all(
    jsonlFiles.map((name) => readLatestCodexUsage(join(dayDir, name))),
  )

  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let sessions = 0
  for (const usage of usages) {
    if (!usage) continue
    sessions += 1
    const rawInput = usage.inputTokens ?? 0
    const cached = usage.cachedInputTokens ?? 0
    const nonCachedInput = Math.max(0, rawInput - cached)
    const out = usage.outputTokens ?? 0
    inputTokens += nonCachedInput
    outputTokens += out
    totalTokens += usage.totalTokens ?? rawInput + out
  }

  return {
    tokens: totalTokens,
    inputTokens,
    outputTokens,
    sessions,
  }
}

export const usageRouter = router({
  today: publicProcedure.query(async (): Promise<UsageTodayResult> => {
    const [claude, codex] = await Promise.all([
      readClaudeToday(),
      readCodexToday(),
    ])
    return { claude, codex, date: todayLocalISO() }
  }),
})
