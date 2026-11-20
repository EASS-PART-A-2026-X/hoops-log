// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import type { ChatReply, ProposedShot, Shot, ShotInput } from '../api'
import type { MapShot } from '../court/stats'
import { today } from '../today'
import { buildStats } from './chatStats'
import { useChat } from './useChat'

vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), sendChat: vi.fn() }))
const { sendChat } = await import('../api')
const chatCall = vi.mocked(sendChat)

afterEach(cleanup)
beforeEach(() => {
  chatCall.mockReset()
})

const shots: MapShot[] = [1, 2, 3].map((id) => ({ id, player: 'Yuly', x: 25, y: 6, made: id !== 2, zone: 'paint', shot_type: '2PT' as const }))
const corner: ProposedShot = {
  x: 47.5,
  y: 3,
  made: true,
  game_date: '2026-11-19',
  note: 'caught and shot',
  quote: 'hit one from the right corner',
  zone: 'right_corner_3',
  shot_type: '3PT',
}
const elbow: ProposedShot = { ...corner, x: 17, y: 19, made: false, note: '', zone: 'left_elbow', shot_type: '2PT' }
const answer = (text = 'Nice.', proposals: ProposedShot[] = []): ChatReply => ({ reply: text, proposals, model: 'm' })

function setup(over: { shots?: MapShot[]; player?: string } = {}) {
  let id = 0
  const props = {
    shots,
    player: 'Yuly',
    say: vi.fn(),
    onCreate: vi.fn(async (input: ShotInput): Promise<Shot> => ({ ...input, id: ++id, zone: 'paint', shot_type: '2PT' })),
    onSaved: vi.fn(async (_saved: Shot[]) => {}),
    onOutcome: vi.fn(),
    ...over,
  }
  const view = renderHook((p) => useChat(p), { initialProps: props })
  const send = (text: string) => act(async () => void (await view.result.current.send(text)))
  // Starts a message without waiting for the answer, for tests where the answer is still to come.
  const start = (text: string) => {
    let running: Promise<void> = Promise.resolve()
    act(() => {
      running = view.result.current.send(text)
    })
    return running
  }
  return { ...view, props, send, start }
}

describe('sending a message', () => {
  it('asks the backend with the message, the numbers from the log and the players own date', async () => {
    chatCall.mockResolvedValue(answer())
    const { send } = setup()
    await send('how am I doing?')
    expect(chatCall).toHaveBeenCalledWith([{ role: 'user', text: 'how am I doing?' }], buildStats(shots, 'Yuly'), today(), expect.any(AbortSignal))
  })

  it('shows the message and Deni\'s reply, makes him say it, and reports that the AI answered', async () => {
    chatCall.mockResolvedValue(answer('You shoot 67%.'))
    const { result, props, send } = setup()
    await send('how am I doing?')
    expect(result.current.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'how am I doing?'],
      ['deni', 'You shoot 67%.'],
    ])
    expect(props.say).toHaveBeenCalledWith({ text: 'You shoot 67%.', mood: 'idle' })
    expect(props.onOutcome).toHaveBeenCalledWith(true)
  })

  it('looks happy when he understood shots, and keeps them as cards waiting for Save', async () => {
    chatCall.mockResolvedValue(answer('Got it.', [corner, elbow]))
    const { result, props, send } = setup()
    await send('hit one from the right corner, missed one from the left elbow')
    expect(props.say).toHaveBeenCalledWith({ text: 'Got it.', mood: 'happy' })
    expect(result.current.messages[1]!.cards!.map((c) => [c.status, c.shot.x])).toEqual([
      ['pending', 47.5],
      ['pending', 17],
    ])
    expect(props.onCreate).not.toHaveBeenCalled() // nothing is saved by being understood
  })

  it('sends no numbers when the log is empty', async () => {
    chatCall.mockResolvedValue(answer())
    const { send } = setup({ shots: [] })
    await send('hello')
    expect(chatCall.mock.calls[0]![1]).toBeNull()
  })

  it('ignores an empty message, and one that is only spaces', async () => {
    const { result, send } = setup()
    await send('')
    await send('   ')
    expect(chatCall).not.toHaveBeenCalled()
    expect(result.current.messages).toEqual([])
  })

  it('trims the message', async () => {
    chatCall.mockResolvedValue(answer())
    const { send } = setup()
    await send('  hi  ')
    expect(chatCall.mock.calls[0]![0]).toEqual([{ role: 'user', text: 'hi' }])
  })

  it('is thinking until the answer arrives, and does not start a second question meanwhile', async () => {
    let finish: (value: ChatReply) => void = () => {}
    chatCall.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const { result, send, start } = setup()
    const first = start('one')
    expect(result.current.thinking).toBe(true)
    await send('two') // ignored: one is already being answered
    expect(chatCall).toHaveBeenCalledTimes(1)
    await act(async () => {
      finish(answer())
      await first
    })
    expect(result.current.thinking).toBe(false)
  })
})

