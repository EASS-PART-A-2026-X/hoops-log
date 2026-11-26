/** The wording of the toasts that need logic: kept apart from App so it can be tested. */

/** The notice after a delete. */
export function deletedText(id: number): string {
  return `Deleted shot #${id}.`
}
