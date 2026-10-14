import { useState } from 'react'
import { Activity, AlertTriangle, ClipboardList, Database, LayoutDashboard, Map, Menu, Radio, Satellite, ShieldAlert, Truck, X } from 'lucide-react'
import { MapView } from './components/MapView'
import { areas, incidents, resources, type Incident } from './data/demoData'

type Page = 'Overview' | 'Live monitoring' | 'Interactive map' | 'Flood & satellite' | 'Citizen SOS' | 'Incidents' | 'Rescue coordination' | 'Data & system status'
const navigation: [Page, typeof LayoutDashboard][] = [['Overview', LayoutDashboard], ['Live monitoring', Radio], ['Interactive map', Map], ['Flood & satellite', Satellite], ['Citizen SOS', ShieldAlert], ['Incidents', ClipboardList], ['Rescue coordination', Truck], ['Data & system status', Database]]
const styles = { Critical: 'bg-red-50 text-red-800 ring-red-200', High: 'bg-amber-50 text-amber-800 ring-amber-200', Moderate: 'bg-blue-50 text-blue-800 ring-blue-200' }
function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) { return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-900">{title}</h2>{action}</div>{children}</section> }
function Simulated() { return <span className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold tracking-wide text-amber-800 ring-1 ring-amber-200">SIMULATED · DEMO ONLY</span> }

function IncidentView({ selected, setSelected }: { selected: Incident; setSelected: (item: Incident) => void }) { return <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]"><Panel title="Incident queue" action={<Simulated />}><div className="divide-y divide-slate-100">{incidents.map(item => <button key={item.id} onClick={() => setSelected(item)} className="flex w-full items-start justify-between gap-4 py-4 text-left first:pt-0"><div><p className="text-sm font-semibold text-slate-900">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.id} · {item.location} · {item.status}</p></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ring-1 ${styles[item.severity]}`}>{item.severity}</span></button>)}</div></Panel><Panel title="Incident detail"><Simulated /><h3 className="mt-4 text-lg font-semibold text-slate-900">{selected.title}</h3><dl className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-slate-500">Reference</dt><dd className="font-medium">{selected.id}</dd></div><div><dt className="text-slate-500">Status</dt><dd className="font-medium">{selected.status}</dd></div><div className="col-span-2"><dt className="text-slate-500">Location</dt><dd className="font-medium">{selected.location}</dd></div></dl><p className="mt-5 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">{selected.description}</p></Panel></div> }

function Sos() {
  const [sent, setSent] = useState(false)
  const [form, setForm] = useState({ name: '', contact: '', need: '', people: '' })
  const peopleCount = Number(form.people)
  const valid =
    form.name.trim().length > 0 &&
    form.contact.trim().length > 0 &&
    form.need.length > 0 &&
    Number.isInteger(peopleCount) &&
    peopleCount >= 1

  return (
    <div className="mx-auto max-w-2xl">
      <Panel title="Submit a simulated SOS">
        <p className="mb-5 text-sm text-slate-600">
          This demo form does not contact emergency services, store information, or provide offline synchronisation.
        </p>
        {sent ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            Simulated report validated for the demo. No report was transmitted.
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={event => {
              event.preventDefault()
              if (valid) setSent(true)
            }}
          >
            <label className="grid gap-1 text-sm font-medium">
              Name or identifier
              <input
                required
                value={form.name}
                onChange={event => setForm({ ...form, name: event.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Demo participant"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Safe contact method
              <input
                required
                value={form.contact}
                onChange={event => setForm({ ...form, contact: event.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Demo contact only"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">
                Primary need
                <select
                  required
                  value={form.need}
                  onChange={event => setForm({ ...form, need: event.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="">Select a need</option>
                  <option>Medical support</option>
                  <option>Evacuation support</option>
                  <option>Food or water</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium">
                People affected
                <input
                  required
                  min="1"
                  step="1"
                  type="number"
                  value={form.people}
                  onChange={event => setForm({ ...form, people: event.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            </div>
            <button
              className="mt-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={!valid}
            >
              Validate simulated SOS
            </button>
          </form>
        )}
      </Panel>
    </div>
  )
}

function Content({ page, area, setArea, selected, setSelected }: { page: Page; area: keyof typeof areas; setArea: (a: keyof typeof areas) => void; selected: Incident; setSelected: (i: Incident) => void }) {
 const [point, setPoint] = useState('No custom point selected'); const current = areas[area]
 const mapPanel = <Panel title="Operational map" action={<select aria-label="Scenario" value={area} onChange={e => setArea(e.target.value as keyof typeof areas)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"><option value="nepal">Nepal historical scenario</option><option value="custom">Custom area</option></select>}><div className="h-[380px]"><MapView center={current.center} zoom={current.zoom} onAreaSelect={(lat,lng) => setPoint(`Custom point: ${lat.toFixed(3)}, ${lng.toFixed(3)}`)} /></div><p className="mt-3 text-xs text-slate-500">{current.label}. Click the map to select an AOI point — {point}. Markers are simulated fixtures; map data © OpenStreetMap contributors.</p></Panel>
 if (page === 'Interactive map') return mapPanel
 if (page === 'Citizen SOS') return <Sos />
 if (page === 'Incidents') return <IncidentView selected={selected} setSelected={setSelected} />
 if (page === 'Live monitoring') return <div className="grid gap-5 lg:grid-cols-2"><Panel title="Earthquake monitoring"><div className="rounded-lg border border-dashed border-slate-300 p-5 text-sm text-slate-600"><AlertTriangle className="mb-2 text-slate-400" />Live provider integration has not been configured. No earthquake events are displayed or fabricated.</div></Panel><Panel title="Refresh state"><p className="text-sm text-slate-600">External feeds will be fetched by the FastAPI backend in a later step. This frontend has no live-data connection.</p></Panel></div>
 if (page === 'Flood & satellite') return <div className="grid gap-5 lg:grid-cols-2"><Panel title="Flood information"><p className="text-sm text-slate-600">Historical scenario context will be added after a published Nepal event and licence are verified. No live flood extent is shown.</p></Panel><Panel title="Satellite analysis"><p className="text-sm text-slate-600">Not operational. Imagery discovery and analysis require backend credentials, quotas, provenance, and validation.</p></Panel></div>
 if (page === 'Rescue coordination') return <Panel title="Simulated rescue resources" action={<Simulated />}><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-xs uppercase tracking-wide text-slate-500"><tr><th className="pb-3">Reference</th><th className="pb-3">Resource</th><th className="pb-3">State</th><th className="pb-3">Location</th></tr></thead><tbody>{resources.map(row => <tr key={row[0]} className="border-b border-slate-100"><td className="py-3 font-medium">{row[0]}</td>{row.slice(1).map(cell => <td key={cell} className="py-3 text-slate-600">{cell}</td>)}</tr>)}</tbody></table></div></Panel>
 if (page === 'Data & system status') return <div className="grid gap-5 lg:grid-cols-2"><Panel title="System status"><ul className="space-y-3 text-sm"><li className="flex justify-between"><span>Frontend shell</span><b className="text-emerald-700">Available</b></li><li className="flex justify-between"><span>External provider API</span><b className="text-slate-500">Not connected</b></li><li className="flex justify-between"><span>Offline SOS sync</span><b className="text-slate-500">Not operational</b></li></ul></Panel><Panel title="Data classes"><p className="text-sm text-slate-600">Current fixtures: <b>simulation</b>. Future provider content will distinguish observations, forecasts, historical references, and ArkGrid analysis.</p></Panel></div>
 return <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]"><div className="space-y-5"><Panel title="Operational overview" action={<span className="text-xs text-slate-500">Demo environment</span>}><div className="grid gap-3 sm:grid-cols-3">{[['Open incidents','3'],['Provider feeds','Not connected'],['Resources','3 simulated']].map(([label,value]) => <div key={label} className="rounded-lg bg-slate-50 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-lg font-semibold text-slate-900">{value}</p></div>)}</div></Panel>{mapPanel}</div><div className="space-y-5"><Panel title="Attention required"><p className="text-sm text-slate-600">No live alerts are loaded. Connect approved sources through the backend before treating this view as operational.</p></Panel><Panel title="Scenario safeguards"><Simulated /><p className="mt-3 text-sm text-slate-600">The Nepal scenario is historical context. SOS reports and resources are fixtures for demonstration only.</p></Panel></div></div>
}

export default function App() { const [page,setPage]=useState<Page>('Overview'); const [area,setArea]=useState<keyof typeof areas>('nepal'); const [selected,setSelected]=useState(incidents[0]); const [open,setOpen]=useState(false); return <div className="min-h-screen bg-slate-100 text-slate-800"><header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-7"><div className="flex items-center gap-3"><button className="lg:hidden" onClick={()=>setOpen(!open)} aria-label="Toggle navigation">{open?<X/>:<Menu/>}</button><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white"><Activity size={18}/></div><div><p className="font-semibold tracking-tight">ArkGrid</p><p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Disaster intelligence · demo</p></div></div><div className="hidden items-center gap-2 text-xs text-slate-600 sm:flex"><span className="h-2 w-2 rounded-full bg-amber-400"/> Demonstration environment</div></header><div className="flex"><aside className={`${open?'block':'hidden'} fixed inset-x-0 top-16 z-10 border-b border-slate-200 bg-white p-3 lg:static lg:block lg:min-h-[calc(100vh-4rem)] lg:w-64 lg:border-b-0 lg:border-r`}><nav className="space-y-1">{navigation.map(([label,Icon])=><button key={label} onClick={()=>{setPage(label);setOpen(false)}} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${page===label?'bg-slate-900 text-white':'text-slate-600 hover:bg-slate-100'}`}><Icon size={17}/>{label}</button>)}</nav></aside><main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8"><div className="mb-6"><p className="text-xs font-semibold uppercase tracking-[.16em] text-slate-500">ArkGrid command centre</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{page}</h1></div><Content page={page} area={area} setArea={setArea} selected={selected} setSelected={setSelected}/></main></div></div> }
