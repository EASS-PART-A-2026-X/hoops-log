"""The saved conversation with Deni: /chat/history and the saving inside POST /chat."""

import json

import httpx
from sqlmodel import func, select

from app.models import ChatLine
from app.routers.history import KEEP_LINES

REPLY = {"reply": "Got it.", "proposals": [], "model": "m"}


def say(client, fake_ai, text, player="Yuly", reply="Got it."):
    fake_ai(lambda request: httpx.Response(200, json={**REPLY, "reply": reply}))
    body = {"messages": [{"role": "user", "text": text}]}
    if player is not None:
        body["player"] = player
    return client.post("/chat", json=body)


def rows_in_table(session):
    return session.exec(select(func.count()).select_from(ChatLine)).one()


def lines(client, player="Yuly"):
    response = client.get("/chat/history", params={"player": player})
    assert response.status_code == 200
    return response.json()["lines"]


def test_a_new_player_has_no_history(client):
    assert lines(client) == []


def test_a_chat_with_a_player_is_saved_as_the_message_then_the_reply(client, fake_ai):
    assert say(client, fake_ai, "hit one", reply="Nice one.").status_code == 200
    assert lines(client) == [
        {"role": "user", "text": "hit one"},
        {"role": "deni", "text": "Nice one."},
    ]


def test_the_history_is_oldest_first_across_messages(client, fake_ai):
    say(client, fake_ai, "one", reply="r1")
    say(client, fake_ai, "two", reply="r2")
    assert [line["text"] for line in lines(client)] == ["one", "r1", "two", "r2"]


def test_without_a_player_nothing_is_saved(client, fake_ai):
    assert say(client, fake_ai, "hit one", player=None).status_code == 200
    assert lines(client) == []


def test_the_player_is_never_sent_to_the_ai_service(client, fake_ai):
    seen = fake_ai(lambda request: httpx.Response(200, json=REPLY))
    client.post(
        "/chat", json={"messages": [{"role": "user", "text": "hi"}], "player": "Yuly"}
    )
    assert "player" not in json.loads(seen[0].content)


def test_the_text_saved_is_the_trimmed_message(client, fake_ai):
    say(client, fake_ai, "  hit one  ")
    assert lines(client)[0]["text"] == "hit one"


def test_capitals_do_not_make_another_player(client, fake_ai):
    say(client, fake_ai, "one", player="Yuly")
    say(client, fake_ai, "two", player="yULY")
    assert len(lines(client, "YULY")) == 4
    assert len(lines(client, "  yuly ")) == 4  # a space around the name does not matter


def test_players_do_not_see_each_others_conversations(client, fake_ai):
    say(client, fake_ai, "mine", player="Yuly")
    say(client, fake_ai, "yours", player="Noam")
    assert lines(client, "Noam")[0]["text"] == "yours"
    assert len(lines(client, "Noam")) == 2


def test_hebrew_names_work(client, fake_ai):
    say(client, fake_ai, "קלעתי", player="דני")
    assert lines(client, "דני")[0]["text"] == "קלעתי"


def test_a_failed_chat_saves_nothing(client, fake_ai):
    fake_ai(lambda request: httpx.Response(503, json={"detail": "no model"}))
    response = client.post(
        "/chat", json={"messages": [{"role": "user", "text": "hi"}], "player": "Yuly"}
    )
    assert response.status_code == 503
    assert lines(client) == []


def test_a_reply_that_breaks_the_rules_saves_nothing(client, fake_ai):
    bad = {
        **REPLY,
        "proposals": [{"x": 99, "y": 3, "made": True, "game_date": "2026-11-19"}],
    }
    fake_ai(lambda request: httpx.Response(200, json=bad))
    response = client.post(
        "/chat", json={"messages": [{"role": "user", "text": "hi"}], "player": "Yuly"}
    )
    assert response.status_code == 502
    assert lines(client) == []


def test_start_over_forgets_only_that_player(client, fake_ai):
    say(client, fake_ai, "mine", player="Yuly")
    say(client, fake_ai, "yours", player="Noam")
    assert client.delete("/chat/history", params={"player": "YULY"}).status_code == 204
    assert lines(client, "Yuly") == []
    assert len(lines(client, "Noam")) == 2


def test_start_over_on_an_empty_history_is_fine(client):
    assert (
        client.delete("/chat/history", params={"player": "Nobody"}).status_code == 204
    )


def test_after_start_over_a_new_conversation_begins(client, fake_ai):
    say(client, fake_ai, "old")
    client.delete("/chat/history", params={"player": "Yuly"})
    say(client, fake_ai, "new")
    assert [line["text"] for line in lines(client)] == ["new", "Got it."]


