import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { observable } from "@trpc/server/observable"
import { streamText } from "ai"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import {
  clearGeminiApiKey,
  getGeminiAuthStatus,
  loadGeminiApiKey,
  saveGeminiApiKey,
  type GeminiAuthStatus,
} from "../../gemini-auth-store"
import { appendGeminiUsage } from "../../gemini-usage"
import { publicProcedure, router } from "../index"

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
})

type GeminiStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "finish"; usage: { input: number; output: number; total: number } }
  | { type: "error"; message: string }

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
  stream: publicProcedure
    .input(
      z.object({
        modelId: z.string().min(1),
        sessionId: z.string().optional(),
        messages: z.array(messageSchema).min(1),
      }),
    )
    .subscription(({ input }) => {
      return observable<GeminiStreamEvent>((emit) => {
        const apiKey = loadGeminiApiKey()
        if (!apiKey) {
          emit.next({
            type: "error",
            message:
              "No Gemini API key configured. Add one in Settings → Models.",
          })
          emit.complete()
          return () => undefined
        }

        const sessionId = input.sessionId ?? randomUUID()
        const provider = createGoogleGenerativeAI({ apiKey })
        const model = provider(input.modelId)

        let cancelled = false

        const run = async (): Promise<void> => {
          try {
            const result = streamText({
              model,
              messages: input.messages,
            })
            for await (const delta of result.textStream) {
              if (cancelled) return
              if (delta) emit.next({ type: "text-delta", text: delta })
            }
            const usage = await result.usage
            const inputTokens = usage?.inputTokens ?? 0
            const outputTokens = usage?.outputTokens ?? 0
            const totalTokens = usage?.totalTokens ?? inputTokens + outputTokens
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
            emit.next({
              type: "finish",
              usage: {
                input: inputTokens,
                output: outputTokens,
                total: totalTokens,
              },
            })
            emit.complete()
          } catch (error) {
            emit.next({
              type: "error",
              message:
                error instanceof Error ? error.message : "Stream failed",
            })
            emit.complete()
          }
        }

        void run()

        return () => {
          cancelled = true
        }
      })
    }),
})
