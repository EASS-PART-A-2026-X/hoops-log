/** Where the throwaway servers live. 127.0.0.1 (not "localhost") so IPv4 and IPv6 cannot disagree. */
export const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8011)
export const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 5199)
export const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://127.0.0.1:${BACKEND_PORT}`
export const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${FRONTEND_PORT}`

/** The usual dev backend. Your own shots live there, so the tests refuse to write to it. */
export const FORBIDDEN_PORT = '8000'

export function assertSafeBackend(url: string = BACKEND_URL): void {
  if (new URL(url).port === FORBIDDEN_PORT) {
    throw new Error(`Refusing to run the e2e tests against ${url}: that is the real dev backend (port ${FORBIDDEN_PORT}).`)
  }
}
