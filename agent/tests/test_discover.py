"""Offline tests for the Brave-backed Discover feed. Fixtures mirror shapes verified live 2026-09-25."""
import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI

from agent.api.core import brave_search as bs
from agent.api.endpoints.discover import router

NEWS = {"type": "news_result", "title": "Honda unveiled an e-MTB", "url": "https://electrek.co/2026/09/22/honda",
        "description": "Honda is best known for motorcycles", "age": "3 days ago", "page_age": "2026-09-22T13:02:13",
        "profile": {"name": "Electrek", "url": "https://electrek.co/2026/09/22/honda"},
        "meta_url": {"hostname": "electrek.co", "favicon": "https://imgs.search.brave.com/fav"},
        "thumbnail": {"src": "https://imgs.search.brave.com/thumb"}}
VIDEO = {"type": "video_result", "url": "https://www.youtube.com/watch?v=T5-2oqy0vSg", "title": "Best Ebikes",
         "description": "Review", "age": "November 22, 2025", "page_age": "2025-11-22T16:27:59",
         "video": {"duration": "16:19", "creator": "TailHappyTV", "publisher": "YouTube", "author": {"name": "TailHappyTV"}},
         "meta_url": {"hostname": "www.youtube.com", "favicon": "https://imgs.search.brave.com/yt"},
         "thumbnail": {"src": "https://imgs.search.brave.com/v", "original": "https://i.ytimg.com/vi/T5-2oqy0vSg/maxresdefault.jpg"}}
IMAGE = {"type": "image_result", "title": "EB3s Electric Bike", "url": "https://www.amazon.com/electric-bike", "source": "amazon.com",
         "page_fetched": "2026-09-25T01:44:25Z", "thumbnail": {"src": "https://imgs.search.brave.com/i", "width": 500, "height": 500},
         "properties": {"url": "https://m.media-amazon.com/images/I/71X.jpg", "width": 1600, "height": 1600},
         "meta_url": {"hostname": "www.amazon.com"}, "confidence": "high"}
PLACE = {"type": "location_result", "id": "loc4L3ZOIP2J4NBEBV5CAVUFXGS6YB7UYKQKAAAAAAA=", "title": "Mike's Bikes of San Francisco",
         "url": "https://mikesbikes.com/pages/san-francisco", "coordinates": [37.7756729, -122.4116], "zoom_level": 7,
         "thumbnail": {"src": "https://imgs.search.brave.com/p", "original": "https://yelp/l.jpg"},
         "postal_address": {"type": "PostalAddress", "displayAddress": "1233 Howard St, San Francisco, CA 94103"},
         "opening_hours": {"current_day": [{"abbr_name": "Fri", "opens": "10:00", "closes": "18:00"}], "days": []},
         "contact": {"telephone": "+14152412453"}, "rating": {"ratingValue": 4.5, "reviewCount": 321}, "profiles": [],
         "pictures": {"results": [{"src": "https://pic/1"}, {"src": "https://pic/2"}]}, "categories": ["Bike Shop"]}
WEB = {"type": "search_result", "title": "Lectric eBikes", "url": "https://lectricebikes.com/", "description": "Discover",
       "profile": {"name": "Lectric eBikes", "img": "https://imgs.search.brave.com/l"}, "page_age": "2026-01-01T00:00:00"}
DISCUSSION = {"type": "discussion", "title": "Which ebike?", "url": "https://www.reddit.com/r/ebikes/1", "description": "asking",
              "data": {"forum_name": "reddit", "num_answers": 42, "score": "120", "question": "Which ebike?", "top_comment": "Lectric"}}
NOT_IN_PLAN = {"type": "ErrorResponse", "error": {"status": 400, "detail": "The option is not included in the plan.",
                                                  "meta": {"component": "authentication"}, "code": "OPTION_NOT_IN_PLAN"}}
