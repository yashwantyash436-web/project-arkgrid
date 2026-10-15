import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Activity, ClipboardList, Database, LayoutDashboard, Map, Menu, ShieldAlert, Siren, Users, Waves, Wifi, WifiOff, X } from 'lucide-react'
import { IncidentCoordinator } from './components/IncidentCoordinator'
import { SourceStatusPanel } from './components/SourceStatusPanel'
import { DashboardSummary } from './components/DashboardSummary'
import { arkgridApi, ApiError, apiBaseUrl } from './api/client'
import { areas } from './data/demoData'
import { emergencyStorage } from './emergency/storage'
import { createReportId } from './emergency/types'
import type { EmergencyCategory, EmergencyReport, IncidentType, Severity } from './emergency/types'

const MapView = lazy(() => import('./components/MapView').then(module => ({ default: module.MapView })))
const LiveMonitoring = lazy(() => import('./components/LiveMonitoring').then(module => ({ default: module.LiveMonitoring })))
const FloodSimulation = lazy(() => import('./components/FloodSimulation').then(module => ({ default: module.FloodSimulation })))
const EmergencyMode = lazy(() => import('./emergency/EmergencyMode').then(module => ({ default: module.EmergencyMode })))

type Page = 'Overview' | 'Live monitoring' | 'Interactive map' | 'Flood & satellite' | 'Citizen SOS' | 'Incidents' | 'Rescue coordination' | 'Trusted contacts' | 'Data & system status' | 'Emergency Mode'
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const navigation: { label: Page; page: Page; Icon: typeof LayoutDashboard }[] = [
  { label: 'Overview', page: 'Overview', Icon: LayoutDashboard },
  { label: 'Emergency Mode', page: 'Emergency Mode', Icon: ShieldAlert },
  { label: 'Live monitoring', page: 'Live monitoring', Icon: Activity },
  { label: 'Interactive map', page: 'Interactive map', Icon: Map },
  { label: 'Flood & satellite', page: 'Flood & satellite', Icon: Waves },
  { label: 'Citizen SOS', page: 'Citizen SOS', Icon: Siren },
  { label: 'Incidents', page: 'Incidents', Icon: ClipboardList },
  { label: 'Rescue coordination', page: 'Rescue coordination', Icon: Users },
  { label: 'Trusted contacts', page: 'Trusted contacts', Icon: Users },
  { label: 'Data & system status', page: 'Data & system status', Icon: Database },
]
const pageTitles: Record<Page, string> = {
  Overview: 'Overview',
  'Live monitoring': 'Live map',
  'Interactive map': 'Area map',
  'Flood & satellite': 'Flood simulation',
  'Citizen SOS': 'Citizen SOS',
  Incidents: 'Incidents',
  'Rescue coordination': 'Incidents',
  'Trusted contacts': 'Trusted contacts',
  'Data & system status': 'System status',
  'Emergency Mode': 'Emergency Mode',
}
const pageGuidance: Record<Page, string> = {
  Overview: 'A current summary, important reports, and map. ArkGrid is a demonstration and does not contact emergency services.',
  'Emergency Mode': 'Save a help report on this device and choose how to share it. Saving a report does not call for help.',
  'Live monitoring': 'See recent earthquake observations from the USGS. These observations do not predict future events.',
  'Interactive map': 'Choose an area or tap the map to note a location. The example markers are simulated.',
  'Flood & satellite': 'Explore a made-up flood scenario and check whether outside data sources are available.',
  'Citizen SOS': 'Enter a demo request. It goes to the demo server, not to emergency responders.',
  Incidents: 'Review demo reports saved by the server. Check details before acting on any report.',
  'Rescue coordination': 'Review reports and example resources. Assignments here do not dispatch real responders.',
  'Trusted contacts': 'Manage contacts saved on this device and review your local emergency settings.',
  'Data & system status': 'Check the server and outside data sources, and read what this demonstration can and cannot do.',
}
function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) { return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-900">{title}</h2>{action}</div>{children}</section> }
const pages: Page[] = [
  'Overview', 'Live monitoring', 'Interactive map', 'Flood & satellite', 'Citizen SOS',
  'Incidents', 'Rescue coordination', 'Trusted contacts', 'Data & system status', 'Emergency Mode',
]

function isPage(value: unknown): value is Page {
  return pages.some(page => page === value)
}

function Sos({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const [savedReport, setSavedReport] = useState<EmergencyReport | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [locationMessage, setLocationMessage] = useState('')
  const [hazardMessage, setHazardMessage] = useState('')
  const attemptedSyncIds = useRef(new Set<string>())
  const [deviceLocation, setDeviceLocation] = useState<{
    latitude: number
    longitude: number
    accuracy: number
    capturedAt: string
  } | null>(null)
  const submitLock = useRef(false)
  const [form, setForm] = useState({ need: '', severity: 'Moderate', people: '', location: '', message: '' })
  const peopleCount = Number(form.people)
  const valid = ['Medical assistance', 'Evacuation assistance', 'Food or water'].includes(form.need) &&
    ['Critical', 'High', 'Moderate'].includes(form.severity) &&
    (form.location.trim().length > 0 || deviceLocation !== null) &&
    form.location.trim().length <= 160 &&
    Number.isInteger(peopleCount) && peopleCount >= 1 && peopleCount <= 99999 &&
    form.message.trim().length <= 500

  function requestReportLocation() {
    if (!navigator.geolocation) {
      setLocationMessage('Location is unavailable in this browser. Enter a location description instead.')
      return
    }
    setLocationMessage('Waiting for permission and a device location…')
    navigator.geolocation.getCurrentPosition(
      position => {
        setDeviceLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        })
        setLocationMessage('Location captured for this report. Review it before submitting.')
      },
      cause => setLocationMessage(
        `${cause.code === cause.PERMISSION_DENIED ? 'Location permission was denied.' : 'Device location is unavailable.'} Enter a location description instead.`,
      ),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    )
  }

  async function checkNearbyHazard(report: EmergencyReport) {
    if (report.latitude === null || report.longitude === null) {
      setHazardMessage('Hazard information unavailable — manual emergency report retained.')
      return
    }
    try {
      const observations = await arkgridApi.earthquakes(-2)
      const reportTime = Date.parse(report.createdAt)
      const nearby = observations.items.some(observation => {
        const ageHours = (reportTime - Date.parse(observation.time)) / 3600000
        if (ageHours < 0 || ageHours > 24) return false
        const radians = Math.PI / 180
        const latitudeDelta = (observation.latitude - report.latitude!) * radians
        const longitudeDelta = (observation.longitude - report.longitude!) * radians
        const arc = Math.sin(latitudeDelta / 2) ** 2 +
          Math.cos(report.latitude! * radians) * Math.cos(observation.latitude * radians) *
          Math.sin(longitudeDelta / 2) ** 2
        return 6371 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc)) <= 100
      })
      setHazardMessage(nearby
        ? 'A nearby earthquake observation was found; verify the situation.'
        : 'No recent nearby earthquake observation was found. This does not rule out other hazards.')
    } catch {
      setHazardMessage('Hazard information unavailable — manual emergency report retained.')
    }
  }

  const synchronizeReport = useCallback(async (report: EmergencyReport) => {
    if (attemptedSyncIds.current.has(report.id) || report.syncStatus === 'synchronized') return
    attemptedSyncIds.current.add(report.id)
    try {
      const result = await arkgridApi.syncEmergencyReport(report)
      const synchronized = {
        ...report,
        serverIncidentId: result.serverId,
        syncAttempts: report.syncAttempts + 1,
        syncStatus: 'synchronized' as const,
        syncAttemptedAt: result.synchronizedAt,
        syncError: null,
      }
      await emergencyStorage.saveReport(synchronized)
      setSavedReport(synchronized)
    } catch (cause) {
      const failed = {
        ...report,
        syncAttempts: report.syncAttempts + 1,
        syncStatus: 'failed' as const,
        syncAttemptedAt: new Date().toISOString(),
        syncError: cause instanceof ApiError ? cause.message : 'Backend synchronization failed.',
      }
      try {
        await emergencyStorage.saveReport(failed)
        setSavedReport(failed)
      } catch {
        setError('The report is saved on this device, but its failed synchronization status could not be updated.')
      }
    }
  }, [])

  useEffect(() => {
    const retryWhenOnline = () => {
      attemptedSyncIds.current.delete(savedReport?.id ?? '')
      if (savedReport && navigator.onLine) void synchronizeReport(savedReport)
    }
    window.addEventListener('offline', retryWhenOnline)
    window.addEventListener('online', retryWhenOnline)
    return () => {
      window.removeEventListener('offline', retryWhenOnline)
      window.removeEventListener('online', retryWhenOnline)
    }
  }, [savedReport, synchronizeReport])

  async function submitReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid || submitLock.current) return
    submitLock.current = true
    setSubmitting(true)
    setError('')
    try {
      const incidentType: IncidentType = form.need === 'Medical assistance'
        ? 'Medical emergency'
        : form.need === 'Evacuation assistance' ? 'Evacuation needed' : 'Other urgent need'
      const category: EmergencyCategory = form.need === 'Medical assistance'
        ? 'Medical assistance'
        : form.need === 'Evacuation assistance' ? 'Evacuation' : 'Food or water'
      const report: EmergencyReport = {
        id: createReportId(),
        createdAt: new Date().toISOString(),
        incidentType,
        severity: form.severity as Severity,
        category,
        message: form.message.trim(),
        peopleAffected: peopleCount,
        assistanceNote: '',
        latitude: deviceLocation?.latitude ?? null,
        longitude: deviceLocation?.longitude ?? null,
        manualLocation: form.location.trim(),
        locationSource: deviceLocation ? 'device' : 'manual',
        locationAccuracyMeters: deviceLocation?.accuracy ?? null,
        locationCapturedAt: deviceLocation?.capturedAt ?? null,
        serverIncidentId: null,
        syncAttempts: 0,
        transmissionStatus: 'not_started',
        transmissionAttemptedAt: null,
        syncStatus: 'pending',
        syncAttemptedAt: null,
        syncError: null,
      }
      await emergencyStorage.saveReport(report)
      setSavedReport(report)
      setHazardMessage('Checking available hazard observations…')
      void checkNearbyHazard(report)
      if (navigator.onLine) {
        await synchronizeReport(report)
      }
    } catch (cause) {
      setError(cause instanceof Error
        ? `Could not save this SOS report locally: ${cause.message}. It was not sent.`
        : 'Could not save this SOS report locally. It was not sent.')
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Panel title="Citizen SOS report">
        <p className="mb-5 text-sm text-slate-600">
          Demo environment only. Do not enter real personal or sensitive information. Reports save on this device first, then may synchronize with the demo backend. Neither action contacts emergency services. Location is requested only when you choose it.
        </p>
        {savedReport ? (
          <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
            <p className="font-semibold">SOS saved on this device — {savedReport.syncStatus === 'synchronized'
              ? 'backend acknowledged persistence; no emergency service was contacted.'
              : 'not yet delivered.'}</p>
            <p className="break-all">Report ID: {savedReport.id} · {new Date(savedReport.createdAt).toLocaleString()}</p>
            {savedReport.syncStatus === 'failed' && <p role="alert">Backend synchronization failed. The local report remains saved and can be retried from Emergency Mode.</p>}
            {hazardMessage && <p role="status">{hazardMessage}</p>}
            {error && <p role="alert">{error}</p>}
            <button type="button" className="min-h-11 rounded-lg border border-emerald-800 px-3 font-semibold" onClick={() => onNavigate('Emergency Mode')}>
              Review saved report and SMS options
            </button>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={submitReport}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">Primary need
                <select required value={form.need}
                  onChange={event => setForm(current => ({ ...current, need: event.target.value }))}
                  className="min-h-11 rounded-lg border border-slate-300 px-3">
                  <option value="">Select a need</option>
                  <option>Medical assistance</option>
                  <option>Evacuation assistance</option>
                  <option>Food or water</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium">Reported severity
                <select value={form.severity} onChange={event => setForm(current => ({ ...current, severity: event.target.value }))} className="min-h-11 rounded-lg border border-slate-300 px-3"><option>Moderate</option><option>High</option><option>Critical</option></select>
              </label>
              <label className="grid gap-1 text-sm font-medium">People affected
                <input required min="1" max="99999" step="1" type="number" value={form.people}
                  onChange={event => setForm(current => ({ ...current, people: event.target.value }))}
                  className="min-h-11 rounded-lg border border-slate-300 px-3" />
              </label>
              <label className="grid gap-1 text-sm font-medium">Location description
                <input required={!deviceLocation} maxLength={160} value={form.location}
                  onChange={event => setForm(current => ({ ...current, location: event.target.value }))}
                  className="min-h-11 rounded-lg border border-slate-300 px-3" placeholder="Enter a location (demo data only)" />
              </label>
            </div>
            <div>
              <button type="button" className="min-h-10 rounded-lg border border-slate-400 px-3 text-sm font-semibold" onClick={requestReportLocation}>
                Use current location (optional)
              </button>
              {deviceLocation && <p className="mt-1 text-sm text-slate-700">Location: {deviceLocation.latitude.toFixed(5)}, {deviceLocation.longitude.toFixed(5)} · ±{Math.round(deviceLocation.accuracy)} m</p>}
              {locationMessage && <p role="status" className="mt-1 text-sm text-slate-700">{locationMessage}</p>}
            </div>
            <label className="grid gap-1 text-sm font-medium">Additional details
              <textarea maxLength={500} value={form.message} onChange={event => setForm(current => ({ ...current, message: event.target.value }))} className="min-h-24 rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
            <button className="min-h-11 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={!valid || submitting}>
              {submitting ? 'Saving report…' : 'Submit SOS report'}
            </button>
          </form>
        )}
      </Panel>
    </div>
  )
}

