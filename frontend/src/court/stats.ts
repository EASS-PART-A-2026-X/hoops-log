import { COURT_L, COURT_W } from './geometry'

/** The few fields the map needs. A `Shot` from the API fits this. */
export interface MapShot {
  id: number
  player: string
  x: number
  y: number
  made: boolean
  zone: string
  shot_type: '2PT' | '3PT'
}

export type AreaFilter = 'all' | 'threes' | 'mid' | 'paint'
export type ResultFilter = 'all' | 'made' | 'missed'

export interface Filters {
  area: AreaFilter
  result: ResultFilter
  player: string // '' means everyone
}

const MID_ZONES = new Set(['mid_range', 'left_elbow', 'right_elbow'])
const PAINT_ZONES = new Set(['paint', 'restricted_area'])

export function applyFilters<T extends MapShot>(shots: T[], f: Filters): T[] {
  return shots.filter((s) => {
    if (f.player && s.player !== f.player) return false
    if (f.result === 'made' && !s.made) return false
    if (f.result === 'missed' && s.made) return false
    if (f.area === 'threes') return s.shot_type === '3PT'
    if (f.area === 'mid') return MID_ZONES.has(s.zone)
    if (f.area === 'paint') return PAINT_ZONES.has(s.zone)
    return true
  })
}

export function zoneLabel(zone: string): string {
  const text = zone.replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Whole-number percent, or null when there is nothing to divide. */
export function pct(made: number, attempts: number): number | null {
  return attempts === 0 ? null : Math.round((made / attempts) * 100)
}

export interface ZoneStat {
  zone: string
  label: string
  made: number
  attempts: number
  pct: number
  /** Average position of the shots in this zone, in court feet. */
  x: number
  y: number
}

/** One row per zone that has shots, most attempts first (ties: more makes, then name). */
export function zoneStats(shots: MapShot[]): ZoneStat[] {
  const acc = new Map<string, { made: number; attempts: number; sx: number; sy: number }>()
  for (const s of shots) {
    const z = acc.get(s.zone) ?? { made: 0, attempts: 0, sx: 0, sy: 0 }
    z.attempts += 1
    z.made += s.made ? 1 : 0
    z.sx += s.x
    z.sy += s.y
    acc.set(s.zone, z)
  }
  return [...acc.entries()]
    .map(([zone, z]) => ({
      zone,
      label: zoneLabel(zone),
      made: z.made,
      attempts: z.attempts,
      pct: pct(z.made, z.attempts) ?? 0,
      x: z.sx / z.attempts,
      y: z.sy / z.attempts,
    }))
    .sort((a, b) => b.attempts - a.attempts || b.made - a.made || a.zone.localeCompare(b.zone))
}

/** Best field-goal percentage among zones with enough attempts to mean something. */
export function hottestZone(zones: ZoneStat[], minAttempts = 3): ZoneStat | null {
  const eligible = zones.filter((z) => z.attempts >= minAttempts)
  if (eligible.length === 0) return null
  return eligible.reduce((best, z) =>
    z.pct > best.pct || (z.pct === best.pct && z.attempts > best.attempts) ? z : best,
  )
}

export interface Summary {
  attempts: number
  made: number
  fg: number | null
  threeAttempts: number
  threeMade: number
  three: number | null
}

export function summarize(shots: MapShot[]): Summary {
  let made = 0
  let threeAttempts = 0
  let threeMade = 0
  for (const s of shots) {
    if (s.made) made++
    if (s.shot_type === '3PT') {
      threeAttempts++
      if (s.made) threeMade++
    }
  }
  return {
    attempts: shots.length,
    made,
    fg: pct(made, shots.length),
    threeAttempts,
    threeMade,
    three: pct(threeMade, threeAttempts),
  }
}

export interface HeatGrid {
  cols: number
  rows: number
  /** Per cell: how hot (0 cold .. 1 hot) and how sure we are (0 none .. 1 lots of shots). */
  hot: Float32Array
  confidence: Float32Array
}

/**
 * Smooth "where are you hot or cold" field. Every shot spreads a Gaussian blob of
 * `sigma` feet into a made grid and a missed grid. A cell's heat is the made share of
 * the blobs that reach it; its confidence is how much shot weight reaches it, so
 * empty corners of the court stay dark instead of showing a made-or-missed guess.
 */
export function heatGrid(shots: MapShot[], cellsPerFoot = 2, sigma = 3.2): HeatGrid {
  const cols = COURT_W * cellsPerFoot
  const rows = COURT_L * cellsPerFoot
  const made = new Float32Array(cols * rows)
  const missed = new Float32Array(cols * rows)
  const reach = Math.ceil(sigma * 3 * cellsPerFoot)
  const inv = 1 / (2 * sigma * sigma)
  for (const s of shots) {
    const cx = s.x * cellsPerFoot
    const cy = s.y * cellsPerFoot
    const target = s.made ? made : missed
    const c0 = Math.max(0, Math.floor(cx) - reach)
    const c1 = Math.min(cols - 1, Math.floor(cx) + reach)
    const r0 = Math.max(0, Math.floor(cy) - reach)
    const r1 = Math.min(rows - 1, Math.floor(cy) + reach)
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5 - cy) / cellsPerFoot
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5 - cx) / cellsPerFoot
        target[r * cols + c] += Math.exp(-(dx * dx + dy * dy) * inv)
      }
    }
  }
  let peak = 0
  for (let i = 0; i < made.length; i++) peak = Math.max(peak, made[i] + missed[i])
  const hot = new Float32Array(made.length)
  const confidence = new Float32Array(made.length)
  for (let i = 0; i < made.length; i++) {
    const total = made[i] + missed[i]
    hot[i] = total > 1e-6 ? made[i] / total : 0.5
    // sqrt lifts the faint edges so a single shot still glows a little.
    confidence[i] = peak > 0 ? Math.sqrt(Math.min(1, total / peak)) : 0
  }
  return { cols, rows, hot, confidence }
}

