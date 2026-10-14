from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from app.main import SOURCE_PAGES, connect, create_app, initialize_database
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
