import { createACPProvider, type ACPProvider } from "@mcpc-tech/acp-ai-provider"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { observable } from "@trpc/server/observable"
import { streamText } from "ai"
import { eq } from "drizzle-orm"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { getClaudeShellEnvironment } from "../../claude/env"
import { getDatabase, subChats } from "../../db"
import {
  clearGeminiApiKey,
  getGeminiAuthStatus,
  loadGeminiApiKey,
  saveGeminiApiKey,
  type GeminiAuthStatus,
} from "../../gemini-auth-store"
import { appendGeminiUsage } from "../../gemini-usage"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

type ActiveGeminiStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

type GeminiProviderSession = {
  provider: ACPProvider
  cwd: string
  binaryPath: string
}

const activeStreams = new Map<string, ActiveGeminiStream>()
const providerSessions = new Map<string, GeminiProviderSession>()

const COMMON_GEMINI_BINARY_PATHS = [
  "/opt/homebrew/bin/gemini",
  "/usr/local/bin/gemini",
  join(homedir(), ".local/bin/gemini"),
  join(homedir(), ".npm-global/bin/gemini"),
]

let cachedGeminiBinaryPath: string | null = null

function resolveGeminiBinaryPath(): string | null {
  if (cachedGeminiBinaryPath && existsSync(cachedGeminiBinaryPath)) {
    return cachedGeminiBinaryPath
  }

  const binaryName = process.platform === "win32" ? "gemini.exe" : "gemini"

  try {
    const shellEnv = getClaudeShellEnvironment()
    const pathEnv = shellEnv.PATH || process.env.PATH || ""
    for (const dir of pathEnv.split(delimiter)) {
      if (!dir) continue
      const candidate = join(dir, binaryName)
      if (existsSync(candidate)) {
        cachedGeminiBinaryPath = candidate
        return candidate
      }
    }
  } catch {
    // fall through to common paths
  }

  for (const candidate of COMMON_GEMINI_BINARY_PATHS) {
    if (existsSync(candidate)) {
      cachedGeminiBinaryPath = candidate
      return candidate
    }
  }

  return null
}

function buildGeminiSpawnEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  try {
    Object.assign(env, getClaudeShellEnvironment())
  } catch {
    // fall back to process.env
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  return env
}

function getOrCreateProvider(params: {
  subChatId: string
  cwd: string
  binaryPath: string
  existingSessionId?: string
}): ACPProvider {
  const existing = providerSessions.get(params.subChatId)

  if (
    existing &&
    existing.cwd === params.cwd &&
    existing.binaryPath === params.binaryPath
  ) {
    return existing.provider
  }

  if (existing) {
    existing.provider.cleanup()
    providerSessions.delete(params.subChatId)
  }

  const provider = createACPProvider({
    command: params.binaryPath,
    args: ["--acp"],
    env: buildGeminiSpawnEnv(),
    session: {
      cwd: params.cwd,
      mcpServers: [],
    },
    ...(params.existingSessionId
      ? { existingSessionId: params.existingSessionId }
      : {}),
    persistSession: true,
  })

  providerSessions.set(params.subChatId, {
    provider,
    cwd: params.cwd,
    binaryPath: params.binaryPath,
  })

  return provider
}

function cleanupProvider(subChatId: string): void {
  const existing = providerSessions.get(subChatId)
  if (!existing) return
  existing.provider.cleanup()
  providerSessions.delete(subChatId)
}

export function hasActiveGeminiStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllGeminiStreams(): void {
  for (const stream of activeStreams.values()) {
    stream.controller.abort()
  }
  activeStreams.clear()
  for (const subChatId of [...providerSessions.keys()]) {
    cleanupProvider(subChatId)
  }
}

