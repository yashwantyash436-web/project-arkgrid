# ArkGrid web frontend

This React, TypeScript, Vite, Tailwind CSS, and Leaflet application is the ArkGrid demonstration UI. Its incident and resource fixtures are simulated; USGS observations, flood data, satellite imagery, and a backend service are not connected.

## Requirements

- Node.js 20.19+ (or 22.12+), as required by Vite 8.
- pnpm 10, using the committed `pnpm-lock.yaml`.

Run these commands from the repository root:

```powershell
pnpm --dir apps\web install --frozen-lockfile
pnpm --dir apps\web run dev
pnpm --dir apps\web run typecheck
pnpm --dir apps\web run lint
pnpm --dir apps\web run test
pnpm --dir apps\web run build
```

Vitest uses its runner config loader and skips its optional dependency-install probe because that probe escapes this workspace and attempts to parse an unrelated invalid `C:\package.json`. The app's test dependencies are declared in `package.json` and resolve within this workspace; the external file is neither needed nor modified.

See [the testing strategy](../../docs/TESTING_STRATEGY.md) for current verification results and known behavior boundaries.

## Offline Emergency Mode

Production builds include an installable PWA shell and a separate `/emergency` route. Open the app online at least once and wait for the “Offline app shell cached” indicator before relying on offline reload. Service-worker installation requires HTTPS or localhost. The worker caches the app shell and built JS/CSS only; it does not cache OpenStreetMap tiles, third-party requests, or `/api/` responses. The map displays a fallback notice if its basemap tiles are unavailable.

Emergency reports and trusted contacts are stored in this browser profile’s IndexedDB. Local save is not submission or synchronization; records can be lost when browser data is cleared and are not encrypted by the app. The device connection label is based on browser connectivity signals and does not establish internet or backend reachability.

SMS is a user-confirmed handoff: a saved E.164 contact and the reviewed message are passed to the device’s SMS composer, or the user can copy the message. ArkGrid does not send messages automatically and cannot confirm that a message was sent, delivered, or received. SMS requires compatible device support and working cellular/SMS service. No backend is included in this repository; optional manual sync is available only when `VITE_ARKGRID_API_URL` points to a compatible service implementing `POST /api/incidents` and idempotency by report ID. There is no background sync. Bluetooth relay is not supported; the app does not scan, pair, or transmit over Bluetooth.

For an offline smoke test, build and serve the production app, open it online once, wait for caching to finish, create a test report and trusted contact, then disable the browser network and reload `/emergency`. Verify that the app shell and locally saved records return, while map tiles remain unavailable. Remove test reports and contacts afterward. Do not use real emergency details or phone numbers as test data.
