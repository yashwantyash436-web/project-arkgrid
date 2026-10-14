import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const serviceWorkerSource = fileURLToPath(new URL('./src/service-worker.js', import.meta.url))
type BundleOutput =
  | { type: 'chunk'; code: string }
  | { type: 'asset'; source: string | Uint8Array }

function offlineShellPlugin() {
  let base = '/'

  return {
    name: 'arkgrid-offline-shell',
    apply: 'build' as const,
    configResolved(config: { base: string }) {
      base = config.base.endsWith('/') ? config.base : `${config.base}/`
    },
    async generateBundle(this: { emitFile: (file: { type: 'asset'; fileName: string; source: string }) => void }, _options: unknown, bundle: Record<string, BundleOutput>) {
      const source = await readFile(serviceWorkerSource, 'utf8')
      const bundledAssets = Object.keys(bundle).filter(fileName =>
        bundle[fileName].type === 'chunk' ||
        /\.(?:css|svg|png|webmanifest)$/i.test(fileName),
      )
      const precacheUrls = Array.from(new Set([
        base,
        `${base}index.html`,
        `${base}manifest.webmanifest`,
        `${base}favicon.svg`,
        `${base}arkgrid-icon.svg`,
        ...bundledAssets.map(fileName => `${base}${fileName}`),
      ]))
      const hash = createHash('sha256')
        .update(source)
        .update(precacheUrls.join('\n'))
      for (const [fileName, output] of Object.entries(bundle).sort(([left], [right]) => left.localeCompare(right))) {
        hash.update(fileName)
        if (output.type === 'chunk') hash.update(output.code)
        else hash.update(output.source)
      }
      for (const fileName of ['manifest.webmanifest', 'favicon.svg', 'arkgrid-icon.svg']) {
        hash.update(await readFile(new URL(`./public/${fileName}`, import.meta.url)))
      }
      const cacheVersion = hash.digest('hex').slice(0, 12)
      const serviceWorker = source
        .replace('__ARKGRID_CACHE_NAME__', `arkgrid-shell-${cacheVersion}`)
        .replace('__ARKGRID_PRECACHE_URLS__', JSON.stringify(precacheUrls))

      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), offlineShellPlugin()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  css: {
    postcss: { plugins: [] },
  },
})
