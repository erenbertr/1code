# Design

## Context

OpenRouter is a HTTP gateway to ~200 third-party LLMs with an OpenAI-compatible chat-completions API and per-request USD cost reporting. Users on this app already manage three providers (Claude, Codex, Gemini); OpenRouter adds a fourth that is qualitatively different in three ways: (1) the catalog is too large to enable wholesale, (2) cost-per-request is the headline metric (not tokens or sessions), and (3) authentication is a single API key with no OAuth/CLI variant.

## Goals / Non-Goals

- **Goals**
  - One-paste API-key entry with masking, encryption at rest, and a "test" round-trip.
  - User picks which models from the live catalog to expose in the in-chat picker.
  - Sidebar usage row shows tokens and USD cost; quota row shows live credit balance.
  - Zero schema migration; mirror the Gemini provider's storage layout.
- **Non-Goals**
  - Tool calls / function calls in the first ship — OpenRouter passes them through but our chat path does not yet exercise them; deferred to a follow-up change.
  - Multi-account OpenRouter support — one key per install.
  - Replacing the existing `customClaudeConfigAtom` "Override Model" path. It remains for power users who want a raw Anthropic-compatible base URL override.

## Decisions

### D1: API key storage — Electron `safeStorage`

Mirror `gemini-auth-store.ts` exactly. File at `{userData}/data/openrouter-auth.dat` (encrypted) with `openrouter-auth.json` plaintext fallback for environments where `safeStorage.isEncryptionAvailable()` is false. No DB table. Validation prefix: `sk-or-`.

**Alternatives considered:** Drizzle table → rejected as overkill for a single-tenant per-install secret.

### D2: Invocation — `@openrouter/ai-sdk-provider`

The Gemini integration already uses `streamText` from `ai`, plus a fork-specific provider (`@mcpc-tech/acp-ai-provider`). OpenRouter ships an official `@openrouter/ai-sdk-provider` that returns a `LanguageModelV1` plug-compatible with the same `streamText` surface, including `result.usage` resolving to `{ inputTokens, outputTokens, totalTokens, cost }`. This minimizes new code in the streaming/abort path.

**Alternatives considered:**
- Hand-rolled `fetch` + SSE parser → more code, no benefit.
- Reuse the `customClaudeConfigAtom` override path → fails the "select models" and "stats" requirements; relies on environment-variable injection into the Claude SDK which is not the right shape.

### D3: New provider, not replacement

Add a fourth provider tag `"openrouter"` alongside `"claude-code" | "codex" | "gemini"` everywhere the discriminator appears (`active-chat.tsx` provider type, `agents-models-tab.tsx` icon switch, sidebar footer rows). Existing chats with Claude/Codex/Gemini messages stay on those providers via `inferProviderFromMessages`.

### D4: Catalog freshness — live fetch with localStorage cache

`openrouter-model-browser.tsx` calls `trpc.openrouter.listModels` on open; the main process performs the HTTP fetch (no auth needed for `/models`) and caches in-memory for 5 minutes. The renderer caches the parsed result in `atomWithStorage` (`openRouterCatalogCacheAtom`) with a 6-hour TTL plus a manual Refresh button. Hardcoding the catalog is rejected — OR adds models weekly.

### D5: Pin model — opt-in via `pinnedOpenRouterModelsAtom`

The existing `hiddenModelsAtom` is opt-out (default visible). Inverting it for OpenRouter would auto-show every new OR model. Instead, OR uses a separate **pinned** set: only pinned models surface in the picker. This is consistent with how users actually want to interact with a 200-model catalog.

### D6: Usage tracking — per-request JSONL with USD

Mirror `gemini-usage.ts` but include `cost: number` (USD float). Aggregator `readOpenRouterToday()` returns `{ tokens, inputTokens, outputTokens, sessions, costUsd }`. The footer shows tokens as the headline number for visual consistency with other rows; USD is surfaced in the tooltip and as a separate "Spend" cell in the quota row.

## Risks / Trade-offs

| Risk | Severity | Mitigation |
|---|---|---|
| API key leakage in tRPC error envelopes | High | Wrap fetch errors; never echo the key. Log only HTTP status + first 4/last 4 of key. |
| Cost surprise on expensive models | High | Pricing column is mandatory in the browser; tooltip shows `$X / 1M tokens` for prompt and completion. |
| `@openrouter/ai-sdk-provider` package quality | Medium | Pin a known-good version; if it churns, fallback is direct fetch using `ai`'s `LanguageModelV1` interface. |
| Catalog staleness | Medium | Live fetch; manual Refresh button; cache TTL of 6 hours. |
| 429 rate limits | Medium | `humanizeOpenRouterError` parses the response; surfaces in chat UI like the existing `humanizeGeminiError`. |
| `/auth/key` endpoint shape varies (free tier vs. paid) | Low | Treat null `limit` as "unlimited"; render `—` for utilization. |

## Migration Plan

No migration. New capability; existing users see an empty OpenRouter section in Settings until they paste a key.

## Open Questions

- Should expensive models (>$10 per 1M tokens) display a confirm dialog before first use? **Deferred** to follow-up; out of scope for this change.
- Is there value in displaying the "Sessions" count for OpenRouter, given that requests can be one-shot? **Yes** — keeping the row format consistent across providers reduces UI complexity even if the count is not the primary metric.
