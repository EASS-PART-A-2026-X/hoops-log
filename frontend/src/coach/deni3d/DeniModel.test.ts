import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DRIBBLE_CLIP, buildModel } from './DeniModel'
import { BALL_R, poseAt } from './pose'

/** A made-up skeleton with the names the real one has, standing in a T with its feet on the floor, about 2 m tall. */
function skeleton(): THREE.Object3D {
  const scene = new THREE.Group()
  const bone = (name: string, parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const b = new THREE.Bone()
    b.name = `mixamorig${name}`
    b.position.set(x, y, z)
    parent.add(b)
    return b
  }
  const hips = bone('Hips', scene, 0, 1.0)
  const spine = bone('Spine', hips, 0, 0.12)
  const spine1 = bone('Spine1', spine, 0, 0.14)
  const spine2 = bone('Spine2', spine1, 0, 0.14)
  const neck = bone('Neck', spine2, 0, 0.3)
  bone('Head', neck, 0, 0.12)
  for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
    const arm = bone(`${side}Arm`, spine2, sign * 0.2, 0.25)
    const fore = bone(`${side}ForeArm`, arm, sign * 0.3, 0)
    bone(`${side}Hand`, fore, sign * 0.27, 0)
  }
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.0, 0.3).translate(0, 1.0, 0)))
  return scene
}

/** A made-up recording: the right hand goes up and down every 0.8 s for 3.2 s, highest at the start. */
function recording(name = DRIBBLE_CLIP): THREE.AnimationClip {
  const times: number[] = []
  const values: number[] = []
  for (let i = 0; i <= 8; i++) {
    times.push(i * 0.4)
    values.push(-0.27, i % 2 === 0 ? 0.0 : -0.5, 0)
  }
  return new THREE.AnimationClip(name, 3.2, [new THREE.VectorKeyframeTrack('mixamorigRightHand.position', times, values)])
}

const find = (root: THREE.Object3D, name: string) => root.getObjectByName(`mixamorig${name}`)!
const at = (root: THREE.Object3D, name: string) => {
  root.updateMatrixWorld(true)
  return new THREE.Vector3().setFromMatrixPosition(find(root, name).matrixWorld)
}
const pose = (over: Partial<Parameters<typeof poseAt>[0]> = {}) =>
  poseAt({ t: 0.9, talking: false, mood: 'idle', moodAge: 3, look: { x: 0, y: 0 }, reduced: false, ...over })

describe('the realistic coach', () => {
  it('stands on the floor at his height', () => {
    const model = buildModel(skeleton(), [recording()])
    const box = new THREE.Box3().setFromObject(model.root)
    expect(box.min.y).toBeCloseTo(0, 3)
    expect(box.max.y).toBeCloseTo(2.04, 2)
  })

  it('fails loudly when the file has no dribble recording or lacks a bone (a wrong file), so the drawn figure carries on', () => {
    expect(() => buildModel(skeleton(), [])).toThrow(/basketball_dribble/)
    expect(() => buildModel(skeleton(), [recording('Walking')])).toThrow(/basketball_dribble/)
    const scene = skeleton()
    find(scene, 'LeftForeArm').name = 'Something'
    expect(() => buildModel(scene, [recording()])).toThrow(/LeftForeArm/)
  })

  it('plays the recording: the right hand goes up and down', () => {
    const model = buildModel(skeleton(), [recording()])
    model.apply(pose(), 0)
    const high = at(model.root, 'RightHand').y
    model.apply(pose(), 0.4)
    const low = at(model.root, 'RightHand').y
    expect(high - low).toBeGreaterThan(0.2)
  })

  it('keeps the ball under the hand, lets it fall to the floor and brings it back, and never above the palm', () => {
    const model = buildModel(skeleton(), [recording()])
    let lowest = 9
    let held = 0
    for (let t = 0; t <= 3.2; t += 0.02) {
      const { ball } = model.apply(pose({ t }), t)
      const wrist = at(model.root, 'RightHand')
      expect(Number.isFinite(ball.x + ball.y + ball.z)).toBe(true)
      expect(ball.y).toBeLessThanOrEqual(wrist.y - 0.2 + 1e-6)
      expect(ball.y).toBeGreaterThanOrEqual(BALL_R - 1e-6)
      expect(ball.x).toBeCloseTo(wrist.x, 5)
      lowest = Math.min(lowest, ball.y)
      if (Math.abs(ball.y - (wrist.y - 0.2)) < 1e-6) held++
    }
    expect(lowest).toBeCloseTo(BALL_R, 1)
    expect(held).toBeGreaterThan(10) // it rests in the hand for part of every bounce
  })

  it('jumps for a hype: all of him goes up', () => {
    const model = buildModel(skeleton(), [recording()])
    model.apply(pose({ mood: 'idle' }), 0.1)
    const rest = at(model.root, 'Hips').y
    model.apply({ ...pose(), rootY: 0.16 }, 0.1)
    expect(at(model.root, 'Hips').y - rest).toBeCloseTo(0.16, 3)
  })

  it('poses the left arm from the mood (overhead for a hype, at rest otherwise), easing in', () => {
    const model = buildModel(skeleton(), [recording()])
    model.apply(pose(), 0)
    const rest = at(model.root, 'LeftHand').y
    const hype = (t: number) => pose({ t, mood: 'hype', moodAge: 0.6 })
    model.apply(hype(0.05), 0.05)
    const early = at(model.root, 'LeftHand').y
    for (let t = 0.1; t < 1.2; t += 0.05) model.apply(hype(t), t)
    const late = at(model.root, 'LeftHand').y
    expect(late).toBeGreaterThan(rest + 0.3)
    expect(early).toBeLessThan(late) // it did not snap there in one frame
  })

  it('poses him still with reduced motion, whatever the clock says', () => {
    const model = buildModel(skeleton(), [recording()])
    const still = () => poseAt({ t: 3.3, talking: false, mood: 'idle', moodAge: 3, look: { x: 0, y: 0 }, reduced: true })
    const first = model.apply(still(), 0)
    const hand = at(model.root, 'RightHand').clone()
    const second = model.apply(poseAt({ t: 9.9, talking: false, mood: 'idle', moodAge: 9, look: { x: 0, y: 0 }, reduced: true }), 0)
    expect(at(model.root, 'RightHand').distanceTo(hand)).toBeLessThan(1e-6)
    expect(second.ball.distanceTo(first.ball)).toBeLessThan(1e-6)
  })

  it('moves nothing to NaN in any mood, talking or not, looking anywhere', () => {
    const model = buildModel(skeleton(), [recording()])
    let t = 0
    for (const mood of ['idle', 'happy', 'hype', 'hmm'] as const) {
      for (const talking of [false, true]) {
        t += 0.3
        const { ball } = model.apply(pose({ t, mood, talking, moodAge: 0.7, look: { x: 0.9, y: -0.9 } }), t)
        for (const name of ['LeftHand', 'RightHand', 'Head']) {
          const v = at(model.root, name)
          expect(Number.isFinite(v.x + v.y + v.z)).toBe(true)
        }
        expect(Number.isFinite(ball.x + ball.y + ball.z)).toBe(true)
      }
    }
  })
})
