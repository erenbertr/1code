import { z } from "zod"
import {
  clearGithubToken,
  getGithubAuthStatus,
  loadGithubToken,
  saveGithubToken,
  type GithubAuthStatus,
} from "../../github-auth-store"
import { publicProcedure, router } from "../index"

export type GithubCommitStats = {
  today: number
  week: number
  month: number
  login: string
  fetchedAt: string
}

export type GithubCommitStatsResult =
  | { available: true; stats: GithubCommitStats }
  | {
      available: false
      reason: "no_token" | "unauthorized" | "error"
      message?: string
    }

const GITHUB_API = "https://api.github.com/graphql"

const GRAPHQL_QUERY = `
  query($todayFrom: DateTime!, $weekFrom: DateTime!, $monthFrom: DateTime!, $to: DateTime!) {
    viewer {
      login
      today: contributionsCollection(from: $todayFrom, to: $to) {
        totalCommitContributions
        restrictedContributionsCount
      }
      week: contributionsCollection(from: $weekFrom, to: $to) {
        totalCommitContributions
        restrictedContributionsCount
      }
      month: contributionsCollection(from: $monthFrom, to: $to) {
        totalCommitContributions
        restrictedContributionsCount
      }
    }
  }
`

function startOfTodayLocal(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfWeekLocal(): Date {
  const d = startOfTodayLocal()
  // Treat Monday as start of week (1..7 -> 0..6 offset)
  const day = d.getDay() // 0=Sun..6=Sat
  const offset = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - offset)
  return d
}

function startOfMonthLocal(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
}

async function fetchCommitStats(
  token: string,
): Promise<GithubCommitStatsResult> {
  const to = new Date()
  const todayFrom = startOfTodayLocal()
  const weekFrom = startOfWeekLocal()
  const monthFrom = startOfMonthLocal()

  let response: Response
  try {
    response = await fetch(GITHUB_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "1code-desktop",
      },
      body: JSON.stringify({
        query: GRAPHQL_QUERY,
        variables: {
          todayFrom: todayFrom.toISOString(),
          weekFrom: weekFrom.toISOString(),
          monthFrom: monthFrom.toISOString(),
          to: to.toISOString(),
        },
      }),
    })
  } catch (error) {
    return {
      available: false,
      reason: "error",
      message: error instanceof Error ? error.message : "Network error",
    }
  }

  if (response.status === 401 || response.status === 403) {
    return { available: false, reason: "unauthorized" }
  }

  if (!response.ok) {
    return {
      available: false,
      reason: "error",
      message: `GitHub API ${response.status}`,
    }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { available: false, reason: "error", message: "Invalid response" }
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    "errors" in payload
  ) {
    const errors = (payload as { errors?: Array<{ message?: string }> })?.errors
    const message = errors?.[0]?.message ?? "GraphQL error"
    return { available: false, reason: "error", message }
  }

  const data = (payload as { data?: unknown }).data
  if (typeof data !== "object" || data === null) {
    return { available: false, reason: "error", message: "Empty response" }
  }

  const viewer = (data as { viewer?: unknown }).viewer
  if (typeof viewer !== "object" || viewer === null) {
    return { available: false, reason: "error", message: "No viewer" }
  }

  const v = viewer as Record<string, unknown>
  const login = typeof v.login === "string" ? v.login : ""

  function readWindow(window: unknown): number {
    if (typeof window !== "object" || window === null) return 0
    const w = window as Record<string, unknown>
    const total =
      typeof w.totalCommitContributions === "number"
        ? w.totalCommitContributions
        : 0
    const restricted =
      typeof w.restrictedContributionsCount === "number"
        ? w.restrictedContributionsCount
        : 0
    // restrictedContributionsCount covers private repos the token can't see
    // when scope is limited; surface combined count to the user.
    return total + restricted
  }

  return {
    available: true,
    stats: {
      today: readWindow(v.today),
      week: readWindow(v.week),
      month: readWindow(v.month),
      login,
      fetchedAt: new Date().toISOString(),
    },
  }
}

export const githubRouter = router({
  getAuthStatus: publicProcedure.query((): GithubAuthStatus => {
    return getGithubAuthStatus()
  }),
  setToken: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(({ input }) => {
      saveGithubToken(input.token)
      return getGithubAuthStatus()
    }),
  clearToken: publicProcedure.mutation(() => {
    clearGithubToken()
    return getGithubAuthStatus()
  }),
  testToken: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const result = await fetchCommitStats(input.token)
      if (result.available) {
        return { ok: true as const, login: result.stats.login }
      }
      return {
        ok: false as const,
        error: result.message ?? result.reason,
      }
    }),
  commitStats: publicProcedure.query(
    async (): Promise<GithubCommitStatsResult> => {
      const token = loadGithubToken()
      if (!token) {
        return { available: false, reason: "no_token" }
      }
      return fetchCommitStats(token)
    },
  ),
})
