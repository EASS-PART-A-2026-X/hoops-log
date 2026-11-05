import { describe, expect, it } from 'vitest'
import { applyFilters, hexBins, summarize, zoneShare, zoneStats } from './stats'
import type { Filters, MapShot, Typical } from './stats'

let nextId = 1
function shot(over: Partial<MapShot> = {}): MapShot {
  return { id: nextId++, player: 'Ann', x: 25, y: 10, made: true, zone: 'paint', shot_type: '2PT', ...over }
}

const ALL: Filters = { area: 'all', result: 'all', player: '' }

describe('applyFilters', () => {
  const shots = [
    shot({ player: 'Ann', made: true, zone: 'paint', shot_type: '2PT' }),
    shot({ player: 'Ann', made: false, zone: 'restricted_area', shot_type: '2PT' }),
    shot({ player: 'Bob', made: true, zone: 'mid_range', shot_type: '2PT' }),
    shot({ player: 'Bob', made: false, zone: 'left_elbow', shot_type: '2PT' }),
    shot({ player: 'Bob', made: true, zone: 'top_3', shot_type: '3PT' }),
    shot({ player: 'Ann', made: false, zone: 'left_corner_3', shot_type: '3PT' }),
  ]
  const zonesOf = (list: MapShot[]) => list.map((s) => s.zone)

  it('keeps everything when nothing is filtered', () => {
    expect(applyFilters(shots, ALL)).toHaveLength(shots.length)
  })

  it('does not mutate or reorder the input', () => {
    const copy = [...shots]
    applyFilters(shots, { ...ALL, area: 'threes' })
    expect(shots).toEqual(copy)
  })

  it('area threes uses the shot type, not the zone name', () => {
    expect(zonesOf(applyFilters(shots, { ...ALL, area: 'threes' }))).toEqual(['top_3', 'left_corner_3'])
  })

  it('area mid keeps mid range and both elbows', () => {
    expect(zonesOf(applyFilters(shots, { ...ALL, area: 'mid' }))).toEqual(['mid_range', 'left_elbow'])
  })

  it('area paint keeps the paint and the restricted area', () => {
    expect(zonesOf(applyFilters(shots, { ...ALL, area: 'paint' }))).toEqual(['paint', 'restricted_area'])
  })

  it('result filters split made and missed', () => {
    expect(applyFilters(shots, { ...ALL, result: 'made' }).every((s) => s.made)).toBe(true)
    expect(applyFilters(shots, { ...ALL, result: 'made' })).toHaveLength(3)
    expect(applyFilters(shots, { ...ALL, result: 'missed' }).every((s) => !s.made)).toBe(true)
    expect(applyFilters(shots, { ...ALL, result: 'missed' })).toHaveLength(3)
  })

  it('player filter matches the exact name and an empty name means everyone', () => {
    expect(applyFilters(shots, { ...ALL, player: 'Bob' })).toHaveLength(3)
    expect(applyFilters(shots, { ...ALL, player: 'bob' })).toHaveLength(0)
    expect(applyFilters(shots, { ...ALL, player: '' })).toHaveLength(6)
  })

  it('combines all three filters', () => {
    const out = applyFilters(shots, { area: 'threes', result: 'missed', player: 'Ann' })
    expect(zonesOf(out)).toEqual(['left_corner_3'])
  })
})

describe('summarize', () => {
  it('returns nulls for no shots', () => {
    expect(summarize([])).toEqual({
      attempts: 0,
      made: 0,
      fg: null,
      threeAttempts: 0,
      threeMade: 0,
      three: null,
    })
  })

  it('counts makes and rounds percentages', () => {
    const shots = [
      shot({ made: true }),
      shot({ made: false }),
      shot({ made: false }),
      shot({ made: true, shot_type: '3PT', zone: 'top_3' }),
      shot({ made: false, shot_type: '3PT', zone: 'top_3' }),
      shot({ made: false, shot_type: '3PT', zone: 'top_3' }),
    ]
    const s = summarize(shots)
    expect(s.attempts).toBe(6)
    expect(s.made).toBe(2)
    expect(s.fg).toBe(33) // 2 of 6
    expect(s.threeAttempts).toBe(3)
    expect(s.threeMade).toBe(1)
    expect(s.three).toBe(33)
  })

  it('has a null three-point percentage when there are only twos', () => {
    const s = summarize([shot({ made: true }), shot({ made: false })])
    expect(s.fg).toBe(50)
    expect(s.three).toBeNull()
  })
})

