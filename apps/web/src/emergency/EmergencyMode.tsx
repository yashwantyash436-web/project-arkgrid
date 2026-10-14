import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { arkgridApi, ApiError, apiBaseUrl } from '../api/client'
import {
  isLikelyMultipartSms,
  normalizePhoneNumber,
  smsHandoffProvider,
} from './communications'
import { emergencyStorage } from './storage'
import {
  createReportId,
  emergencyCategories,
  emptyEmergencyDraft,
  incidentTypes,
  isValidCoordinate,
  validateEmergencyDraft,
} from './types'
import type {
  EmergencyDraft,
  EmergencyReport,
  EmergencySettings,
  EmergencyCategory,
  IncidentType,
  TrustedContact,
  Severity,
} from './types'

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-950'
const labelClass = 'grid gap-1.5 text-sm font-semibold text-slate-800'

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Never'
}

function currentTimestamp(): string {
  return new Date().toISOString()
}

function describeStatus(report: EmergencyReport): string {
  if (report.syncStatus === 'synchronized') return `Backend acknowledged persistence at ${formatTime(report.syncAttemptedAt)}; this does not confirm emergency-service delivery.`
  if (report.syncStatus === 'failed') return `Saved on this device — delivery is not confirmed. Sync failed at ${formatTime(report.syncAttemptedAt)}. ${report.syncError ?? ''}`
  if (report.transmissionStatus === 'user_marked_attempted') {
    return `You marked an SMS attempt at ${formatTime(report.transmissionAttemptedAt)}; delivery status is unknown.`
  }
  if (report.transmissionStatus === 'composer_opened') {
    return `SMS handoff requested at ${formatTime(report.transmissionAttemptedAt)}; delivery status is unknown.`
  }
  if (report.transmissionStatus === 'copied_for_manual_send') {
    return `Message copied at ${formatTime(report.transmissionAttemptedAt)}; delivery status is unknown.`
  }
  if (report.syncStatus === 'pending') return 'Saved on this device — NOT YET DELIVERED. Ready to synchronize with the configured backend.'
  return 'Saved on this device — NOT YET DELIVERED. Backend synchronization is not configured.'
}

function isEditable(report: EmergencyReport): boolean {
  return report.syncStatus !== 'synchronized' &&
    report.syncAttempts === 0 &&
    report.transmissionStatus === 'not_started'
}

