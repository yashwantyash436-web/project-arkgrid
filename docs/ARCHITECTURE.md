# ArkGrid — Architecture

## Recommended shape

Build a modular monolith: one React PWA, one FastAPI service, and one database. This delivers a credible end-to-end hackathon application with fewer moving parts, while retaining clean provider and analysis boundaries for later scale-out.

```text
Browser PWA (React + TypeScript + Leaflet)
  | HTTPS JSON / GeoJSON                    | IndexedDB queue + cache
  v                                      <---+ Service worker
FastAPI application
  ├─ API routes / validation / rate limits
  ├─ Domain services: incidents, SOS, priority, duplicate detection
  ├─ Provider adapters: USGS, Copernicus/CEMS, geocoder
  ├─ Background job runner: EO analysis/import only
  └─ Repository layer
       └─ SQLite (MVP) → PostgreSQL + PostGIS (when spatial querying/hosting requires it)
```

External providers are accessed only by FastAPI. The frontend never contains provider credentials and never directly treats external responses as ArkGrid incident records.

## Component responsibilities

| Component | Responsibility | Explicit boundary |
| --- | --- | --- |
| React PWA | Presentation, map interactions, local offline queue, accessible forms | Does not calculate authoritative hazards or retain API secrets. |
| Leaflet | Basemap and vector/raster visualisation | Layers have a legend, freshness, source, and `data_class`. |
| FastAPI | Stable ArkGrid API, validation, orchestration, provider normalization | Does not claim provider data is independently verified. |
| Provider adapters | Fetch/cache/normalize one provider per adapter | Raw payload and fetch metadata retained for traceability. |
| Analysis worker | Bounded EO/import jobs | Separate queue/process from HTTP request; no long raster work in request handlers. |
| Database | Durable domain records and job provenance | SQLite for one instance; migrate before multi-instance/complex spatial operations. |

## Domain model

- `area_of_interest`: UUID, name, geometry/bbox, selected scenario, created time.
- `external_event`: provider + provider_event_id (unique), event type, geometry, observed/updated time, normalized properties, raw reference, `external_observation` or `external_forecast`.
- `incident`: ArkGrid operational record linked to zero/many external events and SOS reports; lifecycle `new → triaged → assigned → resolved/closed`.
- `sos_report`: client-generated UUID/idempotency key, status, need category, people count, coordinates/accuracy, consent, queued/synced times. Store contact data separately and minimise it.
- `priority_assessment`: versioned score, components, reason codes, calculated time, reviewer override and reason.
- `resource`: demo-only initially; type, capacity, availability, geometry, `simulation` class.
- `analysis_job` / `analysis_result`: input product IDs/AOI/parameters, state, output URI/geometry, method version, limitations.
- `scenario`: fixture metadata, historical reference citations, active flag. No hard-coded country logic.

Use UUIDs for ArkGrid records; retain provider IDs unchanged. Every displayable record has `source_name`, `source_url`, `data_class`, `observed_at`, `fetched_at`, and `disclaimer` where relevant.

## API outline

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/health` | Service and dependency health (never exposes secrets). |
| `GET /api/v1/earthquakes?bbox=&min_magnitude=` | Cached, normalized USGS GeoJSON with source/freshness metadata. |
| `GET /api/v1/map/features?bbox=&layers=` | ArkGrid incidents/SOS/resources as GeoJSON. |
| `POST /api/v1/sos-reports` | Validated, idempotent creation of a simulated/approved SOS report. |
| `GET /api/v1/incidents` / `PATCH /api/v1/incidents/{id}` | Coordinator queue and controlled lifecycle changes. |
| `GET /api/v1/incidents/{id}/priority` | Score and reason codes, not a black-box label. |
| `GET /api/v1/scenarios` / `POST /api/v1/scenarios/{id}/load` | Discover/load controlled fixture scenario for demo. |
| `GET /api/v1/imagery/availability` | Metadata only at first; proxies/normalizes approved provider result. |
| `POST /api/flood/demo-simulation` | Bounded synthetic logistic-regression demonstration, synthetic cell scores, and illustrative route ranking. Not a real-data forecast or operational router. |

Define OpenAPI-generated TypeScript client types rather than hand-copying request models. Version endpoints from the first release.

## Location independence

Locations are coordinates, an AOI geometry/bbox, time range, and optional human label. Provider capability is configuration-driven (`earthquake`, `imagery_catalog`, `flood_forecast`, `historical_layer`), not selected with `if country == ...`. A scenario is data plus configuration, so Nepal remains one selectable dataset among many.

## Key workflows

### Earthquake monitoring

Scheduled fetch → USGS adapter validates GeoJSON → upsert by provider event ID → cache normalized response → map/API. The UI calls it “recent USGS earthquake observations”, displays fetch time, and shows unavailable/stale status on failure. Monitoring is not prediction.

In the current implementation the actual feed is `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson`, which is global. The backend caches successful responses in memory for 60 seconds, validates WGS84 longitude/latitude, and applies the requested minimum magnitude. The Live monitoring map starts at a world extent and separately offers the configured demo region; city search, clustering, and nearby-radius search are not implemented.

### Offline SOS

Form validates locally → writes report with UUID to IndexedDB → UI shows `Queued on this device` → connectivity/service-worker sync attempts `POST` with idempotency key → server returns existing/created record → client marks it synced. Background Sync is progressive enhancement; an in-app “Sync now” action is required because browser support varies.

SMS uses a user-activated `sms:` link, with platform-specific body separators. It records only a handoff request, user-reported cancellation, or a user-reported send attempt. Browsers cannot reliably confirm composer launch or carrier delivery; there is no carrier/native SMS provider or receipt integration. Precise location is omitted until the user enables the location-sharing option in the review screen.

### Flood-model demonstration

`services/api/app/flood_risk.py` contains a deterministic synthetic-data trainer and inference interface. The checked-in model artifact is generated with `services/api/scripts/train_flood_demo_model.py`; synthetic train/held-out metrics are metadata, not evidence of real-world skill. The endpoint validates bounded inputs, reports an uncalibrated risk score (not probability), and returns scenario cells plus synthetic route-graph candidates. The frontend provides the timeline and explicit missing-real-data warning. This demo has no real rainfall, gauge, terrain, flood extent, settlement, or road-network inputs; neither cells nor routes are actionable.

### Priority and duplicate handling

On report create/update, deterministic duplicate candidates use a configurable time window, radius, category, and safe contact comparison. The system suggests links; a coordinator decides. Priority uses a documented weighted formula such as urgency + vulnerable people + number affected + report recency + access/verification indicators. It must return each component/reason and permit logged override.

## Folder structure

```text
ArkGrid/
  apps/web/                 # React PWA
    src/{features,components,lib,offline,map}/
  services/api/
    app/{api,core,db,models,schemas,repositories,services,providers,workers}/
    tests/
  packages/contracts/       # generated/shared API types (optional initially)
  data/{fixtures,scenarios,sample-aoi}/
  docs/
  infra/                    # deployment definitions later
  scripts/
  .env.example              # names only, no values/secrets
  README.md
```

## Evolution triggers

Stay on SQLite while one API instance handles a hackathon demo. Move to PostgreSQL/PostGIS when deploying multiple instances, needing robust geometry indexes/intersections, or retaining substantial spatial data. Move EO jobs to a dedicated worker/queue only after a bounded local task works; do not add distributed infrastructure pre-emptively.
