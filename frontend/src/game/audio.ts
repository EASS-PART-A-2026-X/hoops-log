/**
 * Arena sound, made in the browser with Web Audio: no audio files. Browsers keep sound off until the
 * visitor clicks or presses a key, so `unlockAudio` runs on the first one. The mute choice is kept in
 * localStorage (and the app works when that is blocked).
 */

export type Sound = 'swish' | 'rim' | 'cheer' | 'groan' | 'buzzer' | 'levelup' | 'trophy' | 'tick' | 'start'

const KEY = 'hoops-muted'
let ctx: AudioContext | null = null
let muted = readMuted()
const listeners = new Set<() => void>()

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function isMuted(): boolean {
  return muted
}

export function setMuted(value: boolean): void {
  muted = value
  try {
    window.localStorage.setItem(KEY, value ? '1' : '0')
  } catch {
    /* a blocked store only means the choice is not remembered */
  }
  for (const l of listeners) l()
}

export function subscribeMuted(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function audioClass(): typeof AudioContext | undefined {
  return typeof window === 'undefined' ? undefined : window.AudioContext
}

/** Create or resume the audio context. Call from a click or key press. */
export function unlockAudio(): void {
  const Ctor = audioClass()
  if (!Ctor) return
  try {
    ctx ??= new Ctor()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    ctx = null
  }
}

/** For tests: forget the context and re-read the stored mute choice. */
export function resetAudioForTests(): void {
  ctx = null
  muted = readMuted()
  listeners.clear()
}

function noise(c: AudioContext, seconds: number): AudioBufferSourceNode {
  const buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buffer
  return src
}

function envelope(c: AudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(peak, at + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
  return g
}

function tone(c: AudioContext, type: OscillatorType, freq: number, at: number, peak: number, decay: number, to?: number): void {
  const osc = c.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + decay)
  const g = envelope(c, at, peak, 0.01, decay)
  osc.connect(g).connect(c.destination)
  osc.start(at)
  osc.stop(at + decay + 0.05)
}

function band(c: AudioContext, at: number, seconds: number, freq: number, q: number, peak: number, attack: number): void {
  const src = noise(c, seconds + 0.1)
  const f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.setValueAtTime(freq, at)
  f.Q.value = q
  const g = envelope(c, at, peak, attack, seconds)
  src.connect(f).connect(g).connect(c.destination)
  src.start(at)
  src.stop(at + seconds + attack + 0.1)
}

const RECIPES: Record<Sound, (c: AudioContext, t: number) => void> = {
  // Net: a quick hiss that drops in pitch.
  swish: (c, t) => band(c, t, 0.35, 5200, 0.8, 0.5, 0.02),
  // Rim: two detuned metal tones.
  rim: (c, t) => {
    tone(c, 'sine', 330, t, 0.35, 0.5)
    tone(c, 'sine', 497, t, 0.25, 0.4)
    band(c, t, 0.12, 2400, 2, 0.25, 0.005)
  },
  cheer: (c, t) => {
    band(c, t, 1.4, 1100, 0.6, 0.45, 0.25)
    band(c, t, 1.4, 2300, 0.5, 0.2, 0.3)
  },
  groan: (c, t) => band(c, t, 1.0, 380, 1.2, 0.4, 0.2),
  buzzer: (c, t) => {
    tone(c, 'sawtooth', 190, t, 0.3, 0.9)
    tone(c, 'sawtooth', 193, t, 0.3, 0.9)
  },
  levelup: (c, t) => {
    ;[392, 523, 659, 784].forEach((f, i) => tone(c, 'triangle', f, t + i * 0.09, 0.28, 0.5))
  },
  trophy: (c, t) => {
    tone(c, 'triangle', 880, t, 0.25, 0.6)
    tone(c, 'sine', 1319, t + 0.1, 0.2, 0.8)
  },
  tick: (c, t) => tone(c, 'square', 1200, t, 0.05, 0.04),
  // Game start: a deep drop, a rising sweep and a crowd swell.
  start: (c, t) => {
    tone(c, 'sine', 140, t, 0.6, 0.7, 40)
    tone(c, 'sawtooth', 200, t + 0.05, 0.12, 0.6, 900)
    band(c, t + 0.1, 1.1, 1400, 0.6, 0.35, 0.3)
    ;[523, 659, 784].forEach((f, i) => tone(c, 'triangle', f, t + 0.25 + i * 0.08, 0.2, 0.6))
  },
}

/** Play a sound now, or `delayMs` from now. Does nothing when muted or when sound is not available yet. */
export function play(sound: Sound, delayMs = 0): void {
  if (muted || !ctx || ctx.state !== 'running') return
  try {
    RECIPES[sound](ctx, ctx.currentTime + delayMs / 1000)
  } catch {
    /* sound is a bonus, never an error */
  }
}
