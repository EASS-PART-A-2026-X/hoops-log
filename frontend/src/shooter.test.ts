import { describe, expect, it } from 'vitest'
import { listShooters, pickDefaultShooter, resolveShooter, sameShooter, shooterKey, shooterNames } from './shooter'

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

describe('shooterKey matches the backend where JavaScript differs', () => {
  it('keeps the dotless ı as it is: Python casefold does, upper-then-lower-case would turn it into i', () => {
    expect(shooterKey('ılhan')).toBe('ılhan')
    expect(sameShooter('ılhan', 'ilhan')).toBe(false)
    expect(sameShooter('ILHAN', 'ilhan')).toBe(true)
  })

  it('folds ß, ẞ and a final sigma like casefold', () => {
    expect(shooterKey('Straße')).toBe('strasse')
    expect(shooterKey('STRAẞE')).toBe('strasse')
    expect(shooterKey('ΟΔΟΣ')).toBe(shooterKey('οδοσ'))
    expect(shooterKey('οδος')).toBe('οδοσ')
  })

  it('folds İ to i plus a combining dot, as Python does', () => {
    expect(shooterKey('İ')).toBe('i̇')
    expect(sameShooter('İSTANBUL', 'i̇stanbul')).toBe(true)
  })

  it('strips the edge whitespace Python strips, and not what it does not', () => {
    expect(shooterKey(' yuly　')).toBe('yuly')
    expect(shooterKey('\x1cyuly\x85')).toBe('yuly') // JavaScript trim() would keep these
    expect(shooterKey('﻿yuly')).toBe('﻿yuly') // JavaScript trim() would strip this one; Python does not
    expect(shooterKey('yu ly')).toBe('yu ly')
  })

  it('treats a name of only spaces like an empty one, but resolveShooter does not take it for "every player"', () => {
    expect(sameShooter('   ', '')).toBe(true)
    expect(resolveShooter('   ', ['Ben'], 'Ben')).toBe('Ben')
  })
})

describe('shooterNames', () => {
  it('maps each person to the spelling shown, by key', () => {
    expect(shooterNames(shots('yuly', 'Yuly', 'Yuly', 'Ben'))).toEqual(
      new Map([
        ['yuly', 'Yuly'],
        ['ben', 'Ben'],
      ]),
    )
    expect(shooterNames(null)).toEqual(new Map())
  })

  it('lets the count decide between three spellings, not the alphabet', () => {
    expect(shooterNames(shots('yuly', 'Yuly', 'Yuly', 'Yuly', 'YULY', 'YULY')).get('yuly')).toBe('Yuly')
    expect(pickDefaultShooter(shots('yuly', 'Yuly', 'Yuly', 'Yuly', 'YULY', 'YULY', 'Ben', 'Ben', 'Ben', 'Ben'))).toBe('Yuly')
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
