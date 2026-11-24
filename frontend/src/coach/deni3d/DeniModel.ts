/**
 * The realistic coach: a rigged character model (public/deni.glb, a Mixamo-style skeleton with no fingers and no
 * face rig) posed in code every frame from the same `Pose` the drawn figure uses. The model brings no dribble of
 * its own, so the dribble is made here: his right hand is placed on top of the ball with two-bone arm maths
 * (ik.ts), his knees give a little with every bounce (the feet stay planted), and he leans over the ball.
 *
 * Everything is worked out in the model's own frame (the `root` group), so turning him round changes nothing.
 * A fan-made character inspired by Deni Avdija, not the real Deni.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { solveLimb } from './ik'
import { BALL_R, RELEASE_Y, type Pose } from './pose'

/** How tall he stands (metres), like the drawn figure. */
const HEIGHT = 2.04
/** The hand's thickness plus half the ball's bounce room: how far the wrist stays above the top of the ball. */
const WRIST_ABOVE_BALL = 0.085
/** The hand bone's own axis that points out of the palm (checked on this model: with the opposite sign the hand lands palm up). Local Y runs along the hand. */
const PALM_AXIS = new THREE.Vector3(-1, 0, 0)
/** How much of the turn that puts the palm flat is made, and the most the forearm and hand are twisted in all (radians). */
const TWIST_SHARE = 1
const MAX_TWIST = 1.9

const X = new THREE.Vector3(1, 0, 0)
const Y = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)
const DOWN = new THREE.Vector3(0, -1, 0)

/** The bones this uses, by the names in the file (the loader drops the colon of "mixamorig:Hips"). */
const NAMES = {
  hips: 'Hips',
  spine: 'Spine',
  spine1: 'Spine1',
  spine2: 'Spine2',
  neck: 'Neck',
  head: 'Head',
  lArm: 'LeftArm',
  lFore: 'LeftForeArm',
  lHand: 'LeftHand',
  rArm: 'RightArm',
  rFore: 'RightForeArm',
  rHand: 'RightHand',
  lUp: 'LeftUpLeg',
  lLeg: 'LeftLeg',
  lFoot: 'LeftFoot',
  rUp: 'RightUpLeg',
  rLeg: 'RightLeg',
  rFoot: 'RightFoot',
} as const
type BoneKey = keyof typeof NAMES

export interface DeniModel {
  /** Put this in the scene. Its origin is at his feet, he faces +Z. */
  root: THREE.Group
  /** Poses him for this moment. `ball` is where the ball is, in the same frame. */
  apply(pose: Pose): void
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const softMax = (a: number, b: number, k: number) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k))

export async function loadDeniModel(url: string, maxAnisotropy: number): Promise<DeniModel> {
  const gltf = await new GLTFLoader().loadAsync(url)
  return buildModel(gltf.scene, maxAnisotropy)
}

