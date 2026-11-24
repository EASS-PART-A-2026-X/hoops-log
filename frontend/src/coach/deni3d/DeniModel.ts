/**
 * The realistic coach: a rigged character model (public/deni.glb, a Mixamo-style skeleton with no fingers and no
 * face rig) that dribbles with a recorded motion (the clip `basketball_dribble` in the same file). The ball is not in
 * the recording, so it is worked out from his right hand (dribbleBall.ts). What the recording cannot know is added on
 * top, in code: his left arm gestures while he talks, goes to his chin when he is thinking and overhead when he is
 * hyped (blended in and out smoothly), his head follows the pointer and nods while he talks, and he jumps for a hype.
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
   * Poses him for this moment (`t` = seconds into the recording, which repeats) and says where the ball is, in the
   * frame of `root`.
   */
  apply(pose: Pose, t: number): { ball: THREE.Vector3 }
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

  // ----- the recording, and where the dribbling hand goes in it -----
  const mixer = new THREE.AnimationMixer(scene)
  mixer.clipAction(clip).play()
  const height: number[] = []
  const steps = Math.max(2, Math.round(clip.duration * SAMPLE_FPS))
  for (let i = 0; i <= steps; i++) {
    mixer.setTime((i / steps) * clip.duration)
    scene.updateMatrixWorld(true)
    frame()
    height.push(posOf(bone.rHand).y)
  }
  const tops = findTops(height, steps / clip.duration)
  // The ball is let go from just under his hand at its highest.
  const ballTop = Math.max(...height) - BELOW_WRIST + 0.02

  /** How much the left arm is posed by code instead of by the recording (0 to 1), eased so a gesture comes and goes smoothly. */
  let gesture = 0
  let lastT = 0

  function apply(p: Pose, t: number): { ball: THREE.Vector3 } {
    mixer.setTime(t)
    scene.updateMatrixWorld(true)
    frame()
    const dt = Math.min(0.1, Math.max(0, t - lastT))
    lastT = t

    // The hype jump: all of him goes up (the recording keeps his feet on the floor the rest of the time).
    if (p.rootY > 0) moveBy(bone.hips, new THREE.Vector3(0, p.rootY, 0))

    // Head: it follows the pointer and nods a little while he talks (there is no face rig to move a mouth).
    const nod = 0.05 * p.mouth
    for (const [b, share] of [
      [bone.neck, 0.4],
      [bone.head, 0.6],
    ] as const) {
      turnAbout(b, Y, p.headYaw * share)
      turnAbout(b, X, (p.headPitch + nod) * share)
      turnAbout(b, Z, p.headRoll * share)
    }

    // Left arm: the recording's own while he only dribbles; from the angles of the pose (gesturing, at the chin, overhead) otherwise.
    const wanted = clamp01((p.lShoulder - 0.1) / 0.15)
    gesture = dt === 0 ? wanted : gesture + (wanted - gesture) * (1 - Math.exp(-dt * 10))
    if (gesture > 0.002) {
      const recorded = [bone.lArm.quaternion.clone(), bone.lFore.quaternion.clone()] as const
      // His left is +x (he faces +Z).
      const out = Math.sin(p.lShoulderOut + 0.12)
      const upper = new THREE.Vector3(out, -Math.cos(p.lShoulder), Math.sin(p.lShoulder))
      const total = p.lShoulder + p.lElbow
      const lower = new THREE.Vector3(out * 0.5, -Math.cos(total), Math.sin(total))
      aim(bone.lArm, bone.lFore, upper)
      aim(bone.lFore, bone.lHand, lower)
      bone.lArm.quaternion.slerpQuaternions(recorded[0], bone.lArm.quaternion.clone(), gesture)
      bone.lFore.quaternion.slerpQuaternions(recorded[1], bone.lFore.quaternion.clone(), gesture)
      bone.lArm.updateWorldMatrix(false, true)
    }

    // The ball, from his right hand.
    const wrist = posOf(bone.rHand)
    const y = ballCentreY(freeBallY(t, tops, clip.duration, ballTop, BALL_R), wrist.y, BELOW_WRIST)
    return { ball: new THREE.Vector3(wrist.x, y, wrist.z + 0.02) }
  }

  return { root, apply }
}
