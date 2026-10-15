from __future__ import annotations

import asyncio
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from app.main import SOURCE_PAGES, connect, create_app, fetch_usgs_feed, initialize_database, normalize_earthquakes
from app.priority import calculate_priority


def feed_payload():
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "id": "us7000test",
            "properties": {
                "mag": 4.2,
                "place": "10 km test region",
                "time": 1791950400000,
                "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test",
            },
            "geometry": {"type": "Point", "coordinates": [-70.0, 10.0, 32.5]},
        }],
    }


def create_test_client(tmp_path: Path, *, fetcher=None, probe=None):
    async def fixture_fetcher():
        return feed_payload()

    async def fixture_probe(name: str, url: str):
        return {
            "name": name,
            "url": url,
            "page_reachable": True,
            "http_status": 200,
            "data_available": False,
            "last_successful_retrieval": None,
            "integration_status": "landing_page_only",
            "data_class": "external_source_metadata",
            "limitations": "Page probe only.",
        }

    async def fixture_cdse_probe():
        return {
            **(await fixture_probe("Copernicus Data Space", "https://catalogue.dataspace.copernicus.eu/odata/v1/Products")),
            "requires_credentials": True,
            "metadata_available": True,
            "data_returned": {"Name": "fixture Sentinel product"},
        }

    app = create_app(
        tmp_path / "test.sqlite3",
        earthquake_fetcher=fetcher or fixture_fetcher,
        source_probe_fn=probe or fixture_probe,
        cdse_probe_fn=fixture_cdse_probe,
    )
    return TestClient(app)


def incident_payload(**overrides):
    return {
        "incidentType": "Medical emergency",
        "severity": "Critical",
        "category": "Medical assistance",
        "peopleAffected": 3,
        "manualLocation": "Near the test clinic",
        "locationConfidence": "medium",
        "immediateLifeThreat": True,
        "medicalUrgency": True,
        **overrides,
    }


def test_health_scenarios_sources_and_earthquake_normalization(tmp_path):
    with create_test_client(tmp_path) as client:
        assert client.get("/api/health").json()["database"] == "available"
        assert len(client.get("/api/scenarios").json()["items"]) == 2

        response = client.get("/api/earthquakes?min_magnitude=4")
        assert response.status_code == 200
        body = response.json()
        assert body["data_class"] == "external_observation"
        assert body["items"][0]["magnitude"] == 4.2
        assert body["items"][0]["longitude"] == -70
        assert body["items"][0]["depth_km"] == 32.5
        assert body["items"][0]["url"].endswith("us7000test")

        sources = client.get("/api/sources/status").json()["items"]
        assert len(sources) == 4
        assert {item["name"] for item in sources} >= set(SOURCE_PAGES)
        assert all(
            item["data_available"] is False
            for item in sources
            if item["name"] not in ("USGS earthquakes", "Copernicus Data Space")
        )


def test_earthquake_normalization_keeps_global_coordinates_and_ignores_invalid_values():
    payload = feed_payload()
    payload["features"].extend([
        {
            "type": "Feature",
            "id": f"event-{name}",
            "properties": {"mag": magnitude, "place": name, "time": 1791950400000},
            "geometry": {"type": "Point", "coordinates": [longitude, latitude, None]},
        }
        for name, longitude, latitude, magnitude in (
            ("Asia", 85.3, 27.7, 4.1),
            ("Africa", 3.4, 6.5, "invalid magnitude"),
            ("Europe", -0.1, 51.5, 3.2),
            ("Oceania", 151.2, -33.8, 2.5),
        )
    ])
    payload["features"].append({
        "type": "Feature",
        "id": "invalid-latitude",
        "properties": {"mag": 5, "time": 1791950400000},
        "geometry": {"type": "Point", "coordinates": [0, 91]},
    })
    payload["features"].append(payload["features"][1].copy())

    items = normalize_earthquakes(payload)
    by_place = {item["place"]: item for item in items}
    assert {"Asia", "Africa", "Europe", "Oceania", "10 km test region"} <= set(by_place)
    assert by_place["Africa"]["magnitude"] is None
    assert all(item["latitude"] <= 90 and item["latitude"] >= -90 for item in items)
    assert "invalid-latitude" not in {item["id"] for item in items}
    assert len({item["id"] for item in items}) == len(items)


