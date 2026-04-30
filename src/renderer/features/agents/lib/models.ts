export const CLAUDE_MODELS = [
  { id: "opus", name: "Opus", version: "4.7" },
  { id: "opus[1m]", name: "Opus", version: "4.7 1M" },
  { id: "sonnet", name: "Sonnet", version: "4.6" },
  { id: "haiku", name: "Haiku", version: "4.5" },
]

export type CodexThinkingLevel = "low" | "medium" | "high" | "xhigh"

export const CODEX_MODELS = [
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    thinkings: ["medium", "high"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.3-codex",
    name: "Codex 5.3",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.2-codex",
    name: "Codex 5.2",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.1-codex-max",
    name: "Codex 5.1 Max",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.1-codex-mini",
    name: "Codex 5.1 Mini",
    thinkings: ["medium", "high"] as CodexThinkingLevel[],
  },
]

export function formatCodexThinkingLabel(thinking: CodexThinkingLevel): string {
  if (thinking === "xhigh") return "Extra High"
  return thinking.charAt(0).toUpperCase() + thinking.slice(1)
}

export const GEMINI_MODELS = [
  { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", version: "Preview" },
  { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", version: "Preview" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", version: "Pro" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", version: "Flash" },
  { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", version: "Lite" },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", version: "Flash" },
]

