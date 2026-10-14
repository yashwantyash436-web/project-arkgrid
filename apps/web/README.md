# ArkGrid web frontend

This React, TypeScript, Vite, Tailwind CSS, and Leaflet application is the ArkGrid demonstration UI. Read the [project root README](../../README.md) for the paired FastAPI/SQLite service, local startup, and current provider boundaries.

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

Production and preview builds include an installable PWA shell and a separate `/emergency` route. The Vite development server does not register the service worker and should not be used to claim offline-shell support. Build and run `pnpm --dir apps\web run preview -- --host 127.0.0.1 --port 4173`; open it online once and wait for the “Offline app shell cached” indicator before relying on offline reload. First-visit offline access is not possible. Service-worker installation requires HTTPS or localhost. The worker caches the app shell and built JS/CSS only; it does not cache OpenStreetMap tiles, third-party requests, or `/api/` responses. Service-worker updates do not delete IndexedDB reports. The map displays a fallback notice if its basemap tiles are unavailable.

Emergency reports, named trusted contacts and the latest explicitly captured location are stored in this browser profile’s IndexedDB. Local save is not submission or synchronization; records can be lost when browser data is cleared and are not encrypted by the app. Phone-only contacts from the previous schema are preserved in a migration-safe read path. Contacts and location are local-only; the project has no account authentication, remote contact storage, or recovery mechanism. The browser connection label uses network events/`navigator.onLine` as hints; a separate `/api/health` request checks backend reachability on load, on focus/visibility/online events, and every 30 seconds while visible. The UI also keeps the last successful check time. Neither status proves external-source or SMS availability.

Device location is requested only after the user selects the location action. ArkGrid retains the browser-reported coordinate accuracy and capture timestamp and identifies manually entered coordinates separately; browser accuracy is not a guarantee of real-world position quality.

SMS is a user-confirmed handoff: choose one or more saved E.164 contacts, review each exact recipient/message (including map link when coordinates exist), then select a recipient’s SMS handoff link or copy the text. ArkGrid does not send messages automatically and cannot confirm that a composer opened, or that a message was sent, delivered, or received. SMS requires compatible device support and working cellular/SMS service. Recent location retains only the latest explicit browser capture and reports stale samples; there is no continuous/background tracking. The local FastAPI service implements `POST /api/incidents` and idempotency by report ID; Emergency Mode synchronization is manual, and there is no background sync. Vite proxies `/api` to the local service during development. Bluetooth relay is not supported; the app does not scan, pair, or transmit over Bluetooth.

For an offline smoke test, build and serve the production app, open it online once, wait for caching to finish, create a test report and trusted contact, then disable the browser network and reload `/emergency`. Verify that the app shell and locally saved records return, while map tiles remain unavailable. Remove test reports and contacts afterward. Do not use real emergency details or phone numbers as test data.
