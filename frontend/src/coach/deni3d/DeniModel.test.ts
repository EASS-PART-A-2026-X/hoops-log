import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DRIBBLE_CLIP, REACTIONS, SCHEDULE, buildModel } from './DeniModel'
import type { Schedule } from './DeniModel'
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

/** A made-up recording: the right hand goes up and down every 0.8 s for 6.4 s, highest at the start. */
function recording(name = DRIBBLE_CLIP): THREE.AnimationClip {
  const times: number[] = []
  const values: number[] = []
  for (let i = 0; i <= 16; i++) {
    times.push(i * 0.4)
    values.push(-0.27, i % 2 === 0 ? 0.0 : -0.5, 0)
  }
  return new THREE.AnimationClip(name, 6.4, [new THREE.VectorKeyframeTrack('mixamorigRightHand.position', times, values)])
}

/** Dribbling from the first moment and never resting: most of these tests are about what he does while he dribbles. */
const BUSY: Partial<Schedule> = { firstWait: 0, dribbleFor: Infinity }
const build = (clips: THREE.AnimationClip[], plan: Partial<Schedule> = BUSY) => buildModel(skeleton(), clips, 1, plan)

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
    const model = build([recording()])
    const box = new THREE.Box3().setFromObject(model.root)
    expect(box.min.y).toBeCloseTo(0, 3)
    expect(box.max.y).toBeCloseTo(2.04, 2)
  })

  it('fails loudly when the file has no dribble recording or lacks a bone (a wrong file), so the drawn figure carries on', () => {
    expect(() => build([])).toThrow(/basketball_dribble/)
    expect(() => build([recording('Walking')])).toThrow(/basketball_dribble/)
    const scene = skeleton()
    find(scene, 'LeftForeArm').name = 'Something'
    expect(() => buildModel(scene, [recording()])).toThrow(/LeftForeArm/)
  })

  it('plays the recording: the right hand goes up and down', () => {
    const model = build([recording()])
    const ys: number[] = []
    run(model, 0, 1.6, {}, () => ys.push(at(model.root, 'RightHand').y))
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.2)
  })

  it('keeps the ball under the hand, lets it fall to the floor and brings it back, and never above the palm', () => {
    const model = build([recording()])
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
    const model = build([recording()])
    model.apply(pose(), 0.1)
    const rest = at(model.root, 'Hips').y
    model.apply({ ...pose(), rootY: 0.16 }, 0.1)
    expect(at(model.root, 'Hips').y - rest).toBeCloseTo(0.16, 3)
  })

  it('poses the left arm from the mood while he dribbles (overhead for a hype pose), easing in', () => {
    const model = build([recording()])
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
    const model = build([recording()])
    const still = () => poseAt({ t: 3.3, talking: false, mood: 'idle', moodAge: 3, look: { x: 0, y: 0 }, reduced: true })
    const first = model.apply(still(), 0)
    const hand = at(model.root, 'RightHand').clone()
    const second = model.apply(poseAt({ t: 9.9, talking: false, mood: 'idle', moodAge: 9, look: { x: 0, y: 0 }, reduced: true }), 0)
    expect(at(model.root, 'RightHand').distanceTo(hand)).toBeLessThan(1e-6)
    expect(second.ball.distanceTo(first.ball)).toBeLessThan(1e-6)
  })

  it('moves nothing to NaN in any mood, talking or not, looking anywhere', () => {
    const model = build([recording(), ...Object.values(REACTIONS).flat().map((o) => reaction(o.clip, 0.5))])
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

describe('edits do not pile up', () => {
  /** The angle (degrees) between where his head points now and a frame ago. */
  const turnSince = (model: ReturnType<typeof buildModel>, last: THREE.Quaternion) => {
    const q = new THREE.Quaternion()
    find(model.root, 'Head').getWorldQuaternion(q)
    const deg = (2 * Math.acos(Math.min(1, Math.abs(last.dot(q)))) * 180) / Math.PI
    last.copy(q)
    return deg
  }

  it('keeps his head where the pointer puts it, standing or dribbling, instead of turning a bit more every frame', () => {
    for (const plan of [BUSY, { firstWait: 999 }]) {
      const model = build([recording()], plan)
      const last = new THREE.Quaternion()
      run(model, 0, 0.5, { look: { x: 1, y: -1 } })
      model.root.updateMatrixWorld(true)
      find(model.root, 'Head').getWorldQuaternion(last)
      let biggest = 0
      let t = 0.52
      for (; t < 4; t += 0.02) {
        model.apply(pose({ t, look: { x: 1, y: -1 } }), t)
        model.root.updateMatrixWorld(true)
        biggest = Math.max(biggest, turnSince(model, last))
      }
      expect(biggest).toBeLessThan(1) // degrees in one frame; it was about 13 when it piled up
    }
  })

  it('keeps the jump at its height and the left arm where the pose puts it, while he stands', () => {
    const model = build([recording()], { firstWait: 999 })
    run(model, 0, 0.5)
    const rest = at(model.root, 'Hips').y
    const jump = { ...pose({ t: 0.6, mood: 'hype', moodAge: 0.6 }), rootY: 0.16 }
    for (let t = 0.52; t < 3; t += 0.02) model.apply(jump, t)
    expect(at(model.root, 'Hips').y - rest).toBeCloseTo(0.16, 2)
    const arm = at(model.root, 'LeftHand').clone()
    for (let t = 3.02; t < 6; t += 0.02) model.apply(jump, t)
    expect(at(model.root, 'LeftHand').distanceTo(arm)).toBeLessThan(0.02)
  })

  it('does not jump when the dribble comes to its end, because it stops before the recording wraps round', () => {
    const model = build([recording()], { firstWait: 0, dribbleFor: 99, waitFor: [30], routine: ['dribble'] })
    run(model, 0, 0.02)
    let last = at(model.root, 'RightHand')
    let biggest = 0
    run(model, 0.04, 8, {}, () => {
      const hand = at(model.root, 'RightHand')
      biggest = Math.max(biggest, hand.distanceTo(last))
      last = hand
    })
    // The made-up hand moves 0.5 m in 0.4 s at most (1.25 m/s): 0.03 m a frame. A jump to the start would be much more.
    expect(biggest).toBeLessThan(0.1)
  })
})

describe('reactions', () => {
  const withReactions = () => build([recording(), reaction('Victory_Cheer', 1.0), reaction('Confused_Scratch', 0.4), reaction('Head_Hold_in_Pain', 0.8), reaction('Wave_One_Hand', 0.6)])
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
    run(model, 3.02, REACTIONS.hype[0]!.seconds + 1.5)
    // Two bounces later it is up in his hand again at the top of each, and never above the palm.
    let highest = 0
    run(model, REACTIONS.hype[0]!.seconds + 1.52, REACTIONS.hype[0]!.seconds + 3.3, {}, (_t, ball) => {
      const wrist = at(model.root, 'RightHand')
      highest = Math.max(highest, ball.y)
      expect(ball.y).toBeLessThanOrEqual(wrist.y - 0.2 + 1e-6)
      expect(ball.x).toBeCloseTo(wrist.x, 1)
    })
    expect(highest).toBeGreaterThan(BALL_R + 0.3)
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
    const model = build([recording()])
    run(model, 0, 0.3)
    expect(() => model.react('hype')).not.toThrow()
    expect(() => run(model, 0.32, 1)).not.toThrow()
  })

  it('plays a greeting asked for before the first frame, even when the clock is already far on (a slow download)', () => {
    const model = withReactions()
    const still = withReactions() // the same, asked for nothing
    model.react('greet') // the file has just loaded: no frame has been drawn yet
    run(model, 30, 31.6) // the stage clock started long ago
    run(still, 30, 31.6)
    expect(Math.abs(hand(model) - hand(still))).toBeGreaterThan(0.3) // the wave is playing, not already cut off
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

describe('what he does when left alone', () => {
  /** Stands 2 s, then the routine (a go of 5 s through the dribble, a 3 s recording), then stands 30 s, and so on. */
  const PLAN: Partial<Schedule> = { firstWait: 2, dribbleFor: 5, waitFor: [30, 30], routine: ['dribble', 'idle_to_push_up'] }
  const pushUp = () => reaction('idle_to_push_up', 0.7, 3)
  const make = (plan: Partial<Schedule> = PLAN, clips: THREE.AnimationClip[] = [recording(), pushUp()]) => build(clips, plan)
  const range = (v: number[]) => Math.max(...v) - Math.min(...v)
  /** The right hand's, the ball's and the left hand's heights, every step from `from` to `to`. */
  function watch(model: ReturnType<typeof buildModel>, from: number, to: number) {
    const hand: number[] = []
    const ball: number[] = []
    const left: number[] = []
    run(model, from, to, {}, (_t, b) => {
      hand.push(at(model.root, 'RightHand').y)
      left.push(at(model.root, 'LeftHand').y)
      ball.push(b.y)
    })
    return { hand, ball, left, handRange: range(hand), ballRange: range(ball) }
  }

  it('is set up as asked: about a minute between routines, one dribble then the push-up, and nothing else', () => {
    const total = SCHEDULE.dribbleFor + 2.6 + SCHEDULE.waitFor[0]!
    expect(SCHEDULE.dribbleFor).toBeLessThan(5)
    expect(total).toBeGreaterThanOrEqual(58)
    expect(total).toBeLessThanOrEqual(62)
    expect(SCHEDULE.routine).toEqual(['dribble', 'idle_to_push_up'])
  })

  it('stands and does nothing, then does the dribble once and the push-up right after it, then stands again for a long while', () => {
    const model = make()
    run(model, 0, 1.9)
    const rest = at(model.root, 'LeftHand').y
    expect(watch(model, 1.92, 1.98).handRange).toBeLessThan(0.01) // standing after the greeting
    const dribble = watch(model, 2.5, 6.5) // the dribble, 2 to 7 s
    expect(dribble.handRange).toBeGreaterThan(0.2)
    expect(Math.max(...dribble.left) - rest).toBeLessThan(0.3) // no push-up yet
    const pushUpBegins = watch(model, 7.5, 9.5) // the push-up, 7 to 10 s
    expect(Math.max(...pushUpBegins.left) - rest).toBeGreaterThan(0.4)
    expect(pushUpBegins.handRange).toBeLessThan(0.01) // and he is not dribbling
    run(model, 9.52, 12)
    const stand = watch(model, 12.02, 39) // the long stand, 10 to 40 s
    expect(stand.handRange).toBeLessThan(0.01)
    expect(Math.max(...stand.left) - rest).toBeLessThan(0.05) // doing nothing at all
    expect(stand.ball.slice(Math.round(4 / 0.02)).every((y) => Math.abs(y - BALL_R) < 0.02)).toBe(true)
    // The routine again, after the wait: the dribble from 40 s.
    run(model, 39.02, 41)
    expect(watch(model, 41.02, 44).handRange).toBeGreaterThan(0.2)
  })

  it('does not go from one to the other in a single frame', () => {
    const model = make()
    run(model, 0, 1.98)
    let last = at(model.root, 'RightHand').y
    let biggest = 0
    run(model, 2, 3.5, {}, () => {
      const y = at(model.root, 'RightHand').y
      biggest = Math.max(biggest, Math.abs(y - last))
      last = y
    })
    expect(biggest).toBeLessThan(0.15)
  })

  it('skips a recording the file does not have, and does nothing at all with no routine', () => {
    const model = make(PLAN, [recording()]) // no push-up in the file
    run(model, 0, 8)
    expect(watch(model, 8.02, 35).handRange).toBeLessThan(0.01) // straight to standing after the dribble
    const none = make({ ...PLAN, routine: [] })
    expect(watch(none, 0, 60).handRange).toBeLessThan(0.01)
  })

  it('a reaction still plays when something happens, whatever he was doing', () => {
    const model = make(PLAN, [recording(), pushUp(), reaction('Victory_Cheer', 1.0)])
    run(model, 0, 20)
    const rest = at(model.root, 'LeftHand').y
    model.react('hype')
    run(model, 20.02, 21.6)
    expect(at(model.root, 'LeftHand').y - rest).toBeGreaterThan(0.8)
  })

  it('never does anything on his own with reduced motion (the clock does not move)', () => {
    const model = make(PLAN)
    const reduced = () => poseAt({ t: 99, talking: false, mood: 'idle', moodAge: 0, look: { x: 0, y: 0 }, reduced: true })
    const first = model.apply(reduced(), 0)
    for (let i = 0; i < 5; i++) model.apply(reduced(), 0)
    expect(model.apply(reduced(), 0).ball.distanceTo(first.ball)).toBeLessThan(1e-9)
  })
})
