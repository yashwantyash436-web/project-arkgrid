# Project ArkGrid

ArkGrid is a geospatial disaster-intelligence prototype for observations, citizen reports, offline emergency record keeping, and coordinator review. It is a **demonstration system**, not an emergency service; it does not dispatch responders or guarantee communications or rescue.

## Implemented demo capabilities

- React, TypeScript, Vite, Tailwind, Leaflet, and an installable PWA shell.
- Local SOS queue and trusted-contact storage in IndexedDB, with deliberate SMS-composer/copy handoff. The UI never claims SMS delivery or automatic synchronization.
- Named trusted contacts (name, relationship, E.164 phone, optional note), stored in this browser profile only. Existing saved phone-only entries are retained and presented as editable legacy contacts.
- Optional latest-only recent location, recorded only after an explicit location action. There is no background or continuous location tracking.
- Independent browser connectivity hints and API health checks (initially, after online/focus events, and every 30 seconds while visible), plus a persistent last successful health-check time. Optional automatic Emergency Mode navigation is limited to the Overview so an active form is not interrupted.
- User-triggered device location capture with browser-reported accuracy/time, manual coordinate entry, and explicit coordinate provenance carried into synchronized incident records.
- FastAPI service with SQLite persistence for incident reports, status changes, internal notes, and explicitly fictional resources.
- Overview metrics use persisted API records, demo-resource availability, the backend USGS freshness response, and this device's local pending queue; API failures appear as unavailable rather than fabricated zeroes.
- Idempotent manual synchronization of locally saved emergency reports using their client report ID.
- The local queue retains sync attempt counts and the server incident ID after acknowledgement; retries remain keyed to the stable client report ID.
- Recent USGS all-day earthquake observations, fetched and cached by the API, with freshness/error status and map markers.
- Deterministic, explainable rules-based incident priority. A configured coordinator token is required to record score overrides.
- External-source reachability/status cards. Copernicus Data Space is probed for public catalogue **metadata only**; no imagery is downloaded or analyzed.

Flood forecasts/extents, operational Copernicus Emergency Management activations, rendered satellite imagery, real responder resources, dispatch, authenticated general coordinator roles, and production deployment are **not implemented**. CEMS/GloFAS page reachability is not hazard data. The Citizen SOS form creates clearly labelled simulation records. Emergency Mode reports synchronized only after an explicit upload confirmation are classified as unverified `citizen_report` records; they are not independently confirmed or dispatched. All resources are fictional. Do not use this demo for real emergencies or enter real personal data.

## Requirements

- Node.js 20.19+ or 22.12+, pnpm 10.
- Python 3.12–3.14.
- PowerShell examples below assume the repository root as the current directory.

## Start the API

Create a virtual environment and install the backend plus test dependencies:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e "services/api[test]"
```

If using Python 3.13 or 3.14 instead, replace `py -3.12` with the selected installed version. The database defaults to `services/api/arkgrid.sqlite3` and persists between service restarts; do not delete it if you need to retain demo records.

Start the API from the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir services/api --reload --host 127.0.0.1 --port 8000
```

Optional API environment variables:

```powershell
$env:DATABASE_URL = "sqlite:///./services/api/arkgrid.sqlite3"
$env:ARKGRID_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
$env:ARKGRID_COORDINATOR_TOKEN = "<choose a private local demo token>"
```

The coordinator token is only for the server's priority-override route; never put it in a `VITE_` variable or commit it. Without it, overrides are disabled. API routes other than that override are not role-authenticated or production-hardened.

## Start the web app

In a second PowerShell window:

```powershell
pnpm --dir apps\web install --frozen-lockfile
pnpm --dir apps\web run dev
```

Vite proxies `/api` to `http://127.0.0.1:8000` during local development. For a separately hosted API, copy `apps/web/.env.example` to `apps/web/.env.local` and set `VITE_ARKGRID_API_URL` to its public base URL. Only the API URL belongs in frontend configuration; provider/coordinator credentials must remain server-side. When the API is unavailable, live observations and persisted-coordinator views show an error, while locally saved Emergency Mode reports remain on-device and unsynchronized.

## Deploy on Render

This repository includes a Render Blueprint at [`render.yaml`](./render.yaml). It provisions:

- a free-tier API service running FastAPI and SQLite on Render's ephemeral filesystem (database records can be lost on restart or redeploy),
- a frontend static site built from the Vite app,
- the required environment configuration for the web app to reach the API.

To deploy it:

1. Sign in to Render and create a new Blueprint import.
2. Connect this repository.
3. Review the generated services and confirm the API hostname matches the frontend environment variable.
4. Set a secure `ARKGRID_COORDINATOR_TOKEN` in the Render dashboard if you want override support enabled.
5. Deploy the blueprint.

The frontend static site is declared using Render's `type: web` with `runtime: static` format. It expects the backend to be available at `https://arkgrid-api.onrender.com` unless you rename the service or change the `VITE_ARKGRID_API_URL` value in the Render dashboard.

## Offline and PWA testing

