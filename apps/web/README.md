# ArkGrid web frontend

This React, TypeScript, Vite, Tailwind CSS, and Leaflet application is the ArkGrid demonstration UI. Its incident and resource fixtures are simulated; USGS observations, flood data, satellite imagery, backend persistence, and offline SOS sync are not connected.

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
