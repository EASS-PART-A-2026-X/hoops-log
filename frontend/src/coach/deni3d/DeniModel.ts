/**
 * The realistic coach: a rigged character model (public/deni.glb, a Mixamo-style skeleton with no fingers and no
 * face rig) that dribbles with a recorded motion (the clip `basketball_dribble` in the same file). The ball is not in
 * the recording, so it is worked out from his right hand (dribbleBall.ts). Other recorded motions play once on top of
 * the dribble when something happens (a wave when the dialog opens, a cheer for a hype, a scratch of the head or a hold
 * of it for a "hmm"): the dribble fades out, the ball drops to the floor, and it is picked up when the dribble returns.
 * He does not dribble non-stop: after a while he stands (the first moment of the dribble recording, where he stands
 * upright), the ball at his feet, and after a rest he picks it up and dribbles again. What the recordings cannot know
 * is added in code: his left arm gestures while he talks (when no other motion is
 * playing), his head follows the pointer and nods while he talks, and he jumps for a hype.
 *
 * Everything is worked out in the model's own frame (the `root` group), so turning him round changes nothing.
 * A fan-made character inspired by Deni Avdija, not the real Deni.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ballCentreY, findTops, freeBallY } from './dribbleBall'
import { BALL_R, type Pose } from './pose'

/** How tall he stands (metres), like the drawn figure. */
const HEIGHT = 2.04
/** The recorded motion that plays all the time. */
export const DRIBBLE_CLIP = 'basketball_dribble'
/**
 * The motions that play once on top of the dribble, by what happened: which recording, and how long of it is used
 * (they are cut before their end, where he is already standing again). Each reaction may have several, taken in turn.
 * A recording the file does not have is skipped.
 */
export type Reaction = 'greet' | 'hype' | 'hmm'
export const REACTIONS: Record<Reaction, { clip: string; seconds: number }[]> = {
  greet: [{ clip: 'Wave_One_Hand', seconds: 3.6 }],
  hype: [{ clip: 'Victory_Cheer', seconds: 6.0 }],
  hmm: [
    { clip: 'Confused_Scratch', seconds: 4.2 },
    { clip: 'Head_Hold_in_Pain', seconds: 3.4 },
  ],
}
/**
 * How long he dribbles, then stands still, in turn (seconds). Taken one after the other and round again, a little
 * different each time so it does not feel like a clock.
 */
export const DRIBBLE_FOR = [14, 11, 17, 12]
export const STAND_FOR = [7, 5, 9, 6]
/** Seconds for him to ease from the dribble to standing, and back. */
const REST_BLEND_S = 0.7
/** Seconds for the dribble to fade into a reaction and back. */
const BLEND_S = 0.35
const GRAVITY = 9.8

/** How far the ball's centre is below his wrist while the palm is on it. */
const BELOW_WRIST = 0.2
/** The recording is looked at this many times a second to find the bounces. */
const SAMPLE_FPS = 30

const Y = new THREE.Vector3(0, 1, 0)
const X = new THREE.Vector3(1, 0, 0)
const Z = new THREE.Vector3(0, 0, 1)

/** The bones this uses, by the names in the file (the loader drops the colon of "mixamorig:Hips"). */
const NAMES = {
  hips: 'Hips',
  neck: 'Neck',
  head: 'Head',
  lArm: 'LeftArm',
  lFore: 'LeftForeArm',
  rHand: 'RightHand',
  lHand: 'LeftHand',
} as const
type BoneKey = keyof typeof NAMES

