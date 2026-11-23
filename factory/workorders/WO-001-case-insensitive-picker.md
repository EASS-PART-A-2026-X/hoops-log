# WO-001 Case-insensitive player picker

This is the course's one work-order template (nine fields). The builder and the reviewer are
given exactly these fields. `Files` is enforced by a hook and by a check after the builder
finishes; `Verify with` is what the gate runs on the exact candidate commit.

Outcome:      In the "Shots of" picker, names that differ only in capital letters, or in spaces around the name,
              are ONE person. They are listed once (shown with the spelling that has the most shots; a tie goes
              to the first one alphabetically), their count is all of their shots together, and choosing them
              shows all of those shots on the map and in the stats. The rule is the one the backend's player
              filter already uses: it ignores letter case and spaces around the name.
Files:        frontend/src/shooter.ts
              frontend/src/shooter.test.ts
              frontend/src/ShooterSelect.tsx
              frontend/src/ShooterSelect.test.tsx
              frontend/src/App.tsx
              frontend/e2e/validation.e2e.ts
Non-goals:    No backend change. No change to the shot form, the chat or the Deni coach. Do not rename the
              `player` field or change what is stored. No new dependency.
Verify with:  - frontend lint | frontend | npm run lint
              - frontend types | frontend | npx tsc -b
              - frontend tests | frontend | npx vitest run
              - frontend build | frontend | npx vite build
              - backend tests | backend | uv run pytest -q
              - ai-service tests | ai-service | uv run pytest -q
              - new tests fail without the change | frontend | fails-first: npx vitest run {files}
Review focus: Every place that still compares or groups players by exact spelling (the filter in App.tsx, the
              default shooter, the count per player, resolveShooter). Whether the rule really matches the backend's
              (letter case and spaces around the name). Whether the pinned e2e test was rewritten to describe the
              new behaviour instead of being deleted.
Acceptance:   The new unit tests fail on the original code and pass with the change (the last check of the gate),
              and the pinned test "KNOWN GAP: names that differ only in capital letters are listed as two people
              in the picker" in frontend/e2e/validation.e2e.ts is rewritten to expect ONE person in the picker.
Stop:         Two failed repair attempts, an unclear requirement, or a needed backend change.
Budget:       2 repair attempts, 45 minutes
Delivery:     A local commit on its own branch only. The GM decides about a PR; the agents never push, merge or tag.
