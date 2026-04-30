# Tasks

## 1. Auth plumbing

- [ ] 1.1 Create `src/main/lib/openrouter-auth-store.ts` mirroring `gemini-auth-store.ts` (safeStorage encrypt + JSON fallback).
- [ ] 1.2 Create `src/main/lib/trpc/routers/openrouter.ts` with `getAuthStatus`, `setApiKey`, `clearApiKey`, `testApiKey`.
- [ ] 1.3 Wire `openrouterRouter` into `createAppRouter` in `src/main/lib/trpc/routers/index.ts`.
- [ ] 1.4 Add OpenRouter API-key block to `agents-models-tab.tsx` matching the Gemini section.

## 2. Catalog & pin UI

- [ ] 2.1 Add `listModels` query to `openrouterRouter` that fetches `https://openrouter.ai/api/v1/models` and returns normalized `{ id, name, contextLength, pricing, description }`.
- [ ] 2.2 Add `pinnedOpenRouterModelsAtom` and `openRouterCatalogCacheAtom` to `src/renderer/lib/atoms/index.ts`.
- [ ] 2.3 Build `openrouter-model-browser.tsx` with search, virtualized list, pricing column, pin toggle.
- [ ] 2.4 Merge pinned models into the unified model list in `agents-models-tab.tsx` (extend `allModels` to include `provider: "openrouter"`).
- [ ] 2.5 Add `OpenRouterIcon` SVG and `OPENROUTER_PROVIDER` constant in `models.ts`.

## 3. Chat invocation

- [ ] 3.1 Install `@openrouter/ai-sdk-provider`.
- [ ] 3.2 Add `chat` subscription + `cancel`/`cleanup` mutations to `openrouterRouter`, modeled on `gemini.ts` chat flow but using the OpenRouter provider directly.
- [ ] 3.3 Persist usage events to `~/.1code-openrouter/sessions/.../{sessionId}.jsonl` via new `openrouter-usage.ts`.
- [ ] 3.4 Extend the `inferProviderFromMessages`/`getChatProvider` and provider-dispatch branches in `active-chat.tsx` to route pinned OpenRouter model IDs to the new subscription.

## 4. Sidebar usage stats

- [ ] 4.1 Create `src/main/lib/openrouter-plan-usage.ts` that calls `GET /api/v1/auth/key` and returns balance/limit/utilization.
- [ ] 4.2 Add `readOpenRouterToday()` aggregator (token + cost rollup) in `openrouter-usage.ts`.
- [ ] 4.3 Extend `usageRouter.today` to include OpenRouter; add `usageRouter.openRouterPlan` query.
- [ ] 4.4 Render fourth `ProviderRow` (tokens + USD cost) and `ProviderQuotaRow` (Credits) in `usage-stats-footer.tsx`.

## 5. Verification

- [ ] 5.1 Run `bun run build` and resolve any type errors.
- [ ] 5.2 Run `openspec validate add-openrouter-provider --strict --no-interactive`.
