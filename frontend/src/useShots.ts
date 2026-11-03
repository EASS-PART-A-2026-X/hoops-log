import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, listShots } from './api'
import type { Shot } from './api'

type Result =
  | { ok: true; shots: Shot[]; truncated: boolean }
  | { ok: false; message: string }

// One place that turns "fetch the list" into a plain result, so errors never escape.
async function fetchList(): Promise<Result> {
  try {
    return { ok: true, ...(await listShots()) }
  } catch (caught) {
    const message = caught instanceof ApiError ? caught.message : 'Could not load the shots.'
    return { ok: false, message }
  }
}

/** The shot list: loading, error and truncation state, plus `refresh` for after a write. */
export function useShots() {
  const [shots, setShots] = useState<Shot[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const latest = useRef(0)

  // A ticket per request: an older, slower reply must not overwrite a newer one.
  const apply = useCallback((ticket: number, result: Result) => {
    if (ticket !== latest.current) return
    if (result.ok) {
      setShots(result.shots)
      setTruncated(result.truncated)
      setLoadError(null)
    } else {
      setLoadError(result.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // `counter` is a plain number holder, not a DOM node, so the "ref may have changed"
    // warning does not apply. Bumping it on cleanup makes a StrictMode double mount, or
    // an unmount, ignore the older reply.
    const counter = latest
    const ticket = ++counter.current
    void fetchList().then((result) => apply(ticket, result))
    return () => {
      counter.current++
    }
  }, [apply])

  const refresh = useCallback(() => {
    setLoading(true)
    const ticket = ++latest.current
    return fetchList().then((result) => apply(ticket, result))
  }, [apply])

  return { shots, truncated, loading, loadError, refresh }
}
