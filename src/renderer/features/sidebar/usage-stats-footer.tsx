"use client"

import { memo } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return tokens.toString()
}

function formatNumber(value: number): string {
  return value.toLocaleString()
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

function formatPercent(utilization: number | null): string {
  if (utilization === null) return "—"
  return `${Math.round(utilization)}%`
}

function formatResetIn(resetsAt: string | null): string | null {
  if (!resetsAt) return null
  const target = new Date(resetsAt).getTime()
  if (Number.isNaN(target)) return null
  const diffMs = target - Date.now()
  if (diffMs <= 0) return "now"
  const totalMinutes = Math.floor(diffMs / 60_000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function utilizationColor(utilization: number | null): string {
  if (utilization === null) return "bg-muted-foreground/20"
  if (utilization >= 90) return "bg-red-500/50"
  if (utilization >= 70) return "bg-amber-500/40"
  return "bg-foreground/25"
}

interface UsageBreakdown {
  label: string
  value: number
}

function ProviderRow({
  label,
  tokens,
  sessions,
  breakdown,
  available,
}: {
  label: string
  tokens: number
  sessions: number
  breakdown: UsageBreakdown[]
  available: boolean
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center justify-between gap-2 px-1 py-0.5 rounded",
            "hover:bg-muted/50 cursor-default transition-colors",
          )}
        >
          <span className="text-muted-foreground/80">{label}</span>
          {available ? (
            <span className="flex items-center gap-1.5 font-mono text-foreground/80">
              <span>{formatTokens(tokens)}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground">
                {sessions} {pluralize(sessions, "session", "sessions")}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground/40 font-mono">—</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" align="end" className="min-w-[180px]">
        <div className="font-medium text-foreground mb-1">{label} · today</div>
        {available ? (
          <div className="flex flex-col gap-0.5">
            {breakdown.map(({ label: rowLabel, value }) => (
              <div
                key={rowLabel}
                className="flex justify-between gap-4 text-[11px]"
              >
                <span className="text-muted-foreground">{rowLabel}</span>
                <span className="font-mono text-foreground">
                  {formatNumber(value)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground">
            No usage data found on disk.
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function PlanRow({
  label,
  utilization,
  resetsAt,
  tooltipDescription,
}: {
  label: string
  utilization: number | null
  resetsAt: string | null
  tooltipDescription: string
}) {
  const pct = utilization === null ? 0 : Math.max(0, Math.min(100, utilization))
  const resetIn = formatResetIn(resetsAt)
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex flex-col gap-1 px-1 py-1 rounded",
            "hover:bg-muted/50 cursor-default transition-colors",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground/70 truncate">{label}</span>
            <span className="font-mono text-muted-foreground tabular-nums">
              {formatPercent(utilization)}
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-foreground/[0.06] overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                utilizationColor(utilization),
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" align="end" className="min-w-[180px]">
        <div className="font-medium text-foreground mb-1">{label}</div>
        <div className="text-[11px] text-muted-foreground mb-1">
          {tooltipDescription}
        </div>
        <div className="flex justify-between gap-4 text-[11px]">
          <span className="text-muted-foreground">Used</span>
          <span className="font-mono text-foreground">
            {formatPercent(utilization)}
          </span>
        </div>
        {resetIn && (
          <div className="flex justify-between gap-4 text-[11px]">
            <span className="text-muted-foreground">Resets in</span>
            <span className="font-mono text-foreground">{resetIn}</span>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function GithubCommitsRow({
  today,
  week,
  month,
  login,
}: {
  today: number
  week: number
  month: number
  login: string
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center justify-between gap-2 px-1 py-0.5 rounded",
            "hover:bg-muted/50 cursor-default transition-colors",
          )}
        >
          <span className="text-muted-foreground/80">Commits</span>
          <span className="flex items-center gap-1.5 font-mono text-foreground/80">
            <span>{formatNumber(today)}</span>
            <span className="text-muted-foreground/60">today</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{formatNumber(week)}</span>
            <span className="text-muted-foreground/60">wk</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{formatNumber(month)}</span>
            <span className="text-muted-foreground/60">mo</span>
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" align="end" className="min-w-[180px]">
        <div className="font-medium text-foreground mb-1">
          GitHub commits {login ? `· @${login}` : ""}
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex justify-between gap-4 text-[11px]">
            <span className="text-muted-foreground">Today</span>
            <span className="font-mono text-foreground">
              {formatNumber(today)}
            </span>
          </div>
          <div className="flex justify-between gap-4 text-[11px]">
            <span className="text-muted-foreground">This week</span>
            <span className="font-mono text-foreground">
              {formatNumber(week)}
            </span>
          </div>
          <div className="flex justify-between gap-4 text-[11px]">
            <span className="text-muted-foreground">This month</span>
            <span className="font-mono text-foreground">
              {formatNumber(month)}
            </span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export const UsageStatsFooter = memo(function UsageStatsFooter() {
  const { data: today, isLoading: loadingToday } = trpc.usage.today.useQuery(
    undefined,
    {
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
      staleTime: 15_000,
    },
  )

  const { data: plan, isLoading: loadingPlan } = trpc.usage.plan.useQuery(
    undefined,
    {
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
  )

  const { data: codexPlan } = trpc.usage.codexPlan.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  const { data: geminiPlan } = trpc.usage.geminiPlan.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: false,
  })

  const { data: githubStats } = trpc.github.commitStats.useQuery(undefined, {
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
    retry: false,
  })

  if (loadingToday && !today && loadingPlan && !plan) {
    return (
      <div className="px-2 pt-2 pb-1 border-t border-border/40 text-[10px] text-muted-foreground/40 select-none">
        <div className="flex items-center justify-between px-1 py-0.5">
          <span>Today</span>
          <span className="font-mono">…</span>
        </div>
      </div>
    )
  }

  const claude = today?.claude ?? null
  const codex = today?.codex ?? null
  const gemini = today?.gemini ?? null
  const planUsage = plan?.available ? plan.usage : null
  const codexPlanUsage = codexPlan?.available ? codexPlan.usage : null
  const geminiPlanUsage = geminiPlan?.available ? geminiPlan.usage : null
  const hasGeminiPlanRows =
    geminiPlanUsage !== null &&
    (geminiPlanUsage.primary !== null ||
      geminiPlanUsage.secondary !== null ||
      geminiPlanUsage.tertiary !== null)

  return (
    <div className="px-2 pt-2 pb-1 border-t border-border/40 text-[11px] select-none">
      {planUsage && (
        <>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 px-1 pb-0.5">
            Plan limits
          </div>
          {planUsage.fiveHour && (
            <PlanRow
              label="Current session"
              utilization={planUsage.fiveHour.utilization}
              resetsAt={planUsage.fiveHour.resetsAt}
              tooltipDescription="Rolling 5-hour window."
            />
          )}
          {planUsage.sevenDay && (
            <PlanRow
              label="Weekly · all models"
              utilization={planUsage.sevenDay.utilization}
              resetsAt={planUsage.sevenDay.resetsAt}
              tooltipDescription="Combined 7-day usage across all models."
            />
          )}
          {planUsage.sevenDaySonnet && (
            <PlanRow
              label="Weekly · Sonnet"
              utilization={planUsage.sevenDaySonnet.utilization}
              resetsAt={planUsage.sevenDaySonnet.resetsAt}
              tooltipDescription="7-day Sonnet-only quota."
            />
          )}
          {planUsage.sevenDayOpus && (
            <PlanRow
              label="Weekly · Opus"
              utilization={planUsage.sevenDayOpus.utilization}
              resetsAt={planUsage.sevenDayOpus.resetsAt}
              tooltipDescription="7-day Opus-only quota."
            />
          )}
          {planUsage.extraUsage?.isEnabled &&
            planUsage.extraUsage.utilization !== null && (
              <PlanRow
                label="Extra usage"
                utilization={planUsage.extraUsage.utilization}
                resetsAt={null}
                tooltipDescription={`${planUsage.extraUsage.usedCredits ?? 0} / ${planUsage.extraUsage.monthlyLimit ?? 0} ${planUsage.extraUsage.currency ?? ""}`.trim()}
              />
            )}
        </>
      )}

      {codexPlanUsage && (codexPlanUsage.primary || codexPlanUsage.secondary) && (
        <>
          {!planUsage && (
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 px-1 pb-0.5">
              Plan limits
            </div>
          )}
          {codexPlanUsage.primary && (
            <PlanRow
              label="Codex · current session"
              utilization={codexPlanUsage.primary.utilization}
              resetsAt={codexPlanUsage.primary.resetsAt}
              tooltipDescription="Codex 5-hour rolling window."
            />
          )}
          {codexPlanUsage.secondary && (
            <PlanRow
              label="Codex · weekly"
              utilization={codexPlanUsage.secondary.utilization}
              resetsAt={codexPlanUsage.secondary.resetsAt}
              tooltipDescription="Codex 7-day rolling window."
            />
          )}
        </>
      )}

      {hasGeminiPlanRows && geminiPlanUsage && (
        <>
          {!planUsage &&
            !(codexPlanUsage && (codexPlanUsage.primary || codexPlanUsage.secondary)) && (
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 px-1 pb-0.5">
                Plan limits
              </div>
            )}
          {geminiPlanUsage.primary && (
            <PlanRow
              label="Gemini · Pro"
              utilization={geminiPlanUsage.primary.utilization}
              resetsAt={geminiPlanUsage.primary.resetsAt}
              tooltipDescription="Gemini Pro models · 24-hour quota."
            />
          )}
          {geminiPlanUsage.secondary && (
            <PlanRow
              label="Gemini · Flash"
              utilization={geminiPlanUsage.secondary.utilization}
              resetsAt={geminiPlanUsage.secondary.resetsAt}
              tooltipDescription="Gemini Flash models · 24-hour quota."
            />
          )}
          {geminiPlanUsage.tertiary && (
            <PlanRow
              label="Gemini · Flash Lite"
              utilization={geminiPlanUsage.tertiary.utilization}
              resetsAt={geminiPlanUsage.tertiary.resetsAt}
              tooltipDescription="Gemini Flash Lite models · 24-hour quota."
            />
          )}
        </>
      )}

      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 px-1 pb-0.5 pt-1">
        Today
      </div>
      <ProviderRow
        label="Claude"
        tokens={claude?.tokens ?? 0}
        sessions={claude?.sessions ?? 0}
        available={claude !== null}
        breakdown={[
          { label: "Messages", value: claude?.messages ?? 0 },
          { label: "Sessions", value: claude?.sessions ?? 0 },
          { label: "Tool calls", value: claude?.toolCalls ?? 0 },
          { label: "Total tokens", value: claude?.tokens ?? 0 },
        ]}
      />
      <ProviderRow
        label="Codex"
        tokens={codex?.tokens ?? 0}
        sessions={codex?.sessions ?? 0}
        available={codex !== null}
        breakdown={[
          { label: "Sessions", value: codex?.sessions ?? 0 },
          { label: "Input tokens", value: codex?.inputTokens ?? 0 },
          { label: "Output tokens", value: codex?.outputTokens ?? 0 },
          { label: "Total tokens", value: codex?.tokens ?? 0 },
        ]}
      />
      <ProviderRow
        label="Gemini"
        tokens={gemini?.tokens ?? 0}
        sessions={gemini?.sessions ?? 0}
        available={gemini !== null}
        breakdown={[
          { label: "Sessions", value: gemini?.sessions ?? 0 },
          { label: "Input tokens", value: gemini?.inputTokens ?? 0 },
          { label: "Output tokens", value: gemini?.outputTokens ?? 0 },
          { label: "Total tokens", value: gemini?.tokens ?? 0 },
        ]}
      />
      {githubStats?.available && (
        <GithubCommitsRow
          today={githubStats.stats.today}
          week={githubStats.stats.week}
          month={githubStats.stats.month}
          login={githubStats.stats.login}
        />
      )}
    </div>
  )
})
