/**
 * The optional HD voice: Kokoro, a small open-source (Apache-2.0) speech model that runs on the visitor's own
 * device through WebAssembly. Nothing the coach says is sent anywhere. It costs a one-time download of about
 * 90 MB (kept by the browser afterwards), so it is off until the visitor asks for it, the library is only
 * loaded then, and the browser's own voice speaks until the model is ready (and whenever it fails).
 */

const KEY = 'coach-hd-voice'
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
/** A calm American male voice; the others are listed in the kokoro-js readme. */
const VOICE = 'am_michael'

export type HdState = 'off' | 'loading' | 'ready' | 'failed'

interface Engine {
  generate(text: string, options: { voice: typeof VOICE }): Promise<{ audio: Float32Array; sampling_rate: number }>
}

let state: HdState = readWanted() ? 'loading' : 'off'
let progress = 0
let engine: Promise<Engine> | null = null
const listeners = new Set<() => void>()
let snapshot: { state: HdState; progress: number } = { state, progress }

function readWanted(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

function set(next: HdState, pct = progress): void {
  state = next
  progress = pct
  snapshot = { state, progress }
  for (const l of listeners) l()
}

export function subscribeHd(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
/** A stable object between changes, so it works with useSyncExternalStore. */
export function hdSnapshot(): { state: HdState; progress: number } {
  return snapshot
}

export function hdSupported(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof AudioContext !== 'undefined'
}

function load(): Promise<Engine> {
  if (!engine) {
    set('loading', 0)
    engine = import('kokoro-js')
      .then(({ KokoroTTS }) =>
        KokoroTTS.from_pretrained(MODEL, {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
            // Several files download; the big model file is the one that moves the bar.
            if (info.status === 'progress' && typeof info.progress === 'number' && info.file?.endsWith('.onnx')) set('loading', Math.round(info.progress))
          },
        }),
      )
      .then((tts) => {
        set('ready', 100)
        return tts as unknown as Engine
      })
      .catch((error: unknown) => {
        engine = null
        set('failed', 0)
        throw error
      })
    // The caller handles the failure; this only keeps an unhandled-rejection warning away.
    engine.catch(() => {})
  }
  return engine
}

/** Turn the HD voice on (starting the download) or off. */
export function setHdWanted(wanted: boolean): void {
  try {
    window.localStorage.setItem(KEY, wanted ? '1' : '0')
  } catch {
    /* a blocked store only means the choice is not remembered */
  }
  if (!wanted) {
    stopHd()
    set('off', 0)
    return
  }
  void load().catch(() => {})
}

/** Start the download on page load when the visitor asked for it before (it comes from the browser cache). */
export function resumeHd(): void {
  if (state === 'loading' && !engine && hdSupported()) void load().catch(() => {})
}

let ctx: AudioContext | null = null
let playing: AudioBufferSourceNode | null = null
let token = 0

export function stopHd(): void {
  token += 1
  try {
    playing?.stop()
  } catch {
    /* it had already ended */
  }
  playing = null
}

export function hdReady(): boolean {
  return state === 'ready'
}

/**
 * Say a line with the HD voice. Resolves true if it was spoken (or cut off by a newer line), false if the model
 * failed and the caller should use the browser's voice instead.
 */
export async function speakHd(text: string, handlers: { onStart?: () => void; onEnd?: () => void }): Promise<boolean> {
  stopHd()
  const mine = token
  try {
    const tts = await load()
    const out = await tts.generate(text, { voice: VOICE })
    if (mine !== token) return true
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') await ctx.resume()
    if (mine !== token) return true
    const buffer = ctx.createBuffer(1, out.audio.length, out.sampling_rate)
    buffer.copyToChannel(new Float32Array(out.audio), 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.onended = () => {
      if (playing === source) playing = null
      if (mine === token) handlers.onEnd?.()
    }
    playing = source
    handlers.onStart?.()
    source.start()
    return true
  } catch {
    // A newer line has already cut this one off: do not speak it late with the other voice.
    return mine !== token
  }
}
