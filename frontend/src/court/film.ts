import { ARRIVE_AT, flightPoint, planFlight } from './flight'
import type { FlightPlan, ShotLike, Vec3 } from './flight'
import { HOOP_Y, RIM_HEIGHT } from './geometry'

/**
 * The shot film: a broadcast-style replay. The camera drops behind the shooter, the ball flies the
 * real arc in slow motion near the rim, then the camera swings round to watch the result.
 *
 * This file is only the timeline (pure functions of time, so it can be tested): the scene turns
 * each frame into a camera move, a ball and some effects.
 */

export interface Pose {
  pos: Vec3
  target: Vec3
}

/** How long each part of one shot lasts, in milliseconds. */
export interface Timings {
  /** The camera glides from where it was to behind the shooter. */
  lead: number
  /** The ball leaves the hand and reaches the rim. */
  flight: number
  /** The ball falls through the net, or kicks off the iron. */
  drop: number
  /** The camera watches the result while the graphic shows. */
  hold: number
}

export const CINEMATIC: Timings = { lead: 950, flight: 1500, drop: 750, hold: 1700 }
/** Shorter, for a whole session: about 2.7 seconds a shot. */
export const SESSION: Timings = { lead: 480, flight: 950, drop: 480, hold: 800 }
/** For people who asked for less motion: no travelling, just the result and the graphic. */
export const STILL: Timings = { lead: 0, flight: 0, drop: 0, hold: 2200 }
/** The camera returns to where it started. */
export const OUTRO_MS = 900
/** A session film shows at most this many shots (the latest ones). */
export const SESSION_MAX = 15

export type Phase = 'lead' | 'flight' | 'drop' | 'hold' | 'outro' | 'done'

export interface FilmShot {
  /** The shot's index in the scene's points (the flight plan uses it, so a replay always looks the same). */
  index: number
  shot: ShotLike
  flight: FlightPlan
}

export interface FilmPlan {
  shots: FilmShot[]
  timings: Timings
  /** Where the camera was when the film started: the first shot glides from it, the end returns to it. */
  startPose: Pose
}

export interface FilmFrame {
  /** Which shot of the film, 0-based; the last shot's number while outro or done. */
  k: number
  phase: Phase
  /** 0..1 progress through the current phase. */
  phaseT: number
  camera: Pose
  /** Where the ball is, or null when it is not on screen. */
  ball: Vec3 | null
}

const RIM: Vec3 = [0, RIM_HEIGHT, -HOOP_Y]
const BEHIND_FT = 6.5 // how far behind the shooter the camera stands
const EYE_HEIGHT = 6.6
const DOLLY_FT = 3.2 // how far the camera pushes in while the ball flies
const REACT_DIST = 9 // how far from the rim the camera watches the result
const REACT_HEIGHT = 9.8
const REACT_ANGLE = (50 * Math.PI) / 180
const DROP_BLEND = 0.35 // how far the camera has turned toward the reaction view by the end of the drop

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/** Unit vector (x, z) from one spot toward another; straight at the rim if they are the same spot. */
function dirXZ(from: [number, number], to: [number, number]): [number, number] {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const len = Math.hypot(dx, dz)
  return len < 0.5 ? [0, -1] : [dx / len, dz / len]
}

export function makePlan(points: ShotLike[], indices: number[], timings: Timings, startPose: Pose): FilmPlan {
  const shots: FilmShot[] = []
  for (const index of indices) {
    const shot = points[index]
    if (shot) shots.push({ index, shot, flight: planFlight(shot, index) })
  }
  return { shots, timings, startPose }
}

const shotMs = (t: Timings) => t.lead + t.flight + t.drop + t.hold
/** The way back is skipped when there is no travelling at all (the still version). */
const stillFilm = (t: Timings) => t.lead === 0 && t.flight === 0 && t.drop === 0
const outroMs = (t: Timings) => (stillFilm(t) ? 0 : OUTRO_MS)

export function planDuration(plan: FilmPlan): number {
  return plan.shots.length === 0 ? 0 : plan.shots.length * shotMs(plan.timings) + outroMs(plan.timings)
}

/** Where the film shot k starts, in milliseconds from the start of the film. */
export function shotStartMs(plan: FilmPlan, k: number): number {
  return Math.max(0, Math.min(k, plan.shots.length)) * shotMs(plan.timings)
}

/** The camera behind the shooter, looking at the rim, and the direction it pushes in. */
function shooterView(f: FlightPlan): { pos: Vec3; dir: [number, number] } {
  const rimXZ: [number, number] = [RIM[0], RIM[2]]
  const dir = dirXZ(f.start, rimXZ)
  return { pos: [f.start[0] - dir[0] * BEHIND_FT, EYE_HEIGHT, f.start[1] - dir[1] * BEHIND_FT], dir }
}

/** The camera that watches the result from the side of the rim, a little round from the shooter. */
export function reactionPose(f: FlightPlan): Pose {
  const e = dirXZ([RIM[0], RIM[2]], f.start) // rim toward the shooter
  const c = Math.cos(REACT_ANGLE)
  const s = Math.sin(REACT_ANGLE)
  const rx = e[0] * c - e[1] * s
  const rz = e[0] * s + e[1] * c
  return {
    pos: [RIM[0] + rx * REACT_DIST, REACT_HEIGHT, RIM[2] + rz * REACT_DIST],
    target: [RIM[0], RIM_HEIGHT - 1.2, RIM[2]],
  }
}