The Vite development server intentionally does not register the service worker. For offline-shell testing, build and serve the production bundle locally:

```powershell
pnpm --dir apps\web run build
pnpm --dir apps\web run preview -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/` online and wait until the UI says the offline app shell is cached. This first successful visit is required; first-visit offline use is impossible because the browser has not yet downloaded the shell. Then visit Emergency Mode and create a fictional test report. Use Chrome DevTools Network throttling set to Offline, or disable the network adapter, and reload `/emergency`. IndexedDB reports should remain; map tiles, API requests, SMS, and external data will not work offline. Restore the network and explicitly select Sync pending; confirm the consent prompt and inspect the backend acknowledgement. A sync acknowledgement is database persistence only, not delivery or dispatch.

ArkGrid shows two separate statuses: browser connectivity events/`navigator.onLine` are hints; API reachability is checked against `/api/health`. The API check runs on app load, browser `online`/window-focus/visibility return, and every 30 seconds while visible. The Offline/Unavailable banner offers Emergency Mode. The optional automatic transition preference is stored in this browser and only navigates from Overview; it does not interrupt an open report form. An external-source status remains separate from API reachability.

## Trusted contacts, location and SMS

Open **Trusted contacts** in the main navigation. Add a name, relationship, phone number in international E.164 format (including country code, for example `+14155550123`), and optional note. Contacts are stored locally in IndexedDB only; there is no user account, server-side contact sync, authentication, or recovery/export feature. They may be lost if browser storage is cleared and are accessible to someone with access to the browser profile. Existing phone-only entries are retained by the storage migration as legacy contacts; edit their name/relationship when convenient.

Select **Enable Location / refresh** to explicitly request a browser location fix. Review its coordinates, reported accuracy and capture timestamp. The app retains only the latest explicitly captured sample in local IndexedDB; it does not track continuously or while closed. A saved sample older than 30 minutes is labelled stale. You can delete this sample separately from SOS reports. To share a location, open a saved report, select each intended trusted contact, review the exact recipient-specific SMS preview and choose **Prepare SMS**. Each action opens a device SMS handoff; the user must still send the message in the messaging app. If the browser/device does not handle `sms:`, use Copy message and another channel. Neither route confirms delivery. ArkGrid does not invent emergency numbers.

Standard OpenStreetMap raster tiles are retained to avoid introducing a paid tile service or credentials. They do not provide ArkGrid with a reliable English-label switch; text embedded in map tiles may use another local language. ArkGrid’s navigation, controls, event details, legend and other UI text are English. Tile attribution is visible, and tiles are not cached for offline use.

## API summary

- `GET /api/health`
- `GET /api/scenarios`
- `GET|POST /api/incidents`, `GET|PATCH /api/incidents/{id}`
- `GET /api/incidents/{id}/priority`
- `POST /api/incidents/{id}/priority-override`
- `GET|POST /api/resources`
- `POST /api/incidents/{id}/assign`
- `GET /api/sources/status`
- `GET /api/hazards/earthquakes` (also available at `/api/earthquakes`)

The OpenAPI page is available at `http://127.0.0.1:8000/docs` when the API is running. Incident/resource writes are suitable for a local demo only and must not be exposed as an operational service without authentication, authorization, rate limiting, audit/security review, privacy/retention policies, and deployment hardening.

## Verification

From the repository root:

```powershell
pnpm --dir apps\web run typecheck
pnpm --dir apps\web run lint
pnpm --dir apps\web run test
pnpm --dir apps\web run build
.\.venv\Scripts\python.exe -m pytest services/api/tests -q
```

Backend tests use mocked provider responses. Frontend UI tests mock API responses. Live USGS/Copernicus access and the integrated browser workflow depend on the current network and must be verified separately; a passing test suite does not establish production availability.

## Operational safety boundaries

- USGS records are external observations, not predictions. The API has an eight-second request timeout and a 60-second in-memory successful-response cache; cached data is marked stale after refresh failure.
- CDSE catalogue metadata is not satellite imagery. CEMS/GloFAS page probes do not confirm operational data products.
- Map clicks select a single point, not a polygon AOI. OpenStreetMap attribution is included; third-party map tiles and API responses are not cached offline.
- Emergency Mode's browser-online indicator is only a hint. Sync is manual, requires a confirmation before report details/location leave the device, and retains the local record on failure. A successful backend response means persistence in this local demo database only; the report remains unverified.
- Local trusted contacts and recent location have no server authentication or cross-device backup. Do not store real sensitive information in this prototype.
- SMS handoff requires a user action in compatible messaging software and working cellular SMS service. Asking the OS to open a composer/copying content does not prove sending or delivery.
- Resources are fictional demo fixtures. Assignment is not a dispatch. Priority is a transparent rules aid, not a trained AI model or the sole basis for rescue decisions.
- Bluetooth relay is unsupported.

See [the architecture](./docs/ARCHITECTURE.md), [data-source boundaries](./docs/DATA_SOURCES_AND_APIS.md), and [testing strategy](./docs/TESTING_STRATEGY.md).