// ---------- hex bins ----------

/** What a typical shooter makes, by shot type. Hex colour compares a spot to this, so a
 *  36% three is "typical" and a 36% layup is cold. Rounded figures, used only for colour.
 *  The single source of the league two- and three-point rates (nba.ts derives its own from it). */
export const TYPICAL_FG: Typical = { '2PT': 0.54, '3PT': 0.365 }

/** Expected make rate (0..1) per shot type: the baseline the hex colours compare against. */
export type Typical = Record<'2PT' | '3PT', number>

export interface HexCell {
  /** Centre of the hex, in court feet. */
  x: number
  y: number
  attempts: number
  made: number
  /** 0 much colder than typical .. 0.5 typical .. 1 much hotter. */
  heat: number
  /** Share of the busiest hex's shots, 0..1. Drives hex size and height. */
  size: number
  /** What a typical shooter would make from these same shots, as a whole percent. */
  expectedPct: number
}

export interface HexBins {
  /** Centre-to-corner radius of one cell, in feet. */
  radius: number
  cells: HexCell[]
}

/** Few shots: big cells that say something. Many shots: smaller cells with more detail. */
export function hexRadiusFor(count: number): number {
  return Math.min(3.0, Math.max(1.7, 3.2 - 0.012 * count))
}

/** Round fractional axial coordinates to the nearest hex (pointy-top layout). */
function hexRound(q: number, r: number): [number, number] {
  const s = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  const rs = Math.round(s)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const ds = Math.abs(rs - s)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  return [rq, rr]
}

/**
 * Group shots into hexagons (the classic shot-chart hexbin). Each cell's heat compares
 * its makes with what a typical shooter would make from the same shots, pulled toward
 * "typical" when the cell has few shots, so one lucky make does not look like a hot spot.
 */
export function hexBins(
  shots: MapShot[],
  radius = hexRadiusFor(shots.length),
  typical: Typical = TYPICAL_FG,
): HexBins {
  const sqrt3 = Math.sqrt(3)
  const bins = new Map<string, { q: number; r: number; attempts: number; made: number; expected: number }>()
  for (const s of shots) {
    const q = ((sqrt3 / 3) * s.x - (1 / 3) * s.y) / radius
    const r = ((2 / 3) * s.y) / radius
    const [rq, rr] = hexRound(q, r)
    const key = `${rq},${rr}`
    const bin = bins.get(key) ?? { q: rq, r: rr, attempts: 0, made: 0, expected: 0 }
    bin.attempts += 1
    bin.made += s.made ? 1 : 0
    bin.expected += typical[s.shot_type]
    bins.set(key, bin)
  }
  let maxAttempts = 0
  for (const b of bins.values()) maxAttempts = Math.max(maxAttempts, b.attempts)
  const cells = [...bins.values()].map((b) => {
    const diff = (b.made - b.expected) / b.attempts // -0.5 .. +0.5, in fraction made
    const trust = b.attempts / (b.attempts + 2) // 1 shot: 33%, 4 shots: 67%, 20 shots: 91%
    return {
      x: radius * sqrt3 * (b.q + b.r / 2),
      y: radius * 1.5 * b.r,
      attempts: b.attempts,
      made: b.made,
      heat: Math.min(1, Math.max(0, 0.5 + (diff / 0.5) * trust)),
      size: maxAttempts > 0 ? b.attempts / maxAttempts : 0,
      expectedPct: Math.round((b.expected / b.attempts) * 100),
    }
  })
  return { radius, cells }
}