# Rich fixtures: trimmed copies of live /web/rich payloads (Search plan, 2026-09-25).
RICH_KEYS = {"weather in london": "wkey", "AAPL stock": "skey", "lakers game": "lkey", "100 usd to eur": "ckey"}
RICH_WEATHER = {"type": "rich", "subtype": "weather", "provider": {"type": "external", "name": "OpenWeatherMap", "url": "https://openweathermap.org/"},
                "weather": {"location": {"name": "London", "country": "GB", "state": "", "coords": {"lat": 51.508, "lon": -0.128}},
                            "current_time_iso": "2026-09-25T12:42:52",
                            "current_weather": {"ts": 1790334857, "temp": 20.52, "feels_like": 20.56, "humidity": 74, "wind": {"speed": 0.9, "deg": 210},
                                                "weather": {"id": 800, "main": "clear", "description": "clear sky", "icon": "01d"}},
                            "daily": [{"ts": 1790334000 + i * 86400, "date_i18n": f"Day {i}", "temperature": {"min": 12.7 + i, "max": 22.5 + i},
                                       "weather": {"description": "clear sky", "icon": "01d"}, "pop": 0.1 * i} for i in range(8)],
                            "hours3": [], "alerts": []}}
RICH_STOCK = {"type": "rich", "subtype": "stocks", "provider": {"type": "external", "name": "FMP", "url": "https://financialmodelingprep.com/"},
              "stock": {"asset_info": {"symbol": "AAPL", "name": "apple inc", "exchange": "NASDAQ", "currency": "USD"}, "time_range": "1d",
                        "quote": {"symbol": "AAPL", "company_name": "Apple Inc.", "primary_exchange": "NASDAQ", "market_cap": 4933776627520,
                                  "pe_ratio": 38.34, "week_52_high": 345.34, "week_52_low": 243.42, "latest_price": 335.92, "open": 336.32,
                                  "close": 337.02, "high": 338.91, "low": 334.3, "change": -1.1, "change_percent": -0.32639, "volume": 24364559,
                                  "latest_update": 1790280001000, "currency": "USD"},
                        "timeseries": {"time_range": "1d", "timeseries": [{"timestamp": 1790256600 + i * 300, "close": 336.0 + i * 0.01} for i in range(78)]},
                        "exchange_info": {"timezone": "America/New_York", "open_time": "09:30 AM -04:00", "close_time": "04:00 PM -04:00"}}}
RICH_CURRENCY = {"type": "rich", "subtype": "currency", "provider": {"type": "external", "name": "Fixer", "url": "https://fixer.io/"},
                 "currency": {"conversion": {"query": {"from_currency": {"full_name": "United States Dollar", "code": "USD"},
                                                       "to_currency": {"full_name": "Euro", "code": "EUR"}, "amount": 100.0},
                                             "info": {"rate": 0.87691}, "date": "2026-09-25", "result": 87.691, "amount": 100.0},
                              "timeseries": {"time_range": "1m", "ts_exchange_rate": [["2026-08-26", 0.858], ["2026-09-25", 0.877]]}}}
RICH_SPORTS = {"type": "rich", "subtype": "sports", "provider": {"type": "external", "name": "API-Sports", "url": "https://api-sports.io/"},
               "basketball": {"sport": "basketball", "type": "team", "view": "games",
                              "content": {"type": "team_games", "league": {"id": 12, "name": "NBA", "logo": "https://l/nba", "season": "2026-2027"},
                                          "team": {"id": 145, "name": "Los Angeles Lakers", "logo": "https://l/lal"},
                                          "games": [{"id": 1, "teams": {"home": {"name": "Sacramento Kings", "logo": "https://l/sac"}, "away": {"name": "Los Angeles Lakers", "logo": "https://l/lal"}},
                                                     "start_time": 1000, "status": {"code": "FT"}, "score": {"home": 101, "away": 110}},
                                                    {"id": 2, "teams": {"home": {"name": "Los Angeles Lakers", "logo": "https://l/lal"}, "away": {"name": "Boston Celtics", "logo": "https://l/bos"}},
                                                     "start_time": 3000, "status": {"code": "NS"}, "score_table": {}}]}}}
