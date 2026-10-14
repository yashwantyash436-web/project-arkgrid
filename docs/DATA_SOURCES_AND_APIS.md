# ArkGrid — Data Sources and APIs

## Operating rule

Use provider data through backend adapters, retain provenance, cache responsibly, and state the record’s class and freshness. Integration availability must be re-checked at implementation because APIs, quotas, terms, and products can change.

## Candidate sources

| Source | Intended use | Access/verification | Constraints and ArkGrid treatment |
| --- | --- | --- | --- |
| [USGS Earthquake GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | Recent earthquake observations | Public programmatic GeoJSON; past-hour/day/week/month feeds update every minute according to USGS. | Monitor observations, not predictions. Preserve USGS ID/URL/times; cache and handle outages. |
| [Copernicus Data Space Ecosystem APIs](https://documentation.dataspace.copernicus.eu/APIs.html) | Sentinel catalogue, download, processing/imagery workflows | Supports catalogue interfaces including STAC/OData and data-access/processing APIs. Product download via OData requires an access token. | Free-to-user capacity is quota-controlled; credentials only server-side. Use small AOIs and product metadata first. |
| [CDSE terms](https://dataspace.copernicus.eu/terms-and-conditions) | Licensing/attribution validation | Sentinel data are described as free/full/open under the applicable legal notice; portal content has separate restrictions. | Record exact dataset/product licence and attribution before publishing imagery or derivatives. Availability is not guaranteed. |
| [CEMS Mapping](https://mapping.emergency.copernicus.eu/) | Historical/on-demand emergency mapping references | Service provides free mapping for emergencies worldwide, but only authorised users may request activations. | Do not promise activation or represent it as a general real-time public API. Use accessible published outputs only after checking licence/source. |
| CEMS GloFAS | Flood forecast/monitoring research | Confirm the specific product, data-access route, account needs, licence, coverage, and latency during Phase 5. | Forecasts are model outputs, not observed local inundation. Expose run/lead time and uncertainty. |
| OpenStreetMap | Basemap/context | Use an appropriate tile provider and follow its usage/attribution policy. | Do not depend on the public standard tile service for high-volume production; preserve attribution. |
| Geocoding provider (TBD) | Location search | Select only after rate, attribution, privacy, and hosting use are known. | Do not send personal SOS narrative/contact data to a geocoder. Cache neutral search results. |
| Published Nepal flood sources (TBD) | Historical scenario | Name the event, publication, author, date, licence, geometry, and transformation before import. | No uncited “Nepal flood” data; all scenario material is historical or simulated. |

## Integration audit in this repository

This table describes the requests made by the current code, not the full capabilities of the named organizations. A reachable information page is not evidence of usable hazard observations.

| Source | Request actually made | Credentials / coverage / cadence | Returned content and current status |
| --- | --- | --- | --- |
| USGS earthquakes | Backend GET `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson`; global past-day GeoJSON observations. | No credential. USGS feed guidance says feeds update about once per minute. Cache duration in ArkGrid is 60 seconds. | Features are normalized from GeoJSON; provider IDs, origin time, coordinates, magnitude, depth, place and original URL are retained. No USGS request was made as part of this code-change test run; backend tests use fixtures. |
| Copernicus Data Space | Backend GET to `https://catalogue.dataspace.copernicus.eu/odata/v1/Products` with a Sentinel-2 collection filter, newest-first order, `$top=1`, and metadata-only `$select=Id,Name,ContentDate`. | The current catalogue metadata request is unauthenticated. Product download/processing needs account/token credentials and quota/terms review. The query is global catalogue metadata, not an AOI-specific hazard product. Product refresh schedule is not guaranteed by this request. | At most one newest product metadata record. `data_available` remains false because imagery is not retrieved or analyzed. Current build does not connect credentials. |
| CEMS Emergency Mapping | Backend GET to `https://emergency.copernicus.eu/` via a page reachability probe. | Page probe requires no credential; operational activations are restricted to authorized users. Global emergency mapping does not mean a product exists for a selected location. | Landing-page status only. It does not retrieve a map, activation, flood extent, or machine-readable hazard product. |
| GloFAS | Backend GET to `https://global-flood.emergency.copernicus.eu/` via a page reachability probe. | No credential for the page probe. Forecast product access, licence, cadence, resolution and geographic/time coverage are not verified by this integration. | Landing-page status only; no forecast or gauge data. |
| OpenStreetMap tiles | Browser requests `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`. | No ArkGrid key. Public tile service usage policy and OSM attribution apply; not intended for unrestricted high-volume production. | Raster basemap only. Label language is determined by tile rendering and may not be English. Tile requests are not cached for offline mode. |

No geocoder, precipitation product, river gauge, elevation raster, flood observation/extent, GloFAS feed, or operational routing provider is connected. No external source is used by the synthetic flood model. Before relying on any source, re-check its current documentation, licence, quotas, terms, and returned payload.

The earthquake map's **Global overview** uses the existing all-day global feed; **Scenario region** returns to the configured Nepal demo extent. This is a viewport change, not a query filter. City search, global population-centre data, nearby-distance search, and marker clustering are not currently provided.

## Synthetic flood model and route output

`POST /api/flood/demo-simulation` is the only flood inference endpoint. It accepts bounded rainfall/water/river/elevation/trend values and one of four lead times. The values and 12-cell coordinates/elevations are synthetic. A class-weighted logistic regression is trained and persisted locally by `services/api/scripts/train_flood_demo_model.py`; the train and held-out labels are generated from a deterministic equation. The returned `risk_score` is explicitly uncalibrated and must not be called a probability. Synthetic held-out precision/recall/F1 report only agreement with generated labels.

The route graph is also a deterministic invented fixture. It ranks two candidate polylines using their synthetic cell scores and an illustrative distance penalty. Distances are synthetic, travel time is not estimated, and output is not verified route guidance. No actual DEM, hydrography, roads, settlements, buildings, or observed/forecast water extent is included. The endpoint and UI emit warnings when both demo candidates intersect higher-risk cells; this does not establish that either route is safe.

## Data-access design

```text
Scheduled/API request
  → provider adapter (timeout, schema validation, retries/backoff)
  → raw-reference/fetch metadata + normalized model
  → cache/database
  → ArkGrid API with source, class, freshness, limitations
  → UI layer/legend/attribution
```

For satellite work, query catalogue metadata by AOI/time/cloud property where applicable, select a product deliberately, record its identifier, then run a bounded job. Sentinel-1 radar can be valuable in cloud-prone flood settings, but any derived change map must be labelled an analysis result, not verified flood extent without validation. Sentinel-2 optical imagery can be cloud-obscured and is not continuous.

## Security and credential rules

- Store provider secrets in deployment environment variables or a secret manager, never in frontend bundles, fixtures, Git, logs, or screenshots.
- CDSE documentation explicitly warns against hard-coding login credentials when obtaining tokens; use an account/app strategy appropriate to its current documentation.
- Use timeouts, response-size limits, allowlisted provider hosts, retry/backoff, and cached last-known metadata with a stale marker.
- Keep raw sensitive SOS data out of analytics and external-provider requests.

## Provenance fields required on imports/results

`source_name`, `source_url`, `provider_record_id`, `licence_or_terms_reference`, `data_class`, `observed_or_issued_at`, `fetched_at`, `coverage_geometry`, `processing_method`, `parameters`, `limitations`, and `attribution_text`.

## Validation checklist before enabling a source

1. Retrieve a known example successfully from the backend in a development environment.
2. Confirm documentation, terms, attribution, quota/rate limits, cost, and geographic/temporal coverage.
3. Confirm refresh frequency and whether it is an observation, forecast, model output, or historical product.
4. Create contract tests from a stored, permitted fixture and simulate timeout/malformed/empty response.
5. Confirm UI source wording and stale/error state with a reviewer.
