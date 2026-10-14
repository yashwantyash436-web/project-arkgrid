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
