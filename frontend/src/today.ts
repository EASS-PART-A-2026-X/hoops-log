/** "Today" for the player, in their own time zone, as YYYY-MM-DD (so "yesterday" is theirs). */
export const today = (): string => new Date().toLocaleDateString('en-CA')
