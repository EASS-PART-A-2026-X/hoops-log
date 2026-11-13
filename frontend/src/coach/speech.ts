/**
 * The coach's voice: the browser's own text to speech (free, nothing is sent anywhere). It stays quiet when
 * the sound button is off, when the visitor turned the voice off, when the browser has no speech, or before the
 * visitor has clicked anything (browsers block speech until then, and the caption still shows).
 * The voice choice is kept in localStorage; the app works when that is blocked.
 */
import { isMuted } from '../game/audio'
import { hdReady, resumeHd, speakHd, stopHd } from './hdVoice'

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

/** The neural voices browsers ship (Edge "Natural"/"Online", Chrome "Google", Apple "Premium"/"Enhanced") sound far less robotic. */
const NEURAL = /natural|online|google|premium|enhanced/i

/** Voices the browser has, preferring a neural, male, US English one (Deni), then any English one. */
export function pickVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  if (english.length === 0) return null
  const male = /\b(male|guy|davis|andrew|brian|christopher|eric|roger|steffan|david|mark|daniel|james|alex|ryan|george|fred|ralph)\b/i
  const female = /female|woman|samantha|zira|susan|hazel|karen|moira|tessa|victoria|fiona|serena|aria|jenny|ava|emma|michelle|sonia/i
  // Lower is better: a neural voice first, then a male-sounding one, a female-sounding one last, US English before other English.
  const rank = (v: SpeechSynthesisVoice) =>
    (NEURAL.test(v.name) ? 0 : 6) + (female.test(v.name) ? 4 : male.test(v.name) ? 0 : 2) + (v.lang.toLowerCase() === 'en-us' ? 0 : 1)
  return [...english].sort((a, b) => rank(a) - rank(b))[0] ?? null
}

/** Strip what a speech engine reads out badly (emoji, markdown marks) and add a breath after a lone colon or dash. */
export function speakable(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\u200d|\ufe0f/g, '')
    .replace(/[*_`#]/g, '')
    .replace(/\s+[-–—]\s+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim()
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
  stopHd()
  if (speechSupported()) window.speechSynthesis.cancel()
}

/**
 * Speak a line. Returns false when it stays silent (the caption is then all there is). With the HD voice ready it
 * is used (the line starts a moment later, while the model works) and the browser's voice steps in if it fails.
 */
export function speak(text: string, handlers: { onStart?: () => void; onEnd?: () => void } = {}): boolean {
  resumeHd()
  if (!canSpeak() && !(on && !isMuted() && hdReady() && userHasActed())) return false
  if (hdReady()) {
    if (speechSupported()) window.speechSynthesis.cancel()
    void speakHd(speakable(text), handlers).then((spoken) => {
      if (!spoken) speakBrowser(text, handlers)
    })
    return true
  }
  return speakBrowser(text, handlers)
}

function speakBrowser(text: string, handlers: { onStart?: () => void; onEnd?: () => void }): boolean {
  if (!canSpeak()) return false
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(speakable(text))
    const voice = pickVoice(synth.getVoices())
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang
    } else {
      utterance.lang = 'en-US'
    }
    // A neural voice is already natural: leave its pitch alone. Only the old built-in ones get a lower pitch.
    const neural = voice !== null && NEURAL.test(voice.name)
    utterance.rate = neural ? 1 : 0.95
    utterance.pitch = neural ? 1 : 0.9
    utterance.onstart = () => handlers.onStart?.()
    utterance.onend = () => handlers.onEnd?.()
    utterance.onerror = () => handlers.onEnd?.()
    synth.speak(utterance)
    return true
  } catch {
    return false
  }
}
