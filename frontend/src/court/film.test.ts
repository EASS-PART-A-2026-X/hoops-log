import { describe, expect, it } from 'vitest'
import { HOOP_Y, RIM_HEIGHT, toWorld } from './geometry'
import { ARRIVE_AT, NET_DROP, RELEASE_HEIGHT, planFlight } from './flight'
import {
  CINEMATIC,
  MIN_SHOTS_FOR_BEST_ZONE,
  OUTRO_MS,
  SESSION,
  STILL,
  dropProgress,
  flightProgress,
  frameAt,
  latestIndices,
  makePlan,
  planDuration,
  reactionPose,
  shotStartMs,
  summarizeFilm,
} from './film'
import type { Phase, Pose } from './film'

const startPose: Pose = { pos: [0, 34, -66], target: [0, 0, -15] }
const made = { x: 25, y: 23, made: true } // top of the key, a make
const missed = { x: 5, y: 8, made: false }

const planOf = (shots: { x: number; y: number; made: boolean }[], timings = CINEMATIC) =>
  makePlan(shots, shots.map((_, i) => i), timings, startPose)

const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

describe('film timeline', () => {
  it('lasts one slot per shot plus the way back', () => {
    const plan = planOf([made, missed])
    const per = CINEMATIC.lead + CINEMATIC.flight + CINEMATIC.drop + CINEMATIC.hold
    expect(planDuration(plan)).toBe(2 * per + OUTRO_MS)
    expect(shotStartMs(plan, 1)).toBe(per)
    expect(planDuration(planOf([]))).toBe(0)
  })

  it('goes through lead, flight, drop, hold, outro and done in that order', () => {
    const plan = planOf([made])
    const seen: Phase[] = []
    for (let ms = 0; ms <= planDuration(plan) + 50; ms += 10) {
      const p = frameAt(plan, ms).phase
      if (seen[seen.length - 1] !== p) seen.push(p)
    }
    expect(seen).toEqual(['lead', 'flight', 'drop', 'hold', 'outro', 'done'])
  })

  it('keeps the ball off screen while the camera travels and shows it from release to the end of the hold', () => {
    const plan = planOf([made])
    expect(frameAt(plan, 0).ball).toBeNull()
    expect(frameAt(plan, CINEMATIC.lead + 10).ball).not.toBeNull()
    expect(frameAt(plan, planDuration(plan) - 10).ball).toBeNull()
    expect(frameAt(plan, planDuration(plan) + 500).phase).toBe('done')
  })

  it('releases the ball from the shooter at release height and reaches rim height at the rim', () => {
    const plan = planOf([made])
    const [wx, wz] = toWorld(made.x, made.y)
    const release = frameAt(plan, CINEMATIC.lead).ball!
    expect(release[0]).toBeCloseTo(wx, 5)
    expect(release[1]).toBeCloseTo(RELEASE_HEIGHT, 5)
    expect(release[2]).toBeCloseTo(wz, 5)
    const atRim = frameAt(plan, CINEMATIC.lead + CINEMATIC.flight).ball!
    expect(atRim[0]).toBeCloseTo(0, 5)
    expect(atRim[1]).toBeCloseTo(RIM_HEIGHT, 5)
    expect(atRim[2]).toBeCloseTo(-HOOP_Y, 5)
  })

  it('drops a make straight through the net and leaves a miss on the floor away from the rim', () => {
    const makePlanFrames = planOf([made])
    const holdEnd = CINEMATIC.lead + CINEMATIC.flight + CINEMATIC.drop + CINEMATIC.hold - 1
    const inNet = frameAt(makePlanFrames, holdEnd).ball!
    expect(inNet[0]).toBeCloseTo(0, 1)
    expect(inNet[1]).toBeCloseTo(RIM_HEIGHT - NET_DROP, 1)

    const missPlan = planOf([missed])
    const onFloor = frameAt(missPlan, holdEnd).ball!
    expect(onFloor[1]).toBeLessThan(1)
    expect(Math.hypot(onFloor[0], onFloor[2] + HOOP_Y)).toBeGreaterThan(0.9) // not inside the rim's circle
  })

  it('slows the ball as it nears the rim', () => {
    expect(flightProgress(0)).toBe(0)
    expect(flightProgress(1)).toBeCloseTo(ARRIVE_AT, 10)
    const early = flightProgress(0.1) - flightProgress(0)
    const late = flightProgress(1) - flightProgress(0.9)
    expect(late).toBeLessThan(early / 3)
    expect(dropProgress(0)).toBeCloseTo(ARRIVE_AT, 10)
    expect(dropProgress(1)).toBeCloseTo(1, 10)
  })

  it('never jumps the camera: it moves smoothly across every phase change, shot to shot and back', () => {
    const plan = planOf([made, missed, { x: 45, y: 4, made: true }], SESSION)
    let prev = frameAt(plan, 0).camera
    let worst = 0
    for (let ms = 5; ms <= planDuration(plan); ms += 5) {
      const cam = frameAt(plan, ms).camera
      worst = Math.max(worst, dist(prev.pos, cam.pos), dist(prev.target, cam.target))
      prev = cam
    }
    expect(worst).toBeLessThan(3) // feet in 5 ms
  })

  it('starts the camera where it was and returns it there', () => {
    const plan = planOf([made, missed])
    const first = frameAt(plan, 0).camera
    expect(dist(first.pos, startPose.pos)).toBeLessThan(1e-9)
    const end = frameAt(plan, planDuration(plan) + 1).camera
    expect(end).toEqual(startPose)
  })

  it('puts the reaction camera near the rim and always at a safe distance from it', () => {
    for (const shot of [made, missed, { x: 25, y: 5.25, made: true }, { x: 0, y: 0, made: false }]) {
      const plan = planOf([shot])
      const r = reactionPose(plan.shots[0]!.flight)
      expect(Math.hypot(r.pos[0], r.pos[2] + HOOP_Y)).toBeCloseTo(9, 5)
      expect(Number.isFinite(r.pos[0] + r.pos[1] + r.pos[2])).toBe(true)
    }
  })

  it('has no travel at all in the still version: the camera stays put, and there is no way back', () => {
    const plan = planOf([made], STILL)
    expect(planDuration(plan)).toBe(STILL.hold)
    const early = frameAt(plan, 100)
    const late = frameAt(plan, STILL.hold - 100)
    expect(early.phase).toBe('hold')
    expect(early.camera).toEqual(late.camera)
    expect(frameAt(plan, STILL.hold).phase).toBe('done')
  })

  it('plans a shot from its index: the same index gives the same flight, a miss differs between indices, a make does not', () => {
    // The plan looks the shot up by its index in the list, so pad the list up to that index.
    const planAt = (shot: typeof made, index: number) => makePlan(Array.from({ length: index + 1 }, () => shot), [index], CINEMATIC, startPose).shots[0]!
    // Same shot object, same index: the same plan every time.
    expect(planAt(missed, 3).flight).toEqual(planAt(missed, 3).flight)
    expect(planAt(missed, 3).flight).toEqual(planFlight(missed, 3))
    // A miss: the index picks the kind and the landing spot, so some pair of indices must differ.
    const flights = Array.from({ length: 12 }, (_, i) => planAt(missed, i).flight)
    expect(new Set(flights.map((f) => f.kind)).size).toBeGreaterThan(1)
    expect(new Set(flights.map((f) => f.land.join(','))).size).toBeGreaterThan(1)
    // A make always swishes the same way, whatever the index.
    expect(planAt(made, 0).flight).toEqual(planAt(made, 7).flight)
  })
})

