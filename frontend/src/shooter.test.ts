import { describe, expect, it } from 'vitest'
import { listShooters, pickDefaultShooter, resolveShooter } from './shooter'

const shots = (...players: string[]) => players.map((player) => ({ player }))

describe('listShooters', () => {
  it('lists each player once, sorted by name', () => {
    expect(listShooters(shots('Mia', 'Ben', 'Mia', 'Ana'))).toEqual(['Ana', 'Ben', 'Mia'])
  })

  it('is empty without shots', () => {
    expect(listShooters(null)).toEqual([])
    expect(listShooters([])).toEqual([])
  })
})

describe('pickDefaultShooter', () => {
  it('picks the player with the most shots', () => {
    expect(pickDefaultShooter(shots('Ana', 'Ben', 'Ben', 'Ben', 'Mia', 'Mia'))).toBe('Ben')
  })

  it('gives a tie to the first name alphabetically', () => {
    expect(pickDefaultShooter(shots('Mia', 'Ben', 'Ben', 'Mia'))).toBe('Ben')
  })

  it('is empty when there are no shots', () => {
    expect(pickDefaultShooter(null)).toBe('')
    expect(pickDefaultShooter([])).toBe('')
  })
})

describe('resolveShooter', () => {
  const shooters = ['Ana', 'Ben']

  it('uses the fallback while nothing is chosen', () => {
    expect(resolveShooter(null, shooters, 'Ben')).toBe('Ben')
  })

  it('keeps a chosen player who has shots', () => {
    expect(resolveShooter('Ana', shooters, 'Ben')).toBe('Ana')
  })

  it('keeps "every player" even though it is not a name in the list', () => {
    expect(resolveShooter('', shooters, 'Ben')).toBe('')
  })

  it('falls back when the chosen player has no shots left', () => {
    expect(resolveShooter('Cy', shooters, 'Ben')).toBe('Ben')
  })
})
