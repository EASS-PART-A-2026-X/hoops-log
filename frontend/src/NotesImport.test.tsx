// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from './api'
import type { NotesResult, ProposedShot, Shot, ShotInput } from './api'
import NotesImport from './NotesImport'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  extractNotes: vi.fn(),
}))
const { extractNotes } = await import('./api')
const extract = vi.mocked(extractNotes)

afterEach(cleanup)
beforeEach(() => {
  extract.mockReset()
})

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
const elbow: ProposedShot = { ...corner, x: 17, y: 19, made: false, note: '', quote: 'missed one from the left elbow', zone: 'left_elbow', shot_type: '2PT' }
const found = (over: Partial<NotesResult> = {}): NotesResult => ({ proposals: [corner], questions: [], skipped: [], model: 'groq:test', ...over })

const setup = (props: Partial<Parameters<typeof NotesImport>[0]> = {}) => {
  let id = 0
  // What the backend does for a new shot: gives it an id and works out its zone.
  const onCreate = vi.fn(async (input: ShotInput): Promise<Shot> => ({ ...input, id: ++id, zone: 'paint', shot_type: '2PT' }))
  const onSaved = vi.fn().mockResolvedValue(undefined)
  const user = userEvent.setup()
  render(<NotesImport defaultPlayer="Yuly" onCreate={onCreate} onSaved={onSaved} {...props} />)
  return { user, onCreate, onSaved }
}
const write = async (user: ReturnType<typeof userEvent.setup>, text = 'hit one from the right corner') => {
  await user.type(screen.getByLabelText('Your notes'), text)
}
// The shots the app was told about in the first (and only) call to onSaved.
const savedBy = (onSaved: ReturnType<typeof vi.fn>): Shot[] => (onSaved.mock.calls[0] ?? [[]])[0] as Shot[]
const find = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Find shots' }))

