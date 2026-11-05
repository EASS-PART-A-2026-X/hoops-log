import * as THREE from 'three'
import { COURT_L, COURT_W } from './geometry'

/**
 * The arena around the court: stepped stands on all four sides, a crowd of dim seats and a glowing
 * ribbon board along the court edge. Everything is see-through and drawn behind the shots
 * (renderOrder below zero, no depth writes), so it adds atmosphere without hiding a single shot.
 *
 * World: x runs across the court (-25..25), z runs from the baseline (0) to half court (-47).
 */

const TIERS = 6
const TIER_DEPTH = 3.4 // how far each step goes back
const TIER_HEIGHT = 2.2 // how much each step rises
const FIRST_TIER_Y = 1.8
const COURTSIDE_GAP = 8 // floor between the court and the first row

const STAND_OPACITY = 0.3
const CROWD_OPACITY = 0.3
const RIBBON_OPACITY = 0.3

// Muted on purpose: the crowd is a backdrop, and the brightest things on screen must be the shots.
const CROWD_COLORS = ['#c26a3a', '#8a4b2c', '#9fb4cc', '#4a6a99', '#2f4468', '#6b7b90', '#a85a30']

/** A tiny seeded random generator, so the crowd looks the same every time. */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Stand {
  /** 'x' stands run along a sideline, 'z' stands run along a baseline or the half-court end. */
  axis: 'x' | 'z'
  /** Which way the stand rises away from the court. */
  sign: 1 | -1
  /** Where the first row starts: feet from the court's centre line (sidelines) or from the baseline / half-court line (ends). */
  start: number
  /** Where along the stand it is centred, and how long it is. */
  centre: number
  length: number
}

// The sideline stands run from the far end stand's first row to the near end stand's first row, so they
// stop where the end stands begin and the corners belong to the end stands (no box is drawn twice).
const NEAR_END_START = COURTSIDE_GAP + 2 // feet behind the baseline
const FAR_END_START = 36 // feet past the half-court line
const SIDE_LENGTH = COURT_L + FAR_END_START + NEAR_END_START
const SIDE_CENTRE = (NEAR_END_START - COURT_L - FAR_END_START) / 2

/** The four stands. The half-court end sits far back so the default camera stays in front of it. */
const STANDS: Stand[] = [
  { axis: 'x', sign: 1, start: COURT_W / 2 + COURTSIDE_GAP, centre: SIDE_CENTRE, length: SIDE_LENGTH },
  { axis: 'x', sign: -1, start: COURT_W / 2 + COURTSIDE_GAP, centre: SIDE_CENTRE, length: SIDE_LENGTH },
  { axis: 'z', sign: 1, start: NEAR_END_START, centre: 0, length: COURT_W + 2 * (COURTSIDE_GAP + TIERS * TIER_DEPTH) },
  { axis: 'z', sign: -1, start: FAR_END_START, centre: 0, length: COURT_W + 2 * (COURTSIDE_GAP + TIERS * TIER_DEPTH) },
]

/** World z for a spot `dist` feet back from the court at an end: behind the baseline (+) or past the half-court line (-). */
const endZ = (sign: 1 | -1, dist: number) => (sign > 0 ? dist : -COURT_L - dist)

export function buildArena(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'arena'
  const rand = seeded(2026)

  const standMat = new THREE.MeshBasicMaterial({ color: '#0d1626', transparent: true, opacity: STAND_OPACITY, depthWrite: false })
  const seatGeo = new THREE.BoxGeometry(0.9, 1.15, 0.8)
  const seats: { x: number; y: number; z: number; color: THREE.Color }[] = []

  for (const stand of STANDS) {
    for (let tier = 0; tier < TIERS; tier++) {
      const height = FIRST_TIER_Y + tier * TIER_HEIGHT
      const offset = stand.start + tier * TIER_DEPTH // distance of this step's front edge from the court
      // The step: a long box from the floor up to this tier's height.
      const stepGeo = new THREE.BoxGeometry(stand.axis === 'x' ? TIER_DEPTH : stand.length, height, stand.axis === 'x' ? stand.length : TIER_DEPTH)
      const step = new THREE.Mesh(stepGeo, standMat)
      const mid = offset + TIER_DEPTH / 2
      if (stand.axis === 'x') step.position.set(stand.sign * mid, height / 2 - 0.5, stand.centre)
      else step.position.set(stand.centre, height / 2 - 0.5, endZ(stand.sign, mid))
      step.renderOrder = -3
      group.add(step)

      // The crowd sitting on this step, with a few empty seats.
      const count = Math.floor(stand.length / 2.1)
      for (let i = 0; i < count; i++) {
        if (rand() < 0.1) continue
        const along = stand.centre - stand.length / 2 + (i + 0.5) * (stand.length / count)
        const shade = 0.3 + rand() * 0.45
        const colour = new THREE.Color(CROWD_COLORS[Math.floor(rand() * CROWD_COLORS.length)]).multiplyScalar(shade)
        const y = height - 0.5 + 0.9
        if (stand.axis === 'x') seats.push({ x: stand.sign * (offset + TIER_DEPTH * 0.55), y, z: along, color: colour })
        else seats.push({ x: along, y, z: endZ(stand.sign, offset + TIER_DEPTH * 0.55), color: colour })
      }
    }
  }

  const crowd = new THREE.InstancedMesh(
    seatGeo,
    new THREE.MeshBasicMaterial({ transparent: true, opacity: CROWD_OPACITY, depthWrite: false }),
    seats.length,
  )
  const m = new THREE.Matrix4()
  seats.forEach((s, i) => {
    m.makeTranslation(s.x, s.y, s.z)
    crowd.setMatrixAt(i, m)
    crowd.setColorAt(i, s.color)
  })
  crowd.renderOrder = -2
  group.add(crowd)

  // The ribbon board: a thin glowing band around the court, just outside the sidelines.
  const ribbonMat = new THREE.MeshBasicMaterial({ color: '#ff7a2f', transparent: true, opacity: RIBBON_OPACITY, depthWrite: false })
  const gap = 2.6
  const w = COURT_W + 2 * gap
  const l = COURT_L + 2 * gap
  const cz = -COURT_L / 2
  // [x, z, width, depth] of the four bars: both sidelines, the baseline end and the half-court end.
  const bars: [number, number, number, number][] = [
    [-w / 2, cz, 0.2, l],
    [w / 2, cz, 0.2, l],
    [0, gap, w, 0.2],
    [0, -COURT_L - gap, w, 0.2],
  ]
  for (const [x, z, bw, bd] of bars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.5, bd), ribbonMat)
    bar.position.set(x, 0.25, z)
    bar.renderOrder = -1
    group.add(bar)
  }
  return group
}
