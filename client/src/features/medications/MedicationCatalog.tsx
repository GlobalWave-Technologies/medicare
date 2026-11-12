import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Plus, RefreshCw, Search } from 'lucide-react'
import type { BackendRole } from '../../api/auth'
import { ApiError } from '../../api/client'
import { medicationsApi, type CatalogMedication, type CatalogStatus } from '../../api/medications'
import { Dialog } from '../../components/ui/Dialog'
import { LoadingRows } from '../../components/ui/LoadingRows'
import { Pagination } from '../../components/ui/Pagination'
import { useKeyedRead } from '../reports/report-utils'
import { canManageCatalog, catalogError, catalogStatuses, nameProblem, unconfirmed } from './catalog-utils'
import './medications.css'

// The medication list Medical Officers prescribe from. Administrators add medicines, and deactivate
// ones no longer used; nothing is deleted, and past prescriptions are never affected.
export function MedicationCatalog({ role }: { role: BackendRole }) {
  if (!canManageCatalog(role)) return <section className="panel catalog-workspace" aria-labelledby="catalog-restricted-title">
    <h2 id="catalog-restricted-title">Administrator access required</h2><p>The medication list is managed by administrators.</p>
  </section>
  return <CatalogWorkspace />
}

function CatalogWorkspace() {
  const id = useId(), nameInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(''), [nameError, setNameError] = useState<string | null>(null), [adding, setAdding] = useState(false)
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState<CatalogStatus>('active'), [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0), [notice, setNotice] = useState(''), [problem, setProblem] = useState('')
  const [confirming, setConfirming] = useState<CatalogMedication | null>(null), [working, setWorking] = useState<string | null>(null)
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(1) }, 300); return () => clearTimeout(timer) }, [search])
  const request = { page, limit: 20, status, search: query }
  const { data, loading, error } = useKeyedRead(JSON.stringify([request, revision]), (signal) => medicationsApi.list(request, signal))
  const reload = () => setRevision((n) => n + 1)

  async function add(event: FormEvent) {
    event.preventDefault()
    if (adding) return
    const issue = nameProblem(name)
    setNameError(issue); setNotice(''); setProblem('')
    if (issue) { nameInput.current?.focus(); return }
    setAdding(true)
    try {
      const { medication } = await medicationsApi.create(name)
      setName(''); setNotice(`${medication.name} added. Medical Officers can now choose it when prescribing.`)
      setSearch(medication.name); setQuery(medication.name); setStatus('all'); setPage(1); reload()
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'MEDICATION_ALREADY_EXISTS') {
        setNameError(catalogError(caught)); setSearch(name.trim()); setStatus('all'); setPage(1); nameInput.current?.focus()
      } else setNameError(unconfirmed(caught) ? 'Adding the medicine could not be confirmed. Search the list for it before trying again.' : catalogError(caught))
    } finally { setAdding(false) }
  }
  async function change(medication: CatalogMedication, active: boolean) {
    setWorking(medication.id); setNotice(''); setProblem('')
    try {
      const result = active ? await medicationsApi.reactivate(medication.id) : await medicationsApi.deactivate(medication.id)
      setNotice(active ? `${result.medication.name} is active again and can be prescribed.` : `${result.medication.name} deactivated. It no longer appears when prescribing; past prescriptions keep it.`)
      setConfirming(null); reload()
    } catch (caught) {
      setProblem(unconfirmed(caught) ? 'The change could not be confirmed. Refresh the list to check the medicine’s status before trying again.' : catalogError(caught))
      setConfirming(null)
    } finally { setWorking(null) }
  }

  return <section className="panel catalog-workspace" aria-labelledby={`${id}-title`} aria-busy={loading}>
    <div className="catalog-header">
      <div><h2 id={`${id}-title`}>Medication list</h2>
        <p className="form-intro">Medical Officers choose from the active medicines when prescribing. Deactivating a medicine hides it from new prescriptions; medicines already prescribed stay in every patient’s record.</p></div>
    </div>
    <form className="catalog-add" noValidate onSubmit={add} aria-labelledby={`${id}-add`}>
      <h3 id={`${id}-add`}>Add a medicine</h3>
      <label htmlFor={`${id}-name`}>Medicine name</label>
      <div className="catalog-add-row">
        <input ref={nameInput} id={`${id}-name`} name="medicationName" maxLength={200} autoComplete="off" placeholder="e.g. Amoxicillin capsule" value={name}
          aria-invalid={nameError ? true : undefined} aria-describedby={`${id}-name-help${nameError ? ` ${id}-name-error` : ''}`}
          onChange={(event) => { setName(event.target.value); setNameError(null) }} disabled={adding} />
        <button className="button button-primary" disabled={adding}><Plus size={17} aria-hidden="true" />{adding ? 'Adding…' : 'Add medicine'}</button>
      </div>
      <small id={`${id}-name-help`} className="field-helper">Use the name staff should see when prescribing. Names cannot be changed later, and a name already in the list (in any capitals) cannot be added again.</small>
      {nameError && <span id={`${id}-name-error`} className="field-error" role="alert">{nameError}</span>}
    </form>
    {notice && <p role="status" className="notice">{notice}</p>}
    {problem && <p role="alert" className="catalog-problem">{problem}</p>}
    <div className="catalog-tools">
      <label className="catalog-search"><Search size={17} aria-hidden="true" />
        <input aria-label="Search medicines" maxLength={100} placeholder="Search medicines" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div role="group" aria-label="Show medicines" className="report-segments">
        {catalogStatuses.map(([value, label]) => <button key={value} type="button" aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1) }}>{label}</button>)}
      </div>
      <button type="button" className="button button-ghost" disabled={loading} onClick={reload}><RefreshCw size={17} aria-hidden="true" />Refresh list</button>
    </div>
    {loading && <LoadingRows label="Loading the medication list…" rows={4} />}
    {error !== undefined && <div role="alert" className="catalog-problem"><p>{catalogError(error)}</p><button type="button" className="button button-ghost" onClick={reload}>Try again</button></div>}
    {data && !loading && (data.items.length ? <ul className="catalog-list" aria-label="Medicines">{data.items.map((medication) =>
      <li key={medication.id} className="catalog-item">
        <span className="catalog-name">{medication.name}</span>
        <span className={`status ${medication.active ? 'catalog-active' : 'catalog-inactive'}`}>
          {medication.active ? 'Active' : 'Inactive'}</span>
        {medication.active
          ? <button type="button" className="button button-ghost" aria-label={`Deactivate ${medication.name}`} disabled={working !== null} onClick={() => setConfirming(medication)}>Deactivate</button>
          : <button type="button" className="button button-ghost" aria-label={`Reactivate ${medication.name}`} disabled={working !== null} onClick={() => void change(medication, true)}>
            {working === medication.id ? 'Reactivating…' : 'Reactivate'}</button>}
      </li>)}</ul>
      : <p className="clinical-empty">{query ? `No ${status === 'all' ? '' : `${status} `}medicines match “${query}”.` : status === 'inactive' ? 'No inactive medicines.' : 'No medicines in the list yet.'}</p>)}
    {data && <Pagination label="Medication list pages" pagination={data.pagination} onPage={setPage} />}
    {confirming && <Dialog title="Deactivate medicine" kind="catalog" size="compact" busy={working !== null} closeLabel="Close deactivate dialog" describedBy={`${id}-deactivate`}
      onClose={() => setConfirming(null)}>
      <div className="catalog-confirm">
        <p id={`${id}-deactivate`}><strong>{confirming.name}</strong> will no longer appear when Medical Officers prescribe. Prescriptions that already include it stay unchanged in every patient’s record, and you can reactivate it at any time.</p>
        <div className="modal-footer"><button type="button" className="button button-ghost" disabled={working !== null} onClick={() => setConfirming(null)}>Cancel</button>
          <button type="button" className="button button-danger" disabled={working !== null} onClick={() => void change(confirming, false)}>{working ? 'Deactivating…' : 'Deactivate'}</button></div>
      </div>
    </Dialog>}
  </section>
}
