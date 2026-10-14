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

## Current frontend verification status (2026-10-14)

The frontend is under `apps/web`; pnpm is the package manager indicated by its `pnpm-lock.yaml` and workspace file. There is no repository-root package manifest or workspace file. Verification used Node.js 20.20.2 and pnpm 10.33.0.

- `pnpm --dir apps\web install --offline --frozen-lockfile` **passed**: restored all 153 locked packages from the local cache, with no downloads and no lockfile regeneration. The previous install had left pnpm metadata without usable top-level dependency links, explaining why scripts could not find `vite`, `tsc`, `vitest`, or `oxlint`.
- `pnpm --dir apps\web run typecheck` **passed**.
- `pnpm --dir apps\web run lint` **passed**.
- `pnpm --dir apps\web run test` **passed**: 3 UI tests cover navigation/live-data messaging, custom-scenario recentering and clicked-point display, and simulated SOS validation.
- `pnpm --dir apps\web run build` **passed**.
- Browser smoke check against the Vite dev server **passed**: HTTP 200, Leaflet controls and OpenStreetMap attribution rendered, scenario navigation and custom map click worked, SOS stayed disabled for zero people and validated for one, and the confirmation explicitly stated that no report was transmitted. No browser console errors, uncaught page errors, or HTTP error responses were observed. On a clean reload, all six OpenStreetMap tile requests returned HTTP 200 with no failed tile requests; this validates only this environment and moment, not production tile-service availability.

The invalid, unrelated `C:\package.json` explains the previous `Unexpected "\x8c" in JSON` failure. Vite's implicit PostCSS discovery reached outside the workspace while processing CSS; `vite.config.ts` now supplies an explicit empty PostCSS plugin list because Tailwind v4 is integrated through its existing Vite plugin. Vitest's default config bundler also traversed to that file, so its script uses the runner loader. Vitest's optional missing-package auto-install probe independently hit the same host file even though `jsdom` resolves from the app; the local test config skips that probe. The external file was not changed.

The current map click captures a **single coordinate only**, not a drawn or persisted area-of-interest geometry. The legacy Citizen SOS demo only validates in the browser; the separate Emergency Mode stores reports locally but does not provide a backend service. USGS/live earthquakes, flood forecasts or extents, and satellite imagery remain unimplemented. UI component tests mock the map; the separate browser smoke check verified that the real Leaflet component mounts and exposes attribution.

## Offline Emergency Mode verification (2026-10-14)

The frontend now includes a production PWA app shell, a local SOS queue, and an explicit user-confirmed SMS handoff. Verification was run after the feature changes:

- `pnpm --dir apps\web run typecheck` **passed**.
- `pnpm --dir apps\web run lint` **passed**.
- `pnpm --dir apps\web run test` **passed**: 13 tests across 4 files, including network-hint state, report validation, local-save flow, contact validation, and SMS handoff formatting.
- `pnpm --dir apps\web run build` **passed**. The production build emits `dist/sw.js`; development mode does not register a service worker.
- Production-browser smoke check **passed** for service-worker control, cached `/emergency` reload while network emulation was disabled, report and trusted-contact persistence in IndexedDB across reload, local report edit and confirmed removal, contact removal, and a visible map-tile-unavailable fallback after uncached OpenStreetMap tile requests failed.
- OpenStreetMap attribution and custom-area selection remain in the existing map. Third-party map tiles are not cached; the app shell and local emergency queue remain usable without them.

The browser harness reproduced a connectivity-reporting limitation: after an offline reload, `navigator.onLine` could still be `true` while a non-cached same-origin request failed with `ERR_INTERNET_DISCONNECTED`. The UI therefore labels connectivity as a **browser hint** and explicitly says it does not verify internet access, backend reachability, or SMS delivery. This event/property is not a proof of connectivity.

No FastAPI backend exists in this repository. Reports remain local unless an operator explicitly configures a compatible `VITE_ARKGRID_API_URL` endpoint and presses Sync; background sync is not implemented. The SMS action opens the device composer or copies a reviewed message; it never sends automatically and cannot confirm delivery. Bluetooth relay remains unsupported. The offline browser smoke test used only temporary synthetic data, which was removed afterward. Offline browser probes and uncached tile requests intentionally generated network-failure console entries; no API was configured or contacted successfully.
