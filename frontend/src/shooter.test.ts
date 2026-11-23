import { describe, expect, it } from 'vitest'
import { listShooters, pickDefaultShooter, resolveShooter, sameShooter } from './shooter'

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

describe('one person whatever the capitals', () => {
  it('lists names that differ in case or edge spaces once, with the most used spelling', () => {
    expect(listShooters(shots('yuly', 'Yuly', 'Yuly', ' yuly ', 'Ben'))).toEqual(['Ben', 'Yuly'])
  })

  it('breaks a tie by the first spelling alphabetically', () => {
    expect(listShooters(shots('yuly', 'YULY'))).toEqual(['YULY'])
  })

  it('folds like the backend: Straße and STRASSE are one', () => {
    expect(sameShooter('Straße', 'STRASSE')).toBe(true)
    expect(listShooters(shots('Straße', 'STRASSE', 'STRASSE'))).toEqual(['STRASSE'])
  })

  it('counts the default shooter across spellings', () => {
    expect(pickDefaultShooter(shots('ana', 'ANA', 'Ben', 'Ben'))).toBe('ANA')
  })

  it('keeps a choice made with another spelling', () => {
    expect(resolveShooter('yuly', ['Yuly'], 'Ben')).toBe('Yuly')
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
