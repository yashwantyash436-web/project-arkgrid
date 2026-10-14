# ArkGrid — Development Roadmap

## Guiding delivery rule

Finish a thin, testable vertical slice before adding hazards, imagery, or ML. Each phase must leave the application demonstrably working; it must not turn into a collection of disconnected screens or API experiments.

## Phase 0 — Project setup and evidence

- Add the presentation if available; extract claims and reconcile them with these documents.
- Create Git repository, `.gitignore`, `README`, `.env.example`, issue board, and decisions log.
- Scaffold `apps/web` and `services/api`; pin tool versions.
- Define demo-data policy: synthetic contacts and resources only.

**Exit:** a clean repository, environment starts locally, and no credentials are committed.

## Phase 1 — Foundation and location-aware map

- React/TypeScript/Tailwind PWA shell; FastAPI health endpoint; SQLite migrations.
- Leaflet map, OpenStreetMap attribution, location search/geocoding choice, AOI selection, responsive layout.
- Domain records and API contracts for AOI, incident, SOS, source metadata, and `data_class`.
- Seed a minimal generic demo scenario, not Nepal-specific behavior.

**Exit:** select any AOI; map/API/database pipeline works with fixture incident features.

## Phase 2 — First complete workflow (recommended first demo)

- USGS backend adapter with refresh/cache/error handling and normalized GeoJSON endpoint.
- Earthquake layer and source/freshness panel.
- Simulated SOS form → persistent SQLite report → coordinator queue/map.
- Deterministic priority score and duplicate suggestions with explanations.

**Exit:** select location → view current USGS observations → submit a simulation report → see it persisted, prioritized, and mapped.

## Phase 3 — Offline protection

- Manifest, service worker, app shell cache, IndexedDB SOS outbox.
- Idempotent sync API, manual sync control, online/offline/failed status.
- Test reload/offline/reconnect paths on a mobile browser.

**Exit:** a simulated SOS made offline survives reload and syncs once when reconnected.

## Phase 4 — Nepal historical scenario and coordination polish

- Select a published Nepal flood event only after source/licence/date are recorded.
- Add cited historical layers/summary and simulated resources; strong labels.
- Incident status workflow, filters, resource overlay, priority rationale/override audit.
- Demo script and accessibility pass.

**Exit:** Nepal scenario is reproducible, cited, and cannot be mistaken for live data.

## Phase 5 — Satellite imagery and scoped flood information

- Register/use CDSE credentials server-side; validate quota, authentication, terms, imagery availability, and CORS through backend proxy/service.
- Start with catalogue/availability metadata. Add Sentinel imagery preview only if download/render cost is bounded.
- Evaluate GloFAS/CEMS data routes per product; show source time, forecast-vs-observation distinction, and coverage.
- Prototype one repeatable analysis on a small AOI (for example documented SAR change detection), save provenance, and validate against a known case.

**Exit:** one source-backed EO/flood capability has a reproducible test case and clearly bounded claim.

## Phase 6 — Hardening and deployment

- Authentication/roles if coordinator actions leave the demo environment; privacy retention/deletion policy.
- Rate limits, structured logs, error tracking, backups, HTTPS, environment-separated configuration.
- Deploy web/API/database; test public URL, source failure, and rollback.
- Run acceptance, performance, security, and demo rehearsal.

**Exit:** a documented deployment with tested critical path and known limitations.

## Deliberately deferred

ML classification, advanced flood modelling, live SMS, Bluetooth mesh, automated resource dispatch, continuous imagery processing, and location prediction. These require data quality, field validation, safety/privacy review, and often paid or platform-specific services.

## Initial end-to-end workflow

1. User selects an AOI and opens ArkGrid.
2. Web app calls ArkGrid API for cached recent USGS earthquakes; map renders a labelled external-observation layer.
3. User files a **simulated** SOS; offline submissions enter the IndexedDB outbox.
4. API validates and idempotently stores the report, evaluates duplicate candidates, and calculates a versioned rule score.
5. Coordinator dashboard displays the report, its score components, status, and simulated resources.

This path proves map, real external monitoring, storage, offline behaviour, and coordination without overstating flood/ML capabilities.

## Required software and accounts

- Git and GitHub account/repository.
- Node.js current LTS and a package manager (recommend npm initially for fewer decisions).
- Python 3.11+ and virtual-environment tooling.
- Modern Chrome/Edge/Firefox for PWA testing; Android device/emulator if available.
- Copernicus Data Space account only when beginning imagery work; keep credentials in backend environment variables.
- Optional later: PostgreSQL/PostGIS, a hosting account, error monitoring, SMS provider account.

## Environment verification commands (PowerShell)

```powershell
git --version
node --version
npm --version
python --version
py -3.11 --version
git status
```

After scaffolding, add project-specific commands such as `npm run lint`, `npm run test`, `npm run build`, `pytest`, and `ruff check .`; do not claim them usable before package configuration exists.
