import { describe, expect, it } from 'vitest'
import { BALL_R, BALL_Z, DRIBBLE_S, DRIBBLE_TOP, FOREARM, HYPE_S, PALM, PALM_HALF, RELEASE_Y, SHOULDER_Y, UPPER_ARM, dribbleArm, poseAt } from './pose'
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

  it('keeps the palm on top of the ball while it is in the hand, and lets go below the release height', () => {
    // Forward kinematics of the arm the way the stage poses it, in the vertical plane through the shoulder.
    const palm = (ballY: number) => {
      const a = dribbleArm(ballY)
      const elbowY = SHOULDER_Y - UPPER_ARM * Math.cos(a.shoulder)
      const elbowZ = UPPER_ARM * Math.sin(a.shoulder)
      const f = a.shoulder + a.elbow
      const wristY = elbowY - FOREARM * Math.cos(f)
      const wristZ = elbowZ + FOREARM * Math.sin(f)
      const h = f + a.wrist // the hand's angle from straight down: about 90 degrees = pointing forward
      return { y: wristY - PALM * Math.cos(h) - PALM_HALF, z: wristZ + PALM * Math.sin(h) }
    }
    for (let y = RELEASE_Y + 0.02; y <= DRIBBLE_TOP; y += 0.01) {
      const p = palm(y)
      expect(Math.abs(p.y - (y + BALL_R))).toBeLessThan(0.012)
      expect(Math.abs(p.z - BALL_Z)).toBeLessThan(0.012)
    }
    // Once the ball is on its way to the floor the hand stays up where it let go.
    expect(palm(BALL_R).y).toBeCloseTo(palm(RELEASE_Y - 0.3).y, 2)
  })

  it('bends the wrist so the palm faces down and never lets the arm go past straight', () => {
    for (let y = BALL_R; y <= DRIBBLE_TOP; y += 0.02) {
      const a = dribbleArm(y)
      expect(a.elbow).toBeGreaterThanOrEqual(0)
      expect(a.elbow).toBeLessThan(Math.PI * 0.8)
      expect(Math.abs(a.wrist)).toBeLessThan(1.2)
    }
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