describe('zoneStats', () => {
  it('is empty with no shots', () => {
    expect(zoneStats([])).toEqual([])
  })

  it('x and y are the average position of the zone shots', () => {
    const [paint] = zoneStats([
      shot({ zone: 'paint', x: 20, y: 6 }),
      shot({ zone: 'paint', x: 24, y: 10 }),
      shot({ zone: 'paint', x: 28, y: 5 }),
    ])
    expect(paint.x).toBeCloseTo(24)
    expect(paint.y).toBeCloseTo(7)
  })

  it('labels sit at the average position for ordinary zones', () => {
    const [paint] = zoneStats([shot({ zone: 'paint', x: 20, y: 6 }), shot({ zone: 'paint', x: 24, y: 10 })])
    expect(paint.labelX).toBe(paint.x)
    expect(paint.labelY).toBe(paint.y)
  })

  it('mid_range keeps its real average in x/y but its label uses the fixed spot', () => {
    const [mid] = zoneStats([
      shot({ zone: 'mid_range', x: 10, y: 8 }),
      shot({ zone: 'mid_range', x: 40, y: 12 }),
    ])
    expect(mid.x).toBeCloseTo(25)
    expect(mid.y).toBeCloseTo(10)
    expect(mid.labelX).toBe(25)
    expect(mid.labelY).toBe(22.5)
  })

  it('moves the mid_range label even when the shots average somewhere else', () => {
    const [mid] = zoneStats([shot({ zone: 'mid_range', x: 8, y: 14 })])
    expect(mid.x).toBe(8)
    expect(mid.y).toBe(14)
    expect([mid.labelX, mid.labelY]).toEqual([25, 22.5])
  })

  it('counts makes and rounds the percentage', () => {
    const [z] = zoneStats([
      shot({ zone: 'top_3', made: true }),
      shot({ zone: 'top_3', made: false }),
      shot({ zone: 'top_3', made: false }),
    ])
    expect(z).toMatchObject({ zone: 'top_3', label: 'Top 3', made: 1, attempts: 3, pct: 33 })
  })

  it('sorts by attempts, then makes, then name', () => {
    const rows = zoneStats([
      shot({ zone: 'paint', made: false }),
      shot({ zone: 'paint', made: false }),
      shot({ zone: 'top_3', made: true }),
      shot({ zone: 'top_3', made: false }),
      shot({ zone: 'left_elbow', made: true }),
      shot({ zone: 'right_elbow', made: true }),
      shot({ zone: 'mid_range', made: false }),
    ])
    // paint and top_3 have 2 attempts each, top_3 has more makes; then one-shot zones: made first, by name
    expect(rows.map((r) => r.zone)).toEqual(['top_3', 'paint', 'left_elbow', 'right_elbow', 'mid_range'])
  })
})

describe('hexBins', () => {
  it('has no cells for no shots', () => {
    expect(hexBins([]).cells).toEqual([])
  })

  it('groups close shots in one cell and scales size by the busiest cell', () => {
    const shots = [
      shot({ x: 25, y: 10 }),
      shot({ x: 25.2, y: 10.1 }),
      shot({ x: 24.9, y: 9.9 }),
      shot({ x: 5, y: 40 }),
    ]
    const { cells, radius } = hexBins(shots, 3)
    expect(radius).toBe(3)
    expect(cells).toHaveLength(2)
    const big = cells.find((c) => c.attempts === 3)
    const small = cells.find((c) => c.attempts === 1)
    expect(big?.size).toBe(1)
    expect(small?.size).toBeCloseTo(1 / 3)
  })

  it('keeps heat within 0..1 and shrinks it toward typical for a single shot', () => {
    const { cells: lone } = hexBins([shot({ made: true })], 3)
    const { cells: many } = hexBins(Array.from({ length: 20 }, () => shot({ made: true })), 3)
    expect(lone[0].heat).toBeGreaterThan(0.5)
    expect(lone[0].heat).toBeLessThanOrEqual(1)
    expect(many[0].heat).toBeGreaterThan(lone[0].heat)
    expect(many[0].heat).toBeLessThanOrEqual(1)
    const { cells: cold } = hexBins(Array.from({ length: 20 }, () => shot({ made: false })), 3)
    expect(cold[0].heat).toBeLessThan(0.5)
    expect(cold[0].heat).toBeGreaterThanOrEqual(0)
  })

  it('a custom baseline changes heat and expectedPct', () => {
    const shots = [
      shot({ made: true }),
      shot({ made: true }),
      shot({ made: false }),
      shot({ made: false }),
    ]
    const low: Typical = { '2PT': 0.3, '3PT': 0.3 }
    const high: Typical = { '2PT': 0.7, '3PT': 0.7 }
    const [vsLow] = hexBins(shots, 3, low).cells
    const [vsHigh] = hexBins(shots, 3, high).cells
    expect(vsLow.expectedPct).toBe(30)
    expect(vsHigh.expectedPct).toBe(70)
    // 50% shooting is hot against a 30% baseline and cold against a 70% one
    expect(vsLow.heat).toBeGreaterThan(0.5)
    expect(vsHigh.heat).toBeLessThan(0.5)
  })

  it('uses the baseline of each shot type for expectedPct', () => {
    const baseline: Typical = { '2PT': 0.5, '3PT': 0.3 }
    const [cell] = hexBins(
      [shot({ shot_type: '2PT' }), shot({ shot_type: '3PT', zone: 'top_3' })],
      3,
      baseline,
    ).cells
    expect(cell.expectedPct).toBe(40)
  })
})

describe('zoneShare', () => {
  const mine = [
    shot({ zone: 'paint', made: true }),
    shot({ zone: 'paint', made: false }),
    shot({ zone: 'paint', made: false }),
    shot({ zone: 'paint', made: true }),
    shot({ zone: 'top_3', made: true }),
  ]

  it('is the made, attempts and whole-number percent from that zone only', () => {
    expect(zoneShare(mine, 'paint')).toEqual({ pct: 50, made: 2, attempts: 4 })
    expect(zoneShare(mine, 'top_3')).toEqual({ pct: 100, made: 1, attempts: 1 })
  })

  it('is null for a zone with no shots', () => {
    expect(zoneShare(mine, 'mid_range')).toBeNull()
    expect(zoneShare([], 'paint')).toBeNull()
  })

  it('is given the shooter\'s shots, so the Result and Area chips do not change it', () => {
    // The chips filter what the map shows; the lower third uses the unfiltered list.
    const shown = applyFilters(mine, { area: 'all', result: 'missed', player: '' })
    expect(zoneShare(shown, 'paint')?.pct).toBe(0) // what the filtered list would wrongly say
    expect(zoneShare(applyFilters(mine, { area: 'all', result: 'all', player: '' }), 'paint')).toEqual({ pct: 50, made: 2, attempts: 4 })
  })
})
