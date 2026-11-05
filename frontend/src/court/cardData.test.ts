import { describe, expect, it } from 'vitest'
import { MIN_SHOTS_FOR_CARD, RADAR_AXES, effectiveFg, playerProfile, radarFraction, radarPoint, radarPolygon, shooterProfile, shootingRating, styleOfPlayer, styleOfShots } from './cardData'
import { PLAYERS } from './players'

type S = { zone: string; made: boolean; shot_type: '2PT' | '3PT' }
const two = (zone: string, made: boolean): S => ({ zone, made, shot_type: '2PT' })
const three = (zone: string, made: boolean): S => ({ zone, made, shot_type: '3PT' })
const many = (n: number, make: (i: number) => S): S[] => Array.from({ length: n }, (_, i) => make(i))

describe('effectiveFg and shootingRating', () => {
  it('counts a three as one and a half twos', () => {
    expect(effectiveFg(50, 40, 50)).toBe(60) // 50 + 0.5 * 40 * 0.5
    expect(effectiveFg(47, 36.5, 0)).toBe(47)
  })

  it('rates the league average shooter 70 and moves about 3 points per point of effective percentage', () => {
    expect(shootingRating(47, 36.5, 40)).toBe(70)
    expect(shootingRating(47, 36.5, 40) + 3).toBeLessThanOrEqual(shootingRating(48, 36.5, 40) + 1)
    expect(shootingRating(55, 40, 40)).toBeGreaterThan(shootingRating(47, 36.5, 40))
  })

  it('stays between 30 and 99', () => {
    expect(shootingRating(100, 100, 100)).toBe(99)
    expect(shootingRating(0, 0, 0)).toBe(30)
  })
})

describe('radarFraction', () => {
  it('puts the outer ring at 70%, clamps above it, and has none without data', () => {
    expect(radarFraction(35)).toBe(0.5)
    expect(radarFraction(70)).toBe(1)
    expect(radarFraction(95)).toBe(1)
    expect(radarFraction(0)).toBe(0)
    expect(radarFraction(null)).toBeNull()
  })
})

describe('styleOfShots', () => {
  const share = (over: Partial<Record<'rim' | 'mid' | 'corner' | 'wing' | 'top', number>>) => ({ rim: 0, mid: 0, corner: 0, wing: 0, top: 0, ...over })

  it('calls anyone under ten shots a rookie, whatever the shares', () => {
    expect(styleOfShots(MIN_SHOTS_FOR_CARD - 1, share({ rim: 1 }), null, null)).toBe('Rookie')
  })

  it('picks the style by the rules, in order', () => {
    expect(styleOfShots(40, share({ rim: 0.5, top: 0.5 }), 50, null)).toBe('Rim finisher')
    expect(styleOfShots(40, share({ wing: 0.3, top: 0.3, rim: 0.1 }), 41, null)).toBe('Sharpshooter')
    expect(styleOfShots(40, share({ wing: 0.3, top: 0.3, rim: 0.1 }), 30, null)).toBe('Volume three-shooter')
    expect(styleOfShots(40, share({ corner: 0.25, mid: 0.1 }), 35, 45)).toBe('Corner specialist')
    expect(styleOfShots(40, share({ corner: 0.25, mid: 0.1 }), 35, 30)).toBe('All-rounder')
    expect(styleOfShots(40, share({ mid: 0.35, rim: 0.2 }), 35, null)).toBe('Mid-range artist')
    expect(styleOfShots(40, share({ rim: 0.3, mid: 0.2, wing: 0.2 }), 35, null)).toBe('All-rounder')
  })

  it('does not call a three-shooter a sharpshooter without a three-point percentage', () => {
    expect(styleOfShots(40, share({ wing: 0.6 }), null, null)).toBe('Volume three-shooter')
  })
})

describe('styleOfPlayer', () => {
  it('reads the style from the three-point share and the percentages', () => {
    expect(styleOfPlayer({ fg: 47, three: 41, threeShare: 55 })).toBe('Sharpshooter')
    expect(styleOfPlayer({ fg: 43, three: 36, threeShare: 55 })).toBe('Volume three-shooter')
    expect(styleOfPlayer({ fg: 55, three: 28, threeShare: 12 })).toBe('Rim finisher')
    expect(styleOfPlayer({ fg: 57, three: 36, threeShare: 20 })).toBe('Efficient scorer')
    expect(styleOfPlayer({ fg: 47, three: 35, threeShare: 30 })).toBe('All-rounder')
  })
})