def test_earthquake_endpoint_reports_empty_feed_and_validates_magnitude(tmp_path):
    async def empty_feed():
        return {"type": "FeatureCollection", "features": []}

    with create_test_client(tmp_path, fetcher=empty_feed) as client:
        response = client.get("/api/hazards/earthquakes")
        assert response.status_code == 200
        assert response.json()["items"] == []
        assert response.json()["total"] == 0
        assert response.json()["stale"] is False
        assert response.json()["cache_age_seconds"] >= 0
        assert client.get("/api/hazards/earthquakes?min_magnitude=11").status_code == 422


def test_failed_manual_refresh_keeps_stale_data_and_respects_retry_cooldown(tmp_path):
    calls = 0

    async def flaky_feed():
        nonlocal calls
        calls += 1
        if calls == 1:
            return feed_payload()
        raise httpx.ReadTimeout("USGS timed out")

    with create_test_client(tmp_path, fetcher=flaky_feed) as client:
        fresh = client.get("/api/earthquakes")
        assert fresh.status_code == 200
        assert fresh.json()["stale"] is False

        stale = client.get("/api/earthquakes?refresh=true")
        assert stale.status_code == 200
        assert stale.json()["stale"] is True
        assert stale.json()["error"] == "USGS timed out"
        assert stale.json()["items"][0]["id"] == "us7000test"
        assert calls == 3

        cooled_down = client.get("/api/earthquakes?refresh=true")
        assert cooled_down.status_code == 200
        assert cooled_down.json()["stale"] is True
        assert calls == 3


def test_simultaneous_earthquake_refreshes_share_one_upstream_request(tmp_path):
    calls = 0

    async def slow_feed():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        return feed_payload()

    app = create_app(tmp_path / "concurrent.sqlite3", earthquake_fetcher=slow_feed)

    async def fetch_concurrently():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                return await asyncio.gather(*(client.get("/api/earthquakes?refresh=true") for _ in range(8)))

    responses = asyncio.run(fetch_concurrently())
    assert all(response.status_code == 200 for response in responses)
    assert all(response.json()["items"][0]["id"] == "us7000test" for response in responses)
    assert calls == 1


def test_usgs_feed_rejects_malformed_json_and_http_failures():
    async def verify():
        malformed = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request: httpx.Response(200, content=b"not json")),
        )
        async with malformed:
            try:
                await fetch_usgs_feed(client=malformed)
            except ValueError as error:
                assert "invalid JSON" in str(error)
            else:
                raise AssertionError("Malformed JSON should not be accepted.")

        unavailable = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request: httpx.Response(503)),
        )
        async with unavailable:
            try:
                await fetch_usgs_feed(client=unavailable)
            except httpx.HTTPStatusError as error:
                assert error.response.status_code == 503
            else:
                raise AssertionError("Unsuccessful upstream responses must raise.")

    asyncio.run(verify())


