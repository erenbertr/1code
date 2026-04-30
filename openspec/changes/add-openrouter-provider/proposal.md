# Change: Add OpenRouter as a fourth AI provider

## Why

Users want access to OpenRouter's catalog (200+ models including Claude, GPT, Llama, Mistral, DeepSeek, Qwen) through a single API key, with full control over which models appear in the in-chat picker and live visibility into pay-as-you-go cost. None of the existing providers (Anthropic Claude, Codex, Gemini) cover OpenAI-compatible third-party model routing or USD-cost-tracked usage.

## What Changes

- **ADDED** OpenRouter API key management — encrypted via Electron `safeStorage`, with mask/test/clear flows mirroring the Gemini provider.
- **ADDED** OpenRouter model catalog — live-fetched from `https://openrouter.ai/api/v1/models`, browseable with search and pricing display in Settings → Models.
- **ADDED** Pin-to-enable workflow — OpenRouter's catalog is too large to enable wholesale; users pin only the models they want, and pinned models are merged into the existing model picker.
- **ADDED** OpenRouter chat invocation — uses `@openrouter/ai-sdk-provider` with the existing `streamText` plumbing from the Gemini integration. Chat-only for first ship; tool calls are out of scope.
- **ADDED** USD cost + token tracking — per-request usage events written to JSONL (`~/.1code-openrouter/sessions/YYYY/MM/DD/{sessionId}.jsonl`); aggregated for the sidebar footer.
- **ADDED** Live credit-balance polling — `GET /api/v1/auth/key` populates a "Credits" quota chip in the sidebar.

## Impact

- **Affected specs:** none existing — new capability `openrouter-provider`.
- **Affected code:**
  - New: `src/main/lib/openrouter-auth-store.ts`, `src/main/lib/openrouter-usage.ts`, `src/main/lib/openrouter-plan-usage.ts`, `src/main/lib/trpc/routers/openrouter.ts`, `src/renderer/components/dialogs/settings-tabs/openrouter-model-browser.tsx`.
  - Edited: `src/main/lib/trpc/routers/index.ts`, `src/main/lib/trpc/routers/usage.ts`, `src/renderer/components/dialogs/settings-tabs/agents-models-tab.tsx`, `src/renderer/features/sidebar/usage-stats-footer.tsx`, `src/renderer/features/agents/lib/models.ts`, `src/renderer/features/agents/main/active-chat.tsx`, `src/renderer/features/agents/atoms/index.ts`.
- **New dependency:** `@openrouter/ai-sdk-provider` (peer of `ai` SDK already in tree).
- **No DB migration** — keys/usage live outside SQLite (safeStorage + JSONL).
