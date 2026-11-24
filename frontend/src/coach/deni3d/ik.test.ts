import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { solveLimb } from './ik'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

describe('solveLimb', () => {
  it('keeps both bones their length and reaches a target that is in reach', () => {
    const root = v(0, 1.6, 0)
    const { mid, end } = solveLimb(root, v(0.1, 1.1, 0.3), 0.34, 0.27, v(0, -1, -0.3))
    expect(mid.distanceTo(root)).toBeCloseTo(0.34, 5)
    expect(end.distanceTo(mid)).toBeCloseTo(0.27, 5)
    expect(end.distanceTo(v(0.1, 1.1, 0.3))).toBeLessThan(1e-9)
  })

  it('stops at the longest reach when the target is too far, in the direction of the target', () => {
    const root = v(0, 1.6, 0)
    const { mid, end } = solveLimb(root, v(0, 0, 3), 0.34, 0.27, v(0, -1, 0))
    expect(end.distanceTo(root)).toBeLessThan(0.61)
    expect(end.distanceTo(root)).toBeGreaterThan(0.6)
    expect(end.z).toBeGreaterThan(0.5)
    expect(mid.distanceTo(root)).toBeCloseTo(0.34, 5)
  })

  it('bends toward the pole: a knee goes forward, an elbow goes back', () => {
    const knee = solveLimb(v(0, 1, 0), v(0, 0.2, 0), 0.5, 0.5, v(0, 0, 1)).mid
    expect(knee.z).toBeGreaterThan(0.1)
    const elbow = solveLimb(v(0, 1.6, 0), v(0, 1.3, 0.4), 0.34, 0.27, v(0, -0.3, -1)).mid
    expect(elbow.z).toBeLessThan(0.2)
  })

  it('does not blow up when the target is on the root, or the pole lines up with the limb', () => {
    const same = solveLimb(v(0, 1, 0), v(0, 1, 0), 0.3, 0.3, v(0, 0, 1))
    expect(Number.isFinite(same.mid.x + same.mid.y + same.mid.z)).toBe(true)
    const lined = solveLimb(v(0, 1, 0), v(0, 0.5, 0), 0.3, 0.3, v(0, -1, 0))
    expect(Number.isFinite(lined.mid.x + lined.mid.y + lined.mid.z)).toBe(true)
  })
})
