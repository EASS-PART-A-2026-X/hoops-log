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

const renderList = (list: Shot[], selectedId: number | null = null) =>
  render(<ShotList shots={list} selectedId={selectedId} onLocate={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} />)

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
