// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Shot } from './api'
import ShotList from './ShotList'

afterEach(cleanup)

const shot = (id: number): Shot => ({
  id,
  player: 'Yuly',
  x: 25,
  y: 6,
  made: id % 2 === 0,
  game_date: '2026-10-12',
  note: `note ${id}`,
  zone: 'restricted_area',
  shot_type: '2PT',
})
const shots = (n: number) => Array.from({ length: n }, (_, i) => shot(i + 1))

const listEl = (list: Shot[], resetKey = '', selectedId: number | null = null) => (
  <ShotList shots={list} resetKey={resetKey} selectedId={selectedId} onLocate={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} />
)
const renderList = (list: Shot[], selectedId: number | null = null) => render(listEl(list, '', selectedId))

const rows = () => document.querySelectorAll('li.shot')

describe('ShotList paging', () => {
  it('shows only a short first page, with a button for the rest', () => {
    renderList(shots(45))
    expect(rows()).toHaveLength(20)
    expect(screen.getByRole('button', { name: 'Show 20 more (25 not shown)' })).toBeTruthy()
  })

  it('adds a page at a time and the button goes away when everything is shown', async () => {
    const user = userEvent.setup()
    renderList(shots(45))
    await user.click(screen.getByRole('button', { name: /Show 20 more/ }))
    expect(rows()).toHaveLength(40)
    await user.click(screen.getByRole('button', { name: 'Show 5 more (5 not shown)' }))
    expect(rows()).toHaveLength(45)
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull()
  })

  it('has no button when everything fits on the first page', () => {
    renderList(shots(20))
    expect(rows()).toHaveLength(20)
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull()
  })

  it('always shows the selected shot, however far down it is', () => {
    renderList(shots(45), 33)
    expect(document.getElementById('shot-33')).not.toBeNull()
    expect(rows()).toHaveLength(33)
  })
})

describe('ShotList resetKey', () => {
  it('goes back to the first page when resetKey changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(listEl(shots(45), 'Yuly'))
    await user.click(screen.getByRole('button', { name: /Show 20 more/ }))
    expect(rows()).toHaveLength(40)
    rerender(listEl(shots(45), 'Noam'))
    expect(rows()).toHaveLength(20)
  })

  it('keeps the shown page when the list changes but resetKey does not', async () => {
    const user = userEvent.setup()
    const { rerender } = render(listEl(shots(45), 'Yuly'))
    await user.click(screen.getByRole('button', { name: /Show 20 more/ }))
    rerender(listEl(shots(46), 'Yuly'))
    expect(rows()).toHaveLength(40)
  })

  it('keeps an open edit form on a shot that is still listed when resetKey changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(listEl(shots(3), 'Yuly'))
    await user.click(screen.getByRole('button', { name: /^Edit.*#2/ }))
    expect(screen.getByRole('heading', { name: 'Edit shot #2' })).toBeTruthy()
    rerender(listEl(shots(5), ''))
    expect(screen.getByRole('heading', { name: 'Edit shot #2' })).toBeTruthy()
    expect(rows()).toHaveLength(5)
  })

  it('keeps a pending delete confirmation on a shot that is still listed when resetKey changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(listEl(shots(3), 'Yuly'))
    await user.click(screen.getByRole('button', { name: /^Delete.*#1/ }))
    rerender(listEl(shots(5), ''))
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeTruthy()
  })
})

describe('ShotList read only (the demo)', () => {
  const demo = (id: number): Shot => ({ ...shot(id), id: -id, player: 'Demo Player' })

  it('has no Edit or Delete, no ids on screen, and does not read the made-up ids out', () => {
    render(<ShotList shots={[demo(1), demo(2)]} resetKey="" selectedId={null} onLocate={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} readOnly />)
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull()
    expect(document.body.textContent).not.toContain('#-')
    expect(document.body.textContent).not.toContain('#')
    const locate = screen.getAllByRole('button', { name: /Show on map/ })
    expect(locate).toHaveLength(2)
    for (const button of locate) expect(button.textContent).toMatch(/Show on map\s*for this shot/)
  })

  it('can still show a shot on the map and unselect it', async () => {
    const onLocate = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<ShotList shots={[demo(1)]} resetKey="" selectedId={null} onLocate={onLocate} onSave={vi.fn()} onDelete={vi.fn()} readOnly />)
    await user.click(screen.getByRole('button', { name: /Show on map/ }))
    expect(onLocate).toHaveBeenCalledWith(-1)
    rerender(<ShotList shots={[demo(1)]} resetKey="" selectedId={-1} onLocate={onLocate} onSave={vi.fn()} onDelete={vi.fn()} readOnly />)
    await user.click(screen.getByRole('button', { name: /Unselect/ }))
    expect(onLocate).toHaveBeenLastCalledWith(null)
  })

  it('a normal list still has them, with the shot number read out', () => {
    renderList(shots(2))
    expect(screen.getAllByRole('button', { name: /^Edit/ })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /^Delete/ })).toHaveLength(2)
    for (const button of screen.getAllByRole('button', { name: /Show on map/ })) expect(button.textContent).toMatch(/Show on map\s*for shot #\d/)
  })
})
