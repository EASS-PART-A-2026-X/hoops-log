import { HOOP_Y, RIM_HEIGHT, toWorld } from './geometry'

/** Where the ball is, in world feet [X, Y, Z], at `u` from 0 (release) to 1 (landed). */
export type Vec3 = [number, number, number]

export const RELEASE_HEIGHT = 6
export const RIM_RADIUS = 0.75
/** Share of the flight spent travelling to the rim; the rest is the drop or the bounce. */
export const ARRIVE_AT = 0.78
/** How far the ball falls through the net before the flight ends. */
export const NET_DROP = 2.8

/** Same number for the same shot every time, so a replay always looks the same. */
function unit(index: number, salt: number): number {
  const x = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

export interface ShotLike {
  x: number
  y: number
  made: boolean
}

/** Where the ball meets the rim height, and where it ends up on the floor if it missed. */
export interface FlightPlan {
  start: [number, number] // shooter [X, Z]
  hit: [number, number] // [X, Z] where the ball reaches rim height
  land: [number, number] // [X, Z] where it ends: the net for a make, the floor for a miss
  /** What a miss did: short = front rim, long = back iron, side = off the left or right iron. */
  kind: 'swish' | 'short' | 'long' | 'side'
}

export function planFlight(shot: ShotLike, index: number): FlightPlan {
  const [wx, wz] = toWorld(shot.x, shot.y)
  const rimZ = -HOOP_Y
  const start: [number, number] = [wx, wz]
  if (shot.made) return { start, hit: [0, rimZ], land: [0, rimZ], kind: 'swish' }

  // Unit vector from the rim toward the shooter.
  const len = Math.hypot(wx, wz - rimZ) || 1
  const dx = wx / len
  const dz = (wz - rimZ) / len
  // A miss lands on the iron, not through the middle: the offset is bigger than the rim.
  const off = RIM_RADIUS + 0.12 + 0.55 * unit(index, 1)
  const pick = unit(index, 0)
  const kind = pick < 0.34 ? 'short' : pick < 0.62 ? 'long' : 'side'
  const side = unit(index, 3) < 0.5 ? 1 : -1
  let hit: [number, number]
  let out: [number, number] // direction the ball kicks away after the rim
  if (kind === 'short') {
    hit = [dx * off, rimZ + dz * off]
    out = [dx, dz] // front rim: it comes back toward the shooter
  } else if (kind === 'long') {
    hit = [-dx * off, rimZ - dz * off]
    out = [dx * 0.6, dz * 0.6] // back iron: it caroms off the glass, back out
  } else {
    hit = [-dz * off * side, rimZ + dx * off * side]
    out = [-dz * side, dx * side] // side iron: it kicks out to that side
  }
  // A back-iron miss starts on the far side of the rim, so it has to travel past the whole
  // rim before it lands: otherwise it would come down inside the rim's circle.
  const away = (kind === 'long' ? off + 2.4 : 2.6) + 3.2 * unit(index, 2)
  const norm = Math.hypot(out[0], out[1]) || 1
  const land: [number, number] = [hit[0] + (out[0] / norm) * away, hit[1] + (out[1] / norm) * away]
  return { start, hit, land, kind }
}

export function flightPoint(shot: ShotLike, index: number, u: number, plan = planFlight(shot, index)): Vec3 {
  const [sx, sz] = plan.start
  const [hx, hz] = plan.hit
  if (u <= ARRIVE_AT) {
    const t = u / ARRIVE_AT
    const peak = 3 + Math.hypot(hx - sx, hz - sz) * 0.22
    return [
      sx + (hx - sx) * t,
      RELEASE_HEIGHT + (RIM_HEIGHT - RELEASE_HEIGHT) * t + peak * 4 * t * (1 - t),
      sz + (hz - sz) * t,
    ]
  }
  const t = (u - ARRIVE_AT) / (1 - ARRIVE_AT)
  if (shot.made) return [hx, RIM_HEIGHT - NET_DROP * t, hz] // straight down through the net
  const [lx, lz] = plan.land
  // Off the iron: a hop up, then down to the floor, drifting away from the rim. A back-iron
  // miss kicks back over the rim, so its hop is higher: it must clear the rim, never fall
  // through the net space on the way out.
  const hop = plan.kind === 'long' ? 5 : 1.4
  return [
    hx + (lx - hx) * t,
    RIM_HEIGHT * (1 - t * t) + hop * Math.sin(Math.PI * t),
    hz + (lz - hz) * t,
  ]
}
