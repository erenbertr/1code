import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { observable } from "@trpc/server/observable"
import { convertToModelMessages, streamText } from "ai"
import { eq } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { z } from "zod"
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

const activeStreams = new Map<string, ActiveGeminiStream>()

export function hasActiveGeminiStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllGeminiStreams(): void {
  for (const stream of activeStreams.values()) {
    stream.controller.abort()
  }
  activeStreams.clear()
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

// Convert a UIMessage stored in our DB into the shape convertToModelMessages expects.
// Replaces our custom data-image parts with file parts, and inlines file-content text.
function normalizeMessageForModel(message: any): any {
  if (!message || !Array.isArray(message.parts)) return message

  const normalizedParts: any[] = []
  const inlinedFileContents: string[] = []

  for (const part of message.parts) {
    if (!part || typeof part !== "object") continue

    if (part.type === "text" && typeof part.text === "string") {
      normalizedParts.push({ type: "text", text: part.text })
      continue
    }

    if (part.type === "data-image" && part.data) {
      const data = part.data
      const base64 = typeof data.base64Data === "string" ? data.base64Data : null
      const mediaType =
        typeof data.mediaType === "string" ? data.mediaType : "image/png"
      if (base64) {
        normalizedParts.push({
          type: "file",
          mediaType,
          data: base64,
          ...(data.filename ? { filename: data.filename } : {}),
        })
      }
      continue
    }

    if (part.type === "file-content" && typeof part.content === "string") {
      const filePath =
        typeof part.filePath === "string" ? part.filePath : "file"
      const fileName = filePath.split("/").pop() || filePath
      inlinedFileContents.push(`\n--- ${fileName} ---\n${part.content}`)
      continue
    }
  }

  if (inlinedFileContents.length > 0) {
    const lastTextIndex = [...normalizedParts]
      .map((p, i) => (p.type === "text" ? i : -1))
      .filter((i) => i >= 0)
      .pop()
    if (typeof lastTextIndex === "number" && lastTextIndex >= 0) {
      normalizedParts[lastTextIndex] = {
        type: "text",
        text:
          (normalizedParts[lastTextIndex].text || "") +
          inlinedFileContents.join(""),
      }
    } else {
      normalizedParts.push({
        type: "text",
        text: inlinedFileContents.join(""),
      })
    }
  }

  return { ...message, parts: normalizedParts }
}

export const geminiRouter = router({
  getAuthStatus: publicProcedure.query((): GeminiAuthStatus => {
    return getGeminiAuthStatus()
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
        sessionId: z.string().optional(),
        images: z.array(imageAttachmentSchema).optional(),
      }),
    )
    .subscription(({ input }) => {
      return observable<any>((emit) => {
        const existingStream = activeStreams.get(input.subChatId)
        if (existingStream) {
          existingStream.cancelRequested = true
          existingStream.controller.abort()
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
            const apiKey = loadGeminiApiKey()
            if (!apiKey) {
              safeEmit({
                type: "error",
                errorText:
                  "No Gemini API key configured. Add one in Settings → Models.",
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
            const sessionId = input.sessionId ?? randomUUID()

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

            const provider = createGoogleGenerativeAI({ apiKey })
            const languageModel = provider(input.modelId)

            const normalizedMessages = messagesForStream.map(
              normalizeMessageForModel,
            )
            const modelMessages = await convertToModelMessages(
              normalizedMessages,
            )

            const startedAt = Date.now()
            const result = streamText({
              model: languageModel,
              messages: modelMessages,
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
                    sessionId,
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
                    sessionId,
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
      const activeStream = activeStreams.get(input.subChatId)
      if (activeStream) {
        activeStream.controller.abort()
        activeStreams.delete(input.subChatId)
      }
      return { success: true }
    }),
})
