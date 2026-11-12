import { describe, expect, it } from 'vitest'
import { QUESTIONS, answer, greet, saved, tip } from './lines'
import type { QuestionId } from './lines'

let n = 0
const shot = (over: Record<string, unknown> = {}) => ({
  id: ++n, player: 'A', made: true, zone: 'mid_range', shot_type: '2PT' as const, x: 25, y: 15, ...over,
})
const many = (count: number, over: Record<string, unknown> = {}) => Array.from({ length: count }, () => shot(over))
const ctx = (shots: ReturnType<typeof shot>[]) => ({ shots, shooter: 'A' })

describe('answers', () => {
  it('has an answer for every question, and never says undefined or NaN', () => {
    const shots = [...many(6, { zone: 'paint' }), ...many(6, { zone: 'top_3', shot_type: '3PT', made: false }), ...many(4, { zone: 'mid_range' })]
    for (const q of QUESTIONS) {
      for (const list of [[], shots]) {
        const text = answer(q.id, ctx(list)).text
        expect(text.length).toBeGreaterThan(10)
        expect(text).not.toMatch(/undefined|NaN|null/)
      }
    }
  })

  it('tells an empty log to add shots instead of inventing numbers', () => {
    for (const id of ['doing', 'practise', 'best'] as QuestionId[]) {
      expect(answer(id, ctx([])).text).toMatch(/no shots/i)
    }
  })

  it('reports the real totals and compares with the league', () => {
    const shots = [...many(3), ...many(1, { made: false })]
    const text = answer('doing', ctx(shots)).text
    expect(text).toContain('made 3 of 4')
    expect(text).toContain('75%')
    expect(text).toContain('47%')
    expect(text).toMatch(/small sample/)
  })

  it('names the best area only when it has enough shots', () => {
    const few = [...many(2, { zone: 'paint' })]
    expect(answer('best', ctx(few)).text).toMatch(/cannot say/)
    const enough = [...many(5, { zone: 'paint' }), ...many(5, { zone: 'mid_range', made: false })]
    expect(answer('best', ctx(enough)).text).toContain('Paint is your best area: 5 of 5, 100%')
  })

  it('picks the area furthest below the league average to practise', () => {
    // Mid range: 0 of 6 against about 41%. Paint: 6 of 6 against about 42%.
    const shots = [...many(6, { zone: 'mid_range', made: false }), ...many(6, { zone: 'paint' })]
    const text = answer('practise', ctx(shots)).text
    expect(text).toContain('Work on Mid range')
    expect(text).toContain('0%')
  })

  it('says there is nothing to fix when every area is at or above the league', () => {
    expect(answer('practise', ctx(many(8, { zone: 'paint' }))).text).toMatch(/at or above/)
  })

  it('needs enough shots to find an NBA match', () => {
    expect(answer('like', ctx(many(3))).text).toMatch(/at least 10/)
    expect(answer('like', ctx(many(12))).text).toMatch(/out of 100 match/)
  })
})

describe('reactions', () => {
  it('differs for a make and a miss, and rotates the wording', () => {
    expect(saved(true).mood).toBe('happy')
    expect(saved(false).mood).toBe('hmm')
    expect(saved(true, 0).text).not.toBe(saved(true, 1).text)
    expect(saved(true, 3).text).toBe(saved(true, 0).text)
  })

  it('greets an empty log differently and uses the numbers otherwise', () => {
    expect(greet('Yuly', 0, 'Rookie').text).toMatch(/empty/)
    expect(greet('Yuly', 12, 'Rookie').text).toContain('12')
    expect(greet('', 12, 'Rookie').text).toContain('there')
  })

  it('has a hint for every page', () => {
    for (const tab of ['log', 'nba', 'players'] as const) expect(tip(tab).text.length).toBeGreaterThan(10)
  })
})
