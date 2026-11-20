// A stand-in for the AI service (ai-service/), for the e2e tests only: no model, no key, no network.
// The throwaway backend is pointed at it (AI_SERVICE_URL), so the tests exercise the real chain
// browser -> frontend -> backend -> HTTP call to "the AI service", with answers that never change.
//
// What it answers depends on a word in the notes, so each test can pick the situation it needs.
// The FIRST word found in this order wins (so a note with "vague" and "corner" is the vague one):
//   1. "simulate down"     503 (the AI service has no model)
//   2. "simulate busy"     429 (provider quota)
//   3. "simulate garbage"  200 but an answer that breaks the rules
//   4. "vague"             a question, no shots
//   5. "corner"            two shots and one thing not logged
//   6. anything else       one layup at the rim
// "yesterday" in the notes makes the shots yesterday's, counted from the `today` the backend sends.
import http from 'node:http'

const port = Number(process.env.E2E_AI_PORT ?? 8012)

const day = (iso, daysBack) => {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - daysBack)
  return date.toISOString().slice(0, 10)
}

function answer(text, today) {
  const when = text.includes('yesterday') ? day(today, 1) : today
  if (text.includes('simulate down')) return [503, { detail: 'No AI model is configured (set AI_MODEL).' }]
  if (text.includes('simulate busy')) return [429, { detail: 'The AI model is busy. Try again in a minute.' }]
  if (text.includes('simulate garbage')) {
    return [200, { proposals: [{ x: 99, y: 3, made: true, game_date: when, note: '', quote: '' }], questions: [], skipped: [], model: 'e2e-fake' }]
  }
  if (text.includes('vague')) {
    return [200, { proposals: [], questions: ['Where was each shot taken, and did it go in?'], skipped: [], model: 'e2e-fake' }]
  }
  if (text.includes('corner')) {
    return [
      200,
      {
        proposals: [
          { x: 47.5, y: 3, made: true, game_date: when, note: 'caught and shot', quote: 'hit one from the right corner' },
          { x: 17, y: 19, made: false, game_date: when, note: '', quote: 'missed one from the left elbow' },
        ],
        questions: [],
        skipped: ['2 free throws'],
        model: 'e2e-fake',
      },
    ]
  }
  return [200, { proposals: [{ x: 25, y: 7, made: true, game_date: when, note: 'layup', quote: text.slice(0, 100) }], questions: [], skipped: [], model: 'e2e-fake' }]
}

const server = http.createServer((request, response) => {
  const send = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  if (request.method === 'GET' && request.url === '/health') return send(200, { status: 'ok', model: 'e2e-fake' })
  if (request.method === 'POST' && request.url === '/extract') {
    let raw = ''
    request.on('data', (chunk) => (raw += chunk))
    request.on('end', () => {
      try {
        const { text, today } = JSON.parse(raw)
        const [status, body] = answer(String(text), String(today ?? new Date().toISOString().slice(0, 10)))
        send(status, body)
      } catch {
        send(422, { detail: 'bad request' })
      }
    })
    return
  }
  send(404, { detail: 'not found' })
})
// This machine only, like the other throwaway servers.
server.listen(port, '127.0.0.1')
