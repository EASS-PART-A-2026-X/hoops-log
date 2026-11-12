// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Coach from './Coach'
import { QUESTIONS } from './lines'
import { bubbleMs, useCoach } from './useCoach'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const shots = [1, 2, 3, 4, 5, 6].map((id) => ({ id, player: 'A', made: true, zone: 'paint', shot_type: '2PT' as const, x: 25, y: 5 }))

function Harness() {
  const coach = useCoach()
  return <Coach coach={coach} context={{ shots, shooter: 'A' }} />
}

describe('Coach', () => {
  it('opens a list of questions, answers one as a caption, and says what he is', () => {
    render(<Harness />)
    const face = screen.getByRole('button', { name: /Ask Deni/ })
    expect(face.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(face)
    expect(face.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('button').filter((b) => QUESTIONS.some((q) => q.label === b.textContent))).toHaveLength(QUESTIONS.length)
    expect(screen.getByText(/fan-made coach inspired by Deni Avdija/)).toBeTruthy()
    expect(screen.getByText(/no AI/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'How am I shooting?' }))
    // The list closes and the answer is in the caption and announced to screen readers.
    expect(screen.queryByRole('group', { name: 'Ask Deni' })).toBeNull()
    expect(screen.getAllByText(/made 6 of 6/)).toHaveLength(2)
  })

  it('closes the list with Escape and returns focus to his face', () => {
    render(<Harness />)
    const face = screen.getByRole('button', { name: /Ask Deni/ })
    fireEvent.click(face)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Ask Deni' })).toBeNull()
    expect(document.activeElement).toBe(face)
  })

  it('takes the caption down after a while, and with the close button', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Ask Deni/ }))
    fireEvent.click(screen.getByRole('button', { name: 'How do I add a shot?' }))
    expect(screen.getAllByText(/Add a shot/).length).toBeGreaterThan(0)
    act(() => void vi.advanceTimersByTime(bubbleMs('x'.repeat(200)) + 10))
    expect(screen.queryByText(/Add a shot/)).toBeNull()
  })

  it('shows no voice switch in a browser without speech', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Ask Deni/ }))
    expect(screen.queryByRole('button', { name: /Voice/ })).toBeNull()
  })
})
