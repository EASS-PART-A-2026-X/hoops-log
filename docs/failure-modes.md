# How the AI path fails, and what happens

One rule runs through all of this: **shots must keep working when the AI does not.** The AI
service is optional for the product. Every failure below ends in a plain sentence for the
player and, for shots, the manual form.

The path of one chat message: `browser -> backend (POST /chat) -> ai-service (POST /chat) -> model`.

## Who retries what

| Layer | Retries? | Why |
|---|---|---|
| The model provider's client | **No** (`max_retries=0`) | A hidden retry inside the client caused unexplained 12-30 s waits. Any waiting is done by our own code, below, where it is logged and bounded. |
| Pydantic AI, when the model's output breaks the contract | **Yes, up to 2 times** (`retries=2`), inside one request | The model gets the validation error and repairs its answer. Bounded by the usage limit below. |
| The AI service, when the provider's rate limit says how long to wait | **Yes, once**, after waiting what the provider says (at most 15 s, plus half a second) | The free tier allows 8,000 tokens a minute (a message costs about 1,500-1,900), and the provider's own answer is usually "try again in 2-11 s". A longer wait (a daily quota says minutes or hours), or a second rate limit, is a 429. The wait is logged, and it is inside the 60 s deadline. |
| The backend | **No** | `POST /chat` is not safe to repeat: with a `player` it saves the exchange, so a retry after a lost reply could save it twice, and every call spends the shared 10-per-minute budget. |
| The browser | **No** | The player presses send again when they choose to. |

So there is exactly one retrying layer, the AI service, and it only repeats work that stores nothing: the model's output repair, and one wait-and-ask-again on a short rate limit.

## Time budget

Each layer waits longer than the one inside it, so the inner layer speaks first and says what
happened:

`30 s` one call to the model < `60 s` the whole request in the AI service, which includes a possible rate-limit wait of up to 15.5 s and the second call (answers 504) < `70 s` the
backend's read timeout < `90 s` the browser waits. The backend's 70 s is a timeout *per read*, not a
hard cap on the whole call: a server that trickled bytes could outlast it. Our own AI service
never does, because its 60 s deadline covers the whole request.

## The failures