def test_demo_ml_category_suggestion_and_validation(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/ml/category-suggestion",
            json={"text": "We are trapped under rubble and need rescue"},
        )
        assert response.status_code == 200
        assert response.json()["category"] == "Rescue"
        assert 0 < response.json()["score"] <= 1
        assert response.json()["model"] == "demo_multinomial_naive_bayes"

        examples = (
            ("injured person needs a doctor", "Medical assistance"),
            ("flood water is rising and we need to evacuate", "Evacuation"),
            ("we need a safe place to stay tonight", "Shelter"),
            ("families are hungry and need food and drinking water", "Food or water"),
            ("power lines are down and electricity is out", "Other"),
        )
        for text, expected_category in examples:
            suggestion = client.post("/api/ml/category-suggestion", json={"text": text}).json()
            assert suggestion["category"] == expected_category

        unknown = client.post(
            "/api/ml/category-suggestion",
            json={"text": "zzzxxyy qqqww"},
        )
        assert unknown.status_code == 200
        assert unknown.json()["category"] is None
        assert unknown.json()["score"] == 0

        assert client.post("/api/ml/category-suggestion", json={"text": "help"}).status_code == 422


def test_flood_demo_model_is_reproducible_validated_and_never_claims_real_probability(tmp_path):
    with create_test_client(tmp_path) as client:
        payload = {
            "rainfallMm": 80,
            "waterLevelM": 0.5,
            "riverLevelM": 1,
            "terrainElevationM": 6,
            "waterLevelTrendMPerHour": 0.3,
            "horizonHours": 0,
        }
        initial = client.post("/api/flood/demo-simulation", json=payload)
        assert initial.status_code == 200
        body = initial.json()
        assert body["data_mode"] == "DEMO SIMULATION"
        assert body["scenario_id"] == "koshi-synthetic-demo"
        assert body["model"]["algorithm"] == "class-weighted logistic regression"
        assert body["model"]["score_kind"] == "uncalibrated synthetic-risk score; not a flood probability"
        assert len(body["cells"]) == 12
        assert body["cells"][0]["risk_class"] in {"low", "moderate", "high"}
        assert "Synthetic demonstration—not a validated real-world flood forecast." in body["limitations"]
        assert client.post("/api/flood/demo-simulation", json=payload).json() == body
        relocated = client.post(
            "/api/flood/demo-simulation",
            json={**payload, "startLatitude": 27.1, "startLongitude": 86.9},
        ).json()
        assert relocated["start_location"] == {"latitude": 27.1, "longitude": 86.9}
        assert relocated["cells"][0]["latitude"] == 27.1
        assert relocated["cells"][0]["longitude"] == 86.9
        assert relocated["propagation_path"][0] == [27.1, 86.9]
        assert relocated["propagation_path"][1] == [27.065, 86.945]
        assert relocated["cells"][0]["risk_score"] == body["cells"][0]["risk_score"]
        assert client.post(
            "/api/flood/demo-simulation",
            json={**payload, "startLatitude": 90},
        ).status_code == 422
        edge_scenario = client.post(
            "/api/flood/demo-simulation",
            json={**payload, "startLatitude": -89.89, "startLongitude": 179.8},
        ).json()
        generated_coordinates = (
            edge_scenario["propagation_path"]
            + [[cell["latitude"], cell["longitude"]] for cell in edge_scenario["cells"]]
            + [point for route in edge_scenario["routes"] for point in route["geometry"]]
        )
        assert all(-90 <= latitude <= 90 and -180 <= longitude <= 180 for latitude, longitude in generated_coordinates)

        later = client.post(
            "/api/flood/demo-simulation",
            json={**payload, "horizonHours": 6},
        ).json()
        assert body["selected_route_id"] == "short-lowbank"
        assert later["selected_route_id"] == "raised-detour"
        assert later["cells"] != body["cells"]

        extreme = client.post(
            "/api/flood/demo-simulation",
            json={
                **payload,
                "rainfallMm": 500,
                "waterLevelM": 20,
                "riverLevelM": 20,
                "terrainElevationM": 0,
                "waterLevelTrendMPerHour": 5,
                "horizonHours": 6,
            },
        ).json()
        assert extreme["route_warning"] is not None
        assert client.post("/api/flood/demo-simulation", json={**payload, "rainfallMm": 501}).status_code == 422
        assert client.post("/api/flood/demo-simulation", json={**payload, "horizonHours": 2}).status_code == 422


