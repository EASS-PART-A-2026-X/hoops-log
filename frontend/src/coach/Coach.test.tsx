// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Coach from './Coach'
import { useChat } from './useChat'

vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), sendChat: vi.fn() }))
const { sendChat } = await import('../api')

// The 3D figure needs WebGL, which jsdom does not have: a stand-in keeps these tests about the dialog.
vi.mock('./Deni3D', () => ({ default: ({ onPoke }: { onPoke?: () => void }) => <button type="button" data-testid="deni-3d" onClick={onPoke} /> }))
import { bubbleMs, useCoach } from './useCoach'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const shots = [1, 2, 3, 4, 5, 6].map((id) => ({ id, player: 'A', made: true, zone: 'paint', shot_type: '2PT' as const, x: 25, y: 5 }))

// The chat itself (the AI side) is tested in useChat.test.tsx and ChatPanel.test.tsx; here it is only part of the dialog.
function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const coach = useCoach()
  const chat = useChat({ shots, player: 'A', say: coach.say, onCreate: vi.fn(), onSaved: vi.fn(), onOutcome: vi.fn() })
  return <Coach coach={coach} chat={chat} aiAvailable={true} context={{ shots, shooter: 'A' }} onOpenChange={onOpenChange} />
}

describe('Coach', () => {
  const openIt = () => {
    const face = screen.getByRole('button', { name: /Open Deni/ })
    fireEvent.click(face)
    return face
  }

  it('opens the big view with the chat, and says what he is', () => {
    render(<Harness />)
    const face = screen.getByRole('button', { name: /Open Deni/ })
    expect(face.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(face)
    expect(face.getAttribute('aria-expanded')).toBe('true')
    const dialog = screen.getByRole('dialog', { name: 'Deni Avdija' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    // One way to talk to him: the chat. No separate question buttons.
    expect(screen.queryByRole('list', { name: /questions/i })).toBeNull()
    expect(screen.getByText(/fan-made coach inspired by Deni Avdija/)).toBeTruthy()
    expect(screen.getByText(/not the real Deni/)).toBeTruthy()
    expect(screen.getByRole('log', { name: 'Conversation with Deni' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Message to Deni' })).toBeTruthy()
    // His first words, since nothing was said before.
    expect(screen.getAllByText(/I am Deni/).length).toBeGreaterThan(0)
  })

  it('says his chat reply as a subtitle and for screen readers, and stays open for the next message', async () => {
    vi.mocked(sendChat).mockResolvedValue({ reply: 'You made 6 of 6, that is 100%.', proposals: [], model: 'm' })
    render(<Harness />)
    openIt()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message to Deni' }), { target: { value: 'How am I doing?' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    // In the subtitle, in the live region and in the chat.
    expect(screen.getAllByText(/made 6 of 6/)).toHaveLength(3)
    expect(screen.getByRole('dialog')).toBeTruthy()
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
    fireEvent.click(screen.getByTestId('deni-3d')) // poking him makes him say something
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
})
