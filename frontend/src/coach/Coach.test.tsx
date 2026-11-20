// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Coach from './Coach'
import { useChat } from './useChat'

// The 3D figure needs WebGL, which jsdom does not have: a stand-in keeps these tests about the dialog.
vi.mock('./Deni3D', () => ({ default: ({ onPoke }: { onPoke?: () => void }) => <button type="button" data-testid="deni-3d" onClick={onPoke} /> }))
import { QUESTIONS } from './lines'
import { bubbleMs, useCoach } from './useCoach'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const shots = [1, 2, 3, 4, 5, 6].map((id) => ({ id, player: 'A', made: true, zone: 'paint', shot_type: '2PT' as const, x: 25, y: 5 }))

// His AI helper is offline here, so a tapped question is answered from his written lines (the AI side is tested in
// useChat.test.tsx and ChatPanel.test.tsx).
function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const coach = useCoach()
  const chat = useChat({ shots, player: 'A', say: coach.say, onCreate: vi.fn(), onSaved: vi.fn(), onOutcome: vi.fn() })
  return <Coach coach={coach} chat={chat} aiAvailable={false} context={{ shots, shooter: 'A' }} onOpenChange={onOpenChange} />
}

describe('Coach', () => {
  const openIt = () => {
    const face = screen.getByRole('button', { name: /Open Deni/ })
    fireEvent.click(face)
    return face
  }

  it('opens the big view with the questions, and says what he is', () => {
    render(<Harness />)
    const face = screen.getByRole('button', { name: /Open Deni/ })
    expect(face.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(face)
    expect(face.getAttribute('aria-expanded')).toBe('true')
    const dialog = screen.getByRole('dialog', { name: 'Deni Avdija' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getAllByRole('button').filter((b) => QUESTIONS.some((q) => q.label === b.textContent))).toHaveLength(QUESTIONS.length)
    expect(screen.getByText(/fan-made coach inspired by Deni Avdija/)).toBeTruthy()
    expect(screen.getByText(/Not the real Deni/)).toBeTruthy()
    expect(screen.getByRole('log', { name: 'Conversation with Deni' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Message to Deni' })).toBeTruthy()
    // His first words, since nothing was said before.
    expect(screen.getAllByText(/I am Deni/).length).toBeGreaterThan(0)
  })

  it('answers a tapped question as a subtitle and for screen readers, and stays open for the next one', () => {
    render(<Harness />)
    openIt()
    fireEvent.click(screen.getByRole('button', { name: 'How am I shooting?' }))
    // In the subtitle, in the live region and in the chat.
    expect(screen.getAllByText(/made 6 of 6/)).toHaveLength(3)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Where am I best?' }))
    expect(screen.getAllByText(/Paint is your best area/)).toHaveLength(3)
  })

  it('closes with Escape, with the close button and with a click outside, and returns focus to his face', () => {
    render(<Harness />)
    const face = openIt()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(face)
    openIt()
    fireEvent.click(screen.getByRole('button', { name: 'Close the coach' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    openIt()
    fireEvent.mouseDown(document.querySelector('.coach-dialog')!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('tells the app when the big view opens and closes', () => {
    const changes: boolean[] = []
    render(<Harness onOpenChange={(o) => changes.push(o)} />)
    openIt()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(changes).toEqual([true, false])
  })

  it('shows the corner caption only while the big view is closed, and takes it down after a while', () => {
    render(<Harness />)
    openIt()
    fireEvent.click(screen.getByRole('button', { name: 'How do I add a shot?' }))
    expect(document.querySelector('.coach-bubble')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('.coach-bubble')).not.toBeNull()
    act(() => void vi.advanceTimersByTime(bubbleMs('x'.repeat(400)) + 10))
    expect(document.querySelector('.coach-bubble')).toBeNull()
  })

  it('shows no voice switch in a browser without speech', () => {
    render(<Harness />)
    openIt()
    expect(screen.queryByRole('button', { name: /Voice/ })).toBeNull()
  })

  it('answers the same question twice with a remark, but not a fact, which rotates', () => {
    render(<Harness />)
    openIt()
    // Earlier answers stay in the chat, so remarks are counted, not looked for.
    const remarks = () => screen.queryAllByText(/Same question/).length
    fireEvent.click(screen.getByRole('button', { name: 'Where am I best?' }))
    expect(remarks()).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Where am I best?' }))
    expect(screen.getAllByText(/Same question\? Fine, here it is again\. Paint is your best area/).length).toBeGreaterThan(0)
    const afterTwice = remarks()
    expect(afterTwice).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Where am I best?' }))
    expect(remarks()).toBeGreaterThan(afterTwice)
    // Another question in between resets it: no new remark.
    fireEvent.click(screen.getByRole('button', { name: 'How do XP and levels work?' }))
    const beforeReset = remarks()
    fireEvent.click(screen.getByRole('button', { name: 'Where am I best?' }))
    expect(remarks()).toBe(beforeReset)
    fireEvent.click(screen.getByRole('button', { name: 'Tell me something about Deni' }))
    const first = document.querySelector('.coach-caption')!.textContent
    fireEvent.click(screen.getByRole('button', { name: 'Tell me something about Deni' }))
    expect(document.querySelector('.coach-caption')!.textContent).not.toBe(first)
    expect(document.querySelector('.coach-caption')!.textContent).not.toMatch(/Same question/)
  })

  it('reacts when he is poked, and loses patience after many pokes in a row', () => {
    render(<Harness />)
    openIt()
    const him = screen.getByTestId('deni-3d')
    fireEvent.click(him)
    const first = document.querySelector('.coach-caption')!.textContent
    expect(first).toMatch(/dribbling|right here|tickles|ball/)
    fireEvent.click(him)
    expect(document.querySelector('.coach-caption')!.textContent).not.toBe(first)
    for (let i = 0; i < 4; i++) fireEvent.click(him)
    expect(document.querySelector('.coach-caption')!.textContent).toMatch(/I am awake/)
    // Slow pokes (more than five seconds apart) never lose patience.
    act(() => void vi.advanceTimersByTime(6000))
    fireEvent.click(him)
    expect(document.querySelector('.coach-caption')!.textContent).not.toMatch(/I am awake/)
  })

  it('accepts the cheat code, but not in the middle of typing or with a wrong key', () => {
    render(<Harness />)
    const press = (keys: string[], target: Element | Window = window) => keys.forEach((key) => fireEvent.keyDown(target, { key }))
    press(['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'x'])
    expect(document.querySelector('.coach-live')!.textContent).toBe('')
    const input = document.body.appendChild(document.createElement('input'))
    press(['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'], input)
    expect(document.querySelector('.coach-live')!.textContent).toBe('')
    input.remove()
    // Extra keys before it do not matter: the code is the last ten keys pressed.
    press(['ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'B', 'A'])
    expect(document.querySelector('.coach-live')!.textContent).toMatch(/Cheat code accepted/)
  })

  it('lets the visitor turn the unprompted remarks off', () => {
    render(<Harness />)
    openIt()
    const toggle = screen.getByRole('button', { name: /Let him chime in: on/ })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: /Let him chime in: off/ }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /Let him chime in: off/ }))
  })
})