RICH_TABLE = {"wkey": RICH_WEATHER, "skey": RICH_STOCK, "lkey": RICH_SPORTS, "ckey": RICH_CURRENCY}


def fake_brave(seen: list[httpx.Request] | None = None, *, fail: dict[str, httpx.Response] | None = None):
    def respond(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        assert request.headers["x-subscription-token"] in ("test-key", "suggest-key", "spell-key")
        path = request.url.path.removeprefix("/res/v1")
        if fail and path in fail:
            return fail[path]
        if path == "/web/search" and request.url.params.get("enable_rich_callback") == "true":
            assert request.headers.get("cache-control") == "no-cache"
            assert request.url.params.get("result_filter") == "web" and request.url.params.get("count") == "1"
            key = RICH_KEYS.get(request.url.params["q"])
            rich = {"hint": {"vertical": RICH_TABLE[key]["subtype"], "callback_key": key}} if key else None
            return httpx.Response(200, json={"type": "search", "query": {}, "web": {"results": [WEB]}, "mixed": {}, "rich": rich})
        if path == "/web/rich":
            key = request.url.params["callback_key"]
            hit = RICH_TABLE.get(key)
            body = {"type": "rich", "results": [hit] if hit else []}
            if hit:
                body["response_callback_info"] = {"vertical": hit["subtype"], "callback_key": key, "callback_status": "success", "search_lang": "en"}
            return httpx.Response(200, json=body)
        table = {
            "/news/search": {"results": [NEWS]}, "/videos/search": {"results": [VIDEO]}, "/images/search": {"results": [IMAGE]},
            "/web/search": {"web": {"results": [WEB]}, "discussions": {"results": [DISCUSSION]}, "mixed": {}},
            "/local/place_search": {"type": "locations", "results": [PLACE]},
            "/local/pois": {"results": [PLACE]},
            "/local/descriptions": {"results": [{"type": "local_description", "id": PLACE["id"], "description": "A premier destination"}]},
            # Separate plans: the Search key gets OPTION_NOT_IN_PLAN; a plan key gets the documented body.
            "/suggest/search": NOT_IN_PLAN if request.headers.get("x-subscription-token") != "suggest-key" else SUGGEST_BODY,
            "/spellcheck/search": NOT_IN_PLAN if request.headers.get("x-subscription-token") != "spell-key" else SPELL_BODY,
        }
        body = table[path]
        return httpx.Response(400 if body is NOT_IN_PLAN else 200, json=body)
    return httpx.MockTransport(respond)


#: Documented response shapes, verified live 2026-10-07 against the Suggest and Spellcheck plans.
SUGGEST_BODY = {"type": "suggest", "query": {"original": "palm spr"}, "results": [
    {"query": "palm springs"}, {"query": "palm springs weather", "type": "query"},
    {"query": "Palm Springs", "type": "entity", "title": "Palm Springs", "description": "City in California", "img": "https://img/ps.jpg"},
]}
SPELL_BODY = {"type": "spellcheck", "query": {"original": "recieve teh pakage"}, "results": [{"query": "receive the package"}]}


def client(seen=None, suggest_api_key="suggest-key", spellcheck_api_key="spell-key", **kwargs) -> bs.BraveClient:
    return bs.BraveClient("test-key", transport=fake_brave(seen, **kwargs), limiter=bs.RateLimiter(1000),
                          suggest_api_key=suggest_api_key, spellcheck_api_key=spellcheck_api_key, assist_limiter=bs.RateLimiter(1000))


def app_with(brave: bs.BraveClient) -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.state.brave_client = brave
    return app


def test_normalizers_produce_distinct_kinds():
    news, video, image, place = bs.normalize_news(NEWS), bs.normalize_video(VIDEO), bs.normalize_image(IMAGE), bs.normalize_place(PLACE)
    assert (news.kind, news.source, news.favicon, news.published) == ("article", "Electrek", "https://imgs.search.brave.com/fav", "2026-09-22T13:02:13")
    assert video.kind == "video" and video.video["duration"] == "16:19" and video.video["creator"] == "TailHappyTV"
    assert video.video["original_thumbnail"].startswith("https://i.ytimg.com/")
    assert image.kind == "image" and image.image["url"].endswith("71X.jpg") and image.image["width"] == 1600 and image.source == "amazon.com"
    assert place.kind == "place" and place.id == f"place:{PLACE['id']}" and place.place["latitude"] == 37.7756729
    assert place.place["address"].startswith("1233 Howard") and place.place["rating"] == 4.5 and place.place["pictures"] == ["https://pic/1", "https://pic/2"]
    discussion = bs.normalize_discussion(DISCUSSION)
    assert discussion.kind == "discussion" and discussion.discussion["forum"] == "reddit" and discussion.discussion["answers"] == 42
    assert bs.normalize_web(WEB).source == "Lectric eBikes"
    assert bs.hostname("https://www.youtube.com/watch") == "youtube.com"


def test_feed_runs_sections_concurrently_and_isolates_failures():
    seen: list[httpx.Request] = []
    brave = client(seen, fail={"/videos/search": httpx.Response(429, headers={"retry-after": "2"}, json={"error": {"detail": "slow down"}})})
    request = bs.FeedRequest(sections=[
        {"kind": "news", "q": "electric bikes", "freshness": "pd"}, {"kind": "videos", "q": "ebike review"},
        {"kind": "images", "q": "ebike", "count": 5}, {"kind": "web", "q": "ebike"}, {"kind": "places", "q": "bike shop"},
    ], location={"latitude": 37.7749, "longitude": -122.4194, "radius_m": 5000})
    sections = asyncio.run(bs.build_feed(brave, request))
    by_kind = {s.kind: s for s in sections}
    assert [s.kind for s in sections] == ["news", "videos", "images", "web", "places"]
    assert by_kind["news"].status == "ok" and by_kind["news"].items[0].kind == "article"
    assert by_kind["videos"].status == "error" and by_kind["videos"].error == {"code": "rate_limited", "message": "slow down", "status": 429, "retry_after": 2.0}
    assert [i.kind for i in by_kind["web"].items] == ["web", "discussion"]
    assert by_kind["places"].items[0].place["place_id"] == PLACE["id"]
    params = {r.url.path: dict(r.url.params) for r in seen}
    assert params["/res/v1/news/search"]["freshness"] == "pd" and params["/res/v1/news/search"]["spellcheck"] == "false"
    assert "freshness" not in params["/res/v1/images/search"] and params["/res/v1/images/search"]["count"] == "5"
    assert params["/res/v1/web/search"]["result_filter"] == "web,discussions"
    place_params = params["/res/v1/local/place_search"]
    assert (place_params["latitude"], place_params["longitude"], place_params["geoloc"], place_params["radius"]) == ("37.7749", "-122.4194", "37.7749x-122.4194", "5000.0")


def test_places_browse_requires_anchor_and_poi_details_merge_descriptions():
    brave = client()
    sections = asyncio.run(bs.build_feed(brave, bs.FeedRequest(sections=[{"kind": "places"}])))
    assert sections[0].status == "error" and sections[0].error["code"] == "invalid_request"
    details = asyncio.run(brave.poi_details([PLACE["id"]]))
    assert details[0]["ai_description"] == "A premier destination" and details[0]["place"]["phone"] == "+14152412453"
    with pytest.raises(bs.BraveSearchError):
        asyncio.run(brave.poi_details([]))


def test_error_mapping_and_plan_entitlements(monkeypatch):
    # Passing the Search key to Suggest returns 400 OPTION_NOT_IN_PLAN from Brave.
    brave = client(suggest_api_key="test-key", spellcheck_api_key="test-key")
    with pytest.raises(bs.BraveSearchError) as info:
        asyncio.run(brave.suggest("golden gate", rich=True))
    assert info.value.code == "not_in_plan" and info.value.status == 400
    # Suggest and Spellcheck keys do not fall back to the Search key when unset.
    monkeypatch.setattr(bs.app_config, "BRAVE_SEARCH_API_KEY", "test-key")
    monkeypatch.setattr(bs.app_config, "BRAVE_SUGGEST_API_KEY", None)
    monkeypatch.setattr(bs.app_config, "BRAVE_SPELLCHECK_API_KEY", None)
    no_assist = bs.BraveClient(limiter=bs.RateLimiter(1000), assist_limiter=bs.RateLimiter(1000))
    assert no_assist.configured is True
    assert no_assist.assist_configured == {"suggest": False, "spellcheck": False}
    with pytest.raises(bs.BraveSearchError) as info:
        asyncio.run(no_assist.suggest("golden gate"))
    assert info.value.code == "not_configured" and info.value.status == 503 and "BRAVE_SUGGEST_API_KEY is not set" in str(info.value)
    with pytest.raises(bs.BraveSearchError) as info:
        asyncio.run(no_assist.spellcheck("golden gate"))
    assert info.value.code == "not_configured" and info.value.status == 503 and "BRAVE_SPELLCHECK_API_KEY is not set" in str(info.value)
    revoked = client(fail={"/news/search": httpx.Response(422, json={"error": {"detail": "The provided API key is invalid.", "code": "SUBSCRIPTION_TOKEN_INVALID"}})})
    with pytest.raises(bs.BraveSearchError) as info:
        asyncio.run(revoked.news("x"))
    assert info.value.code == "unauthorized", "a revoked key is 422 SUBSCRIPTION_TOKEN_INVALID, not a bad request"
    unauthorized = client(fail={"/news/search": httpx.Response(401, json={"error": {"detail": "bad key"}})})
    with pytest.raises(bs.BraveSearchError) as info:
        asyncio.run(unauthorized.news("x"))
    assert info.value.code == "unauthorized"
    missing = bs.BraveClient(None, limiter=bs.RateLimiter(1000))
    with pytest.raises(bs.BraveSearchError) as info:
        asyncio.run(missing.news("x"))
    assert info.value.code == "not_configured" and info.value.status == 503 and "BRAVE_SEARCH_API_KEY is not set" in str(info.value)


def test_rate_limiter_spaces_bursts(monkeypatch):
    async def scenario():
        clock = [0.0]
        slept = []

        async def fake_sleep(seconds):
            slept.append(seconds)
            clock[0] += seconds

        monkeypatch.setattr(bs.asyncio, "sleep", fake_sleep)
        limiter = bs.RateLimiter(2, burst=2, clock=lambda: clock[0])
        return [await limiter.acquire() for _ in range(4)], slept
    waits, slept = asyncio.run(scenario())
    assert waits[:2] == [0.0, 0.0] and waits[2] == pytest.approx(0.5) and waits[3] == pytest.approx(0.5)
    assert slept == [pytest.approx(0.5), pytest.approx(0.5)]


def test_http_surface_never_leaks_key_and_reports_sections():
    async def scenario():
        app = app_with(client())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
            status = await http.get("/discover/status")
            assert status.json()["configured"] is True
            feed = await http.post("/discover/feed", json={"sections": [{"kind": "news", "q": "ebikes"}, {"kind": "places", "q": "bike shop"}],
                                                          "location": {"location": "san francisco ca united states"}})
            assert feed.status_code == 200
            body = feed.json()
            assert [s["status"] for s in body["sections"]] == ["ok", "ok"]
            assert body["sections"][0]["items"][0]["kind"] == "article"
            assert "test-key" not in json.dumps(body)
            suggest = await http.post("/assist/suggest", json={"q": "palm spr", "count": 3})
            assert suggest.status_code == 200 and [r["query"] for r in suggest.json()["results"]][:2] == ["palm springs", "palm springs weather"]
            assert suggest.json()["results"][2]["type"] == "entity" and suggest.json()["results"][2]["img"].endswith("ps.jpg")
            spell = await http.post("/discover/assist/spellcheck", json={"q": "recieve teh pakage"})
            assert spell.status_code == 200 and spell.json()["corrected"] == "receive the package"
            assert status.json()["assist_configured"] == {"suggest": True, "spellcheck": True}
            too_long = await http.post("/assist/suggest", json={"q": "w " * 60})
            assert too_long.status_code == 422 and too_long.json()["detail"]["code"] == "invalid_request"
            pois = await http.post("/discover/pois", json={"ids": [PLACE["id"]]})
            assert pois.json()["results"][0]["ai_description"] == "A premier destination"
            assert (await http.post("/discover/feed", json={"sections": []})).status_code == 422
        unconfigured = app_with(bs.BraveClient(None, limiter=bs.RateLimiter(1000)))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=unconfigured), base_url="http://test") as http:
            response = await http.post("/discover/feed", json={"sections": [{"kind": "news", "q": "x"}]})
            assert response.status_code == 503 and response.json()["detail"]["code"] == "not_configured"
    asyncio.run(scenario())