/** Exported for testing with a made-up skeleton. */
export function buildModel(scene: THREE.Object3D, maxAnisotropy = 1): DeniModel {
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

  // ----- what he looks like at rest -----
  frame()
  const rest = new Map<THREE.Object3D, { q: THREE.Quaternion; p: THREE.Vector3 }>()
  scene.traverse((o) => rest.set(o, { q: o.quaternion.clone(), p: o.position.clone() }))
  const lenOf = (a: THREE.Object3D, b: THREE.Object3D) => posOf(a).distanceTo(posOf(b))
  const rightArm = { l1: lenOf(bone.rArm, bone.rFore), l2: lenOf(bone.rFore, bone.rHand) }
  const leg = {
    left: { l1: lenOf(bone.lUp, bone.lLeg), l2: lenOf(bone.lLeg, bone.lFoot), foot: posOf(bone.lFoot), footQ: quatOf(bone.lFoot) },
    right: { l1: lenOf(bone.rUp, bone.rLeg), l2: lenOf(bone.rLeg, bone.rFoot), foot: posOf(bone.rFoot), footQ: quatOf(bone.rFoot) },
  }

  function apply(p: Pose): void {
    // Back to the resting pose, then pose from the hips up.
    scene.traverse((o) => {
      const r = rest.get(o)
      if (r) {
        o.quaternion.copy(r.q)
        o.position.copy(r.p)
      }
    })
    scene.updateMatrixWorld(true)
    frame()

    // Knees give with the bounce: the lower the ball is pushed, the lower he sits.
    const push = clamp01((0.98 - softMax(p.ball.y, RELEASE_Y, 0.03)) / (0.98 - RELEASE_Y))
    const crouch = 0.07 + 0.04 * push
    moveBy(bone.hips, new THREE.Vector3(p.lean * 0.6, p.rootY - crouch, 0))
    for (const side of ['left', 'right'] as const) {
      const up = side === 'left' ? bone.lUp : bone.rUp
      const lower = side === 'left' ? bone.lLeg : bone.rLeg
      const foot = side === 'left' ? bone.lFoot : bone.rFoot
      const l = leg[side]
      const target = l.foot.clone().add(new THREE.Vector3(0, Math.max(0, p.rootY), 0))
      const { mid, end } = solveLimb(posOf(up), target, l.l1, l.l2, Z)
      aim(up, lower, mid.clone().sub(posOf(up)))
      aim(lower, foot, end.clone().sub(posOf(lower)))
      // The foot stays flat on the floor whatever the knee does.
      const here = quatOf(foot)
      turn(foot, l.footQ.clone().multiply(here.clone().invert()))
    }

    // Over the ball: a forward lean spread up the spine, a breath and a slow sway.
    const lean = 0.16 + 0.012 * p.breathe
    turnAbout(bone.spine, X, lean * 0.4)
    turnAbout(bone.spine1, X, lean * 0.35)
    turnAbout(bone.spine2, X, lean * 0.25 - 0.015 * p.breathe)
    turnAbout(bone.spine1, Z, p.lean)

    // Head: it follows the pointer, nods a little while he talks (there is no face rig to move a mouth).
    const nod = 0.05 * p.mouth
    for (const [b, share] of [[bone.neck, 0.4], [bone.head, 0.6]] as const) {
      turnAbout(b, Y, p.headYaw * share)
      turnAbout(b, X, (p.headPitch + nod - lean * 0.8) * share)
      turnAbout(b, Z, p.headRoll * share)
    }

    // Right arm: the hand on top of the ball.
    {
      const shoulder = posOf(bone.rArm)
      const ball = new THREE.Vector3(p.ball.x, p.ball.y, p.ball.z)
      const hold = softMax(p.ball.y, RELEASE_Y, 0.03)
      const target = new THREE.Vector3(ball.x, hold + BALL_R + WRIST_ABOVE_BALL, ball.z - 0.04)
      const { mid, end } = solveLimb(shoulder, target, rightArm.l1, rightArm.l2, new THREE.Vector3(-0.5, -0.4, -1))
      aim(bone.rArm, bone.rFore, mid.clone().sub(shoulder))
      aim(bone.rFore, bone.rHand, end.clone().sub(mid))
      // The palm flat toward the floor, and the wrist snapping down as he pushes.
      const along = end.clone().sub(mid).normalize()
      const palm = PALM_AXIS.clone().applyQuaternion(quatOf(bone.rHand)).sub(along.clone().multiplyScalar(PALM_AXIS.clone().applyQuaternion(quatOf(bone.rHand)).dot(along))).normalize()
      const want = DOWN.clone().sub(along.clone().multiplyScalar(DOWN.dot(along))).normalize()
      const roll = Math.atan2(along.dot(palm.clone().cross(want)), palm.dot(want))
      // The turn is shared by the forearm and the hand: all of it at the wrist alone pinches the skin there (the sleeve crumples).
      const twist = Math.min(MAX_TWIST, Math.max(-MAX_TWIST, roll * TWIST_SHARE))
      turnAbout(bone.rFore, along, twist * 0.5)
      turnAbout(bone.rHand, along, twist * 0.5)
      turnAbout(bone.rHand, along.clone().cross(want).normalize(), 0.1 + 0.25 * push)
    }

    // Left arm: from the angles of the pose (relaxed, gesturing, at the chin or overhead).
    {
      // His left is +x (he faces +Z).
      const out = Math.sin(p.lShoulderOut + 0.12)
      const upper = new THREE.Vector3(out, -Math.cos(p.lShoulder), Math.sin(p.lShoulder)).normalize()
      const total = p.lShoulder + p.lElbow
      const lower = new THREE.Vector3(out * 0.5, -Math.cos(total), Math.sin(total)).normalize()
      aim(bone.lArm, bone.lFore, upper)
      aim(bone.lFore, bone.lHand, lower)
    }
  }

  return { root, apply }
}
