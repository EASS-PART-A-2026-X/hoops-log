import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, listDemoShots } from '../api'
import type { Shot } from '../api'

/** The name the demo's shots are shown under. */
export const DEMO_NAME = 'Demo Player'

/**
 * The demo's shots: loaded the first time the demo is switched on, then kept for the rest of the visit.
 * They are never stored, never part of the account's own shots, and cannot be changed.
 */
export function useDemoShots(enabled: boolean) {
  const [shots, setShots] = useState<Shot[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const asked = useRef(false)

  const load = useCallback(() => {
    asked.current = true
    setLoading(true)
    setError(null)
    listDemoShots()
      .then((list) => setShots(list))
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : 'Could not load the demo.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (enabled && !asked.current) load()
  }, [enabled, load])

  return { shots, loadError: error, loading, retry: load }
}
