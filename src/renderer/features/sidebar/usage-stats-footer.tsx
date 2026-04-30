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

export const UsageStatsFooter = memo(function UsageStatsFooter() {
  const { data, isLoading } = trpc.usage.today.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })

  if (isLoading && !data) {
    return (
      <div className="px-2 pt-2 pb-1 border-t border-border/40 text-[10px] text-muted-foreground/40 select-none">
        <div className="flex items-center justify-between px-1 py-0.5">
          <span>Today</span>
          <span className="font-mono">…</span>
        </div>
      </div>
    )
  }

  const claude = data?.claude ?? null
  const codex = data?.codex ?? null

  return (
    <div className="px-2 pt-2 pb-1 border-t border-border/40 text-[11px] select-none">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 px-1 pb-0.5">
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
    </div>
  )
})
