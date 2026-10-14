# ArkGrid — Project Requirements

## Planning status and evidence

The inspected workspace contains no application source, configuration, dependency manifest, or `ProjectArk_Wow.pptx`. The presentation therefore could not be inspected and its content is **not** represented as a verified requirement. This plan is based on the supplied written brief only. The project is at the planning stage; no product code or API integration has been implemented or tested.

## Product purpose

ArkGrid is a location-independent disaster-intelligence and rescue-support web application. A user selects a place or map area, explores trustworthy external hazard information and imagery, submits or reviews SOS reports, and uses a command view to triage reported incidents and simulated rescue resources.

It combines monitoring, analysis, citizen protection, and response coordination. It is **not** a universal disaster-prediction system, a continuously updated flood-water map, or a replacement for emergency authorities.

## Users and primary journeys

| User | Goal | First release outcome |
| --- | --- | --- |
| Public/citizen | View hazards; file an SOS; retain it offline | A clearly labelled SOS form queues locally and synchronises after connectivity returns. |
| Coordinator/demo operator | Understand and prioritise incidents | Map, incident queue, explainable priority score, and simulated-resource view. |
| Hackathon reviewer | Verify a credible working flow | Select Nepal demo or any map location, view live USGS data, create/review a demo SOS, and see prioritisation. |

## Functional requirements

### MVP (must build first)

1. Responsive React/TypeScript Progressive Web App with a Leaflet map.
2. Search/select any location and set a map area of interest (AOI); Nepal is a named historical demonstration, not a code assumption.
3. Retrieve and display recent USGS earthquake GeoJSON through the backend, including magnitude, time, depth, source link, and refresh time.
4. Display OpenStreetMap basemap and local ArkGrid layers: incidents, SOS reports, and resources.
5. Store incidents and SOS reports persistently in SQLite; include source, timestamps, location, status, and a `data_class` field.
6. Create citizen SOS reports with consent, contact method, need category, people count, optional location accuracy, and an explicit `SIMULATED`/real-mode policy.
7. Queue unsent SOS reports in IndexedDB and sync idempotently when online.
8. Provide a coordinator dashboard that orders open reports with a transparent rule score and reason list.
9. Supply fixture data for the Nepal historical-flood demonstration and mark every fixture/resource/report as simulated or historical.
10. Expose source attribution, data freshness, limitations, and simulation labels in the UI.

### Incremental capabilities (after MVP)

- Query satellite-product metadata and show an imagery-availability panel; render a controlled image layer only after credentials, quotas, and CORS behavior are validated.
- Import published CEMS mapping products or publicly documented Nepal flood material with provenance; do not represent it as live flood extent.
- Run bounded EO analysis jobs (for example Sentinel-1 change detection) asynchronously; preserve input product IDs, parameters, result geometry, and confidence/limitations.
- Classify report type and detect likely duplicate citizen reports using deterministic rules first (distance, time, category, contact hash); add an evaluated ML model only if it proves better.
- Add scoped flood-risk indicators only where an authoritative forecast/observation and documented method exist. Label estimates, source, timestamp, spatial resolution, and uncertainty.
- Estimate a search area only as a responder-configured planning aid using supplied last-known location/time and assumptions; never present it as a person-location prediction.

### Future/research items (not MVP commitments)

- SMS gateway: requires a provider, sender/recipient compliance, cost review, delivery testing, consent, and local legal review.
- Bluetooth/mesh: browser/PWA support and background constraints make reliable emergency mesh communication unsuitable as a hackathon promise. Investigate native companion apps separately.
- PostGIS, authentication/roles, auditable coordination, routing, and production alerting.

## Non-functional requirements

- **Safety:** show emergency-disclaimer and country-specific emergency-number guidance; never delay a real emergency call.
- **Truthfulness:** separate external observations/forecasts, ArkGrid analysis, historical material, and demo simulation everywhere.
- **Privacy:** minimise personal data; record consent; encrypt transport; set a retention/deletion policy before collecting real SOS data. The hackathon demo should use synthetic contacts only.
- **Accessibility:** keyboard-operable map alternatives, labelled controls, contrast, readable status/error states, and mobile layouts.
- **Performance:** map remains usable on ordinary mobile connections; viewport/AOI limits, paginated lists, cached recent layers, and background jobs for raster work.
- **Reliability:** graceful source failures with last-success timestamp; no fabricated fallback “live” data.
- **Security:** secrets server-side only; validate coordinates and input lengths; rate-limit SOS endpoints; prevent unauthorised coordinator actions once auth exists.

## Data-classification contract

| Class | Examples | UI/API rule |
| --- | --- | --- |
| `external_observation` | USGS earthquake event | Preserve provider ID, source URL, observed/updated time. |
| `external_forecast` | GloFAS forecast product | State it is a forecast, issuance/run time, lead time, and provider. |
| `arkgrid_analysis` | EO-derived change layer | Store inputs, algorithm/version, run time, uncertainty, and limitations. |
| `historical_reference` | Nepal flood case-study boundary | Cite publication/date and state it is historical. |
| `simulation` | SOS reports, rescue vehicles, demo scenario | Prominent “SIMULATED — DEMO ONLY” label; never mix into external counts. |

## Acceptance criteria for the first vertical slice

1. A user can choose a location/AOI without country-specific code.
2. The map draws current USGS feed records returned by the backend, with a displayed fetched-at time and an error/empty state.
3. A user can submit a simulated SOS while offline, see it as queued, reconnect, and observe exactly one persisted report.
4. A coordinator can view the report on the map/list and see score components explaining its order.
5. Nepal fixtures load only when the Nepal demo scenario is selected and are visibly historical/simulated.
6. Automated tests cover the priority rules, duplicate rules, API contracts, offline-sync idempotency, and critical UI states.

## Open decisions

1. Which published Nepal flood event, source documents, spatial boundary, and licensing will be used?
2. Is the demo strictly simulated SOS data, or is there institutional approval for real data collection?
3. Which regions, languages, and emergency-number content are in scope?
4. Which hosting platform and budget are available? This determines background processing and database choices.
5. Is an operator login required for the hackathon demo? Recommended: simple seeded demo operator only; do not expose public response management.
