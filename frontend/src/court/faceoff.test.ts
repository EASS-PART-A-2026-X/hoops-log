import { describe, expect, it } from 'vitest'
import type { CardProfile } from './cardData'
import { FACE_OFF_MS, faceOffRows, rowWinner } from './faceoff'

const profile = (over: Partial<CardProfile>): CardProfile => ({
  kind: 'you',
  name: 'Yuly',
  subtitle: 'Your log',
  rating: 80,
  style: 'All-rounder',
  fg: 50,
  three: 40,
  threeShare: 35,
  shots: 30,
  radar: [null, null, null, null, null],
  estimated: false,
  ...over,
})

describe('faceOffRows', () => {
  it('has the rating, field goal, three point and share of threes, in that order, with each side beside its own', () => {
    const rows = faceOffRows(profile({ rating: 80, fg: 55, three: 41, threeShare: 30 }), profile({ rating: 66, fg: 47, three: 36, threeShare: 55, kind: 'nba' }))
    expect(rows.map((r) => r.label)).toEqual(['Shooting rating', 'Field goal', 'Three point', 'Share of threes'])
    expect(rows.map((r) => [r.you, r.them])).toEqual([
      [80, 66],
      [55, 47],
      [41, 36],
      [30, 55],
    ])
  })

  it('draws the rating bar against 99 and the others against 100', () => {
    const rows = faceOffRows(profile({}), profile({}))
    expect(rows.map((r) => r.max)).toEqual([99, 100, 100, 100])
  })
})

describe('rowWinner', () => {
  const [rating, fg, three, share] = faceOffRows(profile({}), profile({}))

  it('gives a row to the higher number', () => {
    expect(rowWinner({ ...rating!, you: 80, them: 66 })).toBe('you')
    expect(rowWinner({ ...fg!, you: 44, them: 47 })).toBe('them')
  })

  it('calls close numbers level', () => {
    expect(rowWinner({ ...three!, you: 36.2, them: 36.5 })).toBe('tie')
  })

  it('never gives the share of threes to anyone: it is a style, not a skill', () => {
    expect(rowWinner({ ...share!, you: 70, them: 10 })).toBeNull()
  })

  it('has no winner when a side has no number', () => {
    expect(rowWinner({ ...rating!, you: null, them: 66 })).toBeNull()
    expect(rowWinner({ ...rating!, you: 80, them: null })).toBeNull()
  })
})

describe('FACE_OFF_MS', () => {
  it('is long enough for the whole animation (it ends at about 3 seconds) plus time to read', () => {
    expect(FACE_OFF_MS).toBeGreaterThanOrEqual(5000)
  })
})
