// A stand-in for the AI service (ai-service/), for the e2e tests only: no model, no key, no network.
// The throwaway backend is pointed at it (AI_SERVICE_URL), so the tests exercise the real chain
// browser -> frontend -> backend -> HTTP call to "the AI service", with answers that never change.
//
// What it answers depends on a word in the player's LAST message, so each test can pick the situation it needs.
// The FIRST word found in this order wins (so a message with "vague" and "corner" is the vague one):
//   1. "simulate down"     503 (the AI service has no model)
//   2. "simulate busy"     429 (provider quota)
//   3. "simulate garbage"  200 but an answer that breaks the rules
//   4. "how am i"          a reply that repeats the numbers the app sent, proving they arrived
//   5. "context"           a reply that says how many messages of the conversation it was sent
//   6. "vague"             a question, no shots
//   7. "corner"            two shots
//   8. anything else       one layup at the rim
// "yesterday" in the message makes the shots yesterday's, counted from the `today` the backend sends.
import http from 'node:http'

const port = Number(process.env.E2E_AI_PORT ?? 8012)

const day = (iso, daysBack) => {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - daysBack)
  return date.toISOString().slice(0, 10)
}

function answer({ messages, stats }, today) {
  const text = String(messages.at(-1).text).toLowerCase()
  const when = text.includes('yesterday') ? day(today, 1) : today
  const reply = (words, proposals = []) => [200, { reply: words, proposals, model: 'e2e-fake' }]
  if (text.includes('simulate down')) return [503, { detail: 'No AI model is configured (set AI_MODEL).' }]
  if (text.includes('simulate busy')) return [429, { detail: 'The AI model is busy. Try again in a minute.' }]
  if (text.includes('simulate garbage')) {
    return reply('Here you go.', [{ x: 99, y: 3, made: true, game_date: when, note: '', quote: '' }])
  }
  if (text.includes('how am i')) {
    return reply(stats ? `You have made ${stats.made} of ${stats.attempts} for ${stats.player}.` : 'I have no numbers yet.')
  }
  if (text.includes('context')) return reply(`I can see ${messages.length} messages.`)
  if (text.includes('vague')) return reply('Where was each shot taken, and did it go in?')
  if (text.includes('corner')) {
    return reply('Got it: a made three from the right corner and a missed elbow shot. Tap Save to log them.', [
      { x: 47.5, y: 3, made: true, game_date: when, note: 'caught and shot', quote: 'hit one from the right corner' },
      { x: 17, y: 19, made: false, game_date: when, note: '', quote: 'missed one from the left elbow' },
    ])
  }
  return reply('Got it: a layup at the rim. Tap Save to log it.', [
    { x: 25, y: 7, made: true, game_date: when, note: 'layup', quote: String(messages.at(-1).text).slice(0, 100) },
  ])
}

const server = http.createServer((request, response) => {
  const send = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  if (request.method === 'GET' && request.url === '/health') return send(200, { status: 'ok', model: 'e2e-fake' })
  if (request.method === 'POST' && request.url === '/chat') {
    let raw = ''
    request.on('data', (chunk) => (raw += chunk))
    request.on('end', () => {
      try {
        const body = JSON.parse(raw)
        const [status, payload] = answer(body, String(body.today ?? new Date().toISOString().slice(0, 10)))
        send(status, payload)
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
