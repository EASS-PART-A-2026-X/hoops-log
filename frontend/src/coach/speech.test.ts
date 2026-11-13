// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setMuted } from '../game/audio'
import { canSpeak, pickVoice, setVoiceOn, speak, speakable } from './speech'

const voice = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice

describe('pickVoice', () => {
  it('prefers a male US English voice, then any English one, and none without English', () => {
    const list = [voice('Hebrew', 'he-IL'), voice('Samantha', 'en-US'), voice('Google UK English Male', 'en-GB'), voice('Microsoft Guy Online', 'en-US')]
    expect(pickVoice(list)!.name).toBe('Microsoft Guy Online')
    expect(pickVoice([voice('Hebrew', 'he-IL'), voice('Samantha', 'en-US'), voice('Plain', 'en-GB')])!.name).toBe('Plain')
    expect(pickVoice([voice('Hebrew', 'he-IL'), voice('Samantha', 'en-US')])!.name).toBe('Samantha')
    expect(pickVoice([voice('Hebrew', 'he-IL')])).toBeNull()
    expect(pickVoice([])).toBeNull()
  })

  it('ranks a female-sounding voice last, even though "Female" contains "male"', () => {
    expect(pickVoice([voice('Female One', 'en-US'), voice('Plain', 'en-US')])!.name).toBe('Plain')
  })
})

describe('pickVoice neural', () => {
  it('prefers a neural voice over the old built-in ones', () => {
    const list = [voice('Microsoft David - English (United States)', 'en-US'), voice('Microsoft Guy Online (Natural) - English (United States)', 'en-US')]
    expect(pickVoice(list)!.name).toContain('Guy Online')
  })
})

describe('speakable', () => {
  it('drops emoji and markdown marks and turns a spaced dash into a pause', () => {
    expect(speakable('Nice shot 🔥 — **keep** it up')).toBe('Nice shot, keep it up')
  })
})

describe('speak', () => {
  const spoken: string[] = []
  const cancel = vi.fn()

  beforeEach(() => {
    spoken.length = 0
    cancel.mockClear()
    class Utterance {
      text: string
      voice: unknown = null
      lang = ''
      rate = 1
      pitch = 1
      onstart: (() => void) | null = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) {
        this.text = text
      }
    }
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
    vi.stubGlobal('speechSynthesis', { speak: (u: { text: string }) => spoken.push(u.text), cancel, getVoices: () => [] })
    Object.defineProperty(navigator, 'userActivation', { value: { hasBeenActive: true }, configurable: true })
    setMuted(false)
    setVoiceOn(true)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(navigator, 'userActivation', { value: undefined, configurable: true })
    setMuted(false)
    setVoiceOn(true)
  })

  it('speaks and cuts off the line before it', () => {
    expect(speak('Hello')).toBe(true)
    expect(spoken).toEqual(['Hello'])
    expect(cancel).toHaveBeenCalled()
  })

  it('stays silent when the voice is off, the sound is muted, or nobody has clicked yet', () => {
    setVoiceOn(false)
    expect(speak('a')).toBe(false)
    setVoiceOn(true)
    setMuted(true)
    expect(speak('b')).toBe(false)
    setMuted(false)
    Object.defineProperty(navigator, 'userActivation', { value: { hasBeenActive: false }, configurable: true })
    expect(canSpeak()).toBe(false)
    expect(speak('c')).toBe(false)
    expect(spoken).toEqual([])
  })

  it('stays silent in a browser without speech', () => {
    vi.unstubAllGlobals()
    expect(speak('d')).toBe(false)
  })

  it('stops speaking when the voice is turned off', () => {
    setVoiceOn(false)
    expect(cancel).toHaveBeenCalled()
  })
})