def test_incident_validation_idempotency_and_persistence(tmp_path):
    database = tmp_path / "test.sqlite3"
    client = create_test_client(tmp_path)
    response = client.post(
        "/api/incidents",
        json=incident_payload(),
        headers={"Idempotency-Key": "offline-report-uuid-1"},
    )
    assert response.status_code == 201
    incident = response.json()
    assert incident["data_class"] == "simulation"
    assert incident["priority"]["score"] > 0

    retry = client.post(
        "/api/incidents",
        json=incident_payload(message="retry payload"),
        headers={"Idempotency-Key": "offline-report-uuid-1"},
    )
    assert retry.status_code == 200
    assert retry.json()["id"] == incident["id"]
    assert retry.json()["message"] == ""
    assert client.get(f"/api/incidents/{incident['id']}").json()["id"] == incident["id"]
    assert client.post("/api/incidents", json=incident_payload(severity="impossible")).status_code == 422
    assert client.post("/api/incidents", json=incident_payload(longitude=4)).status_code == 422

    restarted_client = create_test_client(tmp_path)
    assert restarted_client.get("/api/incidents").json()["total"] == 1
    assert database.exists()


def test_citizen_reports_require_persisted_consent_and_remain_unverified(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post("/api/incidents", json=incident_payload(dataClass="citizen_report"))
        assert response.status_code == 422
        assert "Consent must be confirmed" in str(response.json())

        confirmed = client.post(
            "/api/incidents",
            json=incident_payload(dataClass="citizen_report", consentConfirmed=True),
        )
        assert confirmed.status_code == 201
        body = confirmed.json()
        assert body["data_class"] == "citizen_report"
        assert body["consent_confirmed"] is True
        assert any("unverified citizen-submitted report" in item for item in body["priority"]["uncertainty"])


def test_device_location_provenance_is_validated_and_persisted(tmp_path):
    with create_test_client(tmp_path) as client:
        invalid = client.post(
            "/api/incidents",
            json=incident_payload(
                latitude=27.7172,
                longitude=85.324,
                locationSource="device",
                locationAccuracyMeters=25,
            ),
        )
        assert invalid.status_code == 422

        response = client.post(
            "/api/incidents",
            json=incident_payload(
                latitude=27.7172,
                longitude=85.324,
                locationSource="device",
                locationAccuracyMeters=25,
                locationCapturedAt="2026-10-14T05:00:00.000Z",
            ),
        )
        assert response.status_code == 201
        assert response.json()["location_source"] == "device"
        assert response.json()["location_accuracy_meters"] == 25
        assert response.json()["location_captured_at"] == "2026-10-14T05:00:00.000Z"

        invalid_manual_metadata = client.post(
            "/api/incidents",
            json=incident_payload(
                latitude=27.7172,
                longitude=85.324,
                locationSource="manual",
                locationAccuracyMeters=25,
            ),
        )
        assert invalid_manual_metadata.status_code == 422


def test_database_schema_update_preserves_existing_incident_rows(tmp_path):
    database = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(database) as connection:
        connection.execute(
            "CREATE TABLE incidents (id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO incidents (id,status,created_at) VALUES ('legacy-row','new','2026-01-01T00:00:00Z')"
        )

    initialize_database(database)

    with connect(database) as connection:
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(incidents)")}
        row = connection.execute("SELECT id,consent_confirmed FROM incidents WHERE id = 'legacy-row'").fetchone()
    assert {"consent_confirmed", "location_source", "location_accuracy_meters", "location_captured_at"} <= columns
    assert row["id"] == "legacy-row"
    assert row["consent_confirmed"] == 0


def test_incident_status_notes_resources_and_assignment(tmp_path):
    with create_test_client(tmp_path) as client:
        incident = client.post("/api/incidents", json=incident_payload()).json()
        resources_response = client.get("/api/resources").json()
        resource = next(row for row in resources_response["items"] if row["id"] == "SIM-RES-12")
        assert resource["is_simulated"] is True
        assert resources_response["connected_real_resources"] == 0

        created = client.post("/api/resources", json={
            "name": "Fictional water team",
            "capabilities": ["water"],
            "location": "Demo depot",
        })
        assert created.status_code == 201
        assert created.json()["is_simulated"] is True
        assert client.post("/api/resources", json={
            "name": "Unverified real team",
            "location": "Unknown",
            "isSimulated": False,
        }).status_code == 422

        triaged = client.patch(f"/api/incidents/{incident['id']}", json={
            "status": "triaged",
            "internal_note": "Coordinator reviewed the fictional demo report.",
        })
        assert triaged.json()["status"] == "triaged"
        assert len(triaged.json()["internal_notes"]) == 1
        assigned = client.post(
            f"/api/incidents/{incident['id']}/assign",
            json={"resource_id": resource["id"]},
        )
        assert assigned.json()["status"] == "assigned"
        assert assigned.json()["assigned_resource_id"] == resource["id"]
        assert client.patch(f"/api/incidents/{incident['id']}", json={"status": "new"}).status_code == 409
        assert client.get("/api/incidents?severity=Critical&status=assigned&location=clinic").json()["total"] == 1


def test_priority_boundaries_missing_information_and_explanation():
    now = datetime.now(UTC)
    complete = {
        "created_at": now.isoformat(),
        "severity": "Critical",
        "people_affected": 12,
        "medical_urgency": True,
        "immediate_life_threat": True,
        "location_confidence": "high",
        "latitude": 0,
        "longitude": 0,
        "manual_location": "",
        "data_class": "simulation",
    }
    assessment = calculate_priority(complete, now=now)
    assert assessment["score"] == 97
    assert assessment["band"] == "immediate"
    assert "not a verified emergency" in assessment["uncertainty"][-1]
    assert any(factor["key"] == "missing_information" for factor in assessment["factors"])

    missing = {
        "created_at": (now - timedelta(days=100)).isoformat(),
        "severity": "Moderate",
        "people_affected": None,
        "medical_urgency": None,
        "immediate_life_threat": None,
        "location_confidence": "unknown",
        "latitude": None,
        "longitude": None,
        "manual_location": "",
        "data_class": "simulation",
    }
    low = calculate_priority(missing, now=now)
    assert low["score"] == 0
    assert low["band"] == "routine"
    assert len(low["uncertainty"]) > 1
    assert "must not determine real-world rescue decisions" in low["explanation"]


def test_priority_override_requires_server_side_coordinator_token(tmp_path, monkeypatch):
    with create_test_client(tmp_path) as client:
        incident = client.post("/api/incidents", json=incident_payload()).json()
        path = f"/api/incidents/{incident['id']}/priority-override"
        assert client.post(path, json={"score": 40, "reason": "review"}).status_code == 503
        monkeypatch.setenv("ARKGRID_COORDINATOR_TOKEN", "test-token")
        assert client.post(path, json={"score": 40, "reason": "reviewed details"}).status_code == 401
        response = client.post(
            path,
            json={"score": 40, "reason": "reviewed details"},
            headers={"X-Coordinator-Token": "test-token"},
        )
        assert response.status_code == 200
        assert response.json()["score"] == 40
        assert response.json()["override_reason"] == "reviewed details"


def test_usgs_failure_is_explicit_and_does_not_fabricate_records(tmp_path):
    async def fail():
        raise httpx.ConnectError("network unavailable")

    with create_test_client(tmp_path, fetcher=fail) as client:
        response = client.get("/api/earthquakes")
        assert response.status_code == 503
        assert "no live observations" in response.json()["detail"]["message"]
        during_cooldown = client.get("/api/earthquakes")
        assert during_cooldown.status_code == 503
        assert "no live observations" in during_cooldown.json()["detail"]["message"]
