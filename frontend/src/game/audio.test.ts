// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isMuted, play, resetAudioForTests, setMuted, subscribeMuted, unlockAudio } from './audio'

function fakeContext(state: 'running' | 'suspended' = 'running') {
  const made: string[] = []
  const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 0 })
  const node = (kind: string) => {
    made.push(kind)
    const n: Record<string, unknown> = {
      gain: param(),
      frequency: param(),
      connect: (to: unknown) => to,
      start: vi.fn(),
      stop: vi.fn(),
      getChannelData: () => new Float32Array(10),
    }
    return n
  }
  return class {
    state = state
    sampleRate = 100
    currentTime = 0
    destination = {}
    resume = vi.fn(async () => {})
    createBuffer = () => node('buffer')
    createBufferSource = () => node('source')
    createGain = () => node('gain')
    createOscillator = () => node('osc')
    createBiquadFilter = () => node('filter')
    static made = made
  }
}

// Node 26 has its own half-working localStorage that hides jsdom's, so the tests bring a plain one.
function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true })
  resetAudioForTests()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mute', () => {
  it('is off by default and remembers the choice', () => {
    expect(isMuted()).toBe(false)
    setMuted(true)
    expect(window.localStorage.getItem('hoops-muted')).toBe('1')
    resetAudioForTests()
    expect(isMuted()).toBe(true)
  })

  it('tells listeners, and stops after unsubscribe', () => {
    const l = vi.fn()
    const off = subscribeMuted(l)
    setMuted(true)
    off()
    setMuted(false)
    expect(l).toHaveBeenCalledTimes(1)
  })

  it('still works when storage is blocked', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => setMuted(true)).not.toThrow()
    expect(isMuted()).toBe(true)
  })
})

describe('play', () => {
  it('is silent and safe before audio is unlocked or when the browser has none', () => {
    expect(() => play('swish')).not.toThrow()
    unlockAudio() // jsdom has no AudioContext
    expect(() => play('swish')).not.toThrow()
  })

  it('makes sound once unlocked, but not when muted', () => {
    const Fake = fakeContext()
    vi.stubGlobal('AudioContext', Fake)
    unlockAudio()
    play('rim')
    const afterRim = Fake.made.length
    expect(afterRim).toBeGreaterThan(0)
    setMuted(true)
    play('rim')
    expect(Fake.made.length).toBe(afterRim)
  })

  it('stays silent while the context is still suspended', () => {
    const Fake = fakeContext('suspended')
    vi.stubGlobal('AudioContext', Fake)
    unlockAudio()
    play('swish')
    expect(Fake.made.length).toBe(0)
  })

  it('every sound can be played without throwing', () => {
    const Fake = fakeContext()
    vi.stubGlobal('AudioContext', Fake)
    unlockAudio()
    for (const s of ['swish', 'rim', 'cheer', 'groan', 'buzzer', 'levelup', 'trophy', 'tick', 'start'] as const) {
      expect(() => play(s, 50)).not.toThrow()
    }
  })
})