| # | What goes wrong | Noticed by | Answer to the player | Proved by |
|---|---|---|---|---|
| 1 | AI service stopped or unreachable | backend (connect error or connect timeout) | **503** "not available right now. You can still add shots by hand." | backend `test_network_trouble_becomes_a_plain_sentence`; **real socket** `test_nothing_listening_is_a_503`; **real stack** `compose_check.py` "AI service stopped" |
| 2 | AI service accepts the call, then never answers | backend read timeout | **504** "took too long" | **real socket** `test_a_server_that_never_answers_is_a_quick_504`; ai-service `test_a_request_that_takes_too_long_is_a_504_and_the_model_is_cut_off` |
| 3 | While the AI service hangs, nothing else stalls | one event loop in the backend | shots still save and list while the chat call is still waiting | **real server** `test_while_the_ai_service_hangs_plain_shot_logging_still_answers` |
| 4 | AI service hangs up, or sends something that is not HTTP | backend | **502** "could not give a usable answer" | **real socket** `test_a_server_that_hangs_up_is_a_502`, `test_a_server_that_does_not_speak_http_is_a_502` |
| 5 | The model provider says "too many requests" or "quota used" | ai-service | a short wait (up to 15 s) is waited out once and asked again; otherwise **429** "busy: the free AI model has a usage limit, try again in a minute" | ai-service `tests/test_rate_limit_wait.py` (waits once; never longer than 15 s; a second limit, a used-up quota, an unparsable message and other errors are not retried; a wait past the deadline is a 504); `test_rate_limit_and_quota_are_429` (the mapping); `test_a_rate_limit_fails_fast_instead_of_being_retried_quietly` checks the `max_retries=0` setting. None of them calls a real provider |
| 6 | Too many chat requests (10 a minute, everybody together) | backend | **429** "wait a minute"; the AI service is not called | backend `test_the_eleventh_request_in_a_minute_is_refused_without_calling_the_ai` |
| 7 | AI service runs, but the model is set up wrong (no key, unknown provider) | ai-service | **503** "not available". The chat shows that sentence; the manual form does **not** appear by itself, because `/health` only says a model name is set, so `/chat/status` still reports available (see Known limits) | ai-service `test_a_missing_provider_key_is_503`, `test_an_unknown_provider_is_503_too`; **real stack** `compose_check.py` "broken model setting" (the service is up, yet `/chat` is 503) |
| 8 | No model configured at all | ai-service | **503**; `/chat/status` says not available, so the manual form shows | ai-service `test_chat_without_a_configured_model_is_503` |
| 9 | The model's answer breaks the contract | ai-service validation | repaired up to 2 times, then **502** | ai-service `test_an_answer_that_breaks_the_rules_is_sent_back_and_repaired`, `test_an_answer_that_never_fits_is_502` |
| 10 | The model loops (tools, tokens) | usage limit: 6 model calls, 20,000 tokens | **502** | ai-service `test_every_request_is_run_with_the_usage_limit`, `test_a_model_that_keeps_calling_a_tool_that_does_not_exist_is_cut_off` |
| 11 | A model call alone is too slow | 30 s per call (a provider client setting) | **504** | ai-service `test_a_model_timeout_is_504` (the mapping); `test_one_model_call_is_cut_before_the_whole_request_is` only checks that 30 s < 60 s. A real 30 s cut is not exercised: tests never call a provider |
| 12 | The AI service's answer breaks the backend's own rules, or is huge (over 200 KB) | backend re-validates everything | **502**, nothing stored | backend `test_an_answer_that_breaks_the_backends_rules_is_refused`, the size-cap tests |
| 13 | Wrong or missing service token | ai-service answers 401 | **502**, no word about tokens | backend `test_the_ai_services_errors_are_translated_and_never_leaked`; **real socket** `test_a_wrong_service_token_is_a_502_that_says_nothing_about_it` |
| 14 | A bug nobody planned for in the AI service | ai-service catch-all | plain **500**, which the backend turns into **502** | ai-service `test_an_unplanned_error_is_a_plain_500_that_leaks_nothing` |
| 15 | The player's request is invalid | backend validation | **422**; does not use up the minute | backend `test_bad_requests_are_422_and_never_reach_the_ai_service`, `test_requests_that_fail_validation_do_not_use_up_the_minute` |
| 16 | The browser cannot reach the backend, or waits 90 s | browser | "cannot be reached" / "took too long" | frontend `api.chat.test.ts`, `App.chat.test.tsx` |

Every failure body is checked for leaks: no key, stack trace or provider message reaches the player.

## Recovery

- Stop the AI service, then start it again: the backend notices within 15 s
  (`/chat/status` is remembered for 15 s at most). `compose_check.py` does exactly this.
- Break the model setting, then fix it: `compose_check.py` does this too.
- Nothing needs a restart of the backend or a clean-up of data: the AI service has no state.

## Known limits

- **A broken model setting does not switch the app to the manual form.** `/health` reports the
  configured model name, not whether it works, so `/chat/status` says available and the
  player meets the 503 sentence in the chat instead. Telling the two apart would need a real
  call to the provider on every status check (or a cached trial call), which spends quota.

- **Giving up does not cancel the work.** If the browser's Cancel (or a closed tab) ends the
  request, the backend and the AI service may still finish the call and spend one of the 10
  requests in the minute. The AI service's own 60 s deadline is what stops a runaway.
- **A real provider failing for real** (an actual 429 from Groq, say) is not automated:
  automated tests never call a real model. The mapping is proved with the library's own
  error types, and the real-model evaluation run records what was seen.
- **The shared rate limit** lets one heavy user use up the minute for everybody. This is on
  purpose, to protect the model's small free quota.