describe('the conversation it sends', () => {
  it('includes the earlier messages in order, ending with the new one', async () => {
    chatCall.mockResolvedValueOnce(answer('First answer.')).mockResolvedValueOnce(answer('Second answer.'))
    const { send } = setup()
    await send('first')
    await send('second')
    expect(chatCall.mock.calls[1]![0]).toEqual([
      { role: 'user', text: 'first' },
      { role: 'deni', text: 'First answer.' },
      { role: 'user', text: 'second' },
    ])
  })

  it('sends at most the last twelve messages, the newest being the players', async () => {
    chatCall.mockResolvedValue(answer('ok'))
    const { send } = setup()
    for (let i = 0; i < 8; i++) await send(`m${i}`)
    const turns = chatCall.mock.calls[7]![0]
    expect(turns).toHaveLength(12)
    expect(turns.at(-1)).toEqual({ role: 'user', text: 'm7' })
    expect(turns[0]).toEqual({ role: 'deni', text: 'ok' }) // the oldest are dropped, not the newest
  })

  it('never sends the apps own error notes back as if Deni had said them', async () => {
    chatCall.mockRejectedValueOnce(new ApiError('unavailable', 'Deni\'s AI helper is not available right now.')).mockResolvedValueOnce(answer('Back.'))
    const { result, send } = setup()
    await send('one')
    expect(result.current.messages[1]).toMatchObject({ role: 'deni', failed: true })
    await send('two')
    expect(chatCall.mock.calls[1]![0]).toEqual([
      { role: 'user', text: 'one' },
      { role: 'user', text: 'two' },
    ])
  })
})

describe('when the AI cannot answer', () => {
  it('shows the sentence from the backend as a failed message and reports it', async () => {
    chatCall.mockRejectedValue(new ApiError('unavailable', 'Deni\'s AI helper is busy. Try again in a minute.'))
    const { result, props, send } = setup()
    await send('hi')
    expect(result.current.messages[1]).toMatchObject({ role: 'deni', failed: true, text: 'Deni\'s AI helper is busy. Try again in a minute.' })
    expect(props.onOutcome).toHaveBeenCalledWith(false)
    expect(props.say).not.toHaveBeenCalled() // he does not read the error aloud
    expect(result.current.thinking).toBe(false)
  })

  it('says something plain for a failure it does not know', async () => {
    chatCall.mockRejectedValue(new Error('boom'))
    const { result, send } = setup()
    await send('hi')
    expect(result.current.messages[1]).toMatchObject({ failed: true, text: 'Something went wrong. Try again.' })
  })

  it('can ask again afterwards', async () => {
    chatCall.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(answer('Fine.'))
    const { result, send } = setup()
    await send('one')
    await send('two')
    expect(result.current.messages.at(-1)).toMatchObject({ role: 'deni', text: 'Fine.' })
  })
})

