from __future__ import annotations

import asyncio
import hmac
import json
import math
import os
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import FastAPI, Header, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.category_model import suggest_category
from app.flood_risk import FloodInputs, run_demo_scenario
from app.priority import calculate_priority

USGS_FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
SOURCE_PAGES = {
    "CEMS Emergency Mapping": "https://emergency.copernicus.eu/",
    "Copernicus Data Space": "https://dataspace.copernicus.eu/",
    "GloFAS": "https://global-flood.emergency.copernicus.eu/",
}
CDSE_CATALOGUE_URL = "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"
DEMO_RESOURCES = (
    ("SIM-RES-07", "High-clearance vehicle", "transport,evacuation", "Sunsari demo depot"),
    ("SIM-RES-12", "Medical support team", "medical,first-aid", "Morang demo staging area"),
    ("SIM-RES-18", "Portable water unit", "water,supply", "Koshi demo depot"),
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def default_database_path() -> Path:
    configured = os.getenv("DATABASE_URL", "sqlite:///./services/api/arkgrid.sqlite3")
    if not configured.startswith("sqlite:///"):
        raise RuntimeError("DATABASE_URL must use a local sqlite:/// path for this SQLite MVP.")
    value = configured.removeprefix("sqlite:///")
    if value in ("", ":memory:"):
        raise RuntimeError("DATABASE_URL must point to a persistent SQLite file.")
    return Path(value).resolve()


class IncidentInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    incident_type: str = Field(alias="incidentType", min_length=2, max_length=80)
    severity: Literal["Critical", "High", "Moderate"]
    category: str = Field(min_length=2, max_length=80)
    message: str = Field(default="", max_length=500)
    people_affected: int | None = Field(default=None, alias="peopleAffected", ge=1, le=99999)
    assistance_note: str = Field(default="", alias="assistanceNote", max_length=300)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    manual_location: str = Field(default="", alias="manualLocation", max_length=160)
    location_source: Literal["device", "manual", "unknown"] = Field(default="unknown", alias="locationSource")
    location_accuracy_meters: float | None = Field(default=None, alias="locationAccuracyMeters", ge=0, le=1_000_000)
    location_captured_at: str | None = Field(default=None, alias="locationCapturedAt", max_length=50)
    location_confidence: Literal["unknown", "low", "medium", "high"] = Field(
        default="unknown", alias="locationConfidence"
    )
    immediate_life_threat: bool | None = Field(default=None, alias="immediateLifeThreat")
    medical_urgency: bool | None = Field(default=None, alias="medicalUrgency")
    data_class: Literal["simulation", "external_observation", "historical_reference", "citizen_report"] = Field(
        default="simulation", alias="dataClass"
    )
    consent_confirmed: bool = Field(default=False, alias="consentConfirmed")
    source: str = Field(default="citizen_report", max_length=80)
    status: Literal["new", "triaged"] = "new"

    @model_validator(mode="after")
    def validate_location(self) -> "IncidentInput":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Provide both latitude and longitude.")
        if not self.manual_location and self.latitude is None:
            raise ValueError("Provide coordinates or a manual location description.")
        if self.location_source == "device":
            if self.latitude is None or self.location_accuracy_meters is None or self.location_captured_at is None:
                raise ValueError("Device coordinates require reported accuracy and capture time.")
        elif self.location_accuracy_meters is not None or self.location_captured_at is not None:
            raise ValueError("Accuracy and capture time are only valid for device-captured coordinates.")
        if self.location_captured_at is not None:
            try:
                captured_at = datetime.fromisoformat(self.location_captured_at.replace("Z", "+00:00"))
            except ValueError as error:
                raise ValueError("Location capture time must be a valid ISO timestamp.") from error
            if captured_at.tzinfo is None:
                raise ValueError("Location capture time must include a timezone.")
        if self.data_class == "citizen_report" and not self.consent_confirmed:
            raise ValueError("Consent must be confirmed before a citizen report is persisted.")
        return self


class IncidentPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    status: Literal["new", "triaged", "assigned", "resolved", "closed"] | None = None
    internal_note: str | None = Field(default=None, min_length=1, max_length=2000)


class ResourceInput(BaseModel):
    id: str | None = Field(default=None, max_length=80)
    name: str = Field(min_length=2, max_length=100)
    capabilities: list[str] = Field(default_factory=list, max_length=20)
    location: str = Field(min_length=2, max_length=160)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    is_simulated: Literal[True] = Field(default=True, alias="isSimulated")

    @model_validator(mode="after")
    def validate_coordinates(self) -> "ResourceInput":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Provide both resource coordinates.")
        return self


class AssignmentInput(BaseModel):
    resource_id: str = Field(min_length=1, max_length=80)


class PriorityOverrideInput(BaseModel):
    score: int = Field(ge=0, le=100)
    reason: str = Field(min_length=5, max_length=500)


class CategorySuggestionInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    text: str = Field(min_length=5, max_length=500)


class FloodSimulationInput(BaseModel):
    rainfall_mm: float = Field(alias="rainfallMm", ge=0, le=500, allow_inf_nan=False)
    water_level_m: float = Field(alias="waterLevelM", ge=0, le=20, allow_inf_nan=False)
    river_level_m: float = Field(alias="riverLevelM", ge=0, le=20, allow_inf_nan=False)
    terrain_elevation_m: float = Field(alias="terrainElevationM", ge=0, le=9000, allow_inf_nan=False)
    water_level_trend_m_per_hour: float = Field(alias="waterLevelTrendMPerHour", ge=-5, le=5, allow_inf_nan=False)
    horizon_hours: Literal[0, 1, 3, 6] = Field(alias="horizonHours")


class EarthquakeCache:
    def __init__(self) -> None:
        self.features: list[dict[str, Any]] = []
        self.last_success: str | None = None
        self.last_error: str | None = None
        self.fetched_monotonic: float = 0


async def fetch_usgs_feed(url: str = USGS_FEED_URL) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(8.0), follow_redirects=True) as client:
        response = await client.get(url, headers={"Accept": "application/geo+json"})
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
        raise ValueError("USGS returned an invalid GeoJSON FeatureCollection.")
    return payload


