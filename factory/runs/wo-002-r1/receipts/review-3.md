Verdict: approve

The change routes the picker, the shooter filter, the map, the stats, the level and trophies, the celebrations and the coach milestones through one folding rule (`shooterKey`, trim plus case-fold), and the tests cover those paths. I found no major gap, only two exact-spelling comparisons that are harmless in practice.

- [minor] frontend/src/ScoreBug.tsx:38 still compares `pop.player === name` by exact spelling. Both values come from the same shots list, so they match in normal use. They can differ only briefly, when a pop was set under an older spelling and the displayed spelling then flips without a new gain. Using `sameShooter(pop.player, name)` would close it, and no test covers that line.
- [minor] frontend/src/coach/useChat.ts:66 keys its once-per-player `asked` set on the raw `player` string. The shooter string is the displayed spelling, so this is stable in practice. It is still an exact-spelling key that could be folded with `shooterKey`. This is not chat wording, so it is outside the non-goal.
