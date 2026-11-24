import { describe, expect, it } from 'vitest'
import { ballCentreY, findTops, freeBallY } from './dribbleBall'

const FPS = 30
/** A hand going up and down every `period` seconds for `seconds`, highest at t = 0. */
const wave = (period: number, seconds: number, lo = 0.7, hi = 1.2) =>
  Array.from({ length: Math.round(seconds * FPS) + 1 }, (_, i) => lo + (hi - lo) * (0.5 + 0.5 * Math.cos((2 * Math.PI * i) / FPS / period)))

describe('findTops', () => {
  it('finds each high point of the hand', () => {
    const tops = findTops(wave(0.8, 4), FPS)
    // The first one (at the very start) has no rise before it to prove it, so the ones after it are found.
    expect(tops.length).toBeGreaterThanOrEqual(4)
    for (const [i, t] of tops.entries()) expect(t).toBeCloseTo((i + 1) * 0.8, 1)
  })

  it('ignores a small wobble on the way down, and finds nothing in a still hand', () => {
    const series = wave(0.8, 3).map((y, i) => y + 0.02 * Math.sin(i * 2.7))
    expect(findTops(series, FPS).length).toBeLessThanOrEqual(5)
    expect(findTops(Array(60).fill(1), FPS)).toEqual([])
    expect(findTops([1, 2], FPS)).toEqual([])
  })

  it('follows a rhythm that is not regular, as a recording is', () => {
    const series = [...wave(0.7, 1.4), ...wave(0.9, 1.8).slice(1)]
    const tops = findTops(series, FPS)
    expect(tops.length).toBeGreaterThanOrEqual(3)
    const gaps = tops.slice(1).map((t, i) => t - tops[i]!)
    expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps))
  })
})

describe('freeBallY', () => {
  const tops = [0.1, 0.9, 1.7]
  it('is at the top at each high point of the hand and on the floor half way between', () => {
    expect(freeBallY(0.1, tops, 2.5, 1.0, 0.12)).toBeCloseTo(1.0, 5)
    expect(freeBallY(0.5, tops, 2.5, 1.0, 0.12)).toBeCloseTo(0.12, 5)
    expect(freeBallY(0.9, tops, 2.5, 1.0, 0.12)).toBeCloseTo(1.0, 5)
  })

  it('carries the bounce over the end of the recording, so the loop has no jump', () => {
    const before = freeBallY(2.5 - 1e-3, tops, 2.5, 1.0, 0.12)
    const after = freeBallY(0 + 1e-3, tops, 2.5, 1.0, 0.12)
    expect(Math.abs(before - after)).toBeLessThan(0.05)
  })

  it('never goes below the floor or above the top, and rests at the top with no recording', () => {
    for (let t = 0; t < 5; t += 0.037) {
      const y = freeBallY(t, tops, 2.5, 1.0, 0.12)
      expect(y).toBeGreaterThanOrEqual(0.12 - 1e-9)
      expect(y).toBeLessThanOrEqual(1.0 + 1e-9)
    }
    expect(freeBallY(1, [], 2.5, 1.0, 0.12)).toBe(1.0)
  })
})

describe('ballCentreY', () => {
  it('rests under the palm while the hand is low, and flies free when it has fallen further than the hand', () => {
    expect(ballCentreY(0.9, 1.0, 0.2)).toBeCloseTo(0.8, 5) // the hand holds it
    expect(ballCentreY(0.3, 1.0, 0.2)).toBeCloseTo(0.3, 5) // it is on its own
  })
})
