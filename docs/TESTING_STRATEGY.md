# ArkGrid — Testing Strategy

## Quality approach

Test the safety-critical truthfulness and data flow before visual polish. A passing build must show correct source/simulation labels, must not duplicate SOS reports during sync, and must provide graceful data-provider failure states.

## Test pyramid

| Level | Scope | Examples |
| --- | --- | --- |
| Unit | Pure frontend/backend logic | Priority score components, duplicate candidate window, coordinate bounds, data-class label mapping, offline state reducer. |
| API/service | FastAPI routes and adapters with mocked HTTP | USGS normalization, cache freshness, idempotent `POST /sos-reports`, validation/rate-limit responses, source outage. |
| Database | Repositories/migrations | Unique `(provider, provider_event_id)`, idempotency key, status transitions, priority audit/override. |
| Integration | Web + API + test database | SOS form through persistence to coordinator queue; GeoJSON layer contract. |
| End-to-end | Browser/PWA on desktop/mobile | Offline queue → reload → reconnect → one synced record; AOI → USGS layer → simulation report → priority explanation. |
| Manual/field-like | Usability, accessibility, source semantics | Keyboard-only, mobile layout, colour/label review, demo rehearsal, slow-network behavior. |

## High-priority acceptance tests

1. **Source truthfulness:** USGS marker shows provider/source link and fetch time. On provider failure it says unavailable/stale, never invents current records.
2. **Country independence:** use at least two unrelated AOIs and confirm no Nepal-only defaults affect normal map/API behavior.
3. **Data segregation:** filters/counts cannot mix `simulation` fixtures with external observation totals; every demo resource/SOS is visibly simulated.
4. **Offline reliability:** disable network after opening app; create SOS; reload; confirm local records survive. Once an API with idempotency support is implemented, restore network, click Sync, and verify the database contains one record for its client UUID. Until then, sync must be labelled unavailable.
5. **User-confirmed SMS:** verify the recipient and message preview before enabling composer handoff; composer opening/copying is not delivery, and only a deliberate user action can attempt sending.
6. **Priority explanation:** fixture reports receive expected order; each result lists input components and formula/version. Override requires a reason and is auditable.
7. **Duplicate suggestion:** close-in-time/space fixture reports produce a suggestion, while distinct reports do not; neither is silently deleted.
8. **Privacy/security:** client build contains no secret; logs redact contact fields; unauthorised users cannot perform coordinator mutations once roles are added.

## Geospatial and analysis validation

- Use known AOI fixtures with declared CRS (store/serve web map geometries as WGS84 GeoJSON unless a calculation needs a projected CRS).
- Assert longitude/latitude ordering and validate geometry/bbox limits to prevent enormous/risky queries.
- For each EO result, retain a golden test case with source product IDs, AOI, parameters, expected footprint/statistics, and algorithm version.
- Compare any claimed flood/change result with an independently documented reference before demonstrations. If validation is insufficient, show it as an exploratory analysis only.

## Test data policy

Commit small, licence-permitted provider response fixtures and synthetic SOS/resources only. Never commit live personal data, access tokens, phone numbers, or private exact locations. Make fixtures deterministic with fixed timestamps and IDs.

## Tooling to add during implementation

- Frontend: ESLint, TypeScript strict mode, Vitest + Testing Library, Playwright.
- Backend: pytest, httpx test client, Ruff, mypy/pyright if adopted, database migration tests.
- CI: install → lint → unit/API tests → frontend build; later run Playwright and dependency/security scans.

## Release gate and demo checklist

- All critical tests pass in CI; no secrets detected in repository/build output.
- Run a clean-environment smoke test using documented setup.
- Verify provider status, source links, terms/attribution, and dataset timestamps on demo day.
- Rehearse provider outage and offline paths; retain fixtures so the planned demo remains reliable even if a live source fails.
- State the system’s limits: observations/forecasts are provider data, Nepal material is historical, SOS/resources are simulated unless explicitly approved otherwise, and ArkGrid does not replace emergency services.

## Frontend setup baseline (2026-10-14)

The frontend is under `apps/web`; pnpm is the package manager indicated by its `pnpm-lock.yaml` and workspace file. There is no repository-root package manifest or workspace file. Verification used Node.js 20.20.2 and pnpm 10.33.0.

- `pnpm --dir apps\web install --offline --frozen-lockfile` **passed**: restored all 153 locked packages from the local cache, with no downloads and no lockfile regeneration. The previous install had left pnpm metadata without usable top-level dependency links, explaining why scripts could not find `vite`, `tsc`, `vitest`, or `oxlint`.
- `pnpm --dir apps\web run typecheck` **passed**.
- `pnpm --dir apps\web run lint` **passed**.
- `pnpm --dir apps\web run test` **passed**: 3 UI tests cover navigation/live-data messaging, custom-scenario recentering and clicked-point display, and simulated SOS validation.
- `pnpm --dir apps\web run build` **passed**.
- Browser smoke check against the Vite dev server **passed**: HTTP 200, Leaflet controls and OpenStreetMap attribution rendered, scenario navigation and custom map click worked, SOS stayed disabled for zero people and validated for one, and the confirmation explicitly stated that no report was transmitted. No browser console errors, uncaught page errors, or HTTP error responses were observed. On a clean reload, all six OpenStreetMap tile requests returned HTTP 200 with no failed tile requests; this validates only this environment and moment, not production tile-service availability.

