// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setMuted } from '../game/audio'

const speakHd = vi.fn()
vi.mock('./hdVoice', () => ({ hdReady: () => true, resumeHd: () => {}, speakHd: (...a: unknown[]) => speakHd(...a), stopHd: () => {} }))

import { setVoiceOn, speak } from './speech'

describe('speak with the HD voice ready', () => {
  beforeEach(() => {
    speakHd.mockReset()
    Object.defineProperty(navigator, 'userActivation', { value: { hasBeenActive: true }, configurable: true })
    setMuted(false)
    setVoiceOn(true)
  })
  afterEach(() => {
    Object.defineProperty(navigator, 'userActivation', { value: undefined, configurable: true })
  })

  it('works even where the browser has no speech synthesis', async () => {
    speakHd.mockResolvedValue(true)
    expect(speak('Hello', {})).toBe(true)
    expect(speakHd).toHaveBeenCalledWith('Hello', expect.anything())
  })

  it('lets the caller know when the model fails and the browser cannot speak either', async () => {
    speakHd.mockResolvedValue(false)
    const onSilent = vi.fn()
    expect(speak('Hello', { onSilent })).toBe(true)
    await vi.waitFor(() => expect(onSilent).toHaveBeenCalledTimes(1))
  })

  it('stays silent when the voice is off, even with the HD voice ready', () => {
    setVoiceOn(false)
    expect(speak('Hello', {})).toBe(false)
    expect(speakHd).not.toHaveBeenCalled()
  })
})
