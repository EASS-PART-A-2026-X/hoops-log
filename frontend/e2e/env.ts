/** Where the throwaway servers live. 127.0.0.1 (not "localhost") so IPv4 and IPv6 cannot disagree. */
export const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8011)
export const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 5199)
export const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://127.0.0.1:${BACKEND_PORT}`
export const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${FRONTEND_PORT}`
/** The stand-in AI service (e2e/fake-ai.mjs). The real one is on 8001 and spends a free model quota: never used here. */
export const AI_PORT = Number(process.env.E2E_AI_PORT ?? 8012)
export const AI_URL = `http://127.0.0.1:${AI_PORT}`

/** The usual dev servers. Your own shots live behind them, so the tests never touch them. */
export const FORBIDDEN_PORTS = ['8000', '5173', '8001']
const LOOPBACK = new Set(['127.0.0.1', 'localhost'])

/**
 * The backend the tests write to (and `Api.clear()` empties before every test) must be a throwaway one: this machine
 * only, an explicit port, and not the usual dev port. It is checked for the API helper, in the Playwright config
 * (before anything is started) and for every request the browser makes (see `support.ts`), so a wrong URL stops the
 * run instead of wiping real data.
 */
export function assertSafeBackend(url: string = BACKEND_URL): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Refusing to run the e2e tests: "${url}" is not a URL.`)
  }
  if (!LOOPBACK.has(parsed.hostname)) {
    throw new Error(`Refusing to run the e2e tests against ${url}: only this machine (127.0.0.1 or localhost) is allowed, because the tests delete every shot.`)
  }
  if (parsed.port === '') {
    throw new Error(`Refusing to run the e2e tests against ${url}: give the throwaway backend an explicit port (the default is ${BACKEND_PORT}).`)
  }
  if (FORBIDDEN_PORTS.includes(parsed.port)) {
    throw new Error(`Refusing to run the e2e tests against ${url}: that is the real dev backend (port ${parsed.port}).`)
  }
}

/** The ports can be set on their own (E2E_BACKEND_PORT, E2E_FRONTEND_PORT), so they are checked on their own too. */
export function assertSafePorts(): void {
  for (const [name, port] of [['E2E_BACKEND_PORT', BACKEND_PORT], ['E2E_FRONTEND_PORT', FRONTEND_PORT], ['E2E_AI_PORT', AI_PORT]] as const) {
    if (!Number.isInteger(port) || port < 1024 || FORBIDDEN_PORTS.includes(String(port))) {
      throw new Error(`Refusing to run the e2e tests: ${name}=${port} is not a safe throwaway port (not 8000, 8001 or 5173, and 1024 or higher).`)
    }
  }
}

/** The page the tests open must not be the usual dev frontend either: it is wired to the real backend. */
export function assertSafeFrontend(url: string = BASE_URL): void {
  const parsed = new URL(url)
  if (!LOOPBACK.has(parsed.hostname) || parsed.port === '' || FORBIDDEN_PORTS.includes(parsed.port)) {
    throw new Error(`Refusing to run the e2e tests against the frontend at ${url}: use a throwaway one on this machine with its own port (the default is ${FRONTEND_PORT}).`)
  }
}
