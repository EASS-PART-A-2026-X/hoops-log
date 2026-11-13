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
})
