// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Shot } from './api'
import NbaCompare from './NbaCompare'

// jsdom does not implement scrollIntoView, which the pickers call while open.
Element.prototype.scrollIntoView = vi.fn()

afterEach(cleanup)

let nextId = 1
const make = (zone: string, made: boolean, shot_type: '2PT' | '3PT' = '2PT'): Shot => ({
  id: nextId++,
  player: 'Yuly',
  x: 25,
  y: 6,
  made,
  game_date: '2026-10-12',
  note: '',
  zone,
  shot_type,
})
const many = (n: number, zone: string, made: boolean) => Array.from({ length: n }, () => make(zone, made))

// 6/6 at the rim (far above the league's 65%), 0/6 from mid-range (far below 41%), 2 made in the paint
// (a small sample). Overall 8/14 = 57%, above the league's 47%. No threes.
const SHOTS: Shot[] = [...many(6, 'restricted_area', true), ...many(6, 'mid_range', false), ...many(2, 'paint', true)]

const CURRY = 201939

// The face-off plays by itself the first time a pair is compared. These tests are about the page, so
// by default the pair counts as already seen; the face-off tests below say otherwise.
const renderCompare = (shots: Shot[] | null, benchmarkId: number | null = null, shooter = 'Yuly', faceOffSeen?: string[], onFaceOffSeen = vi.fn()) =>
  render(
    <NbaCompare
      shots={shots}
      shooter={shooter}
      shooterPicker={<span>shooter picker</span>}
      benchmarkId={benchmarkId}
      onBenchmark={vi.fn()}
      onBrowse={vi.fn()}
      faceOffSeen={faceOffSeen ?? [`${shooter}|${benchmarkId}`]}
      onFaceOffSeen={onFaceOffSeen}
    />,
  )

const zoneItem = (name: string) => screen.getAllByRole('listitem').find((li) => li.textContent?.startsWith(name)) as HTMLElement