def test_rich_two_step_flow_and_cards():
    seen: list[httpx.Request] = []
    brave = client(seen)

    async def scenario():
        weather = await brave.answer("weather in london")
        stock = await brave.answer("AAPL stock")
        currency = await brave.answer("100 usd to eur")
        nothing = await brave.answer("golden gate bridge")
        expired = await brave.rich("stale-key")
        return weather, stock, currency, nothing, expired
    weather, stock, currency, nothing, expired = asyncio.run(scenario())

    # /web/search hint -> /web/rich callback; the miss costs exactly one search call and no callback.
    paths = [r.url.path.removeprefix("/res/v1") for r in seen]
    assert paths == ["/web/search", "/web/rich"] * 3 + ["/web/search", "/web/rich"]
    assert nothing == [] and expired == []

    w = weather[0]
    assert (w.vertical, w.subtype, w.provider["name"]) == ("weather", "weather", "OpenWeatherMap")
    assert w.card["location"] == "London, GB" and w.card["temp_c"] == 20.52 and w.card["condition"] == "clear sky"
    assert len(w.card["daily"]) == 7 and w.card["daily"][1]["max_c"] == 23.5
    assert "current_weather" in w.raw["weather"]  # full payload preserved for richer UIs

    s = stock[0].card
    assert (s["symbol"], s["name"], s["price"], s["change_percent"]) == ("AAPL", "Apple Inc.", 335.92, -0.32639)
    assert len(s["sparkline"]) == bs.SPARKLINE_POINTS and s["sparkline"][0] == [1790256600, 336.0]
    assert s["exchange_hours"]["timezone"] == "America/New_York"

    c = currency[0].card
    assert (c["from"], c["to"], c["amount"], c["result"], c["rate"]) == ("USD", "EUR", 100.0, 87.691, 0.87691)