export function EmergencyMode({
  online,
  offlineReady,
  onPendingChange,
  initialTab = 'report',
}: {
  online: boolean
  offlineReady: boolean
  onPendingChange: (count: number) => void
  initialTab?: 'report' | 'queue' | 'settings'
}) {
  const [reports, setReports] = useState<EmergencyReport[]>([])
  const [settings, setSettings] = useState<EmergencySettings>({
    id: 'settings',
    trustedContacts: [],
    lastSyncAt: null,
    recentLocation: null,
  })
  const [draft, setDraft] = useState<EmergencyDraft>(emptyEmergencyDraft)
  const [activeTab, setActiveTab] = useState<'report' | 'queue' | 'settings'>(initialTab)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [contactDraft, setContactDraft] = useState({ id: '', name: '', relationship: '', phone: '', note: '' })
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([])
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [storageError, setStorageError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [storageLoaded, setStorageLoaded] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const [locationClock, setLocationClock] = useState(0)

  const selectedReport = reports.find(report => report.id === selectedId) ?? null
  const canSync = true
  const pendingReports = useMemo(
    () => reports.filter(report => report.syncStatus !== 'synchronized'),
    [reports],
  )
  const smsMessage = selectedReport ? smsHandoffProvider.createMessage(selectedReport) : ''
  const selectedContacts = settings.trustedContacts.filter(contact => selectedContactIds.includes(contact.id))
  const messageForContact = (contact: TrustedContact) =>
    smsMessage + (contact.note ? `\nContact note: ${contact.note}` : '')

  useEffect(() => {
    let mounted = true
    void Promise.all([emergencyStorage.listReports(), emergencyStorage.getSettings()])
      .then(([storedReports, storedSettings]) => {
        if (!mounted) return
        setReports(storedReports)
        setSettings(storedSettings)
        setStorageLoaded(true)
      })
      .catch(() => {
        if (mounted) setStorageError('Local emergency storage is unavailable. Reports cannot be safely saved on this device.')
      })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    onPendingChange(reports.filter(report => report.syncStatus !== 'synchronized').length)
  }, [onPendingChange, reports])

  useEffect(() => {
    const refresh = () => {
      void emergencyStorage.listReports()
        .then(setReports)
        .catch(() => setStorageError('Could not refresh the local report queue.'))
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])

  useEffect(() => {
    const updateClock = () => setLocationClock(Date.now())
    const timer = window.setTimeout(updateClock, 0)
    const interval = window.setInterval(updateClock, 60000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
    }
  }, [])

  function updateDraft<K extends keyof EmergencyDraft>(key: K, value: EmergencyDraft[K]) {
    setDraft(current => ({ ...current, [key]: value }))
    setValidationErrors([])
  }

  function updateManualCoordinate(axis: 'latitude' | 'longitude', rawValue: string) {
    setDraft(current => {
      const next = { ...current, [axis]: rawValue === '' ? null : Number(rawValue) }
      const hasCoordinates = next.latitude !== null || next.longitude !== null
      return {
        ...next,
        locationSource: hasCoordinates ? 'manual' : 'unknown',
        locationAccuracyMeters: null,
        locationCapturedAt: null,
      }
    })
    setValidationErrors([])
  }

  function startNewReport() {
    setDraft(emptyEmergencyDraft)
    setEditingId(null)
    setSelectedId(null)
    setValidationErrors([])
    setActionMessage('')
    setActiveTab('report')
  }

  function editReport(report: EmergencyReport) {
    if (!isEditable(report)) return
    const {
      id: _id,
      createdAt: _createdAt,
      transmissionStatus: _transmissionStatus,
      transmissionAttemptedAt: _transmissionAttemptedAt,
      syncStatus: _syncStatus,
      syncAttemptedAt: _syncAttemptedAt,
      syncError: _syncError,
      serverIncidentId: _serverIncidentId,
      syncAttempts: _syncAttempts,
      ...reportDraft
    } = report
    setDraft(reportDraft)
    setEditingId(report.id)
    setSelectedId(null)
    setSelectedContactIds([])
    setValidationErrors([])
    setActionMessage('')
    setActiveTab('report')
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const errors = validateEmergencyDraft(draft)
    setValidationErrors(errors)
    setActionMessage('')
    if (errors.length || !storageLoaded || storageError) return

    setIsSaving(true)
    try {
      const oldReport = editingId ? reports.find(report => report.id === editingId) : undefined
      const report: EmergencyReport = {
        ...draft,
        id: editingId ?? createReportId(),
        createdAt: oldReport?.createdAt ?? new Date().toISOString(),
        serverIncidentId: oldReport?.serverIncidentId ?? null,
        syncAttempts: oldReport?.syncAttempts ?? 0,
        transmissionStatus: oldReport?.transmissionStatus === 'user_marked_attempted'
          ? oldReport.transmissionStatus
          : 'not_started',
        transmissionAttemptedAt: oldReport?.transmissionStatus === 'user_marked_attempted'
          ? oldReport.transmissionAttemptedAt
          : null,
        syncStatus: oldReport?.syncStatus === 'synchronized'
          ? 'synchronized'
          : canSync ? 'pending' : 'not_configured',
        syncAttemptedAt: oldReport?.syncStatus === 'synchronized' ? oldReport.syncAttemptedAt : null,
        syncError: null,
      }
      await emergencyStorage.saveReport(report)
      setReports(current => [report, ...current.filter(item => item.id !== report.id)])
      setSelectedId(report.id)
      setSelectedContactIds([])
      setEditingId(null)
      setActionMessage('Report saved on this device. Nothing has been sent.')
      setActiveTab('queue')
    } catch {
      setStorageError('Could not save this report locally. It was not sent; keep this page open and try again.')
    } finally {
      setIsSaving(false)
    }
  }

  async function updateReport(report: EmergencyReport) {
    try {
      await emergencyStorage.saveReport(report)
      setReports(current => [report, ...current.filter(item => item.id !== report.id)]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)))
      setSelectedId(report.id)
      setActionMessage('')
    } catch {
      setStorageError('Could not update the saved report. The previous local copy remains unchanged.')
    }
  }

  async function removeReport(report: EmergencyReport) {
    if (!window.confirm(`Remove report ${report.id} from this device? This cannot be undone.`)) return
    try {
      await emergencyStorage.deleteReport(report.id)
      setReports(current => current.filter(item => item.id !== report.id))
      if (selectedId === report.id) setSelectedId(null)
      setActionMessage('Report removed from this device.')
    } catch {
      setStorageError('Could not remove this report from local storage.')
    }
  }

  function rememberRecentLocation(recentLocation: NonNullable<EmergencySettings['recentLocation']>) {
    const nextSettings = { ...settings, recentLocation }
    void emergencyStorage.saveSettings(nextSettings)
      .then(() => setSettings(nextSettings))
      .catch(() => setStorageError('Location was added to this report but could not be saved as the recent location.'))
  }

  function requestLocation() {
    if (!('geolocation' in navigator)) {
      setLocationMessage('This browser does not provide location access. Enter a manual location instead.')
      return
    }
    setLocationMessage('Waiting for your location permission and device fix…')
    navigator.geolocation.getCurrentPosition(
      position => {
        const { latitude, longitude } = position.coords
        if (!isValidCoordinate(latitude, longitude)) {
          setLocationMessage('The device returned invalid coordinates. Enter a manual location instead.')
          return
        }
        const capturedAt = new Date(position.timestamp)
        if (!Number.isFinite(position.coords.accuracy) || position.coords.accuracy < 0 ||
          !Number.isFinite(capturedAt.getTime())) {
          setLocationMessage('The device returned incomplete location accuracy or timestamp data. Enter a manual location instead.')
          return
        }
        setDraft(current => ({
          ...current,
          latitude,
          longitude,
          locationSource: 'device',
          locationAccuracyMeters: position.coords.accuracy,
          locationCapturedAt: capturedAt.toISOString(),
        }))
        rememberRecentLocation({
          latitude,
          longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: capturedAt.toISOString(),
        })
        setValidationErrors([])
        setLocationMessage('Device coordinates added. Review the reported accuracy and capture time before saving.')
      },
      error => {
        const explanation = error.code === error.PERMISSION_DENIED
          ? 'Location permission was not granted.'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'The device could not determine a location.'
            : 'Location lookup timed out.'
        setLocationMessage(`${explanation} Enter a manual location instead.`)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    )
  }

  async function saveTrustedContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const phone = normalizePhoneNumber(contactDraft.phone)
    if (!contactDraft.name.trim() || !contactDraft.relationship.trim() || !phone) {
      setActionMessage('Enter a name, relationship, and phone in international E.164 format, for example +14155550123.')
      return
    }
    if (contactDraft.note.trim().length > 240) {
      setActionMessage('Keep the optional contact note to 240 characters or fewer.')
      return
    }
    if (!contactDraft.id && settings.trustedContacts.length >= 10) {
      setActionMessage('A maximum of 10 contacts can be stored on this device.')
      return
    }
    const contact: TrustedContact = {
      id: contactDraft.id || createReportId(),
      name: contactDraft.name.trim(),
      relationship: contactDraft.relationship.trim(),
      phone,
      note: contactDraft.note.trim(),
    }
    const trustedContacts = contactDraft.id
      ? settings.trustedContacts.map(item => item.id === contact.id ? contact : item)
      : [...settings.trustedContacts, contact]
    const nextSettings = { ...settings, trustedContacts }
    try {
      await emergencyStorage.saveSettings(nextSettings)
      setSettings(nextSettings)
      setContactDraft({ id: '', name: '', relationship: '', phone: '', note: '' })
      setActionMessage('Contact saved only on this device; it is not stored in an account.')
    } catch {
      setStorageError('Could not save trusted contacts on this device.')
    }
  }

  async function deleteTrustedContact(contact: TrustedContact) {
    if (!window.confirm(`Delete ${contact.name} from this device?`)) return
    const nextSettings = { ...settings, trustedContacts: settings.trustedContacts.filter(item => item.id !== contact.id) }
    try {
      await emergencyStorage.saveSettings(nextSettings)
      setSettings(nextSettings)
      setSelectedContactIds(current => current.filter(id => id !== contact.id))
      if (contactDraft.id === contact.id) setContactDraft({ id: '', name: '', relationship: '', phone: '', note: '' })
      setActionMessage(`${contact.name} was removed from this device.`)
    } catch {
      setStorageError('Could not remove the contact from this device.')
    }
  }

  async function clearRecentLocation() {
    if (!window.confirm('Delete the saved recent location from this device?')) return
    const nextSettings = { ...settings, recentLocation: null }
    try {
      await emergencyStorage.saveSettings(nextSettings)
      setSettings(nextSettings)
      setActionMessage('Recent location deleted from this device.')
    } catch {
      setStorageError('Could not delete the recent location.')
    }
  }

  function useRecentLocation() {
    const location = settings.recentLocation
    if (!location) return
    setDraft(current => ({
      ...current,
      latitude: location.latitude,
      longitude: location.longitude,
      locationSource: 'device',
      locationAccuracyMeters: location.accuracyMeters,
      locationCapturedAt: location.capturedAt,
    }))
    setLocationMessage('Using the last explicitly captured location, not a live location. Check its capture time before saving.')
    setValidationErrors([])
    setActiveTab('report')
    setSelectedId(null)
  }

  async function syncPendingReports() {
    if (!canSync || isSyncing || pendingReports.length === 0) return
    const confirmed = window.confirm(
      `Send ${pendingReports.length} locally saved report(s) to the configured ArkGrid demo backend? This shares their report details and location with that server. It does not contact responders.`,
    )
    if (!confirmed) return
    setIsSyncing(true)
    setActionMessage('')
    try {
      for (const report of pendingReports) {
        const attemptedAt = new Date().toISOString()
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
          setReports(current => current.map(item => item.id === report.id ? synchronized : item))
          const nextSettings = { ...settings, lastSyncAt: result.synchronizedAt }
          try {
            await emergencyStorage.saveSettings(nextSettings)
            setSettings(nextSettings)
          } catch {
            setStorageError('The report synchronized, but its last-sync time could not be recorded locally.')
          }
        } catch (error) {
          const failed = {
            ...report,
            syncAttempts: report.syncAttempts + 1,
            syncStatus: 'failed' as const,
            syncAttemptedAt: attemptedAt,
            syncError: error instanceof ApiError ? error.message : 'Synchronization failed. Your report remains saved on this device.',
          }
          try {
            await emergencyStorage.saveReport(failed)
            setReports(current => current.map(item => item.id === report.id ? failed : item))
          } catch {
            setStorageError('Sync failed and the attempt could not be recorded locally; your saved report remains available.')
          }
        }
      }
    } finally {
      setIsSyncing(false)
    }
  }

  function markSmsAttempted(report: EmergencyReport) {
    void updateReport({
      ...report,
      transmissionStatus: 'user_marked_attempted',
      transmissionAttemptedAt: new Date().toISOString(),
    })
  }

  async function copySmsMessage() {
    if (!selectedReport) return
    const transmissionAttemptedAt = currentTimestamp()
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access unavailable.')
      await navigator.clipboard.writeText(smsMessage)
      await updateReport({
        ...selectedReport,
        transmissionStatus: 'copied_for_manual_send',
        transmissionAttemptedAt,
      })
      setActionMessage('Message copied. Paste it into your messaging app and send only if you choose.')
    } catch {
      setActionMessage('Automatic copy is unavailable. Select and copy the message below manually.')
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-950" aria-labelledby="emergency-disclaimer">
        <h2 id="emergency-disclaimer" className="text-lg font-bold">Emergency support prototype — not an emergency service</h2>
        <p className="mt-2 text-sm leading-6">
          If there is immediate danger, contact local emergency services directly. ArkGrid cannot guarantee message delivery,
          responder receipt, or rescue. SMS requires working cellular/SMS service; location and network access may be unavailable.
          Reports and trusted contacts stay in this browser’s IndexedDB without app-level encryption; anyone with access to this
          browser profile may view them, and clearing browser data can remove them.
        </p>
      </section>

      {!offlineReady && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          Offline reload is not ready yet. Keep this page open online until the app shell finishes caching; local reports can be saved now, but first-visit offline access is not available.
        </div>
      )}
      {storageError && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">{storageError}</div>}
      {actionMessage && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">{actionMessage}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatusCard label="Device connection" value={online ? 'Online (browser hint)' : 'Offline (browser hint)'} />
        <StatusCard label="Saved reports" value={`${reports.length} on this device`} />
        <StatusCard label="Last backend sync" value={formatTime(settings.lastSyncAt)} />
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Emergency mode sections">
        <TabButton active={activeTab === 'report'} onClick={() => { setActiveTab('report'); setSelectedId(null) }}>New report</TabButton>
        <TabButton active={activeTab === 'queue'} onClick={() => setActiveTab('queue')}>Device queue ({reports.length})</TabButton>
        <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')}>Trusted contacts</TabButton>
      </div>

      {activeTab === 'report' && !selectedReport && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5">
            <h2 className="text-xl font-bold text-slate-950">{editingId ? 'Edit saved report' : 'Prepare an emergency report'}</h2>
            <p className="mt-1 text-sm text-slate-600">Required fields are marked. Your report stays on this device until you choose an action.</p>
          </div>
          <form className="grid gap-5" onSubmit={event => void saveDraft(event)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                Incident type
                <select className={inputClass} value={draft.incidentType} onChange={event => updateDraft('incidentType', event.target.value as IncidentType)}>
                  {incidentTypes.map(value => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label className={labelClass}>
                Severity
                <select className={inputClass} value={draft.severity} onChange={event => updateDraft('severity', event.target.value as Severity)}>
                  <option>Critical</option><option>High</option><option>Moderate</option>
                </select>
              </label>
            </div>
            <label className={labelClass}>
              Emergency category
              <select className={inputClass} value={draft.category} onChange={event => updateDraft('category', event.target.value as EmergencyCategory)}>
                {emergencyCategories.map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              Short message
              <textarea className={inputClass} rows={3} maxLength={500} value={draft.message} onChange={event => updateDraft('message', event.target.value)} placeholder="What help is needed?" />
              <span className="font-normal text-slate-500">{draft.message.length}/500 characters</span>
            </label>
            <label className={labelClass}>
              People affected
              <input className={inputClass} type="number" min="1" max="99999" step="1" required value={draft.peopleAffected}
                onChange={event => updateDraft('peopleAffected', event.target.value === '' ? Number.NaN : Number(event.target.value))} />
            </label>
            <label className={labelClass}>
              Accessibility or medical-assistance note (optional)
              <textarea className={inputClass} rows={2} maxLength={300} value={draft.assistanceNote} onChange={event => updateDraft('assistanceNote', event.target.value)} placeholder="Mobility, medication, communication, or other urgent needs" />
            </label>
            <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-4">
              <legend className="px-1 text-sm font-semibold text-slate-800">Location</legend>
              <p className="text-sm text-slate-600">Location is optional if you can describe it manually. Device location is requested only when you press the button.</p>
              <button type="button" className="min-h-12 rounded-lg border border-slate-400 px-4 text-left text-base font-semibold text-slate-900" onClick={requestLocation}>
                Use this device’s location
              </button>
              {locationMessage && <p role="status" className="text-sm text-slate-700">{locationMessage}</p>}
              {draft.latitude !== null && draft.longitude !== null && (
                <div className="space-y-1 text-sm font-medium text-slate-800">
                  <p>Coordinates: {draft.latitude.toFixed(5)}, {draft.longitude.toFixed(5)} · {draft.locationSource === 'device' ? 'device captured' : 'manually entered'}</p>
                  {draft.locationSource === 'device' && draft.locationAccuracyMeters !== null && (
                    <p>Browser-reported accuracy: ±{Math.round(draft.locationAccuracyMeters)} m · captured {formatTime(draft.locationCapturedAt)}</p>
                  )}
                  {draft.locationSource === 'manual' && <p>Manually entered coordinates; not device-verified.</p>}
                </div>
              )}
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="text-sm font-semibold text-slate-800">Or enter coordinates manually (optional)</legend>
                <label className={labelClass}>Latitude
                  <input className={inputClass} type="number" min="-90" max="90" step="any"
                    value={draft.latitude ?? ''} onChange={event => updateManualCoordinate('latitude', event.target.value)} />
                </label>
                <label className={labelClass}>Longitude
                  <input className={inputClass} type="number" min="-180" max="180" step="any"
                    value={draft.longitude ?? ''} onChange={event => updateManualCoordinate('longitude', event.target.value)} />
                </label>
              </fieldset>
              <label className={labelClass}>
                Manual location description
                <input className={inputClass} maxLength={160} value={draft.manualLocation} onChange={event => updateDraft('manualLocation', event.target.value)} placeholder="Address, landmark, or clear directions" />
              </label>
            </fieldset>
            {validationErrors.length > 0 && (
              <ul role="alert" className="list-inside list-disc rounded-lg bg-red-50 p-4 text-sm text-red-900">
                {validationErrors.map(error => <li key={error}>{error}</li>)}
              </ul>
            )}
            <button type="submit" className="min-h-14 rounded-lg bg-red-700 px-5 py-3 text-lg font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
              disabled={isSaving || !storageLoaded || Boolean(storageError)}>
              {isSaving ? 'Saving on this device…' : editingId ? 'Save changes and review' : 'Save on this device and review'}
            </button>
          </form>
        </section>
      )}

      {activeTab === 'queue' && !selectedReport && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-950">Reports saved on this device</h2>
              <p className="mt-1 text-sm text-slate-600">Local save is not server sync and does not mean an SMS was sent or delivered.</p>
            </div>
            {canSync ? (
              <button type="button" disabled={isSyncing || pendingReports.length === 0} onClick={() => void syncPendingReports()}
                className="min-h-12 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:bg-slate-400">
                {isSyncing ? 'Synchronizing…' : `Sync pending (${pendingReports.length})`}
              </button>
            ) : (
              <span className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">Backend sync not configured</span>
            )}
            <button type="button" className="min-h-12 rounded-lg border border-slate-400 px-4 text-sm font-semibold" onClick={startNewReport}>
              New report
            </button>
          </div>
          {reports.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700">No reports are saved on this device.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {reports.map(report => (
                <li key={report.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <button type="button" className="text-left" onClick={() => setSelectedId(report.id)}>
                    <span className="block font-semibold text-slate-950">{report.severity} — {report.incidentType}</span>
                    <span className="mt-1 block break-all text-xs text-slate-600">{report.id} · {formatTime(report.createdAt)}</span>
                    <span className="mt-1 block text-sm text-slate-700">{describeStatus(report)}</span>
                    {report.syncAttempts > 0 && <span className="mt-1 block text-xs text-slate-600">Sync attempts: {report.syncAttempts}</span>}
                  </button>
                  <div className="flex gap-2">
                    {isEditable(report) && <button type="button" className="min-h-11 rounded-md border border-slate-400 px-3 text-sm font-semibold" onClick={() => editReport(report)}>Edit</button>}
                    <button type="button" className="min-h-11 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-800" onClick={() => void removeReport(report)}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-950">
            {canSync
              ? `Manual sync first checks backend health and then uses the report ID as an idempotency key. API base: ${apiBaseUrl || 'same-origin /api'}. Local records remain available if either request fails.`
              : 'There is no backend in this project yet. Reports remain local; synchronization will be added when an API is available.'}
          </div>
        </section>
      )}

      {activeTab === 'settings' && (
        <section className="grid gap-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Trusted contacts · local only</h2>
                <p className="mt-2 text-sm leading-6 text-slate-700">Contacts are stored only in this browser profile’s IndexedDB, not in an account or synced to a server. Browser data clearing may erase them. Use verified numbers in international E.164 format.</p>
              </div>
              <span className="rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-950">ON THIS DEVICE</span>
            </div>
            <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={event => void saveTrustedContact(event)}>
              <label className={labelClass}>Contact name
                <input className={inputClass} required maxLength={80} value={contactDraft.name}
                  onChange={event => setContactDraft(current => ({ ...current, name: event.target.value }))} />
              </label>
              <label className={labelClass}>Relationship
                <input className={inputClass} required maxLength={40} value={contactDraft.relationship}
                  placeholder="Parent, sibling, spouse, friend…"
                  onChange={event => setContactDraft(current => ({ ...current, relationship: event.target.value }))} />
              </label>
              <label className={labelClass}>Phone number (international format)
                <input className={inputClass} required type="tel" maxLength={24} value={contactDraft.phone}
                  placeholder="+14155550123"
                  onChange={event => setContactDraft(current => ({ ...current, phone: event.target.value }))} />
              </label>
              <label className={labelClass}>Optional note
                <input className={inputClass} maxLength={240} value={contactDraft.note}
                  placeholder="Optional message context"
                  onChange={event => setContactDraft(current => ({ ...current, note: event.target.value }))} />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button type="submit" className="min-h-12 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white">
                  {contactDraft.id ? 'Save contact changes' : 'Add trusted contact'}
                </button>
                {contactDraft.id && <button type="button" className="min-h-12 rounded-lg border border-slate-400 px-4 text-sm font-semibold"
                  onClick={() => setContactDraft({ id: '', name: '', relationship: '', phone: '', note: '' })}>Cancel edit</button>}
              </div>
            </form>
            {settings.trustedContacts.length === 0 ? (
              <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">No trusted contacts are stored on this device.</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200 px-4">
                {settings.trustedContacts.map(contact => (
                  <li key={contact.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-semibold text-slate-950">{contact.name} <span className="font-normal text-slate-600">· {contact.relationship}</span></p>
                      <p className="text-sm text-slate-700">{contact.phone}</p>
                      {contact.note && <p className="text-xs text-slate-600">{contact.note}</p>}
                      <p className="text-xs text-amber-900">Saved in this browser only</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className="min-h-10 rounded-md border border-slate-400 px-3 text-sm font-semibold"
                        onClick={() => setContactDraft(contact)}>Edit</button>
                      <button type="button" className="min-h-10 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-800"
                        onClick={() => void deleteTrustedContact(contact)}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-950">My Recent Location</h2>
                <p className="mt-1 text-sm text-slate-700">Only the latest location you explicitly captured is saved locally. There is no continuous or background tracking.</p>
              </div>
              <button type="button" className="min-h-11 rounded-lg border border-slate-400 px-4 text-sm font-semibold"
                onClick={requestLocation}>Enable Location / refresh</button>
            </div>
            {settings.recentLocation ? (() => {
              const recent = settings.recentLocation
              const stale = locationClock > 0 && locationClock - Date.parse(recent.capturedAt) > 30 * 60 * 1000
              return <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm">
                <p className="font-semibold">{stale ? 'Stale saved location — not your current location' : 'Last captured location — not live tracking'}</p>
                <p className="mt-1">Coordinates: {recent.latitude.toFixed(5)}, {recent.longitude.toFixed(5)}</p>
                <p>Browser-reported accuracy: ±{Math.round(recent.accuracyMeters)} m</p>
                <p>Captured: {formatTime(recent.capturedAt)}</p>
                <a className="mt-2 inline-block font-semibold text-blue-800 underline"
                  href={`https://www.openstreetmap.org/?mlat=${recent.latitude}&mlon=${recent.longitude}#map=16/${recent.latitude}/${recent.longitude}`}
                  target="_blank" rel="noreferrer">View coordinates on OpenStreetMap</a>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="min-h-10 rounded-md border border-slate-400 px-3 font-semibold"
                    onClick={useRecentLocation}>Use this saved sample in a report</button>
                  <button type="button" className="min-h-10 rounded-md border border-red-300 px-3 font-semibold text-red-800"
                    onClick={() => void clearRecentLocation()}>Delete recent location</button>
                </div>
              </div>
            })() : <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">No recent location saved. Select Enable Location / refresh to request one; the browser will ask for permission if needed.</p>}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">Other communication options</h2>
            <p className="mt-2 text-sm text-slate-700">Bluetooth SOS relay is not implemented or no compatible receiver is available. This app does not scan, pair, or send data over Bluetooth.</p>
            <p className="mt-2 text-sm text-slate-700">A future multi-hop relay would require compatible devices, a defined relay protocol, authenticated messages, duplicate suppression, expiry rules, and acknowledgement handling.</p>
          </div>
        </section>
      )}

      {activeTab === 'queue' && selectedReport && (
        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-950">Review saved report</h2>
              <p className="mt-1 break-all text-xs text-slate-600">Report ID: {selectedReport.id}</p>
              {selectedReport.serverIncidentId && <p className="mt-1 break-all text-xs text-slate-600">Backend incident ID: {selectedReport.serverIncidentId}</p>}
              <p className="mt-1 text-sm text-slate-600">Created: {formatTime(selectedReport.createdAt)}</p>
            </div>
            <button type="button" className="min-h-11 rounded-lg border border-slate-400 px-4 text-sm font-semibold" onClick={() => { setSelectedId(null); setActiveTab('queue') }}>
              Back to queue
            </button>
          </div>
          <dl className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
            <Detail label="Incident type" value={selectedReport.incidentType} />
            <Detail label="Severity" value={selectedReport.severity} />
            <Detail label="Category" value={selectedReport.category} />
            <Detail label="People affected" value={String(selectedReport.peopleAffected)} />
            <Detail label="Location" value={selectedReport.latitude !== null && selectedReport.longitude !== null
              ? `${selectedReport.latitude.toFixed(5)}, ${selectedReport.longitude.toFixed(5)}`
              : selectedReport.manualLocation} />
            <Detail label="Coordinate source" value={selectedReport.locationSource === 'device'
              ? 'Device geolocation'
              : selectedReport.locationSource === 'manual'
                ? 'Manually entered'
                : 'Not provided'} />
            {selectedReport.locationSource === 'device' && selectedReport.locationAccuracyMeters !== null && (
              <Detail label="Browser-reported accuracy" value={`±${Math.round(selectedReport.locationAccuracyMeters)} m`} />
            )}
            {selectedReport.locationCapturedAt && (
              <Detail label="Coordinates captured" value={formatTime(selectedReport.locationCapturedAt)} />
            )}
            {selectedReport.latitude !== null && selectedReport.longitude !== null && (
              <a
                className="text-sm font-semibold text-blue-800 underline"
                href={`https://www.openstreetmap.org/?mlat=${selectedReport.latitude}&mlon=${selectedReport.longitude}#map=16/${selectedReport.latitude}/${selectedReport.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                View reported coordinates on OpenStreetMap
              </a>
            )}
            <Detail label="Record status" value={describeStatus(selectedReport)} />
          </dl>
          {selectedReport.message && <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{selectedReport.message}</p>}
          {selectedReport.assistanceNote && <p className="whitespace-pre-wrap break-words text-sm text-slate-800">Assistance: {selectedReport.assistanceNote}</p>}
          {selectedReport.transmissionStatus !== 'user_marked_attempted' && (
            <section className="space-y-3 border-t border-slate-200 pt-5">
              <h3 className="text-lg font-bold text-slate-950">Optional SMS handoff</h3>
              <p className="text-sm leading-6 text-slate-700">
                Review the recipient and message. Opening a composer does not send the SMS. Sending requires you to press Send
                in your messaging app and requires working cellular service, SMS service, and sufficient signal.
              </p>
              {settings.trustedContacts.length === 0 ? (
                <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                  <p>No local contacts are saved.</p>
                  <button type="button" className="mt-2 font-bold underline" onClick={() => { setActiveTab('settings'); setSelectedId(null) }}>Add or manage trusted contacts</button>
                </div>
              ) : (
                <fieldset className="space-y-2 rounded-lg border border-slate-200 p-4">
                  <legend className="px-1 text-sm font-semibold text-slate-800">Choose intended recipient(s)</legend>
                  <p className="text-xs text-slate-600">Location is shared only with contacts you select and only after you open each SMS composer. Review each exact recipient and message below.</p>
                  {settings.trustedContacts.map(contact => (
                    <label key={contact.id} className="flex min-h-11 items-center gap-3 text-sm">
                      <input type="checkbox" checked={selectedContactIds.includes(contact.id)}
                        onChange={event => setSelectedContactIds(current => event.target.checked
                          ? [...current, contact.id]
                          : current.filter(id => id !== contact.id))} />
                      <span><strong>{contact.name}</strong> · {contact.relationship} · {contact.phone}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {selectedContacts.length === 0 ? (
                <label className={labelClass}>
                  SMS message preview (no recipient selected)
                  <textarea aria-label="SMS message preview" className={`${inputClass} font-mono text-sm`} rows={9} readOnly value={smsMessage} />
                </label>
              ) : selectedContacts.map(contact => (
                <label key={`preview-${contact.id}`} className={labelClass}>
                  Exact SMS preview for {contact.name} · {contact.phone}
                  <textarea aria-label={`SMS message preview for ${contact.name}`} className={`${inputClass} font-mono text-sm`} rows={9} readOnly value={messageForContact(contact)} />
                </label>
              ))}
              {isLikelyMultipartSms(smsMessage) && (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">This message exceeds 160 characters and may be split into multiple SMS segments.</p>
              )}
              <div className="flex flex-wrap gap-3">
                {selectedContacts.map(contact => (
                  <a key={contact.id}
                    className="inline-flex min-h-14 items-center rounded-lg bg-red-700 px-5 text-base font-bold text-white"
                    href={smsHandoffProvider.createHref(contact.phone, messageForContact(contact))}
                    onClick={() => void updateReport({
                      ...selectedReport,
                      transmissionStatus: 'composer_opened',
                      transmissionAttemptedAt: new Date().toISOString(),
                    })}
                  >
                    Prepare SMS for {contact.name} ({contact.phone})
                  </a>
                ))}
                <button type="button" className="min-h-14 rounded-lg border border-slate-400 px-5 text-base font-semibold text-slate-950" onClick={() => void copySmsMessage()}>
                  Copy message instead
                </button>
              </div>
              <p className="text-xs text-slate-600">The SMS protocol handoff may be unsupported by your current browser/device. Opening a composer does not send or deliver the message. If there is no compatible messaging app, copy the text and use a supported channel directly.</p>
              {(selectedReport.transmissionStatus === 'composer_opened' || selectedReport.transmissionStatus === 'copied_for_manual_send') && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <p className="text-sm text-amber-950">Did you attempt to send this message? ArkGrid cannot confirm delivery.</p>
                  <button type="button" className="mt-3 min-h-12 rounded-lg border border-amber-700 px-4 text-sm font-bold text-amber-950" onClick={() => markSmsAttempted(selectedReport)}>
                    I attempted to send it
                  </button>
                </div>
              )}
            </section>
          )}
        </section>
      )}
    </div>
  )
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 break-words text-sm font-bold text-slate-950">{value}</p>
  </div>
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick}
    className={`min-h-12 rounded-lg px-4 text-sm font-bold ${active ? 'bg-slate-900 text-white' : 'border border-slate-400 bg-white text-slate-900'}`}>
    {children}
  </button>
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 break-words font-semibold text-slate-900">{value}</dd></div>
}
