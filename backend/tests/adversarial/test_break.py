"""Adversarial tests. Each cites the spec sentence it enforces."""

from datetime import date, timedelta
from xml.etree import ElementTree

import pytest
from fastapi.testclient import TestClient

from app.main import app

GOOD = {"player": "Ann", "x": 25, "y": 10, "made": True}


@pytest.fixture
def c(client, engine):
    return TestClient(app, raise_server_exceptions=False)


def post(c, **kw):
    body = {**GOOD, **kw}
    return c.post("/shots", json=body)


def svg_ok(c, url="/chart.svg"):
    r = c.get(url)
    assert r.status_code == 200, r.text
    return ElementTree.fromstring(r.content)


# --- chart: XML/SVG injection (openapi: /chart.svg returns image/svg+xml)
@pytest.mark.parametrize(
    "name",
    ["<script>alert(1)</script>", '"><svg onload=x>', "a&b", "]]>", "&#x0;", "'\"<>&"],
)
def test_chart_escapes_player(c, name):
    assert post(c, player=name).status_code == 201
    root = svg_ok(c)
    titles = [t.text for t in root.iter("{http://www.w3.org/2000/svg}title")]
    assert titles == [f"{name}: made from paint"]
    assert root.find(".//{http://www.w3.org/2000/svg}script") is None


@pytest.mark.parametrize("ch", ["\x00", "\x01", "\x0b", "\x1f", "\x7f", "￾"])
def test_chart_control_chars_in_player_stay_well_formed(c, ch):
    # openapi: image/svg+xml must be parseable XML for any stored shot
    r = post(c, player=f"a{ch}b")
    if r.status_code != 201:
        return  # rejecting at input is also fine
    resp = c.get("/chart.svg")
    assert resp.status_code == 200
    ElementTree.fromstring(resp.content)


def test_chart_lone_surrogate_player(c):
    # JSON allows \ud800; API must answer 201/422, never 500
    r = c.post(
        "/shots",
        content='{"player":"\\ud800","x":1,"y":1,"made":true}',
        headers={"content-type": "application/json"},
    )
    assert r.status_code in (201, 422)


def test_chart_unicode_and_emoji(c):
    post(c, player="יולי 🏀")
    root = svg_ok(c)
    assert "יולי 🏀: made from paint" in [
        t.text for t in root.iter("{http://www.w3.org/2000/svg}title")
    ]


# --- chart filter (openapi: player min 1 max 50)
@pytest.mark.parametrize("q", ["", "x" * 51])
def test_chart_player_bounds_422(c, q):
    assert c.get("/chart.svg", params={"player": q}).status_code == 422


def test_chart_player_50_ok(c):
    assert c.get("/chart.svg", params={"player": "x" * 50}).status_code == 200


def test_chart_repeated_player_param(c):
    post(c, player="A")
    post(c, player="B")
    r = c.get("/chart.svg?player=A&player=B")
    assert r.status_code == 200


def test_chart_sql_like_wildcards_are_literal(c):
    post(c, player="Ann")
    post(c, player="Bob")
    root = svg_ok(c, "/chart.svg?player=%25")
    assert list(root.iter("{http://www.w3.org/2000/svg}title")) == []
    root = svg_ok(c, "/chart.svg?player=' OR '1'='1")
    assert list(root.iter("{http://www.w3.org/2000/svg}title")) == []


def test_chart_filter_matches_stored_stripped_name(c):
    # README: player text; input is stripped, so "  Ann " is stored "Ann"
    post(c, player="  Ann  ")
    assert (
        len(
            list(
                svg_ok(c, "/chart.svg?player=Ann").iter(
                    "{http://www.w3.org/2000/svg}title"
                )
            )
        )
        == 1
    )


def test_chart_extremes_inside_viewbox(c):
    # README: x 0-50, y 0-47 are valid, marks must be on the drawing
    for x, y in [(0, 0), (50, 47), (0, 47), (50, 0)]:
        post(c, x=x, y=y, made=False)
    root = svg_ok(c)
    left, top, width, height = (float(v) for v in root.attrib["viewBox"].split())
    for ln in root.iter("{http://www.w3.org/2000/svg}line"):
        for k in ("x1", "x2"):
            assert left <= float(ln.attrib[k]) <= left + width, "cross is clipped"
        for k in ("y1", "y2"):
            assert top <= float(ln.attrib[k]) <= top + height, "cross is clipped"