describe('latestIndices', () => {
  const items = [
    { id: 3, game_date: '2026-10-12' },
    { id: 1, game_date: '2026-10-14' },
    { id: 2, game_date: '2026-10-12' },
    { id: 4, game_date: '2026-10-20' },
  ]
  it('plays in date order (then id) and keeps the latest ones', () => {
    expect(latestIndices(items, 10)).toEqual([2, 0, 1, 3])
    expect(latestIndices(items, 2)).toEqual([1, 3])
    expect(latestIndices([], 5)).toEqual([])
  })
})

describe('summarizeFilm', () => {
  const zone = (z: string, madeOf: boolean[]) => madeOf.map((made) => ({ made, zone: z }))

  it('counts makes and finds the best zone with at least MIN_SHOTS_FOR_BEST_ZONE shots', () => {
    expect(MIN_SHOTS_FOR_BEST_ZONE).toBe(3)
    const s = summarizeFilm([...zone('paint', [true, true, false]), ...zone('top_3', [false]), ...zone('left_corner_3', [true, false])])
    expect(s).toEqual({ made: 3, total: 6, pct: 50, bestZone: { zone: 'paint', made: 2, total: 3 } })
  })

  it('does not call a zone with fewer shots than the minimum the best, however well it went', () => {
    const s = summarizeFilm([...zone('paint', [true, true]), ...zone('top_3', [true, false, false])])
    expect(s.bestZone).toEqual({ zone: 'top_3', made: 1, total: 3 })
    expect(summarizeFilm(zone('paint', [true, true])).bestZone).toBeNull()
  })

  it('has no best zone when every zone has one shot, and no percentage without shots', () => {
    expect(summarizeFilm([{ made: true, zone: 'paint' }, { made: false, zone: 'top_3' }]).bestZone).toBeNull()
    expect(summarizeFilm([])).toEqual({ made: 0, total: 0, pct: null, bestZone: null })
  })

  it('breaks a tie on percentage by the zone with more shots', () => {
    const s = summarizeFilm([...zone('a', [true, true, true]), ...zone('b', [true, true, true, true])])
    expect(s.bestZone?.zone).toBe('b')
  })
})
