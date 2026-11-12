import { describe, expect, it } from 'vitest'
import { FACTS, KONAMI_CODE, MILESTONES, QUESTIONS, again, answer, chatter, dayOf, daysBetween, fact, greet, milestone, poke, saved, tip, welcomeBack } from './lines'
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

describe('unprompted lines', () => {
  const at = (iso: string) => new Date(iso)
  const base = (over: Record<string, unknown> = {}) => ({
    shots: [] as ReturnType<typeof shot>[],
    shooter: 'A',
    now: at('2026-11-10T13:00:00'),
    dates: [] as string[],
    xpToNext: 100,
    ...over,
  })
  const none = new Set<string>()
  const said = (ctx: ReturnType<typeof base>, used = none) => chatter(ctx, used, 0)

  it('only says what is true right now', () => {
    // A Tuesday lunchtime with no shots: nothing about the night, the morning, Friday or today.
    const ids = new Set<string>()
    for (let n = 0; n < 8; n++) {
      const r = chatter(base(), ids, n)
      if (r) ids.add(r.id)
    }
    expect([...ids]).toEqual(['water'])
  })

  it('remarks on the late hour, the early hour and Friday afternoon', () => {
    expect(said(base({ now: at('2026-11-10T23:30:00') }))!.line.text).toMatch(/late/)
    expect(said(base({ now: at('2026-11-10T02:00:00') }))!.line.text).toMatch(/late/)
    expect(said(base({ now: at('2026-11-10T07:00:00') }))!.line.text).toMatch(/early/)
    expect(said(base({ now: at('2026-11-13T16:00:00') }))!.line.text).toMatch(/Friday/) // 13 Nov 2026 is a Friday
    expect(said(base({ now: at('2026-11-13T10:00:00') }))!.line.text).not.toMatch(/Friday/)
  })

  it('counts the shots of today, using the local date', () => {
    const ctx = base({ dates: ['2026-11-10', '2026-11-10', '2026-11-10', '2026-11-09'] })
    const ids = new Set<string>()
    const texts: string[] = []
    for (let n = 0; n < 10; n++) {
      const r = chatter(ctx, ids, n)
      if (r) {
        ids.add(r.id)
        texts.push(r.line.text)
      }
    }
    expect(texts.some((t) => t.startsWith('3 shots logged today'))).toBe(true)
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })

  it('names the real best and weakest areas, only with enough shots', () => {
    const shots = [...many(6, { zone: 'paint' }), ...many(6, { zone: 'mid_range', made: false })]
    const texts = new Set<string>()
    const ids = new Set<string>()
    for (let n = 0; n < 10; n++) {
      const r = chatter(base({ shots }), ids, n)
      if (r) {
        ids.add(r.id)
        texts.add(r.line.text)
      }
    }
    const all = [...texts].join('\n')
    expect(all).toContain('Paint is your best area at 100%')
    expect(all).toMatch(/your mid range: 0% against about 41%/)
    expect([...ids]).toContain('best')
    // With too few shots he knows nothing about areas.
    expect(chatter(base({ shots: many(2, { zone: 'paint' }) }), new Set(['water']), 0)).toBeNull()
  })

  it('mentions how near the next level is, and a cold run', () => {
    expect(said(base({ xpToNext: 25 }))!.line.text).toContain('Only 25 XP')
    expect(said(base({ xpToNext: 0 }))!.line.text).not.toMatch(/XP to the next/)
    const cold = base({ shots: [...many(2), ...many(3, { made: false })] })
    const ids = new Set<string>()
    const out: string[] = []
    for (let n = 0; n < 10; n++) {
      const r = chatter(cold, ids, n)
      if (r) {
        ids.add(r.id)
        out.push(r.id)
      }
    }
    expect(out).toContain('cold')
  })

  it('never repeats a remark, and runs out instead', () => {
    const used = new Set<string>()
    let r = chatter(base(), used, 0)
    expect(r!.id).toBe('water')
    used.add(r!.id)
    r = chatter(base(), used, 1)
    expect(r).toBeNull()
  })
})

describe('milestones, facts and eggs', () => {
  it('counts whole days between dates, and says so for a bad date', () => {
    expect(daysBetween('2026-11-01', '2026-11-12')).toBe(11)
    expect(daysBetween('2026-11-12', '2026-11-12')).toBe(0)
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3)
    expect(daysBetween('nope', '2026-11-12')).toBeNull()
  })

  it('tells someone who was away how long', () => {
    expect(welcomeBack('Yuly', 9).text).toContain('9 days since your last shot')
  })

  it('has milestone counts in order, and a line for each', () => {
    expect([...MILESTONES]).toEqual([...MILESTONES].sort((a, b) => a - b))
    expect(milestone(100).text).toContain('100')
    expect(milestone(100).mood).toBe('hype')
  })

  it('rotates through the facts, each a complete sentence about the real Deni', () => {
    const texts = FACTS.map((_, i) => fact(i).text)
    expect(new Set(texts).size).toBe(FACTS.length)
    expect(fact(FACTS.length).text).toBe(fact(0).text)
    for (const t of texts) expect(t).toMatch(/Deni/)
    expect(answer('fact', { shots: [], shooter: 'A', n: 1 }).text).toBe(fact(1).text)
  })

  it('repeats a question with a remark in front of the same answer', () => {
    const line = answer('add', ctx([]))
    const second = again(line)
    expect(second.text).toContain(line.text)
    expect(second.text).toMatch(/^Same question/)
  })

  it('has the cheat code in the right order', () => {
    expect(KONAMI_CODE.join(' ')).toBe('arrowup arrowup arrowdown arrowdown arrowleft arrowright arrowleft arrowright b a')
    expect(poke(0).text).not.toBe(poke(1).text)
  })
})