def test_chart_post_method_not_allowed(c):
    assert c.post("/chart.svg").status_code == 405


def test_chart_many_shots(c):
    for i in range(150):
        post(c, x=i % 50, y=i % 47)
    root = svg_ok(c)
    assert len(list(root.iter("{http://www.w3.org/2000/svg}title"))) == 150


# --- shots validation
@pytest.mark.parametrize(
    "field,val",
    [
        ("x", -0.0001),
        ("x", 50.0001),
        ("y", -0.0001),
        ("y", 47.0001),
        ("x", 1e308),
        ("y", -1e308),
        ("x", "NaN"),
        ("x", "inf"),
        ("x", None),
        ("made", "maybe"),
        ("made", 2),
        ("made", None),
        ("player", ""),
        ("player", "   "),
        ("player", " "),
        ("player", "　"),
        ("player", "x" * 51),
        ("player", 5),
        ("player", None),
        ("player", ["a"]),
        ("note", "x" * 201),
        ("note", 5),
        ("game_date", "2999-01-01"),
        ("game_date", "not-a-date"),
        ("game_date", 20250101),
        ("game_date", "2026-13-01"),
        ("game_date", None),
        ("zone", "paint"),
        ("shot_type", "2PT"),
        ("id", 5),
        ("extra", 1),
    ],
)
def test_post_rejects(c, field, val):
    # README data sketch limits; zone/shot_type/id "never sent by a client"
    r = post(c, **{field: val})
    assert r.status_code == 422, (field, val, r.status_code, r.text)


@pytest.mark.parametrize(
    "field,val",
    [
        ("x", 0),
        ("x", 50),
        ("y", 0),
        ("y", 47),
        ("player", "x" * 50),
        ("player", "é"),
        ("note", "x" * 200),
        ("note", ""),
        ("note", "   "),
        ("game_date", (date.today() + timedelta(days=1)).isoformat()),
        ("game_date", "1900-01-01"),
    ],
)
def test_post_accepts_boundaries(c, field, val):
    assert post(c, **{field: val}).status_code == 201


def test_game_date_two_days_ahead_rejected(c):
    assert (
        post(c, game_date=(date.today() + timedelta(days=2)).isoformat()).status_code
        == 422
    )


def test_raw_nan_infinity_json(c):
    for lit in ("NaN", "Infinity", "-Infinity"):
        r = c.post(
            "/shots",
            content=f'{{"player":"a","x":{lit},"y":1,"made":true}}',
            headers={"content-type": "application/json"},
        )
        assert r.status_code == 422, (lit, r.status_code)


def test_huge_int_and_big_exponent(c):
    for v in ("1" + "0" * 400, "1e999"):
        r = c.post(
            "/shots",
            content=f'{{"player":"a","x":{v},"y":1,"made":true}}',
            headers={"content-type": "application/json"},
        )
        assert r.status_code == 422, (v, r.status_code)


def test_post_non_object_bodies(c):
    for body in ("[]", "null", '"s"', "{", ""):
        r = c.post("/shots", content=body, headers={"content-type": "application/json"})
        assert r.status_code == 422, (body, r.status_code)


def test_created_shot_roundtrip_and_computed(c):
    r = post(c, x=2, y=2, made=False, player="  Ann  ").json()
    assert (
        r["player"] == "Ann"
        and r["zone"] == "left_corner_3"
        and r["shot_type"] == "3PT"
    )
    assert c.get(f"/shots/{r['id']}").json() == r


def test_default_game_date_today(c):
    assert post(c).json()["game_date"] == date.today().isoformat()


# --- ids
@pytest.mark.parametrize(
    "sid", ["0", "-1", "99999999999999999999", "1.5", "abc", "-99999999999999999999"]
)
@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_bad_ids(c, sid, method):
    # README: 404 for missing, 422 for invalid type; never 500
    kw = {"json": {"x": 1}} if method == "patch" else {}
    r = getattr(c, method)(f"/shots/{sid}", **kw)
    assert r.status_code in (404, 422), (method, sid, r.status_code)


def test_ids_not_reused_after_delete(c):
    a = post(c).json()["id"]
    assert c.delete(f"/shots/{a}").status_code == 204
    assert post(c).json()["id"] != a


