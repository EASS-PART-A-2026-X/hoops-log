/**
 * Two-bone limb maths (an arm or a leg), pure so it can be tested: where the middle joint goes so that a limb of
 * two bones, fixed at one end, reaches a target with the other.
 */
import * as THREE from 'three'

export interface Limb {
  /** The middle joint (elbow or knee). */
  mid: THREE.Vector3
  /** Where the far end really lands: the target, or the nearest point the limb can reach. */
  end: THREE.Vector3
}

/**
 * `root` is the shoulder or hip, `target` where the hand or foot should be, `l1` and `l2` the bone lengths, and
 * `pole` the way the middle joint should point (down and back for an elbow, forward for a knee).
 */
export function solveLimb(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3): Limb {
  const toTarget = target.clone().sub(root)
  const wanted = toTarget.length()
  // Never fully straight (the joint would lock) and never folded flat: stay inside what the bones can do.
  const reach = Math.min(Math.max(wanted, Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
  const axis = wanted > 1e-6 ? toTarget.clone().divideScalar(wanted) : new THREE.Vector3(0, -1, 0)
  const along = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach)
  const out = Math.sqrt(Math.max(0, l1 * l1 - along * along))
  // The pole, made square to the axis, is the direction the joint bulges.
  const side = pole.clone().sub(axis.clone().multiplyScalar(pole.dot(axis)))
  if (side.lengthSq() < 1e-9) side.set(1, 0, 0).sub(axis.clone().multiplyScalar(axis.x))
  side.normalize()
  const mid = root.clone().addScaledVector(axis, along).addScaledVector(side, out)
  const end = root.clone().addScaledVector(axis, reach)
  return { mid, end }
}
