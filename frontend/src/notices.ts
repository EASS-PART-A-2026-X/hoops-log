/** The wording of the toasts that need logic: kept apart from App so it can be tested. */

/** The notice after a delete. */
export function deletedText(id: number): string {
  return `Deleted shot #${id}.`
}

/** The sentence added when the shown player has no shots left. */
export function shooterSwitchedText(gone: string, now: string): string {
  return `${gone} has no shots left, so the shots of ${now} are shown.`
}

/**
 * The notice text once the shown player has run out of shots. A delete confirmation that is still
 * on screen keeps its place and the sentence follows it, so the confirmation is not lost; anything
 * else is replaced. Calling it again with its own result changes nothing.
 */
export function withShooterSwitch(current: string | null, gone: string, now: string): string {
  const sentence = shooterSwitchedText(gone, now)
  if (current === null || !current.startsWith('Deleted shot #')) return sentence
  return current.endsWith(sentence) ? current : `${current} ${sentence}`
}
