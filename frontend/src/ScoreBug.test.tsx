// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ScoreBug from './ScoreBug'
import Trophies from './Trophies'
import { levelInfo } from './game/xp'

afterEach(cleanup)

const level = levelInfo(150)

describe('ScoreBug', () => {
  it('shows the shooter, field goal percent and level', () => {
    render(<ScoreBug armed name="Ann" made={5} attempts={10} level={level} pop={null} />)
    const group = screen.getByRole('group')
    expect(group.getAttribute('aria-label')).toBe('Ann: level 2 ROOKIE')
    expect(group.textContent).toContain('50')
    expect(group.textContent).toContain('90 / 180 XP')
  })

  it('waits at zero until armed', () => {
    render(<ScoreBug armed={false} name="Ann" made={5} attempts={10} level={level} pop={null} />)
    expect((screen.getByRole('progressbar').firstElementChild as HTMLElement).style.width).toBe('0%')
    expect(screen.getByRole('group').querySelector('.bug-fg b')!.textContent).toBe('0')
  })

  it('names everyone when no player is chosen, and shows a dash with no shots', () => {
    render(<ScoreBug armed name="" made={0} attempts={0} level={levelInfo(0)} pop={null} />)
    expect(screen.getByRole('group').textContent).toContain('ALL PLAYERS')
    expect(screen.getByRole('group').querySelector('.bug-fg b')!.textContent).toBe('–')
  })

  it('shows the XP pop only for the shown player', () => {
    const pop = { key: 1, amount: 25, player: 'Ann' }
    const { rerender, container } = render(<ScoreBug armed name="Ann" made={1} attempts={1} level={level} pop={pop} />)
    expect(container.querySelector('.xp-pop')?.textContent).toBe('+25 XP')
    rerender(<ScoreBug armed name="Bob" made={1} attempts={1} level={level} pop={pop} />)
    expect(container.querySelector('.xp-pop')).toBeNull()
    rerender(<ScoreBug armed name="" made={1} attempts={1} level={level} pop={pop} />)
    expect(container.querySelector('.xp-pop')).not.toBeNull()
  })

  it('says when the level covers only part of the log', () => {
    render(<ScoreBug armed partial name="Ann" made={1} attempts={1} level={level} pop={null} />)
    expect(screen.getByRole('group').getAttribute('title')).toContain('loaded shots only')
    // Visible text and text for screen readers too: a tooltip alone does not reach touch or keyboard users.
    expect(screen.getByRole('group').querySelector('.bug-partial')?.textContent).toBe('loaded shots only')
    expect(screen.getByRole('group').querySelector('.sr-only')?.textContent).toContain('loaded shots only')
  })
})

describe('Trophies', () => {
  const shot = (over = {}) => ({ id: 1, player: 'A', game_date: '2026-11-01', made: true, zone: 'paint', shot_type: '2PT' as const, x: 25, y: 8, ...over })

  it('counts unlocked trophies and shows progress on locked ones', () => {
    const { container } = render(<Trophies shots={[shot()]} shooter="A" />)
    expect(container.querySelector('.count')!.textContent).toBe('1 of 12 unlocked · A')
    expect(container.querySelectorAll('.trophy.got')).toHaveLength(1)
    expect(container.textContent).toContain('1 / 10') // Warm-Up
  })

  it('warns when the list was cut short', () => {
    const { container } = render(<Trophies shots={[shot()]} shooter="A" partial />)
    expect(container.querySelector('.trophies-note')).not.toBeNull()
  })
})