def test_delete_twice(c):
    a = post(c).json()["id"]
    assert c.delete(f"/shots/{a}").status_code == 204
    assert c.delete(f"/shots/{a}").status_code == 404
    assert c.get(f"/shots/{a}").status_code == 404


# --- list paging
@pytest.mark.parametrize(
    "q,code",
    [
        ("limit=0", 422),
        ("limit=101", 422),
        ("limit=100", 200),
        ("limit=1", 200),
        ("offset=-1", 422),
        ("offset=99999999999999999999", None),
        ("limit=abc", 422),
        ("limit=-5", 422),
        ("offset=1.5", 422),
    ],
)
def test_paging(c, q, code):
    r = c.get(f"/shots?{q}")
    if code is None:
        assert r.status_code in (200, 422), r.status_code
    else:
        assert r.status_code == code


def test_paging_slices(c):
    for i in range(5):
        post(c, note=str(i))
    notes = [s["note"] for s in c.get("/shots?offset=1&limit=2").json()]
    assert notes == ["1", "2"]
    assert c.get("/shots?offset=5").json() == []


# --- PATCH
def test_patch_null_unchanged(c):
    sid = post(c, note="keep").json()["id"]
    r = c.patch(
        f"/shots/{sid}", json={"note": None, "x": None, "made": None, "player": None}
    )
    assert r.status_code == 200 and r.json()["note"] == "keep" and r.json()["x"] == 25


def test_patch_empty_body(c):
    sid = post(c).json()["id"]
    assert c.patch(f"/shots/{sid}", json={}).status_code == 200


def test_patch_false_and_zero_are_applied(c):
    sid = post(c, made=True, x=10, y=10).json()["id"]
    r = c.patch(
        f"/shots/{sid}", json={"made": False, "x": 0, "y": 0, "note": ""}
    ).json()
    assert r["made"] is False and r["x"] == 0 and r["y"] == 0


def test_patch_recomputes_zone(c):
    sid = post(c, x=25, y=10).json()["id"]
    r = c.patch(f"/shots/{sid}", json={"x": 1, "y": 1}).json()
    assert r["zone"] == "left_corner_3" and r["shot_type"] == "3PT"


@pytest.mark.parametrize(
    "body",
    [
        {"zone": "paint"},
        {"shot_type": "3PT"},
        {"id": 9},
        {"x": 51},
        {"x": "NaN"},
        {"player": "  "},
        {"player": ""},
        {"game_date": "2999-01-01"},
        {"note": "x" * 201},
        {"made": "maybe"},
    ],
)
def test_patch_rejects(c, body):
    sid = post(c).json()["id"]
    assert c.patch(f"/shots/{sid}", json=body).status_code == 422


def test_patch_invalid_missing_id_is_422_not_404(c):
    # README table row 4
    assert c.patch("/shots/999", json={"x": 51}).status_code == 422


def test_patch_failed_does_not_change(c):
    sid = post(c).json()["id"]
    c.patch(f"/shots/{sid}", json={"x": 3, "y": 99})
    assert c.get(f"/shots/{sid}").json()["x"] == 25


def test_patch_future_date_boundary(c):
    sid = post(c).json()["id"]
    ok = (date.today() + timedelta(days=1)).isoformat()
    assert c.patch(f"/shots/{sid}", json={"game_date": ok}).status_code == 200


def test_chart_reflects_patch_and_delete(c):
    sid = post(c, made=True).json()["id"]
    c.patch(f"/shots/{sid}", json={"made": False})
    t = [x.text for x in svg_ok(c).iter("{http://www.w3.org/2000/svg}title")]
    assert t == ["Ann: missed from paint"]
    c.delete(f"/shots/{sid}")
    assert list(svg_ok(c).iter("{http://www.w3.org/2000/svg}title")) == []


def test_unknown_routes_and_methods(c):
    assert c.get("/chart").status_code == 404
    assert c.put("/shots/1", json=GOOD).status_code == 405
    assert c.post("/shots/1").status_code == 405
    assert c.get("/shots/").status_code in (200, 307, 404)


def test_lax_coercion_is_accepted_for_now(c):
    # SPEC UNCLEAR, decided: README says float/bool but does not say "strictly".
    # Pydantic's default accepts "1.5", true and "yes". Recorded so changing it is a
    # conscious decision (it would reject clients that send numbers as strings).
    assert post(c, x="1.5").status_code == 201
    assert post(c, x=True).status_code == 201
    assert post(c, made="yes").status_code == 201