describe('cancelling', () => {
  it('aborts the request, stops thinking and ignores the answer that comes anyway', async () => {
    let signal: AbortSignal | undefined
    let finish: (value: ChatReply) => void = () => {}
    chatCall.mockImplementation((_turns, _stats, _today, given) => {
      signal = given
      return new Promise((resolve) => (finish = resolve))
    })
    const { result, props, start } = setup()
    const pending = start('hi')
    expect(result.current.thinking).toBe(true)
    act(() => result.current.cancel())
    expect(signal?.aborted).toBe(true)
    expect(result.current.thinking).toBe(false)
    await act(async () => {
      finish(answer('too late'))
      await pending
    })
    expect(result.current.messages.map((m) => m.text)).toEqual(['hi'])
    expect(props.say).not.toHaveBeenCalled()
    expect(props.onOutcome).not.toHaveBeenCalled()
  })

  it('can ask again straight after cancelling', async () => {
    chatCall.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(answer('Second.'))
    const { result, send, start } = setup()
    void start('one')
    expect(result.current.thinking).toBe(true)
    act(() => result.current.cancel())
    await send('two')
    expect(result.current.messages.at(-1)).toMatchObject({ text: 'Second.' })
  })

  it('aborts a request still running when the page goes away', async () => {
    let signal: AbortSignal | undefined
    chatCall.mockImplementation((_turns, _stats, _today, given) => {
      signal = given
      return new Promise(() => {})
    })
    const { result, unmount, start } = setup()
    void start('hi')
    expect(result.current.thinking).toBe(true)
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})

describe('one chat per player', () => {
  it('keeps each players conversation apart and brings it back', async () => {
    chatCall.mockResolvedValue(answer('Hi.'))
    const { result, rerender, props, send } = setup()
    await send('hello from Yuly')
    rerender({ ...props, player: 'Noam' })
    expect(result.current.messages).toEqual([])
    rerender({ ...props, player: 'Yuly' })
    expect(result.current.messages.map((m) => m.text)).toEqual(['hello from Yuly', 'Hi.'])
  })

  it('clears only the chat of the player shown', async () => {
    chatCall.mockResolvedValue(answer('Hi.'))
    const { result, rerender, props, send } = setup()
    await send('Yuly one')
    rerender({ ...props, player: 'Noam' })
    await send('Noam one')
    act(() => result.current.reset())
    expect(result.current.messages).toEqual([])
    rerender({ ...props, player: 'Yuly' })
    expect(result.current.messages).toHaveLength(2)
  })
})

describe('saving the shots he proposed', () => {
  const proposed = async (proposals = [corner, elbow], over: { shots?: MapShot[]; player?: string } = {}) => {
    chatCall.mockResolvedValue(answer('Got it.', proposals))
    const view = setup(over)
    await view.send('my shots')
    return { ...view, messageId: view.result.current.messages[1]!.id }
  }

  it('saves one shot as the chosen player with the proposed fields, and tells the app once', async () => {
    const { result, props, messageId } = await proposed()
    await act(async () => result.current.save(messageId, 0))
    expect(props.onCreate).toHaveBeenCalledTimes(1)
    expect(props.onCreate).toHaveBeenCalledWith({ player: 'Yuly', x: 47.5, y: 3, made: true, game_date: '2026-11-19', note: 'caught and shot' })
    expect(props.onSaved).toHaveBeenCalledTimes(1)
    expect(props.onSaved.mock.calls[0]![0]).toEqual([expect.objectContaining({ id: 1, x: 47.5 })])
    expect(result.current.messages[1]!.cards![0]!.status).toBe('saved')
    expect(result.current.messages[1]!.cards![1]!.status).toBe('pending') // the other one is untouched
  })

  it('shows Saving… while it is being created', async () => {
    let finish: (shot: Shot) => void = () => {}
    const { result, props, messageId } = await proposed()
    props.onCreate.mockImplementationOnce(() => new Promise<Shot>((resolve) => (finish = resolve)))
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.save(messageId, 0)
    })
    expect(result.current.messages[1]!.cards![0]!.status).toBe('saving')
    await act(async () => {
      finish({ ...corner, player: 'Yuly', id: 5 } as unknown as Shot)
      await pending
    })
    expect(result.current.messages[1]!.cards![0]!.status).toBe('saved')
  })

  it('keeps a shot that failed to save, with the reason, and does not tell the app', async () => {
    const { result, props, messageId } = await proposed()
    props.onCreate.mockImplementationOnce(() => Promise.reject(new ApiError('unreachable', "Can't reach the backend")))
    await act(async () => result.current.save(messageId, 0))
    expect(result.current.messages[1]!.cards![0]).toMatchObject({ status: 'error', message: "Can't reach the backend" })
    expect(props.onSaved).not.toHaveBeenCalled()
    await act(async () => result.current.save(messageId, 0)) // try again works
    expect(result.current.messages[1]!.cards![0]).toMatchObject({ status: 'saved', message: undefined })
  })

  it('says something plain for a save failure it does not know', async () => {
    const { result, props, messageId } = await proposed()
    props.onCreate.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    await act(async () => result.current.save(messageId, 0))
    expect(result.current.messages[1]!.cards![0]).toMatchObject({ status: 'error', message: 'Could not save this shot.' })
  })

  it('discarding a shot never saves it', async () => {
    const { result, props, messageId } = await proposed()
    act(() => result.current.discard(messageId, 0))
    expect(result.current.messages[1]!.cards![0]!.status).toBe('discarded')
    expect(props.onCreate).not.toHaveBeenCalled()
  })

  it('Save all creates every open shot in order, then tells the app ONCE with all of them', async () => {
    const { result, props, messageId } = await proposed()
    await act(async () => result.current.saveAll(messageId))
    expect(props.onCreate.mock.calls.map((call) => call[0].x)).toEqual([47.5, 17])
    expect(props.onSaved).toHaveBeenCalledTimes(1)
    expect((props.onSaved.mock.calls[0]![0] as Shot[]).map((s) => s.id)).toEqual([1, 2])
  })

  it('Save all tells the app only about the shots that really saved', async () => {
    const { result, props, messageId } = await proposed()
    props.onCreate.mockImplementationOnce(() => Promise.reject(new ApiError('server', 'The server had a problem (status 500). Try again.')))
    await act(async () => result.current.saveAll(messageId))
    expect((props.onSaved.mock.calls[0]![0] as Shot[]).map((s) => s.x)).toEqual([17])
    expect(result.current.messages[1]!.cards!.map((c) => c.status)).toEqual(['error', 'saved'])
  })

  it('Save all does not tell the app when nothing saved', async () => {
    const { result, props, messageId } = await proposed([corner])
    props.onCreate.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    await act(async () => result.current.saveAll(messageId))
    expect(props.onSaved).not.toHaveBeenCalled()
  })

  it('Save all leaves out shots that were discarded or already saved', async () => {
    const { result, props, messageId } = await proposed([corner, elbow, { ...elbow, x: 33 }])
    await act(async () => result.current.save(messageId, 0))
    act(() => result.current.discard(messageId, 1))
    props.onCreate.mockClear()
    await act(async () => result.current.saveAll(messageId))
    expect(props.onCreate.mock.calls.map((call) => call[0].x)).toEqual([33])
  })

  it('marks a later proposal that looks like a shot just saved, and Save all leaves it out', async () => {
    const { result, props, send, messageId } = await proposed([corner])
    await act(async () => result.current.save(messageId, 0))
    chatCall.mockResolvedValue(answer('Again.', [corner, elbow]))
    await send('and the same again plus an elbow')
    const second = result.current.messages.at(-1)!
    expect(second.cards!.map((c) => c.lookalike)).toEqual([true, false])
    props.onCreate.mockClear()
    await act(async () => result.current.saveAll(second.id))
    expect(props.onCreate.mock.calls.map((call) => call[0].x)).toEqual([17])
  })

  it('does not save anything for a message that has no such card', async () => {
    const { result, props } = await proposed()
    await act(async () => result.current.save(999, 0))
    await act(async () => result.current.save(result.current.messages[1]!.id, 9))
    expect(props.onCreate).not.toHaveBeenCalled()
  })
})

