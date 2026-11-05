import { describe, expect, it } from 'vitest'
import { LEVEL_PTS, describeTally, gapPts, sideOf, tally } from './verdict'

describe('sideOf', () => {
  it('says who has the higher percentage', () => {
    expect(sideOf(55, 47)).toBe('you')
    expect(sideOf(40, 47)).toBe('them')
  })

  it('calls a gap under the level threshold a tie, on both sides', () => {
    expect(sideOf(47.3, 47)).toBe('tie')
    expect(sideOf(46.7, 47)).toBe('tie')
    expect(sideOf(47 + LEVEL_PTS, 47)).toBe('you')
    expect(sideOf(47 - LEVEL_PTS, 47)).toBe('them')
  })

  it('cannot judge when there are no shots', () => {
    expect(sideOf(null, 47)).toBeNull()
  })

  it('handles a 0% shooter', () => {
    expect(sideOf(0, 38.5)).toBe('them')
  })
})

describe('gapPts', () => {
  it('is the positive distance to one decimal', () => {
    expect(gapPts(55, 47)).toBe(8)
    expect(gapPts(47, 55)).toBe(8)
    expect(gapPts(33, 43.2)).toBe(10.2)
  })
})

describe('tally', () => {
  it('counts each side and leaves unjudged areas out', () => {
    expect(tally(['you', 'you', 'them', 'tie', null])).toEqual({ you: 2, them: 1, ties: 1 })
    expect(tally([])).toEqual({ you: 0, them: 0, ties: 0 })
  })
})

describe('describeTally', () => {
  it('names the leader and the count', () => {
    expect(describeTally('Yuly', 'Curry', { you: 4, them: 2, ties: 1 })).toBe('Yuly is ahead of Curry: leading in 4 of 7 areas.')
    expect(describeTally('Yuly', 'Curry', { you: 1, them: 3, ties: 0 })).toBe('Curry is ahead of Yuly: leading in 3 of 4 areas.')
  })

  it('says level when each side leads equally', () => {
    expect(describeTally('Yuly', 'NBA average', { you: 2, them: 2, ties: 0 })).toBe(
      'Yuly and NBA average are level: 2 areas each out of 4 areas.',
    )
  })

  it('says so when nothing could be judged, and uses the singular for one area', () => {
    expect(describeTally('Yuly', 'Curry', { you: 0, them: 0, ties: 0 })).toBe('Not enough shots yet to say who is ahead.')
    expect(describeTally('Yuly', 'Curry', { you: 1, them: 0, ties: 0 })).toBe('Yuly is ahead of Curry: leading in 1 of 1 area.')
  })
})
