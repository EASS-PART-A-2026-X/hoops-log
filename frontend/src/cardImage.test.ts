// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cardFileName, downloadCard } from './cardImage'
import { shooterProfile } from './court/cardData'

describe('cardFileName', () => {
  it('slugs an ASCII name', () => expect(cardFileName('Yuly Cohen')).toBe('hoops-log-card-yuly-cohen.png'))
  it('keeps accented letters', () => expect(cardFileName('José Núñez')).toBe('hoops-log-card-josé-núñez.png'))
  it('keeps Hebrew letters, so different names give different files', () => {
    expect(cardFileName('דנה כהן')).toBe('hoops-log-card-דנה-כהן.png')
    expect(cardFileName('דנה כהן')).not.toBe(cardFileName('יוסי לוי'))
  })
  it('keeps digits', () => expect(cardFileName('Player 23')).toBe('hoops-log-card-player-23.png'))
  it('falls back to "card" when nothing is left', () => {
    expect(cardFileName('!!! ???')).toBe('hoops-log-card-card.png')
    expect(cardFileName('')).toBe('hoops-log-card-card.png')
  })
  it('cuts a long name and does not end on a dash', () => {
    const f = cardFileName('a'.repeat(59) + ' ' + 'b'.repeat(40))
    expect(f).toBe(`hoops-log-card-${'a'.repeat(59)}.png`)
    expect(cardFileName('x'.repeat(200)).length).toBeLessThan(90)
  })
  it('drops leading and trailing separators', () => expect(cardFileName('  --Yuly!  ')).toBe('hoops-log-card-yuly.png'))
})

describe('downloadCard', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('saves the picture under the right name and releases the object URL', async () => {
    vi.useFakeTimers()
    const gradient = { addColorStop: vi.fn() }
    const ctx = new Proxy({ createLinearGradient: () => gradient } as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : () => undefined),
      set: () => true,
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['png'], { type: 'image/png' })))
    const create = vi.fn(() => 'blob:card')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await downloadCard(shooterProfile('דנה כהן', []))
    const a = click.mock.contexts[0] as HTMLAnchorElement | undefined
    expect(a?.download).toBe('hoops-log-card-דנה-כהן.png')
    expect(a?.href).toBe('blob:card')
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(revoke).toHaveBeenCalledWith('blob:card')
  })

  it('throws when the browser cannot make the picture', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    await expect(downloadCard(shooterProfile('Yuly', []))).rejects.toThrow('cannot draw')
  })
})