describe('shooterProfile', () => {
  it('has no rating under ten shots, but still reports what it has', () => {
    const p = shooterProfile('Yuly', [two('paint', true), three('top_3', false)])
    expect(p.rating).toBeNull()
    expect(p.style).toBe('Rookie')
    expect(p.shots).toBe(2)
    expect(p.fg).toBe(50)
    expect(p.three).toBe(0)
  })

  it('builds the rating, the percentages and the radar from the shots', () => {
    const shots = [
      ...many(8, (i) => two('restricted_area', i < 6)), // rim: 6 of 8
      ...many(4, (i) => three('top_3', i < 1)), // top 3: 1 of 4
      ...many(2, () => three('left_wing_3', true)), // wing: 2 shots, below the radar minimum
    ]
    const p = shooterProfile('Yuly', shots)
    expect(p.kind).toBe('you')
    expect(p.shots).toBe(14)
    expect(p.fg).toBe(64) // 9 of 14
    expect(p.three).toBe(50) // 3 of 6
    expect(p.threeShare).toBe(43)
    expect(p.rating).toBe(shootingRating(64, 50, 43))
    const idx = (k: string) => RADAR_AXES.findIndex((a) => a.key === k)
    expect(p.radar[idx('rim')]).toBe(75)
    expect(p.radar[idx('top')]).toBe(25)
    expect(p.radar[idx('wing')]).toBeNull() // 2 shots is too few
    expect(p.radar[idx('mid')]).toBeNull()
    expect(p.estimated).toBe(false)
  })

  it('rates a shooter with no threes by their twos alone, never by a guess', () => {
    const p = shooterProfile('Yuly', many(12, (i) => two('paint', i % 2 === 0)))
    expect(p.three).toBeNull()
    expect(p.threeShare).toBe(0)
    expect(p.rating).toBe(shootingRating(50, 0, 0))
  })

  it('names the whole log when nobody is chosen, and copes with no shots', () => {
    expect(shooterProfile('', []).name).toBe('Everyone')
    expect(shooterProfile('', []).subtitle).toBe('The whole log')
    const empty = shooterProfile('Yuly', [])
    expect(empty.fg).toBeNull()
    expect(empty.rating).toBeNull()
    expect(empty.radar.every((v) => v === null)).toBe(true)
  })
})

describe('playerProfile', () => {
  it('builds every listed player with a rating, a style and an estimated five-axis radar', () => {
    for (const player of PLAYERS) {
      const p = playerProfile(player)
      expect(p.kind).toBe('nba')
      expect(p.estimated).toBe(true)
      expect(p.radar).toHaveLength(RADAR_AXES.length)
      expect(p.radar.every((v) => v !== null && v > 20 && v < 90)).toBe(true)
      expect(p.rating).toBeGreaterThanOrEqual(30)
      expect(p.rating).toBeLessThanOrEqual(99)
      expect(p.subtitle).toContain(player.position)
      expect(p.playerId).toBe(player.id)
    }
  })

  it('puts a better three-point shooter higher on the three-point axes', () => {
    const curry = playerProfile(PLAYERS.find((p) => p.name === 'Stephen Curry')!)
    const giannis = playerProfile(PLAYERS.find((p) => p.name === 'Giannis Antetokounmpo')!)
    const top = RADAR_AXES.findIndex((a) => a.key === 'top')
    expect(curry.radar[top]!).toBeGreaterThan(giannis.radar[top]!)
  })
})

describe('radar geometry', () => {
  it('puts axis 0 straight up and goes clockwise', () => {
    const [x0, y0] = radarPoint(0, 4, 1, 100, 100, 50)
    expect(x0).toBeCloseTo(100, 6)
    expect(y0).toBeCloseTo(50, 6)
    const [x1, y1] = radarPoint(1, 4, 1, 100, 100, 50)
    expect(x1).toBeCloseTo(150, 6)
    expect(y1).toBeCloseTo(100, 6)
  })

  it('puts the polygon corner at the centre for no data, and on the ring for 70% or more', () => {
    const poly = radarPolygon([null, 70, 35, 100, 0], 100, 100, 70)
    expect(poly).toHaveLength(5)
    expect(poly[0]).toEqual([100, 100])
    expect(Math.hypot(poly[1]![0] - 100, poly[1]![1] - 100)).toBeCloseTo(70, 6)
    expect(Math.hypot(poly[2]![0] - 100, poly[2]![1] - 100)).toBeCloseTo(35, 6)
    expect(Math.hypot(poly[3]![0] - 100, poly[3]![1] - 100)).toBeCloseTo(70, 6)
    expect(poly[4]).toEqual([100, 100])
  })
})
