# WO-002 One person, whatever the capitals, on every screen

This order exists because WO-001 stopped: its reviewer found real gaps (the map and its stats, the
trophies and level, and the coach's milestones still compared names by exact spelling) in files WO-001 did
not allow the builder to touch. The contradiction was in the order, not in the builder: WO-001 asked the
reviewer to look at "every place" but listed only five files. This order lists the places the findings
named (see factory/runs/wo-001-r1/receipts/review-2.md and review-3.md).

Outcome:      Names that differ only in capital letters, or in spaces around the name, are ONE person everywhere
              the app groups or filters shots by player: the "Shots of" picker (listed once, with the spelling that
              has the most shots; a tie goes to the first one alphabetically), the count, the map and its
              statistics, the level and the trophies, and the coach's milestones. The folding rule matches the
              backend's (it strips the name and case-folds it, so "Straße" and "STRASSE" are one person too).
Files:        frontend/src/shooter.ts
              frontend/src/shooter.test.ts
              frontend/src/ShooterSelect.tsx
              frontend/src/ShooterSelect.test.tsx
              frontend/src/App.tsx
              frontend/src/ShotMap.tsx
              frontend/src/court/stats.ts
              frontend/src/court/stats.test.ts
              frontend/src/game/*.ts
              frontend/src/coach/useCoachEvents.ts
              frontend/src/coach/useCoachEvents.test.ts
              frontend/e2e/validation.e2e.ts
Non-goals:    No backend change. No change to the shot form or to what the chat says. Do not rename the `player`
              field or change what is stored. No new dependency.
Verify with:  - frontend lint | frontend | npm run lint
              - frontend types | frontend | npx tsc -b
              - frontend tests | frontend | npx vitest run
              - frontend build | frontend | npx vite build
              - backend tests | backend | uv run pytest -q
              - ai-service tests | ai-service | uv run pytest -q
              - new tests fail without the change | frontend | fails-first: npx vitest run {files}
Review focus: One person's spellings must give the same result on every screen: the picker, the map and its stats,
              the trophies and level, the coach. A place that still compares or groups by exact spelling is a gap.
              A test that would still pass if one of those places went back to exact spelling does not count.
              Whether the folding matches the backend's (strip and case-fold), not just a lower-case.
Acceptance:   The new unit tests fail on the original code and pass with the change (the last check of the gate),
              and the pinned test "KNOWN GAP: names that differ only in capital letters are listed as two people
              in the picker" in frontend/e2e/validation.e2e.ts is rewritten to expect ONE person in the picker.
Stop:         Two failed repair attempts, an unclear requirement, or a needed backend change.
Budget:       2 repair attempts, 45 minutes
Delivery:     A local commit on its own branch only. The GM decides about a PR; the agents never push, merge or tag.
