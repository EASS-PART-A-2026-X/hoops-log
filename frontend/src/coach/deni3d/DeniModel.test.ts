import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildModel } from './DeniModel'
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
    const up = bone(`${side}UpLeg`, hips, sign * 0.1, -0.05)
    const leg = bone(`${side}Leg`, up, 0, -0.45)
    bone(`${side}Foot`, leg, 0, -0.45)
  }
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.0, 0.3).translate(0, 1.0, 0)))
  return scene
}

const find = (root: THREE.Object3D, name: string) => root.getObjectByName(`mixamorig${name}`)!
const at = (root: THREE.Object3D, name: string) => {
  root.updateMatrixWorld(true)
  return new THREE.Vector3().setFromMatrixPosition(find(root, name).matrixWorld)
}

describe('the realistic coach', () => {
  it('stands on the floor at his height', () => {
    const model = buildModel(skeleton())
    const box = new THREE.Box3().setFromObject(model.root)
    expect(box.min.y).toBeCloseTo(0, 3)
    expect(box.max.y).toBeCloseTo(2.04, 2)
  })

  it('fails loudly when a bone the posing needs is missing (a wrong file), so the drawn figure carries on', () => {
    const scene = skeleton()
    find(scene, 'LeftForeArm').name = 'Something'
    expect(() => buildModel(scene)).toThrow(/LeftForeArm/)
  })

  it('keeps his feet planted while the knees give, and never stretches a limb', () => {
    const model = buildModel(skeleton())
    const feet = ['LeftFoot', 'RightFoot'].map((n) => at(model.root, n))
    const upper = (side: string) => at(model.root, `${side}Leg`).distanceTo(at(model.root, `${side}UpLeg`))
    const before = [upper('Left'), upper('Right')]
    for (const t of [0, 0.2, 0.4, 0.6, 1.7]) {
      model.apply(poseAt({ t, talking: false, mood: 'idle', moodAge: 0, look: { x: 0, y: 0 }, reduced: false }))
      ;['LeftFoot', 'RightFoot'].forEach((n, i) => {
        const now = at(model.root, n)
        expect(now.distanceTo(feet[i]!)).toBeLessThan(0.02)
      })
      expect(upper('Left')).toBeCloseTo(before[0]!, 3)
      expect(upper('Right')).toBeCloseTo(before[1]!, 3)
    }
  })

  it('puts the right hand over the ball all through the bounce, and lets the ball go to the floor', () => {
    const model = buildModel(skeleton())
    let lowest = 9
    for (let i = 0; i < 16; i++) {
      const pose = poseAt({ t: i * 0.04, talking: false, mood: 'idle', moodAge: 0, look: { x: 0, y: 0 }, reduced: false })
      model.apply(pose)
      const hand = at(model.root, 'RightHand')
      expect(Number.isFinite(hand.x + hand.y + hand.z)).toBe(true)
      // The made-up arm is shorter than a real one, so it is only asked to stay close and above the ball while it reaches.
      expect(hand.y).toBeGreaterThan(pose.ball.y - 0.05)
      lowest = Math.min(lowest, pose.ball.y)
    }
    expect(lowest).toBeCloseTo(BALL_R, 1)
  })

  it('raises the left arm for the hype and moves nothing to NaN in any mood', () => {
    const model = buildModel(skeleton())
    const rest = at(model.root, 'LeftHand').y
    for (const mood of ['idle', 'happy', 'hype', 'hmm'] as const) {
      for (const talking of [false, true]) {
        model.apply(poseAt({ t: 0.9, talking, mood, moodAge: 0.7, look: { x: 0.5, y: -0.5 }, reduced: false }))
        const hand = at(model.root, 'LeftHand')
        expect(Number.isFinite(hand.x + hand.y + hand.z)).toBe(true)
        if (mood === 'hype') expect(hand.y).toBeGreaterThan(rest + 0.3)
      }
    }
  })

  it('poses him still with reduced motion', () => {
    const model = buildModel(skeleton())
    const still = () => poseAt({ t: 3.3, talking: false, mood: 'idle', moodAge: 3, look: { x: 0, y: 0 }, reduced: true })
    model.apply(still())
    const first = at(model.root, 'RightHand').clone()
    model.apply(poseAt({ t: 9.9, talking: false, mood: 'idle', moodAge: 9, look: { x: 0, y: 0 }, reduced: true }))
    expect(at(model.root, 'RightHand').distanceTo(first)).toBeLessThan(1e-6)
  })
})
