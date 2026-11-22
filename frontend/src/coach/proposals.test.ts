import { describe, expect, it } from 'vitest'
import type { ProposedShot } from '../api'
import { describeShot, isOpen, keyOf, markLookalikes } from './proposals'
import type { Card } from './proposals'

const corner: ProposedShot = {
  x: 47.5,
  y: 3,
  made: true,
  game_date: '2026-11-19',
  note: 'caught and shot',
  quote: 'hit one from the right corner',
  zone: 'right_corner_3',
  shot_type: '3PT',
}
const elbow: ProposedShot = { ...corner, x: 17, y: 19, made: false, zone: 'left_elbow', shot_type: '2PT' }

describe('describeShot', () => {
  it('says the zone, the type, the result and the day', () => {
    expect(describeShot(corner)).toBe('Right corner 3 · 3PT · made · 2026-11-19')
    expect(describeShot(elbow)).toBe('Left elbow · 2PT · missed · 2026-11-19')
  })
})

describe('keyOf', () => {
  it('is the same for the same player, place, result and day, and different when any of them differs', () => {
    expect(keyOf('Yuly', corner)).toBe(keyOf('Yuly', { ...corner, note: 'another note', quote: 'other words' }))
    expect(keyOf('Yuly', corner)).not.toBe(keyOf('Noam', corner))
    expect(keyOf('Yuly', corner)).not.toBe(keyOf('Yuly', { ...corner, x: 2.5 }))
    expect(keyOf('Yuly', corner)).not.toBe(keyOf('Yuly', { ...corner, y: 4 }))
    expect(keyOf('Yuly', corner)).not.toBe(keyOf('Yuly', { ...corner, made: false }))
    expect(keyOf('Yuly', corner)).not.toBe(keyOf('Yuly', { ...corner, game_date: '2026-11-18' }))
  })
})

describe('markLookalikes', () => {
  it('marks nothing when nothing was saved', () => {
    expect(markLookalikes('Yuly', [corner, elbow], [])).toEqual([false, false])
  })

  it('marks a proposal that matches a saved shot', () => {
    expect(markLookalikes('Yuly', [corner, elbow], [keyOf('Yuly', elbow)])).toEqual([false, true])
  })

  it('counts identical proposals one by one: one saved before means one marked now', () => {
    expect(markLookalikes('Yuly', [elbow, elbow, elbow], [keyOf('Yuly', elbow)])).toEqual([true, false, false])
    expect(markLookalikes('Yuly', [elbow, elbow], [keyOf('Yuly', elbow), keyOf('Yuly', elbow)])).toEqual([true, true])
  })

  it('does not change the list of saved shots it is given', () => {
    const saved = [keyOf('Yuly', elbow)]
    markLookalikes('Yuly', [elbow], saved)
    expect(saved).toEqual([keyOf('Yuly', elbow)])
  })

  it('does not match another player', () => {
    expect(markLookalikes('Noam', [elbow], [keyOf('Yuly', elbow)])).toEqual([false])
  })
})

describe('isOpen', () => {
  const card = (over: Partial<Card>): Card => ({ shot: corner, status: 'pending', ...over })

  it('is true for a shot that waits or failed to save, unless it is a look-alike', () => {
    expect(isOpen(card({}))).toBe(true)
    expect(isOpen(card({ status: 'error', message: 'x' }))).toBe(true)
    expect(isOpen(card({ lookalike: true }))).toBe(false)
    expect(isOpen(card({ status: 'error', lookalike: true }))).toBe(false)
  })

  it('is false once saved, being saved or discarded', () => {
    for (const status of ['saved', 'saving', 'discarded'] as const) expect(isOpen(card({ status }))).toBe(false)
  })
})