The invalid, unrelated `C:\package.json` explains the previous `Unexpected "\x8c" in JSON` failure. Vite's implicit PostCSS discovery reached outside the workspace while processing CSS; `vite.config.ts` now supplies an explicit empty PostCSS plugin list because Tailwind v4 is integrated through its existing Vite plugin. Vitest's default config bundler also traversed to that file, so its script uses the runner loader. Vitest's optional missing-package auto-install probe independently hit the same host file even though `jsdom` resolves from the app; the local test config skips that probe. The external file was not changed.

At this baseline checkpoint, the map click captured a **single coordinate only**, not a drawn or persisted area-of-interest geometry. The original Citizen SOS form only validated in the browser; the separate Emergency Mode stored reports locally but did not provide a backend service. The later integration status below supersedes those statements where applicable.

## Offline Emergency Mode verification (2026-10-14)

The frontend now includes a production PWA app shell, a local SOS queue, and an explicit user-confirmed SMS handoff. Verification was run after the feature changes:

- `pnpm --dir apps\web run typecheck` **passed**.
- `pnpm --dir apps\web run lint` **passed**.
- `pnpm --dir apps\web run test` **passed**: 13 tests across 4 files, including network-hint state, report validation, local-save flow, contact validation, and SMS handoff formatting.
- `pnpm --dir apps\web run build` **passed**. The production build emits `dist/sw.js`; development mode does not register a service worker.
- Production-browser smoke check **passed** for service-worker control, cached `/emergency` reload while network emulation was disabled, report and trusted-contact persistence in IndexedDB across reload, local report edit and confirmed removal, contact removal, and a visible map-tile-unavailable fallback after uncached OpenStreetMap tile requests failed.
- OpenStreetMap attribution and custom-area selection remain in the existing map. Third-party map tiles are not cached; the app shell and local emergency queue remain usable without them.

The browser harness reproduced a connectivity-reporting limitation: after an offline reload, `navigator.onLine` could still be `true` while a non-cached same-origin request failed with `ERR_INTERNET_DISCONNECTED`. The UI therefore labels connectivity as a **browser hint** and explicitly says it does not verify internet access, backend reachability, or SMS delivery. This event/property is not a proof of connectivity.

At this offline-feature checkpoint, no FastAPI backend existed. The current integration status below supersedes that statement. Background sync remains unimplemented. The SMS action opens the device composer or copies a reviewed message; it never sends automatically and cannot confirm delivery. Bluetooth relay remains unsupported.

## Backend and frontend integration status (2026-10-14)

Current code adds a FastAPI/SQLite service, typed API client, Vite `/api` development proxy, backend-persisted demo SOS reports, a manual idempotent sync action for IndexedDB emergency reports, persisted incident coordination (filters, status, notes, fictional resource assignments), explainable priority details and token-gated score overrides, USGS observation filtering/map markers, and source-status cards. Citizen SOS creates simulation-class records. Emergency Mode sync requires explicit confirmation before uploading local report details/location and creates an unverified `citizen_report` with the confirmation persisted. Neither path contacts rescue services.

Latest verification for this integration work:

- `pnpm --dir apps\web run typecheck`: **passed**.
- `pnpm --dir apps\web run lint`: **passed**.
- `pnpm --dir apps\web run test`: **passed**, 16 tests across 4 files.
- `pnpm --dir apps\web run build`: **passed**; Vite emitted the PWA service worker and production assets.
- `.\.venv\Scripts\python.exe -m pytest services/api/tests -q`: **passed**, 8 tests. Starlette reports that `httpx` with its current TestClient is deprecated; this did not fail the suite.
- Local browser/API smoke check: API health returned `ok`; Citizen SOS submission was persisted, shown in the coordinator, transitioned, annotated, and assigned a fictional resource. An IndexedDB emergency report synchronized only after the upload confirmation and backend acknowledgement; the persisted SQLite response identified it as `citizen_report` with `consent_confirmed=true`. The test report was removed from the browser queue. Source cards rendered current metadata/status limits. Browser console errors, uncaught page errors, and failed requests were not observed in the final browser check. UI tests mock responses, while this smoke check exercised local services.
- Live USGS request at `2026-10-14T06:38:23.849Z` returned 253 normalized all-day observations; this feed count and availability are time-dependent. The monitoring view rendered original USGS links and magnitude filtering.
- Source probes returned HTTP 200 for the CEMS and GloFAS information pages, but neither provides a connected hazard-data product. The CDSE public catalogue probe returned HTTP 200 and product metadata (`metadata_available=true`); it did not return imagery or an analyzed flood product.
- `git diff --check`: **passed**. Integration changes remain uncommitted and unpushed on local `main`; the branch still points at the previously pushed offline-mode checkpoint.

API tests use an injected USGS fixture and fake CEMS/GloFAS/CDSE source probes; those tests do not prove external provider availability. Live checks above describe only this run and must not be treated as an uptime guarantee.

The app routes are not role-authenticated; only priority overrides have the configurable shared-token check. Treat all endpoints as local-demo only. USGS live retrieval, CDSE public catalogue metadata, CEMS/GloFAS reachability, and browser integration must be reported only after a separate runtime check. Copernicus metadata is not imagery; no GloFAS forecast or CEMS activation data is connected. The map still selects a point and does not implement polygon AOIs. General incident authorization, rate limits, privacy/retention policy, and production hardening remain release blockers.
