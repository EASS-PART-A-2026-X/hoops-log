// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generate = vi.fn()
const fromPretrained = vi.fn()
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: (...a: unknown[]) => fromPretrained(...a) } }))

async function fresh() {
  vi.resetModules()
  return import('./hdVoice')
}

describe('HD voice', () => {
  beforeEach(() => {
    generate.mockReset()
    fromPretrained.mockReset()
    try {
      window.localStorage.removeItem('coach-hd-voice')
    } catch {
      /* no storage in this runner */
    }
  })

  it('is off until asked, then downloads, reports progress and becomes ready', async () => {
    fromPretrained.mockImplementation(async (_id: string, opts: { progress_callback: (i: unknown) => void }) => {
      opts.progress_callback({ status: 'progress', progress: 40, file: 'onnx/model_quantized.onnx' })
      opts.progress_callback({ status: 'progress', progress: 90, file: 'voices/am_michael.bin' })
      return { generate }
    })
    const hd = await fresh()
    expect(hd.hdSnapshot()).toEqual({ state: 'off', progress: 0 })
    expect(fromPretrained).not.toHaveBeenCalled()
    hd.setHdWanted(true)
    await vi.waitFor(() => expect(hd.hdSnapshot().state).toBe('ready'))
    expect(hd.hdReady()).toBe(true)
    expect(fromPretrained.mock.calls[0]![1]).toMatchObject({ dtype: 'q8', device: 'wasm' })
    hd.setHdWanted(false)
    expect(hd.hdSnapshot().state).toBe('off')
  })

  it('reports a failed download so the dialog can offer a retry, and speakHd then asks for the browser voice', async () => {
    fromPretrained.mockRejectedValue(new Error('offline'))
    const hd = await fresh()
    hd.setHdWanted(true)
    await vi.waitFor(() => expect(hd.hdSnapshot().state).toBe('failed'))
    expect(await hd.speakHd('Hello', {})).toBe(false)
  })

  it('does not speak a line late when a newer one cut it off', async () => {
    fromPretrained.mockResolvedValue({ generate })
    let release: (v: { audio: Float32Array; sampling_rate: number }) => void = () => {}
    generate.mockImplementation(() => new Promise((r) => (release = r)))
    const hd = await fresh()
    const start = vi.fn()
    const first = hd.speakHd('one', { onStart: start })
    await vi.waitFor(() => expect(generate).toHaveBeenCalled())
    hd.stopHd()
    release({ audio: new Float32Array(10), sampling_rate: 24000 })
    expect(await first).toBe(true)
    expect(start).not.toHaveBeenCalled()
  })

  it('stays off when it is turned off while the download is still running', async () => {
    let finish: (v: unknown) => void = () => {}
    fromPretrained.mockImplementation(() => new Promise((r) => (finish = r)))
    const hd = await fresh()
    hd.setHdWanted(true)
    expect(hd.hdSnapshot().state).toBe('loading')
    hd.setHdWanted(false)
    await vi.waitFor(() => expect(fromPretrained).toHaveBeenCalled())
    finish({ generate })
    await new Promise((r) => setTimeout(r, 0))
    expect(hd.hdSnapshot().state).toBe('off')
    expect(hd.hdReady()).toBe(false)
    // Turning it on again uses the model that already arrived, without a second download.
    hd.setHdWanted(true)
    expect(hd.hdSnapshot().state).toBe('ready')
    expect(fromPretrained).toHaveBeenCalledTimes(1)
  })

  it('tells the caller the line ended when it is cut off while playing', async () => {
    const stop = vi.fn()
    class FakeAudioContext {
      state = 'running'
      destination = {}
      resume = async () => {}
      createBuffer = () => ({ copyToChannel: () => {} })
      createBufferSource = () => ({ buffer: null, connect: () => {}, start: () => {}, stop, onended: null })
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    fromPretrained.mockResolvedValue({ generate })
    generate.mockResolvedValue({ audio: new Float32Array(10), sampling_rate: 24000 })
    const hd = await fresh()
    const start = vi.fn()
    const end = vi.fn()
    expect(await hd.speakHd('one', { onStart: start, onEnd: end })).toBe(true)
    expect(start).toHaveBeenCalledTimes(1)
    expect(end).not.toHaveBeenCalled()
    hd.stopHd()
    expect(stop).toHaveBeenCalled()
    expect(end).toHaveBeenCalledTimes(1)
    // Stopping again does not end it twice.
    hd.stopHd()
    expect(end).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
