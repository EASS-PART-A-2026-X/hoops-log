/**
 * Where Tab should go while a modal drawer is open, or null to let the browser move focus.
 * `items` are the drawer's focusable elements in order; `inside` says whether the focused element
 * is in the drawer at all (focus on the body, say, is not, and would escape to the page behind).
 */
export function tabTarget<T>(items: T[], active: T | null, inside: boolean, shift: boolean): T | null {
  const first = items[0]
  const last = items[items.length - 1]
  if (first === undefined || last === undefined) return null
  if (!inside) return shift ? last : first
  if (shift && active === first) return last
  if (!shift && active === last) return first
  return null
}