def test_rich_sports_card_splits_recent_and_upcoming_and_unknown_subtype_degrades():
    card = bs._rich_sports(RICH_SPORTS, now=2000)
    assert card["sport"] == "basketball" and card["league"]["name"] == "NBA" and card["team"]["name"] == "Los Angeles Lakers"
    assert [g["id"] for g in card["recent"]] == [1] and card["recent"][0]["away"]["score"] == 110
    assert [g["id"] for g in card["upcoming"]] == [2] and card["upcoming"][0]["status"] == "NS" and card["game_count"] == 2
    unknown = bs.normalize_rich({"type": "rich", "subtype": "flights", "provider": {"name": "X"}, "flights": {"number": "UA1"}}, "flights")
    assert unknown.card == {} and unknown.raw == {"flights": {"number": "UA1"}}
    assert bs.normalize_rich({"type": "rich", "subtype": "calculator", "calculator": {"expression": "2+2", "answer": 4.0}}, "calculator").card == {"expression": "2+2", "answer": 4.0}
    assert bs.normalize_rich({"subtype": "unixtimestamp", "unixtimestamp": {"conversion": {"intent_type": "ts_to_date", "input_ts": 1700000000}}}, "unixtimestamp").card["input_ts"] == 1700000000
    assert set(bs.RICH_VERTICALS) == {"weather", "stocks", "cryptocurrency", "currency", "calculator", "unitconversion", "unixtimestamp", "definitions", "sports"}