def normalize_earthquakes(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
        raise ValueError("Earthquake response is not a valid GeoJSON FeatureCollection.")
    normalized: list[dict[str, Any]] = []
    for item in payload["features"]:
        try:
            properties = item["properties"]
            coordinates = item["geometry"]["coordinates"]
            event_id = item["id"]
            epoch_ms = properties["time"]
            if not isinstance(event_id, str) or len(coordinates) < 2 or not isinstance(epoch_ms, (int, float)):
                continue
            longitude, latitude = float(coordinates[0]), float(coordinates[1])
            if not (math.isfinite(longitude) and math.isfinite(latitude) and
                    -180 <= longitude <= 180 and -90 <= latitude <= 90):
                continue
            event_time = datetime.fromtimestamp(epoch_ms / 1000, tz=UTC).isoformat().replace("+00:00", "Z")
            magnitude_value = properties.get("mag")
            magnitude = (
                float(magnitude_value)
                if isinstance(magnitude_value, (int, float)) and math.isfinite(float(magnitude_value))
                else None
            )
            depth_value = coordinates[2] if len(coordinates) > 2 else None
            depth = (
                float(depth_value)
                if isinstance(depth_value, (int, float)) and math.isfinite(float(depth_value))
                else None
            )
            place = properties.get("place")
            if not isinstance(place, str) or not place:
                place = "Unknown place"
            event_url = properties.get("url")
            normalized.append({
                "id": event_id,
                "magnitude": magnitude,
                "place": place,
                "time": event_time,
                "latitude": latitude,
                "longitude": longitude,
                "depth_km": depth,
                "url": (
                    event_url
                    if isinstance(event_url, str) and event_url.startswith("https://")
                    else f"https://earthquake.usgs.gov/earthquakes/eventpage/{event_id}"
                ),
            })
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
    return normalized


def connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    return connection


def initialize_database(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS resources (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                capabilities_json TEXT NOT NULL,
                location TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                is_simulated INTEGER NOT NULL CHECK(is_simulated = 1),
                available INTEGER NOT NULL DEFAULT 1,
                assigned_incident_id TEXT
            );
            CREATE TABLE IF NOT EXISTS incidents (
                id TEXT PRIMARY KEY,
                idempotency_key TEXT NOT NULL UNIQUE,
                incident_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                category TEXT NOT NULL,
                message TEXT NOT NULL,
                people_affected INTEGER,
                assistance_note TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                manual_location TEXT NOT NULL,
                location_source TEXT NOT NULL DEFAULT 'unknown',
                location_accuracy_meters REAL,
                location_captured_at TEXT,
                location_confidence TEXT NOT NULL,
                immediate_life_threat INTEGER,
                medical_urgency INTEGER,
                data_class TEXT NOT NULL,
                source TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                internal_notes_json TEXT NOT NULL DEFAULT '[]',
                assigned_resource_id TEXT REFERENCES resources(id),
                priority_score INTEGER NOT NULL,
                priority_json TEXT NOT NULL,
                override_score INTEGER,
                override_reason TEXT,
                consent_confirmed INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS incidents_status_created ON incidents(status, created_at);
            """
        )
        incident_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(incidents)").fetchall()
        }
        if "consent_confirmed" not in incident_columns:
            connection.execute(
                "ALTER TABLE incidents ADD COLUMN consent_confirmed INTEGER NOT NULL DEFAULT 0"
            )
        for column, definition in (
            ("location_source", "TEXT NOT NULL DEFAULT 'unknown'"),
            ("location_accuracy_meters", "REAL"),
            ("location_captured_at", "TEXT"),
        ):
            if column not in incident_columns:
                connection.execute(f"ALTER TABLE incidents ADD COLUMN {column} {definition}")
        for resource_id, name, capabilities, location in DEMO_RESOURCES:
            connection.execute(
                """INSERT OR IGNORE INTO resources
                (id,name,capabilities_json,location,is_simulated,available)
                VALUES (?,?,?,?,1,1)""",
                (resource_id, name, json.dumps(capabilities.split(",")), location),
            )


def bool_or_none(value: int | None) -> bool | None:
    return None if value is None else bool(value)


def incident_dict(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["immediate_life_threat"] = bool_or_none(item["immediate_life_threat"])
    item["medical_urgency"] = bool_or_none(item["medical_urgency"])
    item["consent_confirmed"] = bool(item["consent_confirmed"])
    item["internal_notes"] = json.loads(item.pop("internal_notes_json"))
    item["priority"] = json.loads(item.pop("priority_json"))
    item["priority"]["score"] = item["override_score"] if item["override_score"] is not None else item["priority"]["score"]
    item["priority"]["override_reason"] = item["override_reason"]
    item["assigned_resource_id"] = item["assigned_resource_id"]
    return item


def resource_dict(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["capabilities"] = json.loads(item.pop("capabilities_json"))
    item["is_simulated"] = bool(item.pop("is_simulated"))
    item["available"] = bool(item.pop("available"))
    return item


def priority_input(value: IncidentInput, incident_id: str, created_at: str) -> dict[str, Any]:
    data = value.model_dump(by_alias=False)
    return {
        **data,
        "id": incident_id,
        "created_at": created_at,
        "immediate_life_threat": value.immediate_life_threat,
        "medical_urgency": value.medical_urgency,
    }


async def probe_source(name: str, url: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0), follow_redirects=True) as client:
            response = await client.head(url, headers={"Accept": "text/html"})
        return {
            "name": name,
            "url": url,
            "page_reachable": response.is_success,
            "http_status": response.status_code,
            "data_available": False,
            "last_successful_retrieval": None,
            "integration_status": "landing_page_only",
            "data_class": "external_source_metadata",
            "limitations": "A reachable information page is not a verified machine-readable hazard-data integration.",
        }
    except httpx.HTTPError as error:
        return {
            "name": name,
            "url": url,
            "page_reachable": False,
            "http_status": None,
            "data_available": False,
            "last_successful_retrieval": None,
            "integration_status": "unavailable",
            "data_class": "external_source_metadata",
            "error": str(error),
            "limitations": "The page could not be reached from this API process.",
        }


async def probe_cdse_catalogue() -> dict[str, Any]:
    query = {
        "$filter": "Collection/Name eq 'SENTINEL-2'",
        "$orderby": "ContentDate/Start desc",
        "$top": "1",
        "$select": "Id,Name,ContentDate",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0), follow_redirects=True) as client:
            response = await client.get(CDSE_CATALOGUE_URL, params=query, headers={"Accept": "application/json"})
            response.raise_for_status()
            body = response.json()
        products = body.get("value") if isinstance(body, dict) else None
        if not isinstance(products, list):
            raise ValueError("CDSE catalogue returned an invalid OData response.")
        product = products[0] if products else None
        return {
            "name": "Copernicus Data Space",
            "url": CDSE_CATALOGUE_URL,
            "page_reachable": True,
            "http_status": response.status_code,
            "data_available": False,
            "metadata_available": product is not None,
            "data_returned": product,
            "last_successful_retrieval": utc_now(),
            "integration_status": "public_catalogue_metadata" if product else "catalogue_empty",
            "data_class": "external_observation_metadata",
            "requires_credentials": True,
            "limitations": "This unauthenticated query returns only the newest Sentinel-2 product metadata, not imagery. Product download/processing requires credentials and product-specific quota/licence checks.",
        }
    except (httpx.HTTPError, ValueError, TypeError) as error:
        return {
            "name": "Copernicus Data Space",
            "url": CDSE_CATALOGUE_URL,
            "page_reachable": False,
            "http_status": None,
            "data_available": False,
            "metadata_available": False,
            "data_returned": None,
            "last_successful_retrieval": None,
            "integration_status": "unavailable",
            "data_class": "external_observation_metadata",
            "requires_credentials": True,
            "error": str(error),
            "limitations": "The public catalogue query failed; product download/processing credentials would still be required.",
        }


def create_app(
    database_path: Path | None = None,
    *,
    earthquake_fetcher=fetch_usgs_feed,
    source_probe_fn=probe_source,
    cdse_probe_fn=probe_cdse_catalogue,
) -> FastAPI:
    db_path = database_path or default_database_path()
    initialize_database(db_path)
    earthquake_cache = EarthquakeCache()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield

    app = FastAPI(title="Project ArkGrid API", version="0.1.0", lifespan=lifespan)
    allowed_origins = os.getenv("ARKGRID_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173").split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in allowed_origins if origin.strip()],
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Content-Type", "Idempotency-Key", "X-Coordinator-Token"],
    )

    def find_incident(connection: sqlite3.Connection, incident_id: str) -> sqlite3.Row:
        row = connection.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Incident not found.")
        return row

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        try:
            with connect(db_path) as connection:
                connection.execute("SELECT 1").fetchone()
            return {"status": "ok", "database": "available", "time": utc_now()}
        except sqlite3.Error as error:
            raise HTTPException(status_code=503, detail="SQLite database is unavailable.") from error

    @app.post("/api/flood/demo-simulation")
    def flood_demo_simulation(payload: FloodSimulationInput) -> dict[str, Any]:
        inputs = FloodInputs(
            rainfall_mm=payload.rainfall_mm,
            water_level_m=payload.water_level_m,
            river_level_m=payload.river_level_m,
            terrain_elevation_m=payload.terrain_elevation_m,
            water_level_trend_m_per_hour=payload.water_level_trend_m_per_hour,
            horizon_hours=payload.horizon_hours,
        )
        try:
            return run_demo_scenario(inputs)
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail="The synthetic flood model is unavailable.") from error

    @app.get("/api/scenarios")
    def scenarios() -> dict[str, list[dict[str, str]]]:
        return {"items": [
            {"id": "generic", "name": "Custom area", "data_class": "interactive_context"},
            {"id": "nepal-historical-demo", "name": "Nepal historical flood demonstration", "data_class": "historical_reference"},
        ]}

    @app.post("/api/ml/category-suggestion")
    def category_suggestion(payload: CategorySuggestionInput) -> dict[str, str | float | None]:
        return suggest_category(payload.text)

    @app.get("/api/incidents")
    def list_incidents(
        search: str = Query(default="", max_length=160),
        incident_type: str | None = Query(default=None, alias="type", max_length=80),
        severity: str | None = Query(default=None, max_length=20),
        status: str | None = Query(default=None, max_length=20),
        location: str | None = Query(default=None, max_length=160),
    ) -> dict[str, Any]:
        query = "SELECT * FROM incidents WHERE 1=1"
        parameters: list[Any] = []
        for column, value in (
            ("incident_type", incident_type),
            ("severity", severity),
            ("status", status),
        ):
            if value:
                query += f" AND {column} = ?"
                parameters.append(value)
        if search:
            query += " AND (incident_type LIKE ? OR category LIKE ? OR message LIKE ? OR manual_location LIKE ?)"
            parameters.extend([f"%{search}%"] * 4)
        if location:
            query += " AND manual_location LIKE ?"
            parameters.append(f"%{location}%")
        query += " ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'triaged' THEN 1 WHEN 'assigned' THEN 2 ELSE 3 END, priority_score DESC, created_at DESC"
        try:
            with connect(db_path) as connection:
                rows = connection.execute(query, parameters).fetchall()
            return {"items": [incident_dict(row) for row in rows], "total": len(rows)}
        except sqlite3.Error as error:
            raise HTTPException(status_code=503, detail="Incidents could not be read from SQLite.") from error

    @app.post("/api/incidents", status_code=201)
    def create_incident(
        payload: IncidentInput,
        response: Response,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> dict[str, Any]:
        key = idempotency_key or str(uuid.uuid4())
        if len(key) > 200 or not key.strip():
            raise HTTPException(status_code=422, detail="Idempotency-Key must be between 1 and 200 characters.")
        try:
            with connect(db_path) as connection:
                existing = connection.execute("SELECT * FROM incidents WHERE idempotency_key = ?", (key,)).fetchone()
                if existing:
                    response.status_code = 200
                    return incident_dict(existing)
                incident_id = str(uuid.uuid4())
                now = utc_now()
                assessment = calculate_priority(priority_input(payload, incident_id, now))
                connection.execute(
                    """INSERT INTO incidents
                    (id,idempotency_key,incident_type,severity,category,message,people_affected,assistance_note,
                    latitude,longitude,manual_location,location_source,location_accuracy_meters,location_captured_at,
                    location_confidence,immediate_life_threat,medical_urgency,
                    data_class,source,status,created_at,updated_at,priority_score,priority_json,consent_confirmed)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        incident_id, key, payload.incident_type, payload.severity, payload.category, payload.message,
                        payload.people_affected, payload.assistance_note, payload.latitude, payload.longitude,
                        payload.manual_location, payload.location_source, payload.location_accuracy_meters,
                        payload.location_captured_at, payload.location_confidence,
                        None if payload.immediate_life_threat is None else int(payload.immediate_life_threat),
                        None if payload.medical_urgency is None else int(payload.medical_urgency),
                        payload.data_class, payload.source, payload.status, now, now, assessment["score"],
                        json.dumps(assessment), int(payload.consent_confirmed),
                    ),
                )
                return incident_dict(find_incident(connection, incident_id))
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="Incident conflicted with an existing record.") from error
        except sqlite3.Error as error:
            raise HTTPException(status_code=503, detail="Incident could not be persisted in SQLite.") from error

    @app.get("/api/incidents/{incident_id}")
    def get_incident(incident_id: str) -> dict[str, Any]:
        try:
            with connect(db_path) as connection:
                return incident_dict(find_incident(connection, incident_id))
        except sqlite3.Error as error:
            raise HTTPException(status_code=503, detail="Incident could not be read from SQLite.") from error

    @app.patch("/api/incidents/{incident_id}")
    def patch_incident(incident_id: str, patch: IncidentPatch) -> dict[str, Any]:
        updates = {key: value for key, value in patch.model_dump(exclude_unset=True).items() if value is not None}
        if not updates:
            raise HTTPException(status_code=422, detail="Provide a status or internal_note update.")
        try:
            with connect(db_path) as connection:
                row = find_incident(connection, incident_id)
                now = utc_now()
                if "status" in updates and updates["status"] != row["status"]:
                    transitions = {
                        "new": {"triaged", "closed"},
                        "triaged": {"assigned", "resolved", "closed"},
                        "assigned": {"triaged", "resolved", "closed"},
                        "resolved": {"closed", "triaged"},
                        "closed": set(),
                    }
                    if updates["status"] not in transitions[row["status"]]:
                        raise HTTPException(status_code=409, detail=f"Invalid status transition: {row['status']} → {updates['status']}.")
                    connection.execute("UPDATE incidents SET status = ?, updated_at = ? WHERE id = ?", (updates["status"], now, incident_id))
                if "internal_note" in updates:
                    notes = json.loads(row["internal_notes_json"])
                    notes.append({"text": updates["internal_note"], "created_at": now})
                    connection.execute(
                        "UPDATE incidents SET internal_notes_json = ?, updated_at = ? WHERE id = ?",
                        (json.dumps(notes), now, incident_id),
                    )
                return incident_dict(find_incident(connection, incident_id))
        except sqlite3.Error as error:
            raise HTTPException(status_code=503, detail="Incident update could not be persisted.") from error

    @app.get("/api/resources")
    def list_resources() -> dict[str, Any]:
        with connect(db_path) as connection:
            rows = connection.execute("SELECT * FROM resources ORDER BY id").fetchall()
        items = [resource_dict(row) for row in rows]
        return {
            "items": items,
            "total": len(items),
            "connected_real_resources": 0,
            "notice": "All resources currently stored by this demo API are fictional demonstration fixtures.",
        }

    @app.post("/api/resources", status_code=201)
    def create_resource(payload: ResourceInput) -> dict[str, Any]:
        resource_id = payload.id or f"SIM-RES-{uuid.uuid4().hex[:8].upper()}"
        try:
            with connect(db_path) as connection:
                connection.execute(
                    """INSERT INTO resources (id,name,capabilities_json,location,latitude,longitude,is_simulated,available)
                    VALUES (?,?,?,?,?,?,1,1)""",
                    (resource_id, payload.name, json.dumps(payload.capabilities), payload.location, payload.latitude, payload.longitude),
                )
                row = connection.execute("SELECT * FROM resources WHERE id = ?", (resource_id,)).fetchone()
                return resource_dict(row)
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="Resource identifier already exists.") from error
        except sqlite3.Error as error:
            raise HTTPException(status_code=503, detail="Resource could not be persisted.") from error

    @app.post("/api/incidents/{incident_id}/assign")
    def assign_resource(incident_id: str, payload: AssignmentInput) -> dict[str, Any]:
        try:
            with connect(db_path) as connection:
                incident = find_incident(connection, incident_id)
                resource = connection.execute("SELECT * FROM resources WHERE id = ?", (payload.resource_id,)).fetchone()
                if resource is None:
                    raise HTTPException(status_code=404, detail="Resource not found.")
                if not resource["is_simulated"]:
                    raise HTTPException(status_code=409, detail="Only explicitly simulated resources can be assigned in this demo.")
                if not resource["available"]:
                    raise HTTPException(status_code=409, detail="Resource is not available.")
                if incident["status"] not in ("new", "triaged", "assigned"):
                    raise HTTPException(status_code=409, detail="Incident is not eligible for assignment.")
                now = utc_now()
                connection.execute(
                    "UPDATE resources SET available = 0, assigned_incident_id = ? WHERE id = ?",
                    (incident_id, payload.resource_id),
                )
                connection.execute(
                    "UPDATE incidents SET assigned_resource_id = ?, status = 'assigned', updated_at = ? WHERE id = ?",
                    (payload.resource_id, now, incident_id),
                )
                return incident_dict(find_incident(connection, incident_id))
        except sqlite3.Error as error:
            raise HTTPException(status_code=503, detail="Resource assignment could not be persisted.") from error

    @app.get("/api/incidents/{incident_id}/priority")
    def get_priority(incident_id: str) -> dict[str, Any]:
        with connect(db_path) as connection:
            return incident_dict(find_incident(connection, incident_id))["priority"]

    @app.post("/api/incidents/{incident_id}/priority-override")
    def override_priority(
        incident_id: str,
        payload: PriorityOverrideInput,
        x_coordinator_token: str | None = Header(default=None, alias="X-Coordinator-Token"),
    ) -> dict[str, Any]:
        configured_token = os.getenv("ARKGRID_COORDINATOR_TOKEN", "")
        if not configured_token:
            raise HTTPException(status_code=503, detail="Priority overrides are disabled until coordinator authentication is configured.")
        if not x_coordinator_token or not hmac.compare_digest(configured_token, x_coordinator_token):
            raise HTTPException(status_code=401, detail="Valid coordinator authentication is required.")
        now = utc_now()
        with connect(db_path) as connection:
            find_incident(connection, incident_id)
            connection.execute(
                "UPDATE incidents SET override_score = ?, override_reason = ?, updated_at = ? WHERE id = ?",
                (payload.score, payload.reason, now, incident_id),
            )
            return incident_dict(find_incident(connection, incident_id))["priority"]

    @app.get("/api/earthquakes")
    @app.get("/api/hazards/earthquakes")
    async def earthquakes(min_magnitude: float = Query(default=-2, ge=-2, le=10)) -> dict[str, Any]:
        now_monotonic = asyncio.get_running_loop().time()
        if not earthquake_cache.last_success or now_monotonic - earthquake_cache.fetched_monotonic >= 60:
            try:
                payload = await earthquake_fetcher()
                features = normalize_earthquakes(payload)
                earthquake_cache.features = features
                earthquake_cache.last_success = utc_now()
                earthquake_cache.fetched_monotonic = now_monotonic
                earthquake_cache.last_error = None
            except (httpx.HTTPError, ValueError, TypeError) as error:
                earthquake_cache.last_error = str(error)
                if not earthquake_cache.last_success:
                    raise HTTPException(
                        status_code=503,
                        detail={
                            "message": "The USGS earthquake feed is unavailable; no live observations are being shown.",
                            "source_url": USGS_FEED_URL,
                            "fetched_at": None,
                        },
                    ) from error
        features = [feature for feature in earthquake_cache.features if feature["magnitude"] is None or feature["magnitude"] >= min_magnitude]
        return {
            "items": features,
            "total": len(features),
            "source_name": "USGS Earthquake Hazards Program",
            "source_url": USGS_FEED_URL,
            "data_class": "external_observation",
            "fetched_at": earthquake_cache.last_success,
            "stale": earthquake_cache.last_error is not None,
            "error": earthquake_cache.last_error,
            "disclaimer": "Recent observations only; this feed does not predict earthquakes.",
        }

    @app.get("/api/sources/status")
    async def source_status() -> dict[str, Any]:
        source_items = await asyncio.gather(
            *(
                cdse_probe_fn() if name == "Copernicus Data Space" else source_probe_fn(name, url)
                for name, url in SOURCE_PAGES.items()
            )
        )
        usgs_state = "not_yet_retrieved" if not earthquake_cache.last_success else (
            "stale" if earthquake_cache.last_error else "available"
        )
        items = [
            {
                "name": "USGS earthquakes",
                "url": USGS_FEED_URL,
                "page_reachable": usgs_state == "available",
                "http_status": None,
                "data_available": bool(earthquake_cache.last_success and not earthquake_cache.last_error),
                "last_successful_retrieval": earthquake_cache.last_success,
                "integration_status": usgs_state,
                "data_class": "external_observation",
                "requires_credentials": False,
                "limitations": "All-day feed; observations are not predictions. The API refreshes the feed on demand and caches successful results for 60 seconds.",
                "error": earthquake_cache.last_error,
            },
            *source_items,
        ]
        for item in items:
            item.setdefault("requires_credentials", item["name"] in ("Copernicus Data Space", "CEMS Emergency Mapping"))
            if item["name"] == "GloFAS":
                item["limitations"] = "A public information page is not a verified forecast-data integration; product access, licence, run time, coverage, and processing still need validation."
            elif item["name"] == "CEMS Emergency Mapping":
                item["limitations"] = "A public information page is not an operational activation or a machine-readable mapping-product integration."
        return {"items": items, "checked_at": utc_now()}

    return app


app = create_app()
