from xml.etree import ElementTree

import pytest
from fastapi.testclient import TestClient

SVG = "{http://www.w3.org/2000/svg}"


def post(client: TestClient, **fields):
    body = {"player": "Ann", "x": 25, "y": 10, "made": True, **fields}
    assert client.post("/shots", json=body).status_code == 201


def parse(client: TestClient, url: str = "/chart.svg") -> ElementTree.Element:
    response = client.get(url)
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/svg+xml"
    return ElementTree.fromstring(response.text)  # raises if not well-formed XML


def test_empty_chart_is_a_court_without_marks(client: TestClient):
    root = parse(client)
    assert root.findall(f".//{SVG}title") == []
    assert root.find(f"{SVG}rect") is not None  # the court outline


def test_made_is_a_circle_and_missed_is_a_cross(client: TestClient):
    post(client, made=True)
    post(client, made=False, x=2, y=2)
    titles = [t.text for t in parse(client).iter(f"{SVG}title")]
    assert titles == ["Ann: made from paint", "Ann: missed from left_corner_3"]
    root = parse(client)
    # court circles (free throw, hoop) plus exactly one made mark
    assert len(root.findall(f".//{SVG}circle/{SVG}title")) == 1
    assert len(root.findall(f".//{SVG}g/{SVG}line")) == 2  # the two strokes of the X


def test_baseline_is_at_the_bottom(client: TestClient):
    post(client, y=0, x=25)  # on the baseline
    mark = next(c for c in parse(client).iter(f"{SVG}circle") if len(c))
    assert float(mark.attrib["cy"]) == 470.0  # y=0 maps to the bottom edge


def test_player_filter(client: TestClient):
    post(client, player="Ann")
    post(client, player="Bob")
    titles = [
        t.text for t in parse(client, "/chart.svg?player=Bob").iter(f"{SVG}title")
    ]
    assert titles == ["Bob: made from paint"]


@pytest.mark.parametrize("query", ["bob", "BOB", "Bob", "  bOb  "])
def test_player_filter_ignores_case_and_surrounding_spaces(client, query):
    post(client, player="Ann")
    post(client, player="Bob")
    url = f"/chart.svg?player={query}"
    titles = [t.text for t in parse(client, url).iter(f"{SVG}title")]
    assert titles == ["Bob: made from paint"]


def test_player_filter_ignores_case_of_non_ascii_letters(client):
    post(client, player="Élodie")
    titles = [
        t.text for t in parse(client, "/chart.svg?player=éLODIE").iter(f"{SVG}title")
    ]
    assert titles == ["Élodie: made from paint"]


def test_player_filter_still_separates_different_names(client):
    post(client, player="Ann")
    assert list(parse(client, "/chart.svg?player=An").iter(f"{SVG}title")) == []


def test_player_name_is_escaped(client: TestClient):
    post(client, player="<script>&")
    response = client.get("/chart.svg")
    assert "<script>" not in response.text
    ElementTree.fromstring(response.text)  # still well-formed


def test_empty_player_filter_is_rejected(client: TestClient):
    assert client.get("/chart.svg?player=").status_code == 422


def number_attrs(element: ElementTree.Element, *names: str) -> list[float]:
    return [float(element.attrib[name]) for name in names]


def test_court_lines_are_where_the_rules_put_them(client: TestClient):
    # 10 px per foot, baseline at the bottom (y=470), hoop at (25, 5.25) ft.
    root = parse(client)
    # the court is 500 x 470 px, drawn inside a 12 px margin so edge marks fit
    assert number_attrs(root, "width", "height") == [524, 494]
    assert root.attrib["viewBox"] == "-12 -12 524 494"
    outline, lane = root.findall(f"{SVG}rect")
    assert number_attrs(outline, "width", "height") == [500, 470]
    # lane: 16 ft wide, centred, from the baseline up to the free-throw line (19 ft)
    assert number_attrs(lane, "x", "y", "width", "height") == [170, 280, 160, 190]
    free_throw, hoop = root.findall(f"{SVG}circle")
    assert number_attrs(free_throw, "cx", "cy", "r") == [250, 280, 60]
    assert number_attrs(hoop, "cx", "cy", "r") == [250, 417.5, 7.5]
    restricted, three = [p.attrib["d"] for p in root.findall(f"{SVG}path")]
    assert restricted == "M 210.0 417.5 A 40.0 40.0 0 0 1 290.0 417.5"
    # corner lines 22 ft from the hoop's centre line, meeting the 23.75 ft arc at 14 ft
    assert three == (
        "M 30.0 470.0 L 30.0 328.0 A 237.5 237.5 0 0 1 470.0 328.0 L 470.0 470.0"
    )


def test_marks_are_centred_on_the_shot(client: TestClient):
    post(client, x=25, y=10, made=True)
    post(client, x=10, y=20, made=False)
    root = parse(client)
    made = next(c for c in root.iter(f"{SVG}circle") if len(c))
    assert number_attrs(made, "cx", "cy", "r") == [250, 370, 8]
    strokes = list(root.iterfind(f".//{SVG}g/{SVG}line"))
    xs = [float(s.attrib[k]) for s in strokes for k in ("x1", "x2")]
    ys = [float(s.attrib[k]) for s in strokes for k in ("y1", "y2")]
    assert (min(xs) + max(xs)) / 2 == pytest.approx(100)  # x = 10 ft
    assert (min(ys) + max(ys)) / 2 == pytest.approx(270)  # y = 20 ft, flipped
    assert max(xs) - min(xs) == pytest.approx(
        15.8, abs=0.1
    )  # a cross about 1.6 ft wide


@pytest.mark.parametrize(
    ("player", "status"), [("A", 200), ("A" * 50, 200), ("A" * 51, 422)]
)
def test_player_filter_length_limits(client: TestClient, player: str, status: int):
    assert client.get("/chart.svg", params={"player": player}).status_code == status


def test_openapi_documents_the_svg_response(client: TestClient):
    schema = client.get("/openapi.json").json()
    assert (
        "image/svg+xml"
        in schema["paths"]["/chart.svg"]["get"]["responses"]["200"]["content"]
    )
