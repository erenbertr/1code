/**
 * Plays a short two-note rising chime via Web Audio API to signal that the
 * model is asking a question and waiting for the user. Distinct from the
 * standard completion sound (sound.mp3) so the user can tell them apart by ear.
 */

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext
  const Ctx =
    (typeof window !== "undefined" && (window as any).AudioContext) ||
    (typeof window !== "undefined" && (window as any).webkitAudioContext)
  if (!Ctx) return null
  try {
    audioContext = new Ctx()
    return audioContext
  } catch {
    return null
  }
}

export function playQuestionSound(): void {
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {})
    }

    const now = ctx.currentTime
    // Rising two-note chime: E5 → A5
    const notes: Array<{ freq: number; offset: number; duration: number }> = [
      { freq: 659.25, offset: 0, duration: 0.18 },
      { freq: 880.0, offset: 0.16, duration: 0.26 },
    ]

    for (const note of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.setValueAtTime(note.freq, now + note.offset)

      const startAt = now + note.offset
      const endAt = startAt + note.duration
      gain.gain.setValueAtTime(0.0001, startAt)
      gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(startAt)
      osc.stop(endAt + 0.05)
    }
  } catch {
    // ignore audio errors
  }
}
