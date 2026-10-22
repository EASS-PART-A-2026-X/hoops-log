# Hoops Log

A shot-chart tracker for basketball players and coaches: log shots on a court, see where you score, and turn a messy game recap into structured shots.

**Purpose:** shots recorded in notes apps and chat messages cannot be mapped or compared, so players never see where they are actually efficient.
**Operational principle:** after a player logs shots (by clicking the court or pasting a recap), the shots are saved and the chart shows made/missed by court position; after a restart the same chart is still there.

## User stories
1. As a player, I can click a spot on the court to log a shot so that my chart builds up over time.
2. As a player, I can paste a messy recap ("missed a corner three, then hit a pull-up from the left elbow") so that I don't have to enter each shot by hand.
3. As a coach, I can filter the chart by player and shot type so that I can see who is efficient from where.
4. As a player, I can ask "where should I shoot more?" so that I get recommendations backed by my own numbers.

## Data sketch
Shot: player (text, 1-50), x (float, 0-50 ft), y (float, 0-47 ft), shot_type (2PT | 3PT), made (bool), note (text, max 200)

## The AI service
Two jobs, both stateless (the service never touches the database):
1. Recap to shots. Input: free-text game recap. Structured output: a list of Shot proposals. Code, not the model, checks court bounds and that a 3PT is beyond the arc.
2. Shot analyst. Input: a player's shots (sent by the backend) and a question. The agent calls tools (zone stats, period comparison, hot/cold zones) and returns a typed result: summary, key findings, recommendations. Every number comes from a tool result, and code rejects answers whose numbers don't match.

## Data flow
browser -> frontend -> backend -> ai-service (only the backend touches the database)

## AI use
Tools: none yet · Help received: none yet · Checks I ran: none yet

## Open-source shortlist
| Repository | Stars (date checked) | License | Why it fits me |
|---|---|---|---|
| udecode/plate | 16.5k (21 Oct 2026) | MIT | React/TS editor; I already have a merged PR there |