function BackendStatus() {
  const [status, setStatus] = useState('Checking backend…')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void arkgridApi.health()
      .then(result => {
        if (active) setStatus(`Available · ${result.database}`)
      })
      .catch(cause => {
        if (!active) return
        setStatus('Unavailable')
        setError(cause instanceof ApiError ? cause.message : 'Health check failed.')
      })
    return () => { active = false }
  }, [])
  return <Panel title="API backend"><p className={`text-sm font-semibold ${status === 'Unavailable' ? 'text-red-800' : 'text-slate-800'}`}>{status}</p><p className="mt-1 break-all text-xs text-slate-500">Base URL: {apiBaseUrl || 'same-origin /api'} · {error || 'Health endpoint check'}</p></Panel>
}

function Content({ page, area, setArea, online, offlineReady, pendingReports, onPendingChange, onNavigate }: { page: Page; area: keyof typeof areas; setArea: (a: keyof typeof areas) => void; online: boolean; offlineReady: boolean; pendingReports: number; onPendingChange: (count: number) => void; onNavigate: (page: Page) => void }) {
 const [point, setPoint] = useState('No custom point selected')
 const current = areas[area]
 const mapPanel = <Panel title="Operational map" action={<select aria-label="Scenario" value={area} onChange={event => setArea(event.target.value as keyof typeof areas)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"><option value="nepal">Nepal historical scenario</option><option value="custom">Custom area</option></select>}><div className="h-[380px]"><MapView center={current.center} zoom={current.zoom} onAreaSelect={(lat, lng) => setPoint(`Selected point: ${lat.toFixed(4)}, ${lng.toFixed(4)}`)} /></div><p className="mt-3 text-xs text-slate-500">{current.label}. Map clicks select a point only, not a polygon area of interest — {point}. Orange/red markers are simulated fixtures. Map data © OpenStreetMap contributors.</p></Panel>
 if (page === 'Emergency Mode') return <EmergencyMode online={online} offlineReady={offlineReady} onPendingChange={onPendingChange} />
 if (page === 'Trusted contacts') return <EmergencyMode online={online} offlineReady={offlineReady} onPendingChange={onPendingChange} initialTab="settings" />
 if (page === 'Interactive map') return mapPanel
 if (page === 'Citizen SOS') return <Sos onNavigate={onNavigate} />
 if (page === 'Incidents' || page === 'Rescue coordination') return <IncidentCoordinator heading="Incident management" onCreateDemoReport={() => onNavigate('Citizen SOS')} />
 if (page === 'Live monitoring') return <LiveMonitoring center={current.center} onOpenAreaMap={() => onNavigate('Interactive map')} />
 if (page === 'Flood & satellite') return <div className="space-y-5"><FloodSimulation online={online} /><SourceStatusPanel /></div>
 if (page === 'Data & system status') return <div className="space-y-5"><BackendStatus /><SourceStatusPanel /><Panel title="Data and safety boundaries"><p className="text-sm text-slate-700">USGS records are labelled external observations. Citizen SOS form entries are explicitly simulated; synchronized Emergency Mode reports are unverified citizen reports. Resources are simulated. Connectivity and backend status do not confirm that live feeds are available; offline reports remain locally stored until the user confirms manual upload and the backend acknowledges it. Neither SMS handoff nor this coordinator dispatches real responders.</p></Panel></div>
 return <div className="space-y-5">
   <DashboardSummary pendingReports={pendingReports} />
   <LiveMonitoring center={current.center} compact onOpenAreaMap={() => onNavigate('Interactive map')} />
 </div>
}

export default function App() {
  const [page, setPage] = useState<Page>(() => window.location.pathname.endsWith('/emergency') ? 'Emergency Mode' : 'Overview')
  const [area, setArea] = useState<keyof typeof areas>('nepal')
  const [open, setOpen] = useState(false)
  const [connectivityOnline, setConnectivityOnline] = useState(false)
  const [connectivityChecked, setConnectivityChecked] = useState(false)
  const [automaticEmergency, setAutomaticEmergency] = useState(() => {
    try { return window.localStorage.getItem('arkgrid-auto-emergency') === 'true' } catch { return false }
  })
  const [pendingCount, setPendingCount] = useState(0)
  const [offlineReady, setOfflineReady] = useState(false)
  const [offlineError, setOfflineError] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [installMessage, setInstallMessage] = useState('')
  const [installed, setInstalled] = useState(() =>
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)),
  )
  const isProduction = import.meta.env.PROD
  const updatePendingCount = useCallback((count: number) => setPendingCount(count), [])

  useEffect(() => {
    let active = true
    let healthRequest: AbortController | null = null
    let requestGeneration = 0

    async function checkBackend() {
      if (!active) return
      if (!navigator.onLine) {
        requestGeneration += 1
        healthRequest?.abort()
        healthRequest = null
        setConnectivityOnline(false)
        setConnectivityChecked(true)
        return
      }
      if (healthRequest) return
      const controller = new AbortController()
      healthRequest = controller
      const generation = ++requestGeneration
      try {
        await arkgridApi.health(controller.signal)
        if (active && generation === requestGeneration && navigator.onLine) {
          setConnectivityOnline(true)
          setConnectivityChecked(true)
        }
      } catch {
        if (active && generation === requestGeneration) {
          setConnectivityOnline(false)
          setConnectivityChecked(true)
        }
      } finally {
        if (healthRequest === controller) healthRequest = null
      }
    }

    const onOffline = () => {
      requestGeneration += 1
      healthRequest?.abort()
      healthRequest = null
      setConnectivityOnline(false)
      setConnectivityChecked(true)
    }
    const onOnline = () => {
      setConnectivityOnline(false)
      setConnectivityChecked(false)
      void checkBackend()
    }
    const onInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPrompt)
      setInstallMessage('')
    }
    const onInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
      setInstallMessage('')
    }

    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    window.addEventListener('beforeinstallprompt', onInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('focus', checkBackend)
    document.addEventListener('visibilitychange', checkBackend)
    void checkBackend()
    const healthTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void checkBackend()
    }, 30000)

    if (isProduction && 'serviceWorker' in navigator) {
      const onControllerChange = () => setOfflineReady(Boolean(navigator.serviceWorker.controller))
      const onOfflineError = () => setOfflineError(true)
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
      window.addEventListener('arkgrid:offline-error', onOfflineError)
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      }).then(registration => {
        setOfflineReady(Boolean(registration.active))
        const watchInstallingWorker = () => {
          const worker = registration.installing
          if (!worker) return
          const onStateChange = () => {
            if (worker.state === 'activated') {
              setOfflineReady(true)
              setOfflineError(false)
            } else if (worker.state === 'redundant' && !registration.active) {
              setOfflineError(true)
            }
          }
          worker.addEventListener('statechange', onStateChange)
          onStateChange()
        }
        registration.addEventListener('updatefound', watchInstallingWorker)
        watchInstallingWorker()
      }).catch(error => {
        console.error('ArkGrid offline app shell could not be registered.', error)
        setOfflineError(true)
      })
      return () => {
        active = false
        window.clearInterval(healthTimer)
        window.removeEventListener('focus', checkBackend)
        document.removeEventListener('visibilitychange', checkBackend)
        window.removeEventListener('offline', onOffline)
        window.removeEventListener('online', onOnline)
        window.removeEventListener('beforeinstallprompt', onInstallPrompt)
        window.removeEventListener('appinstalled', onInstalled)
        window.removeEventListener('arkgrid:offline-error', onOfflineError)
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      }
    }
    return () => {
      active = false
      window.clearInterval(healthTimer)
      window.removeEventListener('focus', checkBackend)
      document.removeEventListener('visibilitychange', checkBackend)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('beforeinstallprompt', onInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [isProduction])

  async function installApp() {
    if (!installPrompt) return
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      setInstallMessage(choice.outcome === 'accepted'
        ? 'Installation requested; waiting for browser confirmation.'
        : 'Installation was cancelled.')
    } catch {
      setInstallMessage('Could not open the install prompt. Try your browser menu.')
    } finally {
      setInstallPrompt(null)
    }
  }

  function navigate(nextPage: Page) {
    setPage(nextPage)
    setOpen(false)
    const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
    window.history.pushState({ page: nextPage }, '', nextPage === 'Emergency Mode' ? `${base}emergency` : base)
  }

  useEffect(() => {
    if (!automaticEmergency || !connectivityChecked || connectivityOnline || page !== 'Overview') return
    const timer = window.setTimeout(() => navigate('Emergency Mode'), 0)
    return () => window.clearTimeout(timer)
  }, [automaticEmergency, connectivityChecked, connectivityOnline, page])

  function toggleAutomaticEmergency(enabled: boolean) {
    setAutomaticEmergency(enabled)
    try {
      window.localStorage.setItem('arkgrid-auto-emergency', String(enabled))
    } catch {
      setAutomaticEmergency(false)
    }
  }

  useEffect(() => {
    const restorePage = (event: PopStateEvent) => {
      setPage(isPage(event.state?.page)
        ? event.state.page
        : window.location.pathname.endsWith('/emergency') ? 'Emergency Mode' : 'Overview')
      setOpen(false)
    }
    window.addEventListener('popstate', restorePage)
    return () => window.removeEventListener('popstate', restorePage)
  }, [])

  const userAgent = navigator.userAgent
  const isIosSafari = (/iPhone|iPad|iPod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) &&
    /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)

  return (
    <div className="app-shell min-h-screen">
      <header className="app-header sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-7">
        <div className="flex items-center gap-3">
          <button className="app-menu-button lg:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="primary-navigation" aria-label="Toggle navigation">{open ? <X /> : <Menu />}</button>
          <div className="app-brand-mark flex h-10 w-10 items-center justify-center rounded-xl text-white"><Activity size={21} /></div>
          <div><p className="font-bold tracking-tight">ArkGrid</p><p className="text-xs font-medium">Community safety · demonstration</p></div>
        </div>
        <div className="app-header-actions flex flex-wrap items-center justify-end gap-2">
          <span role="status" aria-live="polite" aria-label="Connectivity and backend status"
            title="Connectivity and backend health only; external data feeds are not checked."
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${connectivityOnline ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'}`}>
            {connectivityOnline ? <Wifi size={14} /> : <WifiOff size={14} />}{connectivityOnline ? 'Online' : 'Offline'}
          </span>
          {pendingCount > 0 && <button className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-950" onClick={() => navigate('Emergency Mode')}>{pendingCount} saved report{pendingCount === 1 ? '' : 's'}</button>}
          <button className="app-emergency-button min-h-11 rounded-lg px-4 text-sm font-bold text-white" onClick={() => navigate('Emergency Mode')}>Emergency Mode</button>
          {!installed && installPrompt && <button className="min-h-11 rounded-lg border px-3 text-sm font-semibold" onClick={() => void installApp()}>Install App</button>}
          {!installed && !installPrompt && isIosSafari && <span className="text-xs font-medium" role="status">Install: Share → Add to Home Screen</span>}
          {!installed && !installPrompt && !isIosSafari && <span className="text-xs font-medium" role="status">{installMessage || 'Installation unavailable in this browser.'}</span>}
          {installed && <span className="text-xs font-medium" role="status">Installed</span>}
          <span className="app-demo-label hidden items-center gap-2 text-xs font-semibold lg:flex"><span className="h-2 w-2 rounded-full bg-amber-500" />Demonstration only</span>
        </div>
      </header>
      <div className="app-offline-note px-4 py-2 text-sm sm:px-6 lg:px-7">
        {isProduction
          ? (offlineReady
            ? 'Offline app shell cached on this device. Map tiles, SMS, and server sync may still require external services.'
            : offlineError
              ? 'Offline caching could not be enabled in this browser. Keep a connection available.'
              : 'Offline capability is not ready yet. Keep the app online until its first successful cache completes.')
          : 'This Vite development server does not register the offline service worker. Build and preview once online to cache the app shell; first-visit offline use is not available.'}
        {isProduction && !('serviceWorker' in navigator) && ' This browser does not support service workers.'}
        {' Connectivity status checks the backend health endpoint only; it does not confirm external data feeds, SMS delivery, or map tile availability.'}
      </div>
      {connectivityChecked && !connectivityOnline && (
        <section role="alert" className="app-connection-alert border-b px-4 py-3 text-sm lg:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold">
              Emergency Mode can save reports on this device. External messaging and server synchronization may be unavailable.
            </p>
          </div>
          <label className="mt-2 inline-flex min-h-9 items-center gap-2">
            <input type="checkbox" checked={automaticEmergency} onChange={event => toggleAutomaticEmergency(event.target.checked)} />
            Automatically open Emergency Mode when connectivity or the backend is unavailable (only from Overview; active forms are preserved)
          </label>
        </section>
      )}
      <div className="app-body relative flex">
        <aside className={`${open ? 'block' : 'hidden'} app-sidebar absolute inset-x-0 top-0 z-10 max-h-[calc(100dvh-4rem)] overflow-y-auto p-3 lg:static lg:block lg:min-h-[calc(100vh-4rem)] lg:max-h-none lg:w-64 lg:shrink-0`}>
          <nav id="primary-navigation" className="space-y-1" aria-label="Main navigation">
            {navigation.map(({ label, page: target, Icon }) => (
              <button key={label} onClick={() => navigate(target)} aria-current={page === target ? 'page' : undefined} className={`app-nav-button flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-base font-semibold ${page === target ? 'is-active' : ''}`}>
                <Icon size={19} />{label}
              </button>
            ))}
          </nav>
          <p className="app-sidebar-note mt-5 rounded-xl p-3 text-sm leading-6">This is a demonstration. It does not contact emergency services.</p>
        </aside>
        <main className="app-main min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <div className="page-heading mb-6">
            <h1 className="text-2xl font-bold tracking-tight">{pageTitles[page]}</h1>
            <p className="page-guidance mt-1 max-w-3xl text-sm leading-6">{pageGuidance[page]}</p>
          </div>
          <Suspense fallback={<p role="status" className="rounded-lg bg-white p-4 text-sm text-slate-700">Loading this section…</p>}>
            <Content page={page} area={area} setArea={setArea}
              online={connectivityOnline} offlineReady={offlineReady} pendingReports={pendingCount} onPendingChange={updatePendingCount} onNavigate={navigate} />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