/** Real time through the flight to how far along the arc the ball is: fast at first, slow as it nears the rim. */
export function flightProgress(tf: number): number {
  return ARRIVE_AT * (1 - Math.pow(1 - clamp01(tf), 2.2))
}

/** Through the drop: the ball speeds up as it falls. */
export function dropProgress(tf: number): number {
  return ARRIVE_AT + (1 - ARRIVE_AT) * Math.pow(clamp01(tf), 1.5)
}

/** The camera while the ball flies: pushing in, looking mostly at the rim and a little at the ball. */
function flightCamera(fs: FilmShot, tf: number, ball: Vec3): Pose {
  const view = shooterView(fs.flight)
  const e = easeOut(clamp01(tf))
  return {
    pos: [view.pos[0] + view.dir[0] * DOLLY_FT * e, view.pos[1] + 0.8 * e, view.pos[2] + view.dir[1] * DOLLY_FT * e],
    target: lerp3(RIM, ball, 0.4),
  }
}

const poseLerp = (a: Pose, b: Pose, t: number): Pose => ({ pos: lerp3(a.pos, b.pos, t), target: lerp3(a.target, b.target, t) })

/** Everything on screen `ms` milliseconds into the film. */
export function frameAt(plan: FilmPlan, ms: number): FilmFrame {
  const n = plan.shots.length
  const last = Math.max(0, n - 1)
  if (n === 0) return { k: 0, phase: 'done', phaseT: 1, camera: plan.startPose, ball: null }
  const T = plan.timings
  const per = shotMs(T)

  if (ms >= n * per) {
    const lastFs = plan.shots[last]!
    const outro = outroMs(T)
    const t = outro > 0 ? clamp01((ms - n * per) / outro) : 1
    if (t >= 1) return { k: last, phase: 'done', phaseT: 1, camera: plan.startPose, ball: null }
    return { k: last, phase: 'outro', phaseT: t, camera: poseLerp(reactionPose(lastFs.flight), plan.startPose, easeInOut(t)), ball: null }
  }

  const k = Math.max(0, Math.min(last, Math.floor(ms / per)))
  const local = Math.max(0, ms - k * per)
  const fs = plan.shots[k]!
  const part = (offset: number, dur: number) => (dur > 0 ? clamp01((local - offset) / dur) : 1)
  const ballAt = (u: number) => flightPoint(fs.shot, fs.index, u, fs.flight)

  if (local < T.lead) {
    const from = k === 0 ? plan.startPose : reactionPose(plan.shots[k - 1]!.flight)
    const start = ballAt(0)
    const to = flightCamera(fs, 0, start)
    return { k, phase: 'lead', phaseT: part(0, T.lead), camera: poseLerp(from, to, easeInOut(part(0, T.lead))), ball: null }
  }
  if (local < T.lead + T.flight) {
    const tf = part(T.lead, T.flight)
    const ball = ballAt(flightProgress(tf))
    return { k, phase: 'flight', phaseT: tf, camera: flightCamera(fs, tf, ball), ball }
  }
  const atRim = ballAt(ARRIVE_AT)
  const flightEnd = flightCamera(fs, 1, atRim)
  if (local < T.lead + T.flight + T.drop) {
    const td = part(T.lead + T.flight, T.drop)
    return { k, phase: 'drop', phaseT: td, camera: poseLerp(flightEnd, reactionPose(fs.flight), DROP_BLEND * easeInOut(td)), ball: ballAt(dropProgress(td)) }
  }
  const th = part(T.lead + T.flight + T.drop, T.hold)
  // The still version has no travelling: the camera is simply at the reaction view.
  const blend = stillFilm(T) ? 1 : DROP_BLEND + (1 - DROP_BLEND) * easeInOut(th)
  return { k, phase: 'hold', phaseT: th, camera: poseLerp(flightEnd, reactionPose(fs.flight), blend), ball: ballAt(1) }
}

/** The shot indices for a session film: the latest `max` shots, in the order they were played. */
export function latestIndices(items: { game_date: string; id: number }[], max = SESSION_MAX): number[] {
  return items
    .map((s, i) => ({ i, date: s.game_date, id: s.id }))
    .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
    .slice(-max)
    .map((e) => e.i)
}

/** A zone needs this many shots in a film before the summary calls it the best. */
export const MIN_SHOTS_FOR_BEST_ZONE = 3

export interface FilmSummary {
  made: number
  total: number
  /** Whole-number percent, or null when there are no shots. */
  pct: number | null
  /** The zone with the best percentage among zones with at least MIN_SHOTS_FOR_BEST_ZONE shots (ties: more shots); null if none. */
  bestZone: { zone: string; made: number; total: number } | null
}

export function summarizeFilm(shots: { made: boolean; zone: string }[]): FilmSummary {
  const made = shots.filter((s) => s.made).length
  const zones = new Map<string, { made: number; total: number }>()
  for (const s of shots) {
    const z = zones.get(s.zone) ?? { made: 0, total: 0 }
    z.total++
    if (s.made) z.made++
    zones.set(s.zone, z)
  }
  let best: FilmSummary['bestZone'] = null
  for (const [zone, z] of zones) {
    if (z.total < MIN_SHOTS_FOR_BEST_ZONE) continue
    const better = !best || z.made / z.total > best.made / best.total || (z.made / z.total === best.made / best.total && z.total > best.total)
    if (better) best = { zone, made: z.made, total: z.total }
  }
  return { made, total: shots.length, pct: shots.length === 0 ? null : Math.round((made / shots.length) * 100), bestZone: best }
}