function parseStoredMessages(raw: string | null | undefined): any[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function extractPromptFromStoredMessage(message: any): string {
  if (!message || !Array.isArray(message.parts)) return ""

  const textParts: string[] = []
  const fileContents: string[] = []

  for (const part of message.parts) {
    if (part?.type === "text" && typeof part.text === "string") {
      textParts.push(part.text)
    } else if (part?.type === "file-content") {
      const filePath =
        typeof part.filePath === "string" ? part.filePath : undefined
      const fileName = filePath?.split("/").pop() || filePath || "file"
      const content = typeof part.content === "string" ? part.content : ""
      fileContents.push(`\n--- ${fileName} ---\n${content}`)
    }
  }

  return textParts.join("\n") + fileContents.join("")
}

function getLastSessionId(messages: any[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const meta = messages[i]?.metadata
    if (meta && typeof meta.sessionId === "string" && meta.sessionId) {
      return meta.sessionId
    }
  }
  return undefined
}

function buildUserParts(
  prompt: string,
  images:
    | Array<{
        base64Data?: string
        mediaType?: string
        filename?: string
      }>
    | undefined,
): any[] {
  const parts: any[] = [{ type: "text", text: prompt }]

  if (images && images.length > 0) {
    for (const image of images) {
      if (!image.base64Data || !image.mediaType) continue
      parts.push({
        type: "data-image",
        data: {
          base64Data: image.base64Data,
          mediaType: image.mediaType,
          filename: image.filename,
        },
      })
    }
  }

  return parts
}

function buildModelMessageContent(
  prompt: string,
  images:
    | Array<{
        base64Data?: string
        mediaType?: string
        filename?: string
      }>
    | undefined,
): any[] {
  const content: any[] = [{ type: "text", text: prompt }]

  if (images && images.length > 0) {
    for (const image of images) {
      if (!image.base64Data || !image.mediaType) continue
      content.push({
        type: "file",
        mediaType: image.mediaType,
        data: image.base64Data,
        ...(image.filename ? { filename: image.filename } : {}),
      })
    }
  }

  return content
}

export const geminiRouter = router({
  getAuthStatus: publicProcedure.query((): GeminiAuthStatus => {
    return getGeminiAuthStatus()
  }),

  getCliStatus: publicProcedure.query(() => {
    const binaryPath = resolveGeminiBinaryPath()
    const geminiHome = join(homedir(), ".gemini")
    const homeExists = existsSync(geminiHome)
    return {
      installed: Boolean(binaryPath),
      binaryPath,
      loggedIn: homeExists,
      geminiHome: homeExists ? geminiHome : null,
    }
  }),

  setApiKey: publicProcedure
    .input(z.object({ apiKey: z.string().min(1) }))
    .mutation(({ input }) => {
      saveGeminiApiKey(input.apiKey)
      return getGeminiAuthStatus()
    }),

  clearApiKey: publicProcedure.mutation(() => {
    clearGeminiApiKey()
    return getGeminiAuthStatus()
  }),

  testApiKey: publicProcedure
    .input(z.object({ apiKey: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const provider = createGoogleGenerativeAI({ apiKey: input.apiKey })
        const model = provider("gemini-2.0-flash-lite")
        const result = streamText({
          model,
          messages: [{ role: "user", content: "ping" }],
          maxOutputTokens: 4,
        })
        for await (const _ of result.textStream) {
          break
        }
        await result.finishReason
        return { ok: true as const }
      } catch (error) {
        return {
          ok: false as const,
          error:
            error instanceof Error ? error.message : "Unable to validate key",
        }
      }
    }),

  chat: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        chatId: z.string(),
        runId: z.string(),
        prompt: z.string(),
        modelId: z.string().min(1),
        cwd: z.string().optional(),
        sessionId: z.string().optional(),
        forceNewSession: z.boolean().optional(),
        images: z.array(imageAttachmentSchema).optional(),
      }),
    )
    .subscription(({ input }) => {
      return observable<any>((emit) => {
        const existingStream = activeStreams.get(input.subChatId)
        if (existingStream) {
          existingStream.cancelRequested = true
          existingStream.controller.abort()
          cleanupProvider(input.subChatId)
        }

        const abortController = new AbortController()
        activeStreams.set(input.subChatId, {
          runId: input.runId,
          controller: abortController,
          cancelRequested: false,
        })

        let isActive = true

        const safeEmit = (chunk: any) => {
          if (!isActive) return
          try {
            emit.next(chunk)
          } catch {
            isActive = false
          }
        }

        const safeComplete = () => {
          if (!isActive) return
          isActive = false
          try {
            emit.complete()
          } catch {
            // ignore double completion
          }
        }

        ;(async () => {
          try {
            const binaryPath = resolveGeminiBinaryPath()
            if (!binaryPath) {
              safeEmit({
                type: "error",
                errorText:
                  "Gemini CLI not found. Install it with `npm install -g @google/gemini-cli` (or `brew install gemini-cli`) and run `gemini` once to log in.",
              })
              safeEmit({ type: "finish" })
              safeComplete()
              return
            }

            const db = getDatabase()
            const existingSubChat = db
              .select()
              .from(subChats)
              .where(eq(subChats.id, input.subChatId))
              .get()

            if (!existingSubChat) {
              throw new Error("Sub-chat not found")
            }

            const existingMessages = parseStoredMessages(
              existingSubChat.messages,
            )

            const lastMessage = existingMessages[existingMessages.length - 1]
            const isDuplicatePrompt =
              lastMessage?.role === "user" &&
              extractPromptFromStoredMessage(lastMessage) === input.prompt

            let messagesForStream = existingMessages

            const isAuthoritativeRun = () => {
              const currentStream = activeStreams.get(input.subChatId)
              return !currentStream || currentStream.runId === input.runId
            }

            const persistSubChatMessages = (messages: any[]) => {
              if (!isAuthoritativeRun()) return false
              db.update(subChats)
                .set({
                  messages: JSON.stringify(messages),
                  updatedAt: new Date(),
                })
                .where(eq(subChats.id, input.subChatId))
                .run()
              return true
            }

            if (!isDuplicatePrompt) {
              const userMessage = {
                id: crypto.randomUUID(),
                role: "user",
                parts: buildUserParts(input.prompt, input.images),
                metadata: { model: input.modelId },
              }
              messagesForStream = [...existingMessages, userMessage]
              persistSubChatMessages(messagesForStream)
            }

            if (input.forceNewSession) {
              cleanupProvider(input.subChatId)
            }

            const cwd = input.cwd && input.cwd.trim() ? input.cwd : process.cwd()

            const provider = getOrCreateProvider({
              subChatId: input.subChatId,
              cwd,
              binaryPath,
              existingSessionId: input.forceNewSession
                ? undefined
                : input.sessionId ?? getLastSessionId(existingMessages),
            })

            const startedAt = Date.now()
            let latestSessionId =
              provider.getSessionId() ||
              input.sessionId ||
              getLastSessionId(existingMessages) ||
              randomUUID()

            const result = streamText({
              model: provider.languageModel(input.modelId),
              messages: [
                {
                  role: "user",
                  content: buildModelMessageContent(input.prompt, input.images),
                },
              ],
              tools: provider.tools,
              abortSignal: abortController.signal,
            })

            const cleanAssistantMessageForPersistence = (message: any) => {
              if (!message || message.role !== "assistant") return message
              if (!Array.isArray(message.parts)) return message
              const cleanedParts = message.parts.filter(
                (part: any) => part?.state !== "input-streaming",
              )
              if (cleanedParts.length === 0) return null
              return { ...message, parts: cleanedParts }
            }

            const uiStream = result.toUIMessageStream({
              originalMessages: messagesForStream,
              generateMessageId: () => crypto.randomUUID(),
              messageMetadata: ({ part }) => {
                const sessionId = provider.getSessionId() || latestSessionId
                if (sessionId) latestSessionId = sessionId

                if (part.type === "finish") {
                  return {
                    model: input.modelId,
                    sessionId,
                    durationMs: Date.now() - startedAt,
                    resultSubtype:
                      part.finishReason === "error" ? "error" : "success",
                  }
                }
                return { model: input.modelId, sessionId }
              },
              onFinish: async ({ responseMessage, isContinuation }) => {
                try {
                  const cleaned =
                    cleanAssistantMessageForPersistence(responseMessage)
                  if (!cleaned) {
                    persistSubChatMessages(messagesForStream)
                    return
                  }
                  const messagesToPersist = [
                    ...(isContinuation
                      ? messagesForStream.slice(0, -1)
                      : messagesForStream),
                    cleaned,
                  ]
                  persistSubChatMessages(messagesToPersist)
                } catch (error) {
                  console.error("[gemini] Failed to persist messages:", error)
                }
              },
              onError: (error) =>
                error instanceof Error ? error.message : "Stream failed",
            })

            const reader = uiStream.getReader()
            let pendingFinishChunk: any | null = null
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              if (value?.type === "error") {
                safeEmit({
                  ...value,
                  errorText:
                    typeof (value as any).errorText === "string"
                      ? (value as any).errorText
                      : "Stream failed",
                })
                continue
              }

              if (value?.type === "finish") {
                pendingFinishChunk = value
                continue
              }

              safeEmit(value)
            }

            try {
              const usage = await result.usage
              const inputTokens = usage?.inputTokens ?? 0
              const outputTokens = usage?.outputTokens ?? 0
              const totalTokens =
                usage?.totalTokens ?? inputTokens + outputTokens

              if (inputTokens || outputTokens) {
                try {
                  await appendGeminiUsage({
                    sessionId: latestSessionId,
                    modelId: input.modelId,
                    inputTokens,
                    outputTokens,
                    totalTokens,
                    timestamp: new Date().toISOString(),
                  })
                } catch (error) {
                  console.error("[gemini] failed to append usage", error)
                }

                safeEmit({
                  type: "message-metadata",
                  messageMetadata: {
                    model: input.modelId,
                    sessionId: latestSessionId,
                    inputTokens,
                    outputTokens,
                    totalTokens,
                    durationMs: Date.now() - startedAt,
                  },
                })
              }
            } catch (error) {
              console.error("[gemini] failed to read usage", error)
            }

            if (pendingFinishChunk) {
              safeEmit(pendingFinishChunk)
            } else {
              safeEmit({ type: "finish" })
            }

            safeComplete()
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Stream failed"
            console.error("[gemini] chat stream error:", error)
            safeEmit({ type: "error", errorText: message })
            safeEmit({ type: "finish" })
            safeComplete()
          } finally {
            const activeStream = activeStreams.get(input.subChatId)
            if (activeStream?.runId === input.runId) {
              const shouldCleanup =
                abortController.signal.aborted || activeStream.cancelRequested
              if (shouldCleanup) {
                cleanupProvider(input.subChatId)
              }
              activeStreams.delete(input.subChatId)
            }
          }
        })()

        return () => {
          isActive = false
          abortController.abort()
          const activeStream = activeStreams.get(input.subChatId)
          if (activeStream?.runId === input.runId) {
            activeStream.cancelRequested = true
          }
        }
      })
    }),

  cancel: publicProcedure
    .input(z.object({ subChatId: z.string(), runId: z.string() }))
    .mutation(({ input }) => {
      const activeStream = activeStreams.get(input.subChatId)
      if (!activeStream) return { cancelled: false, ignoredStale: false }
      if (activeStream.runId !== input.runId) {
        return { cancelled: false, ignoredStale: true }
      }
      activeStream.cancelRequested = true
      activeStream.controller.abort()
      return { cancelled: true, ignoredStale: false }
    }),

  cleanup: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .mutation(({ input }) => {
      cleanupProvider(input.subChatId)
      const activeStream = activeStreams.get(input.subChatId)
      if (activeStream) {
        activeStream.controller.abort()
        activeStreams.delete(input.subChatId)
      }
      return { success: true }
    }),
})
