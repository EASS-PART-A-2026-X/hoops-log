/**
 * Where every joint of the 3D coach is at a moment in time. Pure numbers, no drawing, so it can be tested:
 * the stage only copies these onto the model. Lengths are metres (he stands about 2.06 m), angles radians.
 */
import type { Mood } from '../lines'

export interface PoseInput {
  /** Seconds since the stage started. */
  t: number
  talking: boolean
  mood: Mood
  /** Seconds since the mood began (the hype jump and the thinking pose ease in from here). */
  moodAge: number
  /** Where the pointer is over the stage, -1..1 on both axes (0, 0 = straight ahead). */
  look: { x: number; y: number }
  /** With reduced motion he stands still, holding the ball. */
  reduced: boolean
}

export interface Pose {
  rootY: number
  lean: number
  breathe: number
  headYaw: number
  headPitch: number
  headRoll: number
  /** 0 = closed (a smile), 1 = wide open. */
  mouth: number
  /** 1 = eyes open, 0 = shut. */
  eyes: number
  /** Raised brows, 0..1. */
  brows: number
  rShoulder: number
  rElbow: number
  /** The dribbling wrist, bent from the forearm toward the floor (radians). */
  rWrist: number
  lShoulder: number
  lShoulderOut: number
  lElbow: number
  ball: { x: number; y: number; z: number; spin: number }
}

export const BALL_R = 0.12
/** Arm lengths (metres): shoulder height, shoulder to elbow, elbow to wrist, wrist to palm centre, half the palm's thickness. */
export const SHOULDER_Y = 1.63
export const UPPER_ARM = 0.34
export const FOREARM = 0.262
export const PALM = 0.074
export const PALM_HALF = 0.034
/** Where the ball is dribbled: out to his right and in front of him. */
export const BALL_X = -0.32
export const BALL_Z = 0.3
/** The ball leaves his palm at this height (centre) and comes back to it: the hand follows it down only this far. */
export const RELEASE_Y = 0.92
/** The ball's centre at the top of the dribble, and one bounce in seconds. */
export const DRIBBLE_TOP = 0.98
export const DRIBBLE_S = 0.64
/** How long the hype jump lasts. */
export const HYPE_S = 1.5

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (v: number) => {
  const c = clamp01(v)
  return c * c * (3 - 2 * c)
}
/** A max that rounds the corner, so the hand eases into and out of the ball instead of jerking. */
const softMax = (a: number, b: number, k: number) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k))
const mix = (a: number, b: number, k: number) => a + (b - a) * k

/**
 * Joint angles that put the palm flat on top of the ball (fingers over it, wrist snapping down as he pushes):
 * two-bone arm IK in the vertical plane through his shoulder. Angles are from straight down, forward positive.
 */
export function dribbleArm(ballY: number): { shoulder: number; elbow: number; wrist: number } {
  const handBallY = softMax(ballY, RELEASE_Y, 0.03)
  // How far the hand has followed the ball down: 0 at the top of the bounce, 1 at the release.
  const push = clamp01((DRIBBLE_TOP - handBallY) / (DRIBBLE_TOP - RELEASE_Y))
  // The palm points forward and a little down; the wrist snaps further down while pushing.
  const tilt = 0.18 + 0.42 * push
  const wristY = handBallY + BALL_R + PALM_HALF + PALM * Math.sin(tilt)
  const wristZ = BALL_Z - PALM * Math.cos(tilt)
  const dy = wristY - SHOULDER_Y
  const reach = Math.min(UPPER_ARM + FOREARM - 1e-3, Math.max(0.05, Math.hypot(dy, wristZ)))
  const cosInside = (UPPER_ARM * UPPER_ARM + FOREARM * FOREARM - reach * reach) / (2 * UPPER_ARM * FOREARM)
  const elbow = Math.PI - Math.acos(Math.min(1, Math.max(-1, cosInside)))
  const toWrist = Math.atan2(wristZ, -dy)
  const shoulder = toWrist - Math.atan2(FOREARM * Math.sin(elbow), UPPER_ARM + FOREARM * Math.cos(elbow))
  return { shoulder, elbow, wrist: Math.PI / 2 - tilt - (shoulder + elbow) }
}

export function poseAt({ t, talking, mood, moodAge, look, reduced }: PoseInput): Pose {
  // The dribble: the ball leaves the hand, hits the floor and comes back once per period.
  const phase = reduced ? 0 : (t % DRIBBLE_S) / DRIBBLE_S
  const up = reduced ? 1 : Math.pow(Math.cos(phase * Math.PI * 2) * 0.5 + 0.5, 0.6)
  const ballY = BALL_R + (DRIBBLE_TOP - BALL_R) * up
  const arm = dribbleArm(ballY)

  const hype = mood === 'hype' && !reduced ? clamp01(moodAge / HYPE_S) : mood === 'hype' ? 0.5 : 1
  const jumping = mood === 'hype' && !reduced && moodAge < HYPE_S
  const jump = jumping ? 0.16 * Math.abs(Math.sin(hype * Math.PI * 3)) : 0
  const thinking = mood === 'hmm' ? smooth(moodAge / 0.35) : 0
  const cheering = mood === 'hype' ? smooth(moodAge / 0.25) * (jumping || reduced ? 1 : smooth((HYPE_S + 0.6 - moodAge) / 0.6)) : 0
  const gesture = talking && !reduced ? 1 : 0

  // Left arm: relaxed, lifted to gesture while talking, at the chin when thinking, pumping overhead when hyped.
  let lShoulder = mix(0.05, 0.42 + 0.1 * Math.sin(t * 2.3), gesture)
  let lElbow = mix(0.25, 1.25 + 0.25 * Math.sin(t * 3.1 + 1), gesture)
  let lOut = mix(0.1, 0.22, gesture)
  lShoulder = mix(lShoulder, 0.95, thinking)
  lElbow = mix(lElbow, 2.25, thinking)
  lOut = mix(lOut, -0.18, thinking)
  lShoulder = mix(lShoulder, 2.75, cheering)
  lElbow = mix(lElbow, 0.35 + (reduced ? 0 : 0.3 * Math.sin(t * 14)), cheering)
  lOut = mix(lOut, 0.25, cheering)

  const blinkAt = t % 4.2
  const eyes = reduced ? 1 : blinkAt < 0.12 ? Math.abs(blinkAt - 0.06) / 0.06 : 1
  const mouth = talking ? (reduced ? 0.45 : 0.2 + 0.8 * Math.abs(Math.sin(t * 11)) * (0.6 + 0.4 * Math.sin(t * 3.7))) : mood === 'hype' ? 0.7 * cheering : 0

  return {
    rootY: jump,
    lean: reduced ? 0 : 0.015 * Math.sin(t * 0.9),
    breathe: reduced ? 0 : Math.sin(t * 1.6),
    headYaw: clamp01((look.x + 1) / 2) * 1.0 - 0.5,
    headPitch: (clamp01((look.y + 1) / 2) - 0.5) * 0.45 + (talking && !reduced ? 0.03 * Math.sin(t * 6) : 0) + 0.12 * thinking,
    headRoll: 0.14 * thinking,
    mouth: clamp01(mouth),
    eyes: clamp01(eyes),
    brows: mood === 'hype' ? cheering : mood === 'hmm' ? 0.6 * thinking : talking ? 0.2 : 0,
    rShoulder: arm.shoulder,
    rElbow: arm.elbow,
    rWrist: arm.wrist,
    lShoulder,
    lShoulderOut: lOut,
    lElbow,
    ball: { x: BALL_X, y: ballY, z: BALL_Z, spin: reduced ? 0 : t * 5 },
  }
}