export interface DeniModel {
  /** Put this in the scene. Its origin is at his feet, he faces +Z. */
  root: THREE.Group
  /**
   * Poses him for this moment (`t` = seconds on the stage clock, which only goes forward) and says where the ball is,
   * in the frame of `root`.
   */
  apply(pose: Pose, t: number): { ball: THREE.Vector3 }
  /** Something happened: he plays the matching recording once, then goes back to dribbling. */
  react(what: Reaction): void
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export async function loadDeniModel(url: string, maxAnisotropy: number): Promise<DeniModel> {
  const gltf = await new GLTFLoader().loadAsync(url)
  return buildModel(gltf.scene, gltf.animations, maxAnisotropy)
}

/** Exported for testing with a made-up skeleton and a made-up recording. */
export function buildModel(scene: THREE.Object3D, clips: readonly THREE.AnimationClip[], maxAnisotropy = 1): DeniModel {
  const found = clips.find((c) => c.name === DRIBBLE_CLIP)
  if (!found) throw new Error(`The model has no ${DRIBBLE_CLIP} recording`)
  const clip: THREE.AnimationClip = found
  const root = new THREE.Group()
  root.add(scene)

  // Stand him on the floor at his height.
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const k = HEIGHT / Math.max(1e-6, box.max.y - box.min.y)
  scene.scale.multiplyScalar(k)
  scene.position.y -= box.min.y * k
  scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    if (mesh.isMesh) {
      // The box of a skinned mesh is the one of its resting pose: without this he vanishes when an arm leaves it.
      mesh.frustumCulled = false
      const material = mesh.material as THREE.MeshStandardMaterial
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.anisotropy = Math.min(8, maxAnisotropy)
      }
    }
  })
  root.updateMatrixWorld(true)

  const find = (name: string): THREE.Object3D => {
    const bone = scene.getObjectByName(`mixamorig${name}`) ?? scene.getObjectByName(`mixamorig:${name}`)
    if (!bone) throw new Error(`The model has no bone called ${name}`)
    return bone
  }
  const bone = {} as Record<BoneKey, THREE.Object3D>
  for (const key of Object.keys(NAMES) as BoneKey[]) bone[key] = find(NAMES[key])

  // ----- working in the model's frame -----
  const inverse = new THREE.Matrix4()
  const tmp = new THREE.Matrix4()
  const frame = () => {
    root.updateWorldMatrix(true, false)
    inverse.copy(root.matrixWorld).invert()
  }
  const quatOf = (o: THREE.Object3D): THREE.Quaternion => {
    o.updateWorldMatrix(true, false)
    const q = new THREE.Quaternion()
    tmp.multiplyMatrices(inverse, o.matrixWorld).decompose(new THREE.Vector3(), q, new THREE.Vector3())
    return q
  }
  const posOf = (o: THREE.Object3D): THREE.Vector3 => {
    o.updateWorldMatrix(true, false)
    return new THREE.Vector3().setFromMatrixPosition(tmp.multiplyMatrices(inverse, o.matrixWorld))
  }
  /** Turns a bone by `dq`, a turn in the model's frame (not in the bone's own axes, which differ from bone to bone). */
  const turn = (b: THREE.Object3D, dq: THREE.Quaternion) => {
    const parent = quatOf(b.parent!)
    b.quaternion.premultiply(parent).premultiply(dq).premultiply(parent.clone().invert())
    b.updateWorldMatrix(false, true)
  }
  const turnAbout = (b: THREE.Object3D, axis: THREE.Vector3, angle: number) => {
    if (Math.abs(angle) > 1e-6) turn(b, new THREE.Quaternion().setFromAxisAngle(axis, angle))
  }
  /** Points the bone `b` so that it runs toward `child` along `dir`. */
  const aim = (b: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) => {
    const now = posOf(child).sub(posOf(b)).normalize()
    turn(b, new THREE.Quaternion().setFromUnitVectors(now, dir.clone().normalize()))
  }
  const moveBy = (b: THREE.Object3D, d: THREE.Vector3) => {
    const at = posOf(b).add(d)
    b.position.copy(b.parent!.worldToLocal(root.localToWorld(at)))
    b.updateWorldMatrix(false, true)
  }

  // ----- the recordings, and where the dribbling hand goes in the dribble -----
  const mixer = new THREE.AnimationMixer(scene)
  const base = mixer.clipAction(clip)
  base.play()
  const height: number[] = []
  const steps = Math.max(2, Math.round(clip.duration * SAMPLE_FPS))
  for (let i = 0; i <= steps; i++) {
    mixer.setTime((i / steps) * clip.duration)
    scene.updateMatrixWorld(true)
    frame()
    height.push(posOf(bone.rHand).y)
  }
  mixer.setTime(0)
  const tops = findTops(height, steps / clip.duration)
  // The ball is let go from just under his hand at its highest.
  const ballTop = Math.max(...height) - BELOW_WRIST + 0.02

  // A reaction (a wave, a cheer...) is mixed over the dribble: `blend` goes from 0 (only the dribble) to 1 (only the reaction).
  const once = new Map<string, THREE.AnimationAction>()
  const actionFor = (name: string): THREE.AnimationAction => {
    let action = once.get(name)
    if (!action) {
      action = mixer.clipAction(clips.find((c) => c.name === name)!)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      once.set(name, action)
    }
    return action
  }
  let shot: { action: THREE.AnimationAction; endAt: number } | null = null
  let blend = 0
  // Standing: the first moment of the dribble held still (a copy of the recording, so it can be mixed with the dribble itself).
  const stand = mixer.clipAction(clip.clone())
  stand.play()
  stand.paused = true
  stand.time = 0
  let resting = false
  let rest = 0
  let phaseEnd = -1
  let cycle = 0
  const turns: Record<Reaction, number> = { greet: 0, hype: 0, hmm: 0 }

  /** How much the left arm is posed by code instead of by the recording (0 to 1), eased so a gesture comes and goes smoothly. */
  let gesture = 0
  let lastT = 0
  // The ball: where it is, how fast it falls while he is busy with a reaction, and whether he is still picking it up again.
  const ball = new THREE.Vector3()
  let fall = 0
  let picking = false
  let started = false

  function react(what: Reaction): void {
    const options = REACTIONS[what].filter((o) => clips.some((c) => c.name === o.clip))
    if (options.length === 0) return
    const choice = options[turns[what]++ % options.length]!
    const action = actionFor(choice.clip)
    if (shot && shot.action !== action) shot.action.stop()
    action.reset().setEffectiveWeight(blend).play()
    shot = { action, endAt: lastT + choice.seconds }
  }

  function apply(p: Pose, t: number): { ball: THREE.Vector3 } {
    // Time only goes forward (with reduced motion it stays at 0, and he stands still).
    const dt = Math.max(0, t - lastT)
    lastT = t
    // Dribbling for a while, then standing for a while.
    if (phaseEnd < 0) phaseEnd = t + DRIBBLE_FOR[0]!
    if (t >= phaseEnd) {
      resting = !resting
      if (resting) {
        phaseEnd = t + STAND_FOR[cycle % STAND_FOR.length]!
      } else {
        cycle++
        phaseEnd = t + DRIBBLE_FOR[cycle % DRIBBLE_FOR.length]!
        // He starts the next dribble from the beginning of it, standing up (it is not seen: its weight is 0 now).
        base.reset().play()
      }
    }
    rest = resting ? Math.min(1, rest + dt / REST_BLEND_S) : Math.max(0, rest - dt / REST_BLEND_S)
    const active = shot !== null && t < shot.endAt
    const step = dt / BLEND_S
    blend = active ? Math.min(1, blend + step) : Math.max(0, blend - step)
    if (shot && !active && blend === 0) {
      shot.action.stop()
      shot = null
    }
    base.setEffectiveWeight((1 - blend) * (1 - rest))
    stand.setEffectiveWeight((1 - blend) * rest)
    shot?.action.setEffectiveWeight(blend)
    mixer.update(dt)
    scene.updateMatrixWorld(true)
    frame()
    const free = 1 - blend

    // The hype jump: all of him goes up (the recording keeps his feet on the floor the rest of the time).
    if (p.rootY > 0 && free > 0) moveBy(bone.hips, new THREE.Vector3(0, p.rootY * free, 0))

    // Head: it follows the pointer and nods a little while he talks (there is no face rig to move a mouth).
    const nod = 0.05 * p.mouth
    const share = 1 - 0.6 * blend
    for (const [b, part] of [
      [bone.neck, 0.4],
      [bone.head, 0.6],
    ] as const) {
      turnAbout(b, Y, p.headYaw * part * share)
      turnAbout(b, X, (p.headPitch + nod) * part * share)
      turnAbout(b, Z, p.headRoll * part * share)
    }

    // Left arm: the recording's own while he only dribbles; from the angles of the pose (gesturing, at the chin, overhead) otherwise.
    const wanted = clamp01((p.lShoulder - 0.1) / 0.15)
    gesture = dt === 0 ? wanted : gesture + (wanted - gesture) * (1 - Math.exp(-dt * 10))
    const left = gesture * free
    if (left > 0.002) {
      const recorded = [bone.lArm.quaternion.clone(), bone.lFore.quaternion.clone()] as const
      // His left is +x (he faces +Z).
      const out = Math.sin(p.lShoulderOut + 0.12)
      const upper = new THREE.Vector3(out, -Math.cos(p.lShoulder), Math.sin(p.lShoulder))
      const total = p.lShoulder + p.lElbow
      const lower = new THREE.Vector3(out * 0.5, -Math.cos(total), Math.sin(total))
      aim(bone.lArm, bone.lFore, upper)
      aim(bone.lFore, bone.lHand, lower)
      bone.lArm.quaternion.slerpQuaternions(recorded[0], bone.lArm.quaternion.clone(), left)
      bone.lFore.quaternion.slerpQuaternions(recorded[1], bone.lFore.quaternion.clone(), left)
      bone.lArm.updateWorldMatrix(false, true)
    }

    // The ball: in his right hand while he dribbles; on the floor while a reaction plays or he stands; picked up again after.
    const wrist = posOf(bone.rHand)
    const held = new THREE.Vector3(wrist.x, ballCentreY(freeBallY(base.time, tops, clip.duration, ballTop, BALL_R), wrist.y, BELOW_WRIST), wrist.z + 0.02)
    if (!started || dt === 0) {
      started = true
      ball.copy(held)
    } else if (Math.max(blend, rest) > 0.5) {
      fall -= GRAVITY * dt
      ball.y += fall * dt
      if (ball.y < BALL_R) {
        ball.y = BALL_R
        fall = Math.abs(fall) * 0.55 > 0.4 ? Math.abs(fall) * 0.55 : 0
      }
      picking = true
    } else if (picking) {
      ball.lerp(held, 1 - Math.exp(-dt * 12))
      fall = 0
      if (ball.distanceTo(held) < 0.01) picking = false
    } else {
      ball.copy(held)
    }
    return { ball: ball.clone() }
  }

  return { root, apply, react }
}