def test_only_the_newest_lines_are_kept(client, fake_ai, monkeypatch, session):
    monkeypatch.setenv("AI_RATE_LIMIT", "1000")
    for n in range(KEEP_LINES):  # two lines each, so far more than the limit
        say(client, fake_ai, f"m{n}", reply=f"r{n}")
    saved = lines(client)
    # The table itself is trimmed, not only what the endpoint shows.
    assert rows_in_table(session) == KEEP_LINES
    assert len(saved) == KEEP_LINES
    assert saved[-2:] == [
        {"role": "user", "text": f"m{KEEP_LINES - 1}"},
        {"role": "deni", "text": f"r{KEEP_LINES - 1}"},
    ]
    assert saved[0]["text"] == f"m{KEEP_LINES // 2}"  # the oldest ones were dropped


def test_trimming_one_player_does_not_touch_another(
    client, fake_ai, monkeypatch, session
):
    monkeypatch.setenv("AI_RATE_LIMIT", "1000")
    say(client, fake_ai, "keep me", player="Noam")
    for n in range(KEEP_LINES):
        say(client, fake_ai, f"m{n}", reply=f"r{n}")
    assert [line["text"] for line in lines(client, "Noam")] == ["keep me", "Got it."]
    assert rows_in_table(session) == KEEP_LINES + 2


def test_a_one_letter_player_is_fine(client, fake_ai):
    assert say(client, fake_ai, "hi", player="x").status_code == 200
    assert len(lines(client, "x")) == 2
    assert client.delete("/chat/history", params={"player": "x"}).status_code == 204


def test_the_player_is_required_and_limited(client):
    assert client.get("/chat/history").status_code == 422
    assert client.get("/chat/history", params={"player": ""}).status_code == 422
    assert client.get("/chat/history", params={"player": "x" * 51}).status_code == 422
    assert client.delete("/chat/history").status_code == 422


def test_the_rate_limit_still_applies_to_saved_chats(client, fake_ai):
    from app.ai import DEFAULT_RATE_LIMIT

    for _ in range(DEFAULT_RATE_LIMIT):
        assert say(client, fake_ai, "hi").status_code == 200
    assert say(client, fake_ai, "hi").status_code == 429
    assert len(lines(client)) == DEFAULT_RATE_LIMIT * 2  # the refused one is not saved


def test_a_failing_database_does_not_lose_the_reply(client, fake_ai, monkeypatch):
    def broken(session, player, lines):
        raise RuntimeError("disk full")

    monkeypatch.setattr("app.routers.chat.remember", broken)
    response = say(client, fake_ai, "hit one", reply="Nice one.")
    assert response.status_code == 200
    assert response.json()["reply"] == "Nice one."
    assert lines(client) == []


def test_start_over_while_a_chat_is_on_its_way_means_that_chat_is_not_saved(
    client, fake_ai
):
    def answer_after_start_over(request):
        # The player presses Start over while the AI is still thinking.
        assert (
            client.delete("/chat/history", params={"player": "Yuly"}).status_code == 204
        )
        return httpx.Response(200, json=REPLY)

    fake_ai(answer_after_start_over)
    body = {"messages": [{"role": "user", "text": "hi"}], "player": "Yuly"}
    assert (
        client.post("/chat", json=body).status_code == 200
    )  # the player still gets it
    assert lines(client) == []  # but the erased conversation did not come back


def test_start_over_for_one_player_does_not_stop_another_players_chat_saving(
    client, fake_ai
):
    def answer_after_start_over(request):
        client.delete("/chat/history", params={"player": "Noam"})
        return httpx.Response(200, json=REPLY)

    fake_ai(answer_after_start_over)
    body = {"messages": [{"role": "user", "text": "hi"}], "player": "Yuly"}
    client.post("/chat", json=body)
    assert len(lines(client)) == 2


def test_a_chat_after_start_over_is_saved_again(client, fake_ai):
    client.delete("/chat/history", params={"player": "Yuly"})
    say(client, fake_ai, "fresh")
    assert [line["text"] for line in lines(client)] == ["fresh", "Got it."]


def test_a_name_of_only_spaces_or_control_characters_is_refused_everywhere(
    client, fake_ai
):
    for bad in ["   ", "\t", "bell\x07"]:
        assert client.get("/chat/history", params={"player": bad}).status_code == 422
        assert client.delete("/chat/history", params={"player": bad}).status_code == 422
        body = {"messages": [{"role": "user", "text": "hi"}], "player": bad}
        assert client.post("/chat", json=body).status_code == 422


def test_the_name_is_saved_trimmed(client, fake_ai):
    say(client, fake_ai, "hi", player="  Yuly  ")
    assert len(lines(client, "Yuly")) == 2