def test_rich_in_feed_and_answer_endpoint():
    async def scenario():
        app = app_with(client())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
            status = await http.get("/discover/status")
            assert "rich" in status.json()["sources"] and "weather" in status.json()["rich_verticals"]
            answer = await http.post("/discover/answer", json={"q": "AAPL stock"})
            assert answer.status_code == 200
            payload = answer.json()
            assert payload["answers"][0]["card"]["symbol"] == "AAPL" and "test-key" not in json.dumps(payload)
            assert (await http.post("/discover/answer", json={"q": "golden gate bridge"})).json()["answers"] == []
            feed = await http.post("/discover/feed", json={"sections": [{"kind": "rich", "q": "weather in london"}, {"kind": "rich", "q": "nothing here"},
                                                                        {"kind": "news", "q": "ebikes"}, {"kind": "rich"}]})
            sections = feed.json()["sections"]
            assert [s["status"] for s in sections] == ["ok", "ok", "ok", "error"]
            item = sections[0]["items"][0]
            assert item["kind"] == "rich" and item["id"] == "rich:weather:weather in london" and item["source"] == "OpenWeatherMap"
            assert item["rich"]["card"]["temp_c"] == 20.52
            assert sections[1]["items"] == [] and sections[3]["error"]["code"] == "invalid_request"
    asyncio.run(scenario())


