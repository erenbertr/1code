import { existsSync } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  fetchClaudeOAuthUsage,
  type ClaudeOAuthUsage,
} from "../../claude-oauth-usage"
import { publicProcedure, router } from "../index"

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

type ClaudeSessionTotals = {
  messages: number
  toolCalls: number
  tokens: number
}

function pickNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

function localDayBounds(): { start: Date; end: Date } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

async function scanClaudeSessionForDay(
  filePath: string,
  start: Date,
  end: Date,
): Promise<ClaudeSessionTotals | null> {
  let content: string
  try {
    content = await readFile(filePath, "utf8")
  } catch {
    return null
  }

  let messages = 0
  let toolCalls = 0
  let tokens = 0

  for (const line of content.split("\n")) {
    if (!line) continue

    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    if (
      typeof entry !== "object" ||
      entry === null ||
      (entry as { type?: unknown }).type !== "assistant"
    ) {
      continue
    }

    const tsRaw = (entry as { timestamp?: unknown }).timestamp
    if (typeof tsRaw !== "string") continue
    const ts = new Date(tsRaw)
    if (Number.isNaN(ts.getTime())) continue
    if (ts < start || ts >= end) continue

    messages += 1

    const message = (entry as { message?: unknown }).message
    if (typeof message !== "object" || message === null) continue

    const usage = (message as { usage?: unknown }).usage
    if (typeof usage === "object" && usage !== null) {
      const u = usage as Record<string, unknown>
      tokens +=
        pickNonNegativeNumber(u.input_tokens) +
        pickNonNegativeNumber(u.output_tokens) +
        pickNonNegativeNumber(u.cache_read_input_tokens) +
        pickNonNegativeNumber(u.cache_creation_input_tokens)
    }

    const contentBlocks = (message as { content?: unknown }).content
    if (Array.isArray(contentBlocks)) {
      for (const block of contentBlocks) {
        if (
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "tool_use"
        ) {
          toolCalls += 1
        }
      }
    }
  }

  return { messages, toolCalls, tokens }
}

async function readClaudeToday(): Promise<ClaudeTodayUsage | null> {
  const projectsDir = join(homedir(), ".claude", "projects")
  if (!existsSync(projectsDir)) return null

  let projectNames: string[]
  try {
    projectNames = await readdir(projectsDir)
  } catch {
    return null
  }

  const { start, end } = localDayBounds()

  let sessions = 0
  let messages = 0
  let toolCalls = 0
  let tokens = 0

  const sessionFiles: string[] = []
  for (const projectName of projectNames) {
    const projectDir = join(projectsDir, projectName)
    let entries: { name: string; isFile: boolean }[]
    try {
      const dirents = await readdir(projectDir, { withFileTypes: true })
      entries = dirents.map((d) => ({ name: d.name, isFile: d.isFile() }))
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile) continue
      if (!entry.name.endsWith(".jsonl")) continue

      const filePath = join(projectDir, entry.name)
      let mtime: Date
      try {
        const s = await stat(filePath)
        mtime = s.mtime
      } catch {
        continue
      }
      if (mtime < start) continue
      sessionFiles.push(filePath)
    }
  }

  const totalsList = await Promise.all(
    sessionFiles.map((filePath) => scanClaudeSessionForDay(filePath, start, end)),
  )

  for (const totals of totalsList) {
    if (!totals || totals.messages === 0) continue
    sessions += 1
    messages += totals.messages
    toolCalls += totals.toolCalls
    tokens += totals.tokens
  }

  return { tokens, sessions, messages, toolCalls }
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
  const sessionsRoot = join(homedir(), ".codex", "sessions")
  if (!existsSync(sessionsRoot)) return null

  const emptyToday: CodexTodayUsage = {
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    sessions: 0,
  }

  const { year, month, day } = todayLocalParts()
  const dayDir = join(sessionsRoot, year, month, day)
  if (!existsSync(dayDir)) return emptyToday

  let entries: string[]
  try {
    entries = await readdir(dayDir)
  } catch {
    return emptyToday
  }

  const jsonlFiles = entries.filter((name) => name.endsWith(".jsonl"))
  if (jsonlFiles.length === 0) {
    return emptyToday
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

export type ClaudePlanUsageResult =
  | { available: true; usage: ClaudeOAuthUsage; fetchedAt: string }
  | {
      available: false
      reason: "no_credentials" | "unauthorized" | "error"
      message?: string
      fetchedAt: string
    }

export const usageRouter = router({
  today: publicProcedure.query(async (): Promise<UsageTodayResult> => {
    const [claude, codex] = await Promise.all([
      readClaudeToday(),
      readCodexToday(),
    ])
    return { claude, codex, date: todayLocalISO() }
  }),
  plan: publicProcedure.query(async (): Promise<ClaudePlanUsageResult> => {
    const result = await fetchClaudeOAuthUsage()
    const fetchedAt = new Date().toISOString()
    if (result.ok) {
      return { available: true, usage: result.usage, fetchedAt }
    }
    return {
      available: false,
      reason: result.reason,
      message: result.message,
      fetchedAt,
    }
  }),
})