describe('asking', () => {
  it('cannot search with nothing written, and can once there is text', async () => {
    const { user } = setup()
    const button = screen.getByRole('button', { name: 'Find shots' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await user.type(screen.getByLabelText('Your notes'), '   ')
    expect(button.disabled).toBe(true)
    await user.type(screen.getByLabelText('Your notes'), 'hit one')
    expect(button.disabled).toBe(false)
  })

  it('sends the trimmed text and the players own date', async () => {
    extract.mockResolvedValue(found())
    const { user } = setup()
    await write(user, '  hit one  ')
    await find(user)
    expect(extract).toHaveBeenCalledWith('hit one', new Date().toLocaleDateString('en-CA'), expect.any(AbortSignal))
  })

  it('counts the characters and stops at the backends limit', async () => {
    const { user } = setup()
    await write(user, 'abc')
    expect(screen.getByText('3 / 2000')).toBeTruthy()
    expect((screen.getByLabelText('Your notes') as HTMLTextAreaElement).maxLength).toBe(2000)
  })

  it('says the notes go to an AI model, and that nothing is saved without Save', () => {
    setup()
    expect(screen.getByText(/sent to an AI model/)).toBeTruthy()
    expect(screen.getByText(/nothing is saved until you press Save/)).toBeTruthy()
  })

  it('shows a waiting message with a Cancel button while the model reads', async () => {
    extract.mockReturnValue(new Promise(() => {}))
    const { user } = setup()
    await write(user)
    await find(user)
    expect(screen.getByText(/this can take up to a minute/)).toBeTruthy()
    const busy = screen.getByRole('button', { name: 'Reading…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('ignores the answer of a search that was cancelled', async () => {
    let finish: (value: NotesResult) => void = () => {}
    extract.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { user } = setup()
    await write(user)
    await find(user)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    finish(found())
    await waitFor(() => expect(screen.queryByText(/this can take up to a minute/)).toBeNull())
    expect(screen.queryByText('Proposed shots')).toBeNull()
  })

  it('shows the backends sentence when it fails and keeps what was typed', async () => {
    extract.mockImplementation(() => Promise.reject(new ApiError('unavailable', 'The AI helper is not available right now. You can still add shots with the form.')))
    const { user } = setup()
    await write(user, 'my notes')
    await find(user)
    expect((await screen.findByRole('alert')).textContent).toContain('not available right now')
    expect((screen.getByLabelText('Your notes') as HTMLTextAreaElement).value).toBe('my notes')
    expect((screen.getByRole('button', { name: 'Find shots' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('says something plain for a failure it does not know', async () => {
    extract.mockImplementation(() => Promise.reject(new Error('boom')))
    const { user } = setup()
    await write(user)
    await find(user)
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Try again.')
  })
})

describe('the answer', () => {
  it('lists each proposed shot with its zone, result, date, note and the words it came from', async () => {
    extract.mockResolvedValue(found({ proposals: [corner, elbow] }))
    const { user } = setup()
    await write(user)
    await find(user)
    expect(await screen.findByText('Right corner 3 · 3PT · made · 2026-11-19')).toBeTruthy()
    expect(screen.getByText('caught and shot')).toBeTruthy()
    expect(screen.getByText('hit one from the right corner', { selector: 'q' })).toBeTruthy()
    expect(screen.getByText('Left elbow · 2PT · missed · 2026-11-19')).toBeTruthy()
    expect(screen.getByText('Read by groq:test')).toBeTruthy()
  })

  it('warns when the answer came from the fake test model', async () => {
    extract.mockResolvedValue(found({ model: 'test' }))
    const { user } = setup()
    await write(user)
    await find(user)
    expect(await screen.findByText('Test model: these answers are fake.')).toBeTruthy()
  })

  it('shows the AIs questions and asks the user to add the answers and search again', async () => {
    extract.mockResolvedValue(found({ proposals: [], questions: ['Which day?', 'Did it go in?'] }))
    const { user } = setup()
    await write(user)
    await find(user)
    expect(await screen.findByText('Which day?')).toBeTruthy()
    expect(screen.getByText('Did it go in?')).toBeTruthy()
    expect(screen.getByText(/press Find shots again/)).toBeTruthy()
    expect(screen.queryByText('Proposed shots')).toBeNull()
  })

  it('lists what was not logged', async () => {
    extract.mockResolvedValue(found({ skipped: ['2 free throws'] }))
    const { user } = setup()
    await write(user)
    await find(user)
    expect(await screen.findByText('Not logged')).toBeTruthy()
    expect(screen.getByText('2 free throws')).toBeTruthy()
  })

  it('says so when nothing at all came back', async () => {
    extract.mockResolvedValue(found({ proposals: [] }))
    const { user } = setup()
    await write(user)
    await find(user)
    expect(await screen.findByText('Nothing was found in those notes.')).toBeTruthy()
  })

  it('a new search replaces the old answer', async () => {
    extract.mockResolvedValueOnce(found()).mockResolvedValueOnce(found({ proposals: [elbow] }))
    const { user } = setup()
    await write(user)
    await find(user)
    await screen.findByText(/Right corner 3/)
    await find(user)
    expect(await screen.findByText(/Left elbow/)).toBeTruthy()
    expect(screen.queryByText(/Right corner 3/)).toBeNull()
  })
})

describe('saving', () => {
  it('saves one shot with the chosen player and the proposed fields, then marks it saved', async () => {
    extract.mockResolvedValue(found())
    const { user, onCreate } = setup()
    await write(user)
    await find(user)
    await user.click(await screen.findByRole('button', { name: 'Save shot 1' }))
    expect(onCreate).toHaveBeenCalledWith({ player: 'Yuly', x: 47.5, y: 3, made: true, game_date: '2026-11-19', note: 'caught and shot' })
    expect(await screen.findByText('Saved ✓')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save shot 1' })).toBeNull()
  })

  it('uses the player typed in the box instead of the default', async () => {
    extract.mockResolvedValue(found())
    const { user, onCreate } = setup()
    await write(user)
    await user.clear(screen.getByLabelText('Save the shots for'))
    await user.type(screen.getByLabelText('Save the shots for'), '  Noam ')
    await find(user)
    await user.click(await screen.findByRole('button', { name: 'Save shot 1' }))
    expect(onCreate.mock.calls[0]?.[0].player).toBe('Noam')
  })

  it('will not save without a player, and says why', async () => {
    extract.mockResolvedValue(found())
    const { user, onCreate } = setup({ defaultPlayer: '' })
    await write(user)
    await find(user)
    expect(await screen.findByText('Enter the player above to save these shots.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save shot 1' }) as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText('Save the shots for'), 'Yuly')
    expect((screen.getByRole('button', { name: 'Save shot 1' }) as HTMLButtonElement).disabled).toBe(false)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('keeps a shot that failed to save, shows why, and lets the user try again', async () => {
    extract.mockResolvedValue(found())
    const { user, onCreate } = setup()
    onCreate.mockImplementationOnce(() => Promise.reject(new ApiError('unreachable', "Can't reach the backend")))
    await write(user)
    await find(user)
    await user.click(await screen.findByRole('button', { name: 'Save shot 1' }))
    expect((await screen.findByRole('alert')).textContent).toContain("Can't reach the backend")
    await user.click(screen.getByRole('button', { name: 'Save shot 1' }))
    expect(await screen.findByText('Saved ✓')).toBeTruthy()
    expect(onCreate).toHaveBeenCalledTimes(2)
  })

  it('discarding removes a proposal without saving it', async () => {
    extract.mockResolvedValue(found({ proposals: [corner, elbow] }))
    const { user, onCreate } = setup()
    await write(user)
    await find(user)
    await user.click(await screen.findByRole('button', { name: 'Discard shot 1' }))
    expect(screen.queryByText(/Right corner 3/)).toBeNull()
    expect(screen.getByText(/Left elbow/)).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('Save all saves every open shot in the order of the notes, and only shows with two or more', async () => {
    extract.mockResolvedValue(found({ proposals: [corner, elbow] }))
    const { user, onCreate } = setup()
    await write(user)
    await find(user)
    await user.click(await screen.findByRole('button', { name: 'Save all (2)' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2))
    expect(onCreate.mock.calls.map((call) => call[0])).toEqual([
      { player: 'Yuly', x: 47.5, y: 3, made: true, game_date: '2026-11-19', note: 'caught and shot' },
      { player: 'Yuly', x: 17, y: 19, made: false, game_date: '2026-11-19', note: '' },
    ])
    expect(screen.getAllByText('Saved ✓')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Save all/ })).toBeNull()
  })

  it('has no Save all for a single proposal', async () => {
    extract.mockResolvedValue(found())
    const { user } = setup()
    await write(user)
    await find(user)
    await screen.findByRole('button', { name: 'Save shot 1' })
    expect(screen.queryByRole('button', { name: /Save all/ })).toBeNull()
  })

  it('Save all skips a shot that is already saved or discarded', async () => {
    extract.mockResolvedValue(found({ proposals: [corner, elbow, { ...elbow, x: 33 }] }))
    const { user, onCreate } = setup()
    await write(user)
    await find(user)
    await user.click(await screen.findByRole('button', { name: 'Save shot 1' }))
    await user.click(screen.getByRole('button', { name: 'Discard shot 2' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: /Save all/ })).toBeNull()
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('one refresh and one notice per save, however many shots', () => {
  it('tells the app once after a single save, with the shot that was really created', async () => {
    extract.mockResolvedValue(found())
    const { user, onSaved } = setup()
    await write(user)
    await find(user)
    await user.click(await screen.findByRole('button', { name: 'Save shot 1' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(onSaved.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ id: 1, x: 47.5, y: 3, made: true, player: 'Yuly' })])
  })

  it('Save all creates each shot but tells the app only once, with all of them in order', async () => {
    extract.mockResolvedValue(found({ proposals: [corner, elbow] }))
    const { user, onCreate, onSaved } = setup()
    await write(user)
    await find(user)
    await user.click(await screen.findByRole('button', { name: 'Save all (2)' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(onCreate).toHaveBeenCalledTimes(2)
    expect(savedBy(onSaved).map((shot) => [shot.id, shot.x])).toEqual([
      [1, 47.5],
      [2, 17],
    ])
  })

  it('Save all tells the app only about the shots that really saved, and keeps the failed one to retry', async () => {
    extract.mockResolvedValue(found({ proposals: [corner, elbow] }))
    const { user, onCreate, onSaved } = setup()
    onCreate.mockImplementationOnce(() => Promise.reject(new ApiError('server', 'The server had a problem (status 500). Try again.')))
    await write(user)
    await find(user)
    await user.click(await screen.findByRole('button', { name: 'Save all (2)' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(savedBy(onSaved).map((shot) => shot.x)).toEqual([17])
    expect((await screen.findByRole('alert')).textContent).toContain('status 500')
    expect(screen.getByRole('button', { name: 'Save shot 1' }).textContent).toBe('Try again')
  })

  it('does not tell the app anything when the only save failed', async () => {
    extract.mockResolvedValue(found())
    const { user, onCreate, onSaved } = setup()
    onCreate.mockImplementationOnce(() => Promise.reject(new ApiError('unreachable', "Can't reach the backend")))
    await write(user)
    await find(user)
    await user.click(await screen.findByRole('button', { name: 'Save shot 1' }))
    await screen.findByRole('alert')
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('a search cannot start while a save is running', () => {
  it('disables Find shots until the save ends', async () => {
    extract.mockResolvedValue(found())
    let finish: (shot: Shot) => void = () => {}
    const { user, onCreate } = setup()
    onCreate.mockImplementationOnce(() => new Promise<Shot>((resolve) => (finish = resolve)))
    await write(user)
    await find(user)
    await user.click(await screen.findByRole('button', { name: 'Save shot 1' }))
    expect((screen.getByRole('button', { name: 'Find shots' }) as HTMLButtonElement).disabled).toBe(true)
    finish({ ...corner, player: 'Yuly', id: 9, note: '' } as unknown as Shot)
    await screen.findByText('Saved ✓')
    expect((screen.getByRole('button', { name: 'Find shots' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('shots that look like ones just saved', () => {
  const searchTwice = async (second: ProposedShot[], first: ProposedShot[] = [corner]) => {
    extract.mockResolvedValueOnce(found({ proposals: first })).mockResolvedValueOnce(found({ proposals: second }))
    const view = setup()
    await write(view.user)
    await find(view.user)
    await view.user.click(await screen.findByRole('button', { name: 'Save shot 1' }))
    await screen.findByText('Saved ✓')
    await find(view.user)
    return view
  }

  it('marks them, offers Save again, and keeps them out of Save all', async () => {
    await searchTwice([corner, elbow, { ...elbow, x: 33 }])
    expect(await screen.findByText('Looks like a shot you just saved.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save shot 1' }).textContent).toBe('Save again')
    expect(screen.getByRole('button', { name: 'Save shot 2' }).textContent).toBe('Save')
    expect(screen.getByRole('button', { name: 'Save all (2)' })).toBeTruthy()
  })

  it('Save all really leaves the marked shot out', async () => {
    const { user, onCreate, onSaved } = await searchTwice([corner, elbow, { ...elbow, x: 33 }])
    await user.click(await screen.findByRole('button', { name: 'Save all (2)' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2)) // the first save, then this batch
    // 1 for the first save, then only the two that are not marked.
    expect(onCreate.mock.calls.map((call) => call[0].x)).toEqual([47.5, 17, 33])
  })

  it('a shot at the same spot with a different result is not the same shot', async () => {
    await searchTwice([{ ...corner, made: false }])
    await screen.findByRole('button', { name: 'Save shot 1' })
    expect(screen.queryByText('Looks like a shot you just saved.')).toBeNull()
  })

  it('a shot on a different day is not the same shot', async () => {
    await searchTwice([{ ...corner, game_date: '2026-11-18' }])
    await screen.findByRole('button', { name: 'Save shot 1' })
    expect(screen.queryByText('Looks like a shot you just saved.')).toBeNull()
  })

  it('a marked shot can still be saved on purpose', async () => {
    const { user, onCreate } = await searchTwice([corner])
    await user.click(await screen.findByRole('button', { name: 'Save shot 1' }))
    await screen.findByText('Saved ✓')
    expect(onCreate).toHaveBeenCalledTimes(2)
  })

  it('counts identical shots one by one: one saved before means one marked now', async () => {
    await searchTwice([elbow, elbow], [elbow, elbow])
    expect(await screen.findAllByText('Looks like a shot you just saved.')).toHaveLength(1)
  })

  it('does not mark a shot for a different player', async () => {
    extract.mockResolvedValue(found())
    const { user } = setup()
    await write(user)
    await find(user)
    await user.click(await screen.findByRole('button', { name: 'Save shot 1' }))
    await screen.findByText('Saved ✓')
    await user.clear(screen.getByLabelText('Save the shots for'))
    await user.type(screen.getByLabelText('Save the shots for'), 'Noam')
    await find(user)
    await screen.findByRole('button', { name: 'Save shot 1' })
    expect(screen.queryByText('Looks like a shot you just saved.')).toBeNull()
  })

  it('does not mark shots that were never saved (discarded or not yet saved)', async () => {
    extract.mockResolvedValue(found())
    const { user } = setup()
    await write(user)
    await find(user)
    await user.click(await screen.findByRole('button', { name: 'Discard shot 1' }))
    await find(user)
    await screen.findByRole('button', { name: 'Save shot 1' })
    expect(screen.queryByText('Looks like a shot you just saved.')).toBeNull()
  })
})

describe('Cancel really stops the request', () => {
  // The signal of every call, in order.
  const signals: AbortSignal[] = []
  const neverAnswers = () =>
    extract.mockImplementation((_text, _today, given) => {
      if (given) signals.push(given)
      return new Promise(() => {})
    })
  beforeEach(() => {
    signals.length = 0
  })

  it('aborts the call that is in flight', async () => {
    neverAnswers()
    const { user } = setup()
    await write(user)
    await find(user)
    expect(signals.map((signal) => signal.aborted)).toEqual([false])
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(signals.map((signal) => signal.aborted)).toEqual([true])
  })

  it('aborts the call when the panel goes away', async () => {
    neverAnswers()
    const { user } = setup()
    await write(user)
    await find(user)
    cleanup()
    expect(signals.map((signal) => signal.aborted)).toEqual([true])
  })
})
