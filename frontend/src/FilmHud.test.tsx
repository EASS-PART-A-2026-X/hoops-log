// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Shot } from './api'
import type { FilmState } from './court/CourtScene'
import { FilmHud, FilmSummaryCard } from './FilmHud'

afterEach(cleanup)

const shot: Shot = {
  id: 7,
  player: 'Demo Yuly',
  x: 2,
  y: 3,
  made: true,
  game_date: '2026-10-17',
  note: '',
  zone: 'left_corner_3',
  shot_type: '3PT',
}
const state = (over: Partial<FilmState> = {}): FilmState => ({
  active: true,
  k: 2,
  total: 5,
  phase: 'flight',
  index: 0,
  paused: false,
  finished: false,
  ...over,
})

const renderHud = (s: FilmState, handlers = {}) =>
  render(
    <FilmHud
      state={s}
      shot={shot}
      zone={{ pct: 73, made: 8, attempts: 11 }}
      nbaPct={38.5}
      results={[true, false, true, true, false]}
      onPause={vi.fn()}
      onStep={vi.fn()}
      onClose={vi.fn()}
      {...handlers}
    />,
  )

describe('FilmHud', () => {
  it('shows who, where, when and how good that zone is against the league', () => {
    renderHud(state())
    expect(screen.getByText('Demo Yuly')).toBeTruthy()
    expect(screen.getByText(/Left corner 3, three-pointer · 2026-10-17/)).toBeTruthy()
    expect(screen.getByText(/73% from here \(8 of 11\)/)).toBeTruthy()
    expect(screen.getByText(/NBA 38\.5%/)).toBeTruthy()
  })

  it('shows only the counts, with no percentage and no league figure, below five attempts in the zone', () => {
    render(<FilmHud state={state()} shot={shot} zone={{ pct: 75, made: 3, attempts: 4 }} nbaPct={38.5} results={[true]} onPause={vi.fn()} onStep={vi.fn()} onClose={vi.fn()} />)
    const stat = document.querySelector('.film-stat')?.textContent
    expect(stat).toBe('3 of 4 from here')
    expect(stat).not.toMatch(/%|NBA/)
  })

  it('shows the percentage and the league figure from five attempts on', () => {
    render(<FilmHud state={state()} shot={shot} zone={{ pct: 80, made: 4, attempts: 5 }} nbaPct={38.5} results={[true]} onPause={vi.fn()} onStep={vi.fn()} onClose={vi.fn()} />)
    expect(document.querySelector('.film-stat')?.textContent).toBe('80% from here (4 of 5) · NBA 38.5%')
  })

  it('keeps the result hidden while the ball is in the air and shows it from the rim on', () => {
    const { rerender } = renderHud(state({ phase: 'flight' }))
    const result = () => document.querySelector('.film-result')?.textContent
    expect(result()).toBe('')
    for (const phase of ['drop', 'hold', 'outro'] as const) {
      rerender(
        <FilmHud state={state({ phase })} shot={shot} zone={null} nbaPct={null} results={[true]} onPause={vi.fn()} onStep={vi.fn()} onClose={vi.fn()} />,
      )
      expect(result()).toBe('Made')
    }
  })

  it('shows Missed for a miss and leaves out the zone line when there are too few shots there', () => {
    render(
      <FilmHud state={state({ phase: 'hold' })} shot={{ ...shot, made: false }} zone={null} nbaPct={null} results={[false]} onPause={vi.fn()} onStep={vi.fn()} onClose={vi.fn()} />,
    )
    expect(document.querySelector('.film-result')?.textContent).toBe('Missed')
    expect(document.querySelector('.film-stat')).toBeNull()
  })

  it('says which shot of how many, and marks each shot made or missed in the strip', () => {
    renderHud(state({ k: 2, total: 5 }))
    expect(screen.getByText('Shot 3 of 5')).toBeTruthy()
    const dots = [...document.querySelectorAll('.film-ribbon span')]
    expect(dots.map((d) => (d.classList.contains('made') ? 'made' : 'missed'))).toEqual(['made', 'missed', 'made', 'made', 'missed'])
    expect(dots.map((d) => d.classList.contains('current'))).toEqual([false, false, true, false, false])
  })

  it('has working controls: previous, pause or play, next and close', async () => {
    const user = userEvent.setup()
    const onPause = vi.fn()
    const onStep = vi.fn()
    const onClose = vi.fn()
    const { rerender } = renderHud(state(), { onPause, onStep, onClose })
    await user.click(screen.getByRole('button', { name: 'Previous shot' }))
    await user.click(screen.getByRole('button', { name: 'Next shot' }))
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Close the film' }))
    expect(onStep.mock.calls).toEqual([[-1], [1]])
    expect(onPause).toHaveBeenCalledWith(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(
      <FilmHud state={state({ paused: true })} shot={shot} zone={null} nbaPct={null} results={[true]} onPause={onPause} onStep={onStep} onClose={onClose} />,
    )
    await user.click(screen.getByRole('button', { name: 'Play' }))
    expect(onPause).toHaveBeenLastCalledWith(false)
  })

  it('draws no lower third while the film changes shot (no shot to show), but keeps the controls', () => {
    render(<FilmHud state={state()} shot={undefined} zone={null} nbaPct={null} results={[true]} onPause={vi.fn()} onStep={vi.fn()} onClose={vi.fn()} />)
    expect(document.querySelector('.film-lower')).toBeNull()
    expect(screen.getByRole('toolbar', { name: 'Film controls' })).toBeTruthy()
  })
})

describe('FilmSummaryCard', () => {
  const summary = { made: 7, total: 15, pct: 47, bestZone: { zone: 'restricted_area', made: 3, total: 4 } }

  it('says how it went and which zone was best', () => {
    render(<FilmSummaryCard summary={summary} bestZoneName="Restricted area" onAgain={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('7 of 15 made')).toBeTruthy()
    expect(screen.getByText(/47% · best from Restricted area: 3 of 4/)).toBeTruthy()
  })

  it('leaves the best zone out when there is none, and puts focus on Watch again', () => {
    render(<FilmSummaryCard summary={{ ...summary, bestZone: null }} bestZoneName={null} onAgain={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('47%').textContent).not.toContain('best')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Watch again' }))
  })

  it('watches again or closes', async () => {
    const user = userEvent.setup()
    const onAgain = vi.fn()
    const onClose = vi.fn()
    render(<FilmSummaryCard summary={summary} bestZoneName="Restricted area" onAgain={onAgain} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Watch again' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onAgain).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
