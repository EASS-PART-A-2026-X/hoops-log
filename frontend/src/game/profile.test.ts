import { describe, expect, it } from 'vitest'
import { trophiesOf, xpOf } from './profile'
import { totalXp } from './xp'

let n = 0
const shot = (player: string, over: Record<string, unknown> = {}) => ({
  id: ++n, player, game_date: '2026-11-01', made: true, zone: 'paint', shot_type: '2PT' as const, x: 25, y: 8, ...over,
})
const many = (player: string, count: number, over: Record<string, unknown> = {}) => Array.from({ length: count }, () => shot(player, over))

describe('xpOf', () => {
  it('is the same as totalXp for one player', () => {
    const list = many('A', 6)
    expect(xpOf(list)).toBe(totalXp(list))
  })

  it('adds players up, with each player on their own streak', () => {
    // Interleaved by id, A and B would each break the other's streak if mixed together.
    const mixed = [shot('A'), shot('B'), shot('A'), shot('B'), shot('A'), shot('B')]
    expect(xpOf(mixed)).toBe(totalXp(mixed.filter((s) => s.player === 'A')) + totalXp(mixed.filter((s) => s.player === 'B')))
    expect(xpOf(mixed)).toBe(10 + 10 + 15 + 10 + 10 + 15)
  })

  it('is zero without shots', () => {
    expect(xpOf([])).toBe(0)
  })
})

describe('trophiesOf', () => {
  const status = (list: ReturnType<typeof shot>[], id: string) => trophiesOf(list).find((t) => t.trophy.id === id)!

  it('does not add two players together for a streak', () => {
    const list = [...many('A', 3), ...many('B', 3)]
    expect(status(list, 'hot-hand').unlocked).toBe(false)
  })

  it('is unlocked when any one player has it', () => {
    const list = [...many('A', 5), ...many('B', 1, { made: false })]
    expect(status(list, 'hot-hand').unlocked).toBe(true)
  })

  it('shows the best player\'s progress while locked', () => {
    const list = [...many('A', 3), ...many('B', 4)]
    expect(status(list, 'hot-hand')).toMatchObject({ done: 4, unlocked: false })
  })

  it('lists every trophy even without shots', () => {
    expect(trophiesOf([])).toHaveLength(12)
    expect(trophiesOf([]).every((t) => !t.unlocked && t.done === 0)).toBe(true)
  })
})
