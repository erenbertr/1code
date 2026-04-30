# OpenRouter Provider

## ADDED Requirements

### Requirement: API Key Management

The application SHALL allow a user to provide a single OpenRouter API key, store it encrypted at rest using Electron `safeStorage`, and surface the key's presence with a masked display in Settings → Models.

#### Scenario: Saving a valid key

- **WHEN** a user enters an OpenRouter API key starting with `sk-or-` and blurs the input
- **THEN** the key is encrypted via `safeStorage` and persisted to `{userData}/data/openrouter-auth.dat`
- **AND** the Settings UI shows an "Active" badge plus a masked preview (first 4, last 4 characters)

#### Scenario: Rejecting an invalid prefix

- **WHEN** a user enters a string that does not start with `sk-or-`
- **THEN** the input is rejected with an inline toast and the previous state is preserved

#### Scenario: Removing a saved key

- **WHEN** a user clicks the trash icon next to the API key field
- **THEN** the encrypted file and any plaintext fallback are deleted
- **AND** the "Active" badge is removed and the placeholder returns to `sk-or-...`

### Requirement: Model Catalog Browse and Pin

The application SHALL fetch OpenRouter's live model catalog and let users pin individual models for use, persisting the pinned set across restarts.

#### Scenario: Browsing the catalog

- **WHEN** a user opens the OpenRouter section in Settings → Models with a saved key
- **THEN** the renderer calls `trpc.openrouter.listModels`, the main process fetches `https://openrouter.ai/api/v1/models`, and a searchable list of models with name, context length, and prompt/completion pricing is rendered

#### Scenario: Pinning a model

- **WHEN** a user toggles the pin switch on a model row
- **THEN** the model id is added to (or removed from) `pinnedOpenRouterModelsAtom`
- **AND** the unified model list at the top of the Models tab includes only pinned OpenRouter models alongside Claude/Codex/Gemini models

#### Scenario: Catalog cache

- **WHEN** the catalog has been fetched within the last 6 hours
- **THEN** the renderer reuses the cached result and the "Refresh" button forces a re-fetch

### Requirement: OpenRouter Chat Invocation

The application SHALL stream chat completions from any pinned OpenRouter model using the configured API key, and persist the resulting messages to the same `sub_chats.messages` JSON column used by other providers.

#### Scenario: Successful streamed response

- **WHEN** a user selects a pinned OpenRouter model in a chat and sends a prompt
- **THEN** the main process opens a `streamText` against `@openrouter/ai-sdk-provider`, forwards UI message stream chunks via the `openrouter.chat` subscription, and persists the assistant message on completion

#### Scenario: Cancellation

- **WHEN** a user clicks Cancel during an in-flight OpenRouter stream
- **THEN** the corresponding `AbortController` aborts, the subscription emits `{ type: "finish" }`, and no partial assistant message is persisted

#### Scenario: Authentication failure

- **WHEN** OpenRouter returns 401 for an invalid key
- **THEN** the subscription emits a humanized error advising the user to re-enter their key in Settings

### Requirement: Usage Tracking and Stats

The application SHALL record per-request OpenRouter usage (input tokens, output tokens, USD cost, model id, timestamp) to JSONL files and surface aggregated daily totals plus live credit balance in the left sidebar usage footer.

#### Scenario: Recording a request

- **WHEN** an OpenRouter chat stream completes with a `usage` payload
- **THEN** an entry of shape `{ type: "usage", sessionId, modelId, inputTokens, outputTokens, totalTokens, costUsd, timestamp }` is appended to `~/.1code-openrouter/sessions/YYYY/MM/DD/{sessionId}.jsonl`

#### Scenario: Today's totals in the sidebar

- **WHEN** the sidebar usage footer renders
- **THEN** an "OpenRouter" row displays today's total tokens and session count
- **AND** the row's tooltip shows the breakdown including total USD spend

#### Scenario: Live credit balance

- **WHEN** the sidebar's `openRouterPlan` query polls every 60 seconds
- **THEN** `GET https://openrouter.ai/api/v1/auth/key` is called with the saved key
- **AND** a "Credits" quota chip displays the remaining balance and utilization

#### Scenario: No usage when no key

- **WHEN** no OpenRouter API key is saved
- **THEN** the OpenRouter row is hidden from the footer and the credits chip is not rendered