def test_brave_tools_verticals_and_error_handling():
    from agent.api.core import brave_tools as bt
    from agent.api.endpoints import discover as discover_ep

    seen: list[httpx.Request] = []
    bt.set_search_client(client(seen))
    try:
        assert [t.tool_name for t in bt.brave_tools()] == list(bt.BRAVE_TOOL_NAMES)

        web_res = asyncio.run(bt.brave_web_search("ebike", count=25, extra_snippets=True))
        assert web_res["query"] == "ebike"
        assert [r["kind"] for r in web_res["results"]] == ["web", "discussion"]
        assert seen[-1].url.params["count"] == "20" and seen[-1].url.params["extra_snippets"] == "true"

        news_res = asyncio.run(bt.brave_news_search("honda", count=100, freshness="pd"))
        assert news_res["results"][0]["kind"] == "article" and seen[-1].url.params["count"] == "50"

        img_res = asyncio.run(bt.brave_image_search("ebike", count=0))
        assert img_res["results"][0]["kind"] == "image" and seen[-1].url.params["count"] == "1"

        vid_res = asyncio.run(bt.brave_video_search("ebike review"))
        assert vid_res["results"][0]["kind"] == "video"

        local_res = asyncio.run(bt.brave_local_search("bike shop", location="San Francisco, CA"))
        assert local_res["results"][0]["ai_description"] == "A premier destination"

        rich_res = asyncio.run(bt.brave_rich_answer("AAPL stock"))
        assert rich_res["answers"][0]["card"]["symbol"] == "AAPL"

        # Fallback when poi_details fails on local search
        bt.set_search_client(client(fail={"/local/pois": httpx.Response(500, json={"error": {"detail": "poi down"}})}))
        fallback_local = asyncio.run(bt.brave_local_search("bike shop", location="San Francisco, CA"))
        assert fallback_local["results"][0]["kind"] == "place" and "ai_description" not in fallback_local["results"][0]

        # Error formatting when unconfigured
        bt.set_search_client(bs.BraveClient(None, limiter=bs.RateLimiter(1000)))
        err = asyncio.run(bt.brave_web_search("ebike"))
        assert err["status"] == "error" and "brave_web_search not_configured:" in err["content"][0]["text"]

        # Shared default client with discover_ep
        bt.set_search_client(None)
        discover_ep._default_client = None
        shared = bt.search_client()
        assert shared is discover_ep._default_client
    finally:
        bt.set_search_client(None)


