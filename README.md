# Hoops Log

A shot-chart tracker for basketball players and coaches: log shots on a court, see where you score, and turn a messy game recap into structured shots.

**Purpose:** shots recorded in notes apps and chat messages cannot be mapped or compared, so players never see where they are actually efficient.
**Operational principle:** after a player logs shots (by clicking the court, or by pasting a recap and confirming the proposed shots), the shots are saved and the chart shows made/missed by court position and zone; after a restart the same chart is still there.

## User stories
1. As a player, I can click a spot on the court to log a shot so that my chart builds up over time.
2. As a player, I can paste a messy recap ("missed a corner three, then hit a pull-up from the left elbow"), review the proposed shots and save them, so that I don't have to enter each shot by hand.
3. As a coach, I can filter the chart by player, zone, shot type and date range so that I can see who is efficient from where.
4. As a player, I can ask "where should I shoot more?" so that I get recommendations backed by my own numbers.

## Data sketch
Shot: player (text, 1-50), x (float, 0-50 ft), y (float, 0-47 ft), made (bool), game_date (date, not in the future), note (text, max 200)

Computed by backend code, never stored or sent by a client:
- **zone**: named area from x, y (left_corner_3, left_wing_3, top_3, right_wing_3, right_corner_3, left_elbow, right_elbow, mid_range, paint, restricted_area)
- **shot_type**: 2PT or 3PT from the distance between x, y and the hoop

Court rules: NBA half court, 50 ft wide × 47 ft deep, origin at the left baseline corner, hoop at (25, 5.25). The 3PT line is 22 ft from the hoop in the corners (the first 14 ft from the baseline) and 23.75 ft on the arc.

## The AI service
Two jobs, both stateless (the service never touches the database). The model reads text and classifies; code does the geometry and checks the numbers.
1. Recap to shots (built first). Input: free-text game recap. Structured output: a list of shot proposals, each with a zone, made, and an optional note. The backend maps each zone to a fixed spot on the court, so the same phrase always lands on the same x, y. Proposals are shown to the user to confirm or edit; nothing is saved until they do. If the AI service is down, logging shots by clicking still works.
2. Shot analyst. Input: a player's shots (sent by the backend) and a question. The agent calls tools (zone stats, period comparison by game_date, hot/cold zones) and returns a typed result: summary, key findings, recommendations. Every number comes from a tool result, and code rejects answers whose numbers don't match.

## Data flow
browser -> frontend (:8501) -> backend (:8000) -> ai-service (:8001)

Only the backend touches the database (SQLite) and calls the AI service.

## AI use
Tools: none yet · Help received: none yet · Checks I ran: none yet

## Open-source shortlist
| Repository | Stars (date checked) | License | Why it fits me |
|---|---|---|---|
| udecode/plate | 16.5k (21 Oct 2026) | MIT | React/TS editor; I already have a merged PR there |