describe('NbaCompare against the league', () => {
  it('names both sides in the heading', () => {
    renderCompare(SHOTS)
    expect(screen.getByRole('heading', { level: 2, name: 'Yuly vs NBA average' })).toBeTruthy()
  })

  it('counts field goal and judged zones, and says who is ahead', () => {
    renderCompare(SHOTS)
    // Field goal (57 vs 47) and the rim go to Yuly; mid-range goes to the NBA; no threes, and the paint is a small sample.
    expect(screen.getByRole('img', { name: 'Areas led: Yuly 2, NBA average 1' })).toBeTruthy()
    expect(screen.getByText('Yuly is ahead of NBA average: leading in 2 of 3 areas.')).toBeTruthy()
  })

  it('shows a leads pill for each side', () => {
    renderCompare(SHOTS)
    expect(within(zoneItem('Restricted area')).getByText(/Yuly \+35/)).toBeTruthy()
    expect(within(zoneItem('Mid range')).getByText(/NBA \+41/)).toBeTruthy()
  })

  it('shows a small-sample zone but does not count it', () => {
    renderCompare(SHOTS)
    const paint = zoneItem('Paint')
    expect(within(paint).getByText('Small sample')).toBeTruthy()
    expect(within(paint).getByText('2/2 made')).toBeTruthy()
    // 100% vs 42% would be a lead for Yuly if it counted: the tally above stays 2-1.
    expect(screen.getByRole('img', { name: /Yuly 2, NBA average 1/ })).toBeTruthy()
  })

  it('does not count a three-point percentage from fewer than 5 shots', () => {
    // 4 threes, all missed: judged it would be an NBA lead, but 4 shots are too few.
    const shots = [...Array.from({ length: 4 }, () => make('top_3', false, '3PT')), ...many(6, 'restricted_area', true)]
    renderCompare(shots)
    expect(screen.getByRole('img', { name: 'Areas led: Yuly 2, NBA average 0' })).toBeTruthy()
  })

  it('says exactly what counts', () => {
    renderCompare(SHOTS)
    expect(
      screen.getByText(/Counted: field goal, three point and each zone, when at least 5 shots; these areas overlap, a zone's shots are also in the field goal\./),
    ).toBeTruthy()
    expect(screen.getByText(/NBA numbers are rounded figures/)).toBeTruthy()
  })
})

describe('NbaCompare against a chosen player', () => {
  it('names both sides in the heading, the verdict and the pills', () => {
    renderCompare(SHOTS, CURRY)
    expect(screen.getByRole('heading', { level: 2, name: 'Yuly vs Stephen Curry' })).toBeTruthy()
    expect(screen.getByText(/Yuly is ahead of Stephen Curry: leading in 2 of 3 areas\./)).toBeTruthy()
    expect(within(zoneItem('Restricted area')).getByText(/Yuly \+/)).toBeTruthy()
    expect(within(zoneItem('Mid range')).getByText(/Curry \+/)).toBeTruthy()
  })

  it('words the note about the player, not the league', () => {
    renderCompare(SHOTS, CURRY)
    expect(screen.getByText(/Stephen Curry's numbers are rounded figures/)).toBeTruthy()
    expect(screen.getByText(/Zone numbers for a player are estimates/)).toBeTruthy()
    expect(screen.queryByText(/NBA numbers are/)).toBeNull()
  })
})

describe('NbaCompare without shots', () => {
  it('says the log is empty for the chosen shooter', () => {
    renderCompare([])
    expect(screen.getByText(/No shots for Yuly yet\./)).toBeTruthy()
  })

  it('says the log is empty when showing every player', () => {
    renderCompare([], null, '')
    expect(screen.getByText(/No shots yet\./)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Everyone vs NBA average' })).toBeTruthy()
  })

  it('shows a loading state before the shots arrive', () => {
    renderCompare(null)
    expect(screen.getByText('Loading shots…')).toBeTruthy()
  })

  it('says there are not enough shots when every area is too small', () => {
    renderCompare([make('paint', true)])
    expect(screen.getByText('Not enough shots yet to say who is ahead.')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Areas led: Yuly 0, NBA average 0' })).toBeTruthy()
  })
})

describe('the face-off', () => {
  const faceOff = () => screen.queryByRole('dialog', { name: /Face-off/ })

  it('plays by itself the first time a player is compared, with both names and the verdict', () => {
    renderCompare(SHOTS, CURRY, 'Yuly', [])
    const dialog = faceOff()
    expect(dialog).toBeTruthy()
    expect(dialog?.getAttribute('aria-label')).toBe('Face-off: Yuly against Stephen Curry')
    expect(within(dialog!).getByRole('status').textContent).toMatch(/Stephen Curry|Yuly/)
    expect(within(dialog!).getByRole('button', { name: 'See the full comparison' })).toBeTruthy()
  })

  it('does not play against the league average, which has no card to show', () => {
    renderCompare(SHOTS, null, 'Yuly', [])
    expect(faceOff()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Face-off' })).toBeNull()
  })

  it('does not play again for a pair it has already played', () => {
    renderCompare(SHOTS, CURRY, 'Yuly', [`Yuly|${CURRY}`])
    expect(faceOff()).toBeNull()
  })

  it('does not play with no shots to compare', () => {
    renderCompare([], CURRY, 'Yuly', [])
    expect(faceOff()).toBeNull()
  })

  it('does not play by itself when the person asked for less motion, but the Face-off button still shows it', async () => {
    const user = userEvent.setup()
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    try {
      renderCompare(SHOTS, CURRY, 'Yuly', [])
      expect(faceOff()).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Face-off' }))
      expect(faceOff()).toBeTruthy()
    } finally {
      window.matchMedia = original
    }
  })

  it('reports the pair as seen when it is closed, with the button or with Escape', async () => {
    const user = userEvent.setup()
    const onSeen = vi.fn()
    renderCompare(SHOTS, CURRY, 'Yuly', [], onSeen)
    await user.click(screen.getByRole('button', { name: 'See the full comparison' }))
    expect(onSeen).toHaveBeenLastCalledWith(`Yuly|${CURRY}`)
    cleanup()
    const onSeen2 = vi.fn()
    renderCompare(SHOTS, CURRY, 'Yuly', [], onSeen2)
    await user.keyboard('{Escape}')
    expect(onSeen2).toHaveBeenLastCalledWith(`Yuly|${CURRY}`)
  })

  it('can be opened again from the Face-off button even after it was seen, and closes again', async () => {
    const user = userEvent.setup()
    renderCompare(SHOTS, CURRY, 'Yuly')
    expect(faceOff()).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Face-off' }))
    expect(faceOff()).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'See the full comparison' }))
    expect(faceOff()).toBeNull()
  })
})
