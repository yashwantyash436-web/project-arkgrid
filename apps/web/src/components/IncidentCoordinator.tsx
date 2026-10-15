import { useCallback, useEffect, useMemo, useState } from 'react'
import { arkgridApi, ApiError } from '../api/client'
import type { Incident, Resource } from '../api/types'

const statusOptions: Incident['status'][] = ['new', 'triaged', 'assigned', 'resolved', 'closed']

export function IncidentCoordinator({
  heading = 'Persisted incident coordination',
  onCreateDemoReport,
}: {
  heading?: string
  onCreateDemoReport?: () => void
}) {
  const [items, setItems] = useState<Incident[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [note, setNote] = useState('')
  const [assignment, setAssignment] = useState('')
  const [overrideScore, setOverrideScore] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [coordinatorToken, setCoordinatorToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [incidents, resourceResult] = await Promise.all([arkgridApi.incidents(), arkgridApi.resources()])
      setItems(incidents.items)
      setResources(resourceResult.items)
      setSelectedId(current => incidents.items.some(item => item.id === current) ? current : incidents.items[0]?.id ?? '')
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Coordinator data could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void Promise.resolve().then(refresh) }, [refresh])

  const filtered = useMemo(() => items.filter(item =>
    (!search || [item.id, item.incident_type, item.category, item.message].some(value => value.toLowerCase().includes(search.toLowerCase()))) &&
    (!typeFilter || item.incident_type === typeFilter) &&
    (!severityFilter || item.severity === severityFilter) &&
    (!statusFilter || item.status === statusFilter) &&
    (!locationFilter || item.manual_location.toLowerCase().includes(locationFilter.toLowerCase()) ||
      (item.latitude !== null && item.longitude !== null &&
        `${item.latitude}, ${item.longitude}`.includes(locationFilter))),
  ), [items, locationFilter, search, severityFilter, statusFilter, typeFilter])
  const selected = filtered.find(item => item.id === selectedId) ?? filtered[0] ?? null
  const availableResources = resources.filter(resource => resource.available && resource.is_simulated)

  async function updateStatus(status: Incident['status']) {
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      const updated = await arkgridApi.updateIncident(selected.id, { status })
      setItems(current => current.map(item => item.id === updated.id ? updated : item))
      setMessage(`Incident status updated to ${updated.status}.`)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Incident status could not be updated.')
    } finally {
      setSaving(false)
    }
  }

  async function addNote() {
    if (!selected || !note.trim()) return
    setSaving(true)
    setError('')
    try {
      const updated = await arkgridApi.updateIncident(selected.id, { internal_note: note.trim() })
      setItems(current => current.map(item => item.id === updated.id ? updated : item))
      setNote('')
      setMessage('Internal coordinator note saved.')
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Coordinator note could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function assignResource() {
    if (!selected || !assignment) return
    setSaving(true)
    setError('')
    try {
      const updated = await arkgridApi.assignResource(selected.id, assignment)
      setItems(current => current.map(item => item.id === updated.id ? updated : item))
      setAssignment('')
      setMessage('Fictional demo resource assigned. This is not a real dispatch.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Demo resource could not be assigned.')
    } finally {
      setSaving(false)
    }
  }

  async function recordPriorityOverride() {
    if (!selected || !coordinatorToken || !overrideReason.trim()) return
    const score = Number(overrideScore)
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      setError('Priority override score must be a whole number from 0 to 100.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const priority = await arkgridApi.overridePriority(selected.id, score, overrideReason.trim(), coordinatorToken)
      setItems(current => current.map(item => item.id === selected.id ? { ...item, priority } : item))
      setOverrideReason('')
      setCoordinatorToken('')
      setMessage('Priority override was recorded with its reason.')
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Priority override could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-bold text-slate-950">{heading}</h2><p className="mt-1 text-sm text-slate-600">Records are persisted in the local SQLite demo database. Resources are fictional, not operational responders.</p></div>
        <div className="flex flex-wrap gap-2">
          {onCreateDemoReport && <button type="button" onClick={onCreateDemoReport} className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white">Submit demo report</button>}
          <button type="button" onClick={() => void refresh()} disabled={loading} className="min-h-11 rounded-lg border border-slate-400 bg-white px-4 text-sm font-semibold">{loading ? 'Loading…' : 'Refresh queue'}</button>
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
      {message && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">{message}</p>}
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <input aria-label="Search incidents" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search incidents" className="min-h-11 rounded-lg border border-slate-300 px-3" />
        <input aria-label="Filter by location" value={locationFilter} onChange={event => setLocationFilter(event.target.value)} placeholder="Location contains" className="min-h-11 rounded-lg border border-slate-300 px-3" />
        <select aria-label="Filter by type" value={typeFilter} onChange={event => setTypeFilter(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3"><option value="">All types</option>{Array.from(new Set(items.map(item => item.incident_type))).map(value => <option key={value}>{value}</option>)}</select>
        <select aria-label="Filter by severity" value={severityFilter} onChange={event => setSeverityFilter(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3"><option value="">All severities</option><option>Critical</option><option>High</option><option>Moderate</option></select>
        <select aria-label="Filter by status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3"><option value="">All statuses</option>{statusOptions.map(value => <option key={value}>{value}</option>)}</select>
      </div>
      {loading && items.length === 0 && <p role="status" className="rounded-lg bg-white p-4 text-sm text-slate-700">Loading persisted incidents and demo resources…</p>}
      {!loading && !error && filtered.length === 0 && <p className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-700">No persisted incidents match these filters. No scenario fixtures are silently inserted as incidents.</p>}
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4" aria-label="Fictional demo resources">
        <h3 className="font-bold text-amber-950">Available resources · all fictional demo entries</h3>
        {resources.length === 0
          ? <p className="mt-2 text-sm text-amber-950">No demo resources are available from the backend.</p>
          : <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{resources.map(resource => (
            <li key={resource.id} className="rounded-lg bg-white p-3 text-sm">
              <p className="font-semibold text-slate-950">{resource.name}</p>
              <p className="mt-1 text-xs text-slate-600">{resource.id} · {resource.location} · {resource.available ? 'Available' : 'Assigned/unavailable'}</p>
              <p className="mt-1 text-xs text-slate-600">Capabilities: {resource.capabilities.join(', ') || 'Not specified'}</p>
            </li>
          ))}</ul>}
      </section>
      {selected && (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
          <ul className="min-w-0 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white px-4">
            {filtered.map(item => (
              <li key={item.id}>
                <button type="button" onClick={() => setSelectedId(item.id)} className={`min-w-0 w-full py-4 text-left ${selected.id === item.id ? 'font-semibold text-slate-950' : 'text-slate-700'}`}>
                  <span className="block">{item.severity} · {item.incident_type}</span>
                  <span className="mt-1 block break-all text-xs">{item.id} · {item.manual_location || 'Coordinates provided'}</span>
                  <span className="mt-1 block text-xs">Status: {item.status} · Priority {item.priority.score}/100 ({item.priority.band})</span>
                  {item.data_class === 'simulation' && <span className="mt-1 inline-block rounded bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-950">SIMULATED — DEMO ONLY</span>}
                  {item.data_class === 'citizen_report' && <span className="mt-1 inline-block rounded bg-sky-100 px-2 py-1 text-[10px] font-bold text-sky-950">CITIZEN REPORT — UNVERIFIED</span>}
                </button>
              </li>
            ))}
          </ul>
          <article className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <div><h3 className="text-lg font-bold text-slate-950">Incident detail</h3><p className="mt-1 break-all text-xs text-slate-500">{selected.id} · Created {new Date(selected.created_at).toLocaleString()}</p></div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Type / category</dt><dd className="font-medium">{selected.incident_type} · {selected.category}</dd></div>
              <div><dt className="text-slate-500">Severity / status</dt><dd className="font-medium">{selected.severity} · {selected.status}</dd></div>
              <div><dt className="text-slate-500">Report class / consent</dt><dd className="font-medium">{selected.data_class === 'citizen_report' ? `Unverified citizen report · consent ${selected.consent_confirmed ? 'confirmed' : 'not recorded'}` : `${selected.data_class} · consent ${selected.consent_confirmed ? 'confirmed' : 'not applicable'}`}</dd></div>
              <div><dt className="text-slate-500">People affected</dt><dd className="font-medium">{selected.people_affected ?? 'Unknown'}</dd></div>
              <div><dt className="text-slate-500">Location</dt><dd className="font-medium">{selected.manual_location || `${selected.latitude}, ${selected.longitude}`}</dd></div>
              <div className="sm:col-span-2"><dt className="text-slate-500">Report details</dt><dd className="font-medium">{selected.message || 'No additional details.'}</dd></div>
            </dl>
            <section className="rounded-lg bg-violet-50 p-4" aria-label="Explainable priority score">
              <h4 className="font-bold text-violet-950">Rule-based priority: {selected.priority.score}/100 · {selected.priority.band}</h4>
              <p className="mt-1 text-xs text-violet-900">{selected.priority.explanation} Method: {selected.priority.method}.</p>
              <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-violet-950">{selected.priority.factors.map(factor => <li key={factor.key}>{factor.explanation} ({factor.points > 0 ? '+' : ''}{factor.points})</li>)}</ul>
              {selected.priority.uncertainty.length > 0 && <p className="mt-2 text-xs text-amber-950">Uncertainty: {selected.priority.uncertainty.join(' ')}</p>}
              <p className="mt-2 text-xs text-violet-950">A coordinator must not use this score as the sole basis for a real-world rescue decision. Overrides require an authenticated server-side coordinator token.</p>
              {selected.priority.override_reason && <p className="mt-2 text-xs font-semibold">Override reason: {selected.priority.override_reason}</p>}
            </section>
            <details className="rounded-lg border border-slate-200 p-4">
              <summary className="cursor-pointer text-sm font-semibold">Authorized coordinator priority override</summary>
              <p className="mt-2 text-xs text-slate-600">The token is used for this request only and is not saved in browser storage. Configure HTTPS before using coordinator credentials beyond local development.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-medium">Score (0–100)
                  <input type="number" min="0" max="100" step="1" value={overrideScore} onChange={event => setOverrideScore(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm" />
                </label>
                <label className="grid gap-1 text-xs font-medium">Coordinator token (request only)
                  <input type="password" autoComplete="off" value={coordinatorToken} onChange={event => setCoordinatorToken(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm" />
                </label>
                <label className="grid gap-1 text-xs font-medium sm:col-span-2">Reason (required)
                  <textarea minLength={5} maxLength={500} value={overrideReason} onChange={event => setOverrideReason(event.target.value)} className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </label>
              </div>
              <button type="button" onClick={() => void recordPriorityOverride()} disabled={saving || !coordinatorToken || !overrideReason.trim()} className="mt-3 min-h-11 rounded-lg bg-violet-900 px-4 text-sm font-semibold text-white disabled:opacity-50">Record priority override</button>
            </details>
            <label className="grid gap-1 text-sm font-medium">Status
              <select aria-label="Update incident status" value={selected.status} onChange={event => void updateStatus(event.target.value as Incident['status'])} disabled={saving} className="min-h-11 rounded-lg border border-slate-300 px-3">
                {statusOptions.map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input aria-label="Internal coordinator note" value={note} onChange={event => setNote(event.target.value)} maxLength={2000} placeholder="Internal note" className="min-h-11 rounded-lg border border-slate-300 px-3" />
              <button type="button" onClick={() => void addNote()} disabled={saving || !note.trim()} className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50">Add note</button>
            </div>
            <ul className="space-y-2 text-sm">{selected.internal_notes.map((item, index) => <li key={`${item.created_at}-${index}`} className="rounded bg-slate-50 p-3">{item.text}<span className="mt-1 block text-xs text-slate-500">{new Date(item.created_at).toLocaleString()} · internal</span></li>)}</ul>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <select aria-label="Assign simulated resource" value={assignment} onChange={event => setAssignment(event.target.value)} className="min-h-11 min-w-0 rounded-lg border border-slate-300 px-3"><option value="">Select an available demo resource</option>{availableResources.map(resource => <option key={resource.id} value={resource.id}>{resource.name} · {resource.capabilities.join(', ')}</option>)}</select>
              <button type="button" onClick={() => void assignResource()} disabled={saving || !assignment} className="min-h-11 rounded-lg border border-slate-400 px-4 text-sm font-semibold disabled:opacity-50">Assign demo resource</button>
            </div>
            {selected.assigned_resource_id && <p className="text-sm font-semibold text-amber-900">Assigned resource: {selected.assigned_resource_id} (fictional demonstration resource; not dispatched).</p>}
          </article>
        </div>
      )}
    </section>
  )
}
