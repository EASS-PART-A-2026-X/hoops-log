/**
 * The coach's voice: the browser's own text to speech (free, nothing is sent anywhere). It stays quiet when
 * the sound button is off, when the visitor turned the voice off, when the browser has no speech, or before the
 * visitor has clicked anything (browsers block speech until then, and the caption still shows).
 * The voice choice is kept in localStorage; the app works when that is blocked.
 */
import { isMuted } from '../game/audio'

const KEY = 'coach-voice'
let on = readVoice()
const listeners = new Set<() => void>()

function readVoice(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export function isVoiceOn(): boolean {
  return on
}

export function setVoiceOn(value: boolean): void {
  on = value
  try {
    window.localStorage.setItem(KEY, value ? '1' : '0')
  } catch {
    /* a blocked store only means the choice is not remembered */
  }
  if (!value) stopSpeaking()
  for (const l of listeners) l()
}

export function subscribeVoice(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

/** Voices the browser has, preferring a male English one (Deni), then any English one. */
export function pickVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  if (english.length === 0) return null
  const male = /\b(male|guy|david|mark|daniel|james|alex|ryan|george|fred|ralph)\b/i
  const female = /female|woman|samantha|zira|susan|hazel|karen|moira|tessa|victoria|fiona|serena|aria|jenny/i
  // Lower is better: a male-sounding voice first, a female-sounding one last, US English before other English.
  const rank = (v: SpeechSynthesisVoice) => (female.test(v.name) ? 4 : male.test(v.name) ? 0 : 2) + (v.lang.toLowerCase() === 'en-us' ? 0 : 1)
  return [...english].sort((a, b) => rank(a) - rank(b))[0] ?? null
}

/** Whether the visitor has done something on the page yet. Where the browser cannot tell, assume so. */
function userHasActed(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
  return activation ? activation.hasBeenActive : true
}

export function canSpeak(): boolean {
  return on && !isMuted() && speechSupported() && userHasActed()
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel()
}

/** Speak a line. Returns false when it stays silent (the caption is then all there is). */
export function speak(text: string, handlers: { onStart?: () => void; onEnd?: () => void } = {}): boolean {
  if (!canSpeak()) return false
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = pickVoice(synth.getVoices())
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang
    } else {
      utterance.lang = 'en-US'
    }
    utterance.rate = 1
    utterance.pitch = 0.9
    utterance.onstart = () => handlers.onStart?.()
    utterance.onend = () => handlers.onEnd?.()
    utterance.onerror = () => handlers.onEnd?.()
    synth.speak(utterance)
    return true
  } catch {
    return false
  }
}