describe('a new log with no player chosen yet', () => {
  it('cannot save until a name is typed, then saves under that name', async () => {
    chatCall.mockResolvedValue(answer('Got it.', [corner]))
    const { result, props, send } = setup({ shots: [], player: '' })
    await send('hit one from the right corner')
    const id = result.current.messages[1]!.id
    expect(result.current.savingFor).toBe('')
    await act(async () => result.current.save(id, 0))
    expect(props.onCreate).not.toHaveBeenCalled()
    act(() => result.current.setTypedPlayer('  Noam  '))
    expect(result.current.savingFor).toBe('Noam')
    await act(async () => result.current.save(id, 0))
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ player: 'Noam' }))
  })

  it('carries the conversation over to the name once a shot is saved under it', async () => {
    chatCall.mockResolvedValue(answer('Got it.', [corner]))
    const { result, rerender, props, send } = setup({ shots: [], player: '' })
    await send('hit one from the right corner')
    act(() => result.current.setTypedPlayer('Noam'))
    await act(async () => result.current.save(result.current.messages[1]!.id, 0))
    // The app now shows Noam, so the chat of Noam must hold what was said before.
    rerender({ ...props, player: 'Noam' })
    expect(result.current.messages.map((m) => m.text)).toEqual(['hit one from the right corner', 'Got it.'])
    rerender({ ...props, player: '' })
    expect(result.current.messages).toEqual([])
  })

  it('does not move the chat when the shot did not save', async () => {
    chatCall.mockResolvedValue(answer('Got it.', [corner]))
    const { result, rerender, props, send } = setup({ shots: [], player: '' })
    await send('hit one')
    act(() => result.current.setTypedPlayer('Noam'))
    props.onCreate.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    await act(async () => result.current.save(result.current.messages[1]!.id, 0))
    rerender({ ...props, player: 'Noam' })
    expect(result.current.messages).toEqual([])
  })

  it('does not rename a chat that already belongs to a player', async () => {
    chatCall.mockResolvedValue(answer('Got it.', [corner]))
    const { result, props, send } = setup()
    await send('hit one')
    act(() => result.current.setTypedPlayer('Someone else')) // only used when no player is chosen
    expect(result.current.savingFor).toBe('Yuly')
    await act(async () => result.current.save(result.current.messages[1]!.id, 0))
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ player: 'Yuly' }))
  })
})
