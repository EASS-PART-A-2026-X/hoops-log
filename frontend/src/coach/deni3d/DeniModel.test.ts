import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DRIBBLE_CLIP, DRIBBLE_FOR, REACTIONS, STAND_FOR, buildModel } from './DeniModel'
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

/** A made-up reaction: the left hand is held `lift` metres above where it is in the dribble, for `seconds`. */
function reaction(name: string, lift: number, seconds = 8): THREE.AnimationClip {
  return new THREE.AnimationClip(name, seconds, [new THREE.VectorKeyframeTrack('mixamorigLeftHand.position', [0, seconds], [0.27, lift, 0, 0.27, lift, 0])])
}

const find = (root: THREE.Object3D, name: string) => root.getObjectByName(`mixamorig${name}`)!
const at = (root: THREE.Object3D, name: string) => {
  root.updateMatrixWorld(true)
  return new THREE.Vector3().setFromMatrixPosition(find(root, name).matrixWorld)
}
const pose = (over: Partial<Parameters<typeof poseAt>[0]> = {}) =>
  poseAt({ t: 0.9, talking: false, mood: 'idle', moodAge: 3, look: { x: 0, y: 0 }, reduced: false, ...over })

/** Plays the stage clock from `from` to `to` in small steps (it only goes forward), with the same pose all the time. */
function run(model: ReturnType<typeof buildModel>, from: number, to: number, over: Parameters<typeof pose>[0] = {}, each?: (t: number, ball: THREE.Vector3) => void): THREE.Vector3 {
  let ball = new THREE.Vector3()
  for (let t = from; t <= to + 1e-9; t += 0.02) {
    ball = model.apply(pose({ t, ...over }), t).ball
    each?.(t, ball)
  }
  return ball
}

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
    const ys: number[] = []
    run(model, 0, 1.6, {}, () => ys.push(at(model.root, 'RightHand').y))
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.2)
  })

  it('keeps the ball under the hand, lets it fall to the floor and brings it back, and never above the palm', () => {
    const model = buildModel(skeleton(), [recording()])
    let lowest = 9
    let held = 0
    run(model, 0, 3.2, {}, (_t, ball) => {
      const wrist = at(model.root, 'RightHand')
      expect(Number.isFinite(ball.x + ball.y + ball.z)).toBe(true)
      expect(ball.y).toBeLessThanOrEqual(wrist.y - 0.2 + 1e-6)
      expect(ball.y).toBeGreaterThanOrEqual(BALL_R - 1e-6)
      expect(ball.x).toBeCloseTo(wrist.x, 5)
      lowest = Math.min(lowest, ball.y)
      if (Math.abs(ball.y - (wrist.y - 0.2)) < 1e-6) held++
    })
    expect(lowest).toBeCloseTo(BALL_R, 1)
    expect(held).toBeGreaterThan(10) // it rests in the hand for part of every bounce
  })

  it('jumps for a hype: all of him goes up', () => {
    const model = buildModel(skeleton(), [recording()])
    model.apply(pose(), 0.1)
    const rest = at(model.root, 'Hips').y
    model.apply({ ...pose(), rootY: 0.16 }, 0.1)
    expect(at(model.root, 'Hips').y - rest).toBeCloseTo(0.16, 3)
  })

  it('poses the left arm from the mood while he dribbles (overhead for a hype pose), easing in', () => {
    const model = buildModel(skeleton(), [recording()])
    run(model, 0, 0.2)
    const rest = at(model.root, 'LeftHand').y
    const hype = { mood: 'hype' as const, moodAge: 0.6 }
    model.apply(pose({ t: 0.22, ...hype }), 0.22)
    const early = at(model.root, 'LeftHand').y
    run(model, 0.24, 1.4, hype)
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
    const model = buildModel(skeleton(), [recording(), ...Object.values(REACTIONS).flat().map((o) => reaction(o.clip, 0.5))])
    let t = 0
    for (const mood of ['idle', 'happy', 'hype', 'hmm'] as const) {
      for (const talking of [false, true]) {
        t += 0.3
        if (mood === 'hype' || mood === 'hmm') model.react(mood)
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

describe('reactions', () => {
  const withReactions = () => buildModel(skeleton(), [recording(), reaction('Victory_Cheer', 1.0), reaction('Confused_Scratch', 0.4), reaction('Head_Hold_in_Pain', 0.8), reaction('Wave_One_Hand', 0.6)])
  const hand = (m: ReturnType<typeof buildModel>) => at(m.root, 'LeftHand').y

  it('plays the recording of the reaction over the dribble, fading it in', () => {
    const model = withReactions()
    run(model, 0, 0.5)
    const rest = hand(model)
    model.react('hype')
    model.apply(pose({ t: 0.52 }), 0.52)
    const early = hand(model)
    run(model, 0.54, 1.5)
    expect(early - rest).toBeLessThan(0.5) // not there in one frame
    expect(hand(model) - rest).toBeGreaterThan(0.8) // and then fully there
  })

  it('goes back to dribbling when the reaction is over, and the left arm is the recording\'s again', () => {
    const model = withReactions()
    run(model, 0, 0.5)
    const rest = hand(model)
    model.react('hype')
    run(model, 0.52, REACTIONS.hype[0]!.seconds + 1.5)
    expect(Math.abs(hand(model) - rest)).toBeLessThan(0.05)
  })

  it('drops the ball while it plays and has it back in the hand after', () => {
    const model = withReactions()
    run(model, 0, 0.5)
    model.react('hype')
    const ball = run(model, 0.52, 3)
    expect(ball.y).toBeCloseTo(BALL_R, 1) // on the floor
    const back = run(model, 3.02, REACTIONS.hype[0]!.seconds + 2.5)
    const wrist = at(model.root, 'RightHand')
    expect(back.y).toBeGreaterThan(BALL_R + 0.05)
    expect(back.y).toBeLessThanOrEqual(wrist.y - 0.2 + 1e-6)
    expect(back.x).toBeCloseTo(wrist.x, 1)
  })

  it('takes the several recordings of a reaction in turn', () => {
    const model = withReactions()
    run(model, 0, 0.5)
    const rest = hand(model)
    model.react('hmm')
    run(model, 0.52, 1.6)
    const first = hand(model) - rest
    run(model, 1.62, REACTIONS.hmm[0]!.seconds + 2)
    model.react('hmm')
    run(model, REACTIONS.hmm[0]!.seconds + 2.02, REACTIONS.hmm[0]!.seconds + 3.1)
    const second = hand(model) - rest
    expect(first).toBeGreaterThan(0.3)
    expect(second).toBeGreaterThan(0.6)
    expect(second).toBeGreaterThan(first + 0.2)
  })

  it('does nothing for a recording the file does not have', () => {
    const model = buildModel(skeleton(), [recording()])
    run(model, 0, 0.3)
    expect(() => model.react('hype')).not.toThrow()
    expect(() => run(model, 0.32, 1)).not.toThrow()
  })

  it('stands the reaction down when a new one starts', () => {
    const model = withReactions()
    run(model, 0, 0.5)
    const rest = hand(model)
    model.react('hype')
    run(model, 0.52, 1.5)
    model.react('greet')
    run(model, 1.52, 2.6)
    expect(hand(model) - rest).toBeGreaterThan(0.45)
    expect(hand(model) - rest).toBeLessThan(0.75) // the wave (0.6), not the cheer (1.0)
  })
})

describe('resting between dribbles', () => {
  /** The right hand's height and the ball's, every step from `from` to `to`. */
  function watch(model: ReturnType<typeof buildModel>, from: number, to: number) {
    const hand: number[] = []
    const ball: number[] = []
    run(model, from, to, {}, (_t, b) => {
      hand.push(at(model.root, 'RightHand').y)
      ball.push(b.y)
    })
    const range = (v: number[]) => Math.max(...v) - Math.min(...v)
    return { hand, ball, handRange: range(hand), ballRange: range(ball) }
  }

  it('dribbles for a while, then stands still with the ball on the floor, then dribbles again', () => {
    const model = buildModel(skeleton(), [recording()])
    const dribble = DRIBBLE_FOR[0]!
    const stand = STAND_FOR[0]!
    const first = watch(model, 0, dribble - 1)
    expect(first.handRange).toBeGreaterThan(0.2) // dribbling
    // Eased into standing, then really still.
    run(model, dribble - 0.98, dribble + 1.5)
    const resting = watch(model, dribble + 1.52, dribble + 3.5)
    expect(resting.handRange).toBeLessThan(0.01)
    // The ball bounces a few times on the floor and then lies there.
    const settled = watch(model, dribble + 3.52, dribble + stand - 0.5)
    expect(settled.ball.every((y) => Math.abs(y - BALL_R) < 0.02)).toBe(true)
    // And back to it: the hand moves again and the ball is back in it.
    run(model, dribble + stand - 0.48, dribble + stand + 2)
    const again = watch(model, dribble + stand + 2.02, dribble + stand + 4.5)
    expect(again.handRange).toBeGreaterThan(0.2)
    expect(again.ballRange).toBeGreaterThan(0.2)
  })

  it('does not go from one to the other in a single frame', () => {
    const model = buildModel(skeleton(), [recording()])
    const dribble = DRIBBLE_FOR[0]!
    let before = 0
    run(model, 0, dribble - 0.02, {}, () => (before = at(model.root, 'RightHand').y))
    let biggest = 0
    let last = before
    run(model, dribble, dribble + 1.5, {}, () => {
      const y = at(model.root, 'RightHand').y
      biggest = Math.max(biggest, Math.abs(y - last))
      last = y
    })
    expect(biggest).toBeLessThan(0.15)
  })

  it('never rests with reduced motion (the clock does not move)', () => {
    const model = buildModel(skeleton(), [recording()])
    const first = model.apply(poseAt({ t: 0, talking: false, mood: 'idle', moodAge: 0, look: { x: 0, y: 0 }, reduced: true }), 0)
    for (let i = 0; i < 5; i++) model.apply(poseAt({ t: 99, talking: false, mood: 'idle', moodAge: 0, look: { x: 0, y: 0 }, reduced: true }), 0)
    expect(model.apply(poseAt({ t: 99, talking: false, mood: 'idle', moodAge: 0, look: { x: 0, y: 0 }, reduced: true }), 0).ball.distanceTo(first.ball)).toBeLessThan(1e-9)
  })
})
