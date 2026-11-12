import { describe, expect, it } from 'vitest'
import { BALL_R, DRIBBLE_S, DRIBBLE_TOP, HYPE_S, poseAt } from './pose'
import type { PoseInput } from './pose'

const at = (over: Partial<PoseInput> = {}) => poseAt({ t: 0, talking: false, mood: 'idle', moodAge: 10, look: { x: 0, y: 0 }, reduced: false, ...over })
const times = Array.from({ length: 400 }, (_, i) => i * 0.013)

describe('poseAt', () => {
  it('bounces the ball between the floor and the hand, never through either', () => {
    const ys = times.map((t) => at({ t }).ball.y)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(BALL_R - 1e-9)
    expect(Math.min(...ys)).toBeLessThan(BALL_R + 0.02)
    expect(Math.max(...ys)).toBeCloseTo(DRIBBLE_TOP, 5)
    // One bounce per period: top at the start, floor in the middle.
    expect(at({ t: DRIBBLE_S / 2 }).ball.y).toBeCloseTo(BALL_R, 5)
    expect(at({ t: DRIBBLE_S }).ball.y).toBeCloseTo(DRIBBLE_TOP, 5)
  })

  it('bends the elbow more when the ball is high (the hand follows the ball)', () => {
    expect(at({ t: 0 }).rElbow).toBeGreaterThan(at({ t: DRIBBLE_S / 2 }).rElbow)
  })

  it('keeps the mouth shut unless he is talking or cheering', () => {
    for (const t of times) expect(at({ t }).mouth).toBe(0)
    const open = times.map((t) => at({ t, talking: true }).mouth)
    expect(Math.max(...open)).toBeGreaterThan(0.6)
    for (const m of open) {
      expect(m).toBeGreaterThanOrEqual(0)
      expect(m).toBeLessThanOrEqual(1)
    }
  })

  it('jumps and raises the left arm when hyped, then lands', () => {
    const during = times.filter((t) => t < HYPE_S).map((t) => at({ t, mood: 'hype', moodAge: t }))
    expect(Math.max(...during.map((p) => p.rootY))).toBeGreaterThan(0.1)
    expect(Math.max(...during.map((p) => p.lShoulder))).toBeGreaterThan(2)
    const after = at({ t: 9, mood: 'hype', moodAge: HYPE_S + 2 })
    expect(after.rootY).toBeLessThan(0.01)
    expect(after.lShoulder).toBeLessThan(0.5)
  })

  it('puts a hand to the chin and tilts the head when thinking', () => {
    const p = at({ mood: 'hmm', moodAge: 2 })
    expect(p.lElbow).toBeGreaterThan(2)
    expect(p.headRoll).toBeGreaterThan(0.1)
    expect(at().headRoll).toBe(0)
  })

  it('turns the head toward the pointer, within limits', () => {
    expect(at({ look: { x: 1, y: 0 } }).headYaw).toBeCloseTo(0.5)
    expect(at({ look: { x: -1, y: 0 } }).headYaw).toBeCloseTo(-0.5)
    expect(at({ look: { x: 50, y: 0 } }).headYaw).toBeCloseTo(0.5)
    expect(at().headYaw).toBeCloseTo(0)
  })

  it('stands still with reduced motion: same pose at any time, ball held, no jump', () => {
    const a = at({ t: 0.1, reduced: true })
    const b = at({ t: 7.3, reduced: true })
    expect(b).toEqual(a)
    expect(a.ball.y).toBeCloseTo(DRIBBLE_TOP)
    expect(at({ t: 0.3, mood: 'hype', moodAge: 0.3, reduced: true }).rootY).toBe(0)
  })

  it('never produces NaN', () => {
    for (const t of times) {
      for (const mood of ['idle', 'happy', 'hype', 'hmm'] as const) {
        const p = at({ t, mood, moodAge: t, talking: t > 2 })
        for (const v of [p.rootY, p.lean, p.headYaw, p.headPitch, p.mouth, p.eyes, p.brows, p.rElbow, p.lShoulder, p.lElbow, p.ball.y]) expect(Number.isFinite(v)).toBe(true)
      }
    }
  })
})
