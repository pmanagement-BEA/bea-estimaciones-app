import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toast } from '../components/Toast'
import Modal from '../components/Modal'
import { fmtMoney, fmtPct, fmtDate } from '../utils/format'
import { disciplineSubtotal, projectTotals, conceptAmount, getAcumuladoAnteriorMap } from '../utils/calculations'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

// ── Helpers ──────────────────────────────────────────────────────────────────
function monthOptions(periodFrom, startDate, endDate) {
  let rangeStart, rangeEnd
  if (startDate && endDate) {
    rangeStart = new Date(startDate + 'T00:00:00')
    rangeEnd   = new Date(endDate   + 'T00:00:00')
    rangeStart = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
    rangeEnd   = new Date(rangeEnd.getFullYear(),   rangeEnd.getMonth(),   1)
  } else {
    const today = new Date()
    rangeStart = new Date(today.getFullYear(), today.getMonth() - 36, 1)
    rangeEnd   = new Date(today.getFullYear(), today.getMonth() + 24,  1)
  }
  const opts = []
  const cursor = new Date(rangeStart)
  while (cursor <= rangeEnd) {
    const y = cursor.getFullYear()
    const m = cursor.getMonth()
    const value = `${y}-${String(m + 1).padStart(2, '0')}`
    const label = `${MESES[m]} ${y}`
    opts.push({ value, label, selected: (periodFrom || '').startsWith(value) })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return opts
}


function thisEstAmount(item, concept, discipline) {
  if (!item?.included) return 0
  const monto = conceptAmount(concept, discipline)
  if (item.parcial_enabled) return ((parseFloat(item.pct_parcial) || 0) / 100) * monto
  return monto
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function Estimation() {
  const { id, estId } = useParams()
  const navigate = useNavigate()

  const [project, setProject]         = useState(null)
  const [disciplines, setDisciplines] = useState([])
  const [estimation, setEstimation]   = useState(null)
  const [allEstimations, setAllEstimations] = useState([])
  const [items, setItems]             = useState({}) // { concept_id: item }
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [activeTab, setActiveTab]     = useState('estimation')
  const [modal, setModal]             = useState(null)
  const [reportData, setReportData]   = useState(null)
  const [reportSaving, setReportSaving] = useState(false)
  const [togglModal, setTogglModal]   = useState(null) // { rows: [] }
  const saveTimer       = useRef(null)
  const reportSaveTimer = useRef(null)
  const reportRef       = useRef(null)
  const togglFileRef    = useRef(null)

  useEffect(() => { fetchAll() }, [id, estId])

  // ── Carga ──────────────────────────────────────────────────────────────────
  async function fetchAll() {
    setLoading(true)
    const [projRes, discRes, allEstRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('disciplines').select('*, concepts(*)').eq('project_id', id).order('sort_order'),
      supabase.from('estimations').select('*, estimation_items(*)').eq('project_id', id).order('created_at'),
    ])
    if (projRes.error || discRes.error) { toast('Error al cargar', true); setLoading(false); return }

    const discs = (discRes.data || []).map(d => ({
      ...d, concepts: [...(d.concepts || [])].sort((a, b) => a.sort_order - b.sort_order),
    }))

    // Resolver el estId actual (puede ser 'current' → buscar borrador)
    let est
    const allEsts = allEstRes.data || []
    if (estId === 'current') {
      est = allEsts.find(e => e.status === 'Borrador')
      if (!est) {
        // Crear borrador
        const now = new Date()
        const y = now.getFullYear(), m = now.getMonth()
        const pad = n => String(n).padStart(2, '0')
        const lastDay = new Date(y, m + 1, 0).getDate()
        const { data, error } = await supabase.from('estimations')
          .insert({ project_id: id, number: allEsts.length + 1, status: 'Borrador', period_from: `${y}-${pad(m+1)}-01`, period_to: `${y}-${pad(m+1)}-${pad(lastDay)}` })
          .select().single()
        if (error) { toast('Error al crear estimación', true); setLoading(false); return }
        est = { ...data, estimation_items: [] }
        allEsts.push(est)
      }
    } else {
      est = allEsts.find(e => e.id === estId)
    }

    if (!est) { toast('Estimación no encontrada', true); setLoading(false); return }

    // Construir mapa de items por concept_id
    const itemMap = {}
    ;(est.estimation_items || []).forEach(item => { itemMap[item.concept_id] = item })
    // Asegurar que todos los conceptos tengan un item (puede que no existan en DB todavía)
    for (const d of discs) {
      for (const c of d.concepts) {
        if (!itemMap[c.id]) itemMap[c.id] = { concept_id: c.id, included: false, amount: 0, parcial_enabled: false, pct_parcial: 0, delayed: false, cause: '' }
      }
    }

    const rdRes = await supabase.from('report_data').select('*').eq('estimation_id', est.id).maybeSingle()
    const rd = rdRes.data || null
    setReportData(rd)
    reportRef.current = rd

    setProject(projRes.data)
    setDisciplines(discs)
    setAllEstimations(allEsts)
    setEstimation(est)
    setItems(itemMap)
    setLoading(false)
  }

  // ── Cambiar mes ────────────────────────────────────────────────────────────
  async function changeMonth(value) {
    if (!value) return
    const [y, m] = value.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    const period_from = `${y}-${String(m).padStart(2, '0')}-01`
    const period_to   = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    setEstimation(prev => ({ ...prev, period_from, period_to }))
    await supabase.from('estimations').update({ period_from, period_to }).eq('id', estimation.id)
  }

  // ── Guardar item en Supabase (debounce 500ms) ──────────────────────────────
  const scheduleItemSave = useCallback((conceptId, updatedItem, disc, concept) => {
    // Calcular amount
    const monto = conceptAmount(concept, disc)
    const amount = updatedItem.included
      ? (updatedItem.parcial_enabled ? ((parseFloat(updatedItem.pct_parcial) || 0) / 100) * monto : monto)
      : 0

    const itemWithAmount = { ...updatedItem, amount }
    setItems(prev => ({ ...prev, [conceptId]: itemWithAmount }))

    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => upsertItem(estimation.id, conceptId, itemWithAmount), 500)
  }, [estimation?.id])

  async function upsertItem(estId, conceptId, item) {
    setSaving(true)
    const payload = {
      estimation_id: estId,
      concept_id: conceptId,
      included: item.included,
      amount: item.amount || 0,
      parcial_enabled: item.parcial_enabled,
      pct_parcial: item.pct_parcial || 0,
      delayed: item.delayed,
      cause: item.cause || '',
    }
    if (item.id) {
      await supabase.from('estimation_items').update(payload).eq('id', item.id)
    } else {
      const { data } = await supabase.from('estimation_items').insert(payload).select().single()
      if (data) setItems(prev => ({ ...prev, [conceptId]: { ...prev[conceptId], id: data.id } }))
    }
    setSaving(false)
  }

  // ── Anticipo ───────────────────────────────────────────────────────────────
  async function saveAnticipo(value) {
    const anticipo = parseFloat(value) || 0
    setEstimation(prev => ({ ...prev, anticipo }))
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() =>
      supabase.from('estimations').update({ anticipo }).eq('id', estimation.id), 600)
  }

  // ── Marcar como Enviada ────────────────────────────────────────────────────
  async function markSent() {
    setSaving(true)
    // Guardar items pendientes primero
    for (const [cid, item] of Object.entries(items)) {
      if (item.included) await upsertItem(estimation.id, cid, item)
    }
    const { error } = await supabase.from('estimations').update({ status: 'Enviada' }).eq('id', estimation.id)
    setSaving(false)
    if (error) { toast('Error al marcar como enviada', true); return }
    setEstimation(prev => ({ ...prev, status: 'Enviada' }))
    toast('Estimación marcada como Enviada ✓')
  }

  // ── Report helpers ─────────────────────────────────────────────────────────
  function scheduleReportSave(updates) {
    const next = { ...(reportRef.current || {}), ...updates }
    setReportData(next)
    reportRef.current = next
    clearTimeout(reportSaveTimer.current)
    reportSaveTimer.current = setTimeout(() => flushReportSave(next), 600)
  }

  async function flushReportSave(data) {
    setReportSaving(true)
    if (data.id) {
      await supabase.from('report_data').update(data).eq('id', data.id)
    } else {
      const { data: created } = await supabase.from('report_data')
        .insert({ estimation_id: estimation.id, ...data }).select().single()
      if (created) { setReportData(created); reportRef.current = created }
    }
    setReportSaving(false)
  }

  function addReportRow(key) {
    const defaults = {
      acciones_realizadas:   { task: '', descripcion: '', fecha: '' },
      acciones_pendientes:   { accion: '', fecha: '', responsable: 'BEA' },
      informacion_pendiente: { texto: '', responsable: 'BEA' },
      riesgos:               { riesgo: '', creditos: '' },
      entregables:           { texto: '' },
    }
    const newRow = { id: crypto.randomUUID(), ...(defaults[key] || {}) }
    const arr = [...(reportRef.current?.[key] || []), newRow]
    scheduleReportSave({ [key]: arr })
  }

  function removeReportRow(key, rowId) {
    const arr = (reportRef.current?.[key] || []).filter(r => r.id !== rowId)
    scheduleReportSave({ [key]: arr })
  }

  function updateReportRow(key, rowId, field, value) {
    const arr = (reportRef.current?.[key] || []).map(r => r.id === rowId ? { ...r, [field]: value } : r)
    scheduleReportSave({ [key]: arr })
  }

  function handleTogglFile(event) {
    const file = event.target.files[0]
    if (!file) return
    event.target.value = ''
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const rows = parseTogglCSV(e.target.result)
        if (!rows.length) { toast('No se encontraron entradas en el CSV', true); return }
        setTogglModal({ rows })
      } catch (err) {
        toast('Error al leer el CSV: ' + err.message, true)
      }
    }
    reader.readAsText(file, 'UTF-8')
  }

  function parseTogglCSV(text) {
    text = text.replace(/^﻿/, '')
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return []
    const header = parseCSVLine(lines[0])
    const taskIdx = header.findIndex(h => /^task$/i.test(h))
    const projIdx = header.findIndex(h => /^project$/i.test(h))
    const descIdx = header.findIndex(h => /^description$/i.test(h))
    const pctIdx  = header.findIndex(h => /duration.*%/i.test(h))
    if (descIdx === -1) throw new Error("Columna 'Description' no encontrada")
    const entries = []
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i])
      if (cols.length < 2) continue
      const desc = (cols[descIdx] || '').trim()
      const task = taskIdx !== -1 ? (cols[taskIdx] || '').trim()
                 : projIdx !== -1 ? (cols[projIdx] || '').trim() : ''
      const pct  = pctIdx !== -1 ? parseFloat(cols[pctIdx]) || 0 : 0
      if (!desc) continue
      const isNoise = desc.length <= 2 || /^[.\-_]+$/.test(desc)
      entries.push({ id: crypto.randomUUID(), desc, task, pct, noise: isNoise, include: !isNoise })
    }
    return entries
  }

  function parseCSVLine(line) {
    const result = []
    let cur = '', inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
        else inQuote = !inQuote
      } else if (ch === ',' && !inQuote) {
        result.push(cur); cur = ''
      } else {
        cur += ch
      }
    }
    result.push(cur)
    return result
  }

  function confirmTogglImport(rows) {
    const selected = rows.filter(r => r.include)
    if (!selected.length) { toast('No hay entradas seleccionadas', true); return }
    const taskMap = new Map()
    selected.forEach(r => {
      const task = (r.task || '').trim()
      const desc = r.desc.trim()
      if (!taskMap.has(task)) taskMap.set(task, [])
      if (desc && !taskMap.get(task).includes(desc)) taskMap.get(task).push(desc)
    })
    const newRows = []
    taskMap.forEach((descs, task) => {
      newRows.push({ id: crypto.randomUUID(), task, descripcion: descs.join('\n'), fecha: '' })
    })
    const existing = (reportRef.current?.acciones_realizadas || []).filter(r => (r.task || '').trim())
    scheduleReportSave({ acciones_realizadas: [...existing, ...newRows] })
    setTogglModal(null)
    toast(`${taskMap.size} tarea${taskMap.size !== 1 ? 's' : ''} importada${taskMap.size !== 1 ? 's' : ''} ✓`)
  }

  async function markReportSent() {
    setReportSaving(true)
    const now = new Date().toISOString()
    const { error } = await supabase.from('estimations')
      .update({ report_sent: true, report_sent_at: now }).eq('id', estimation.id)
    setReportSaving(false)
    if (error) { toast('Error al marcar como enviado', true); return }
    setEstimation(prev => ({ ...prev, report_sent: true, report_sent_at: now }))
    toast('Reporte marcado como Enviado ✓')
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return <div className="main"><div className="spinner" /></div>
  if (!project || !estimation) return <div className="main"><div className="empty-state"><h3>No encontrado</h3></div></div>

  const readonly = estimation.status === 'Enviada'
  const totals = projectTotals(disciplines)
  const acumMap = getAcumuladoAnteriorMap(disciplines, allEstimations, estimation.id)

  // Totales financieros
  let acumAnterior = 0, currentTotal = 0
  disciplines.forEach(d => (d.concepts || []).forEach(c => {
    acumAnterior += acumMap[c.id] || 0
    currentTotal += thisEstAmount(items[c.id], c, d)
  }))
  const acumGlobal  = acumAnterior + currentTotal
  const porEstimar  = Math.max(0, totals.estimable - acumGlobal)
  const advanceThis = totals.estimable > 0 ? (currentTotal / totals.estimable) * 100 : 0
  const advanceGlobal = totals.estimable > 0 ? (acumGlobal / totals.estimable) * 100 : 0

  // Avance por disciplina
  const discAdv = {}
  disciplines.forEach(d => {
    const s = disciplineSubtotal(d)
    let dAcum = 0
    ;(d.concepts || []).forEach(c => {
      dAcum += acumMap[c.id] || 0
      dAcum += thisEstAmount(items[c.id], c, d)
    })
    discAdv[d.id] = s.estimable > 0 ? (dAcum / s.estimable) * 100 : 0
  })

  const estNumLabel = `#${String(estimation.number).padStart(3, '0')}`
  const monthOpts = monthOptions(estimation.period_from, project.start_date, project.end_date)

  return (
    <div className="main">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <a onClick={() => navigate('/')}>Mis Proyectos</a>
        <span className="sep">›</span>
        <a onClick={() => navigate(`/projects/${id}/setup`)}>{project.name}</a>
        <span className="sep">›</span>
        <span className="current">Estimación {estNumLabel}</span>
      </div>

      {/* Banner readonly */}
      {readonly && (
        <div className="readonly-banner">
          <span>📋 Esta estimación está marcada como <strong>{estimation.status}</strong> y no puede editarse.</span>
          <button className="btn btn-sm btn-outline" onClick={() => navigate(`/projects/${id}/history`)}>Ver historial</button>
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Estimación <span className="accent">{estNumLabel}</span></h1>
          <div className="page-subtitle">{project.name} · {project.client}</div>
        </div>
        <div className="flex" style={{ flexWrap: 'wrap', gap: 8 }}>
          {!readonly && <>
            <button className="btn btn-outline" onClick={() => { toast('Borrador guardado ✓') }}>Guardar borrador</button>
            <button className="btn btn-primary" onClick={() => setModal({
              title: '✉ Marcar Estimación como Enviada',
              body: '<p>Una vez marcada como <strong>Enviada</strong>, la estimación no podrá editarse.</p><p style="margin-top:8px;color:var(--text-muted)">¿Confirmas que deseas marcarla como Enviada?</p>',
              onConfirm: markSent,
            })}>Marcar como Enviada</button>
          </>}
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/setup`)}>⚙ Configuración</button>
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/history`)}>📋 Historial</button>
        </div>
      </div>

      {/* Pill estado */}
      <div style={{ marginBottom: 16 }}>
        <span className={`status-pill${saving ? ' dirty' : ''}`}>{saving ? 'Guardando...' : 'Guardado'}</span>
      </div>

      {/* Tabs */}
      <div className="tabs no-print">
        <div className={`tab${activeTab === 'estimation' ? ' active' : ''}`} onClick={() => setActiveTab('estimation')}>Estimación</div>
        <div className={`tab${activeTab === 'report' ? ' active' : ''}`} onClick={() => setActiveTab('report')}>Reporte Mensual</div>
      </div>

      {/* ── TAB: ESTIMACIÓN ─────────────────────────────────────── */}
      {activeTab === 'estimation' && (
        <div className={readonly ? 'readonly' : ''}>
          {/* Periodo */}
          <div className="card mb-md">
            <div className="grid grid-4">
              <div className="field">
                <label>Número de estimación</label>
                <input value={estimation.number} disabled />
              </div>
              <div className="field">
                <label>Mes de estimación</label>
                <select disabled={readonly} value={monthOpts.find(o => o.selected)?.value || ''} onChange={e => changeMonth(e.target.value)} style={{ fontSize: 13 }}>
                  <option value="">— Seleccionar mes —</option>
                  {monthOpts.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Periodo</label>
                <input value={estimation.period_from ? `${fmtDate(estimation.period_from)} — ${fmtDate(estimation.period_to)}` : '—'} disabled />
              </div>
              <div className="field">
                <label>Estado</label>
                <input value={estimation.status} disabled />
              </div>
            </div>
          </div>

          {/* Resumen Financiero */}
          <div className="section">
            <div className="section-header">
              <div className="section-title">Resumen Financiero</div>
              <span className="muted" style={{ fontSize: 11 }}>Moneda: {project.currency}</span>
            </div>
            <div className="summary-grid">
              <StatBox label="Importe Total" value={fmtMoney(totals.importeTotal, project.currency)} />
              <div className="stat-box">
                <div className="stat-label">Anticipo</div>
                <input type="number" step="0.01" value={estimation.anticipo || 0}
                  disabled={readonly}
                  onChange={e => saveAnticipo(e.target.value)}
                  style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy)', width: '100%', padding: 0, border: 'none', background: 'transparent' }} />
              </div>
              <StatBox label="Finiquito (10%)" value={fmtMoney(totals.finiquito, project.currency)} muted />
              <StatBox label="Importe Estimable (90%)" value={fmtMoney(totals.estimable, project.currency)} green />
              <StatBox label="Acumulado Anterior" value={fmtMoney(acumAnterior, project.currency)} muted />
              <StatBox label="Esta Estimación" value={fmtMoney(currentTotal, project.currency)} green />
              <StatBox label="Acumulado Global" value={fmtMoney(acumGlobal, project.currency)} />
              <StatBox label="Por Estimar" value={fmtMoney(porEstimar, project.currency)} muted />
            </div>
          </div>

          {/* KPIs de avance */}
          <div className="section">
            <div className="section-header"><div className="section-title">Avance del Proyecto</div></div>
            <div className="kpi-row" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 10 }}>
              <KpiBox label="Esta Estimación" pct={advanceThis} />
              <KpiBox label="Avance Global del Proyecto" pct={advanceGlobal} />
            </div>
            <div className="kpi-row">
              {disciplines.map(d => {
                const s = disciplineSubtotal(d)
                const active = s.conDesc > 0
                let lbl = d.name
                  .replace('& Monitoring-Based Commissioning', '')
                  .replace('Certificación (FINIQUITO)', 'Certificación').trim()
                return (
                  <div key={d.id} className={`kpi-box${active ? '' : ' inactive'}`}>
                    <div className="kpi-label" title={d.name}>{lbl}</div>
                    <div className="kpi-value">{active ? fmtPct(discAdv[d.id]) : '—'}</div>
                    <div className="progress">
                      <div className="progress-bar" style={{ width: `${active ? Math.min(100, discAdv[d.id]) : 0}%` }} />
                    </div>
                    {!active && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>No aplica</div>}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Tabla de conceptos por disciplina */}
          <div className="section">
            <div className="section-header"><div className="section-title">Conceptos por Disciplina</div></div>
            {disciplines.map(d => {
              const s = disciplineSubtotal(d)
              if (s.conDesc === 0) {
                return (
                  <div key={d.id} className="discipline-block" style={{ opacity: .45, pointerEvents: 'none', filter: 'grayscale(.5)' }}>
                    <div className="discipline-header" style={{ background: 'var(--surface-2)' }}>
                      <div className="discipline-name" style={{ color: 'var(--text-muted)' }}>
                        {d.name}
                        <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 600, background: 'var(--border)', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 99, marginLeft: 8, letterSpacing: .5, textTransform: 'uppercase' }}>
                          🔒 Sin monto configurado
                        </span>
                      </div>
                    </div>
                  </div>
                )
              }
              return (
                <div key={d.id} className="discipline-block">
                  <div className="discipline-header">
                    <div className="discipline-name">{d.name}</div>
                    <div className="discipline-stats">
                      <span>Estimable: <strong>{fmtMoney(s.estimable, project.currency)}</strong></span>
                      <span>Avance: <strong>{fmtPct(discAdv[d.id])}</strong></span>
                    </div>
                  </div>
                  <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: 38 }} className="center">✓</th>
                          <th style={{ width: 70 }}>Clave</th>
                          <th>Descripción</th>
                          <th className="num" style={{ width: 110 }}>Monto</th>
                          <th className="num" style={{ width: 110 }}>Acum. Anterior</th>
                          <th className="num" style={{ width: 110 }}>Esta Est.</th>
                          <th className="num" style={{ width: 110 }}>Acumulado</th>
                          <th className="num" style={{ width: 110 }}>Por Estimar</th>
                          <th style={{ width: 70 }}>Mes</th>
                          <th className="num" style={{ width: 100 }}>% Parcial</th>
                          <th style={{ width: 110 }}>Atraso</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(d.concepts || []).length === 0 ? (
                          <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>Sin conceptos configurados</td></tr>
                        ) : (d.concepts || []).map(c => {
                          const monto = conceptAmount(c, d)
                          const anterior = acumMap[c.id] || 0
                          const item = items[c.id] || { included: false, amount: 0, parcial_enabled: false, pct_parcial: 0, delayed: false, cause: '' }
                          const cobradoCompleto = monto > 0 && anterior >= monto - 0.01
                          const tieneParcialPendiente = !cobradoCompleto && anterior > 0.001
                          const pctYaCobrado = monto > 0 ? Math.round((anterior / monto) * 1000) / 10 : 0
                          const pctDisponible = Math.round((100 - pctYaCobrado) * 10) / 10
                          const thisEst = thisEstAmount(item, c, d)
                          const acum = anterior + thisEst
                          const porEst = Math.max(0, monto - acum)
                          const isFiniquito = c.type === 'Finiquito'

                          if (cobradoCompleto) {
                            return (
                              <tr key={c.id} className={`concept-row${isFiniquito ? ' finiquito' : ''}`} style={{ opacity: .6, background: 'var(--surface)' }}>
                                <td className="center"><span title="Cobrado al 100%" style={{ fontSize: 16 }}>✅</span></td>
                                <td>
                                  <strong>{c.key}</strong>
                                  {isFiniquito && <span className="tag-finiquito">FIN</span>}
                                  <span style={{ display: 'inline-block', fontSize: 10, background: 'var(--green-soft)', color: 'var(--green-dark)', padding: '1px 6px', borderRadius: 3, marginLeft: 4, fontWeight: 600 }}>Cobrado 100%</span>
                                </td>
                                <td style={{ color: 'var(--text-muted)' }}>{c.description}</td>
                                <td className="num">{fmtMoney(monto, project.currency)}</td>
                                <td className="num" style={{ color: 'var(--green-dark)', fontWeight: 700 }}>{fmtMoney(anterior, project.currency)}</td>
                                <td className="num">—</td>
                                <td className="num" style={{ color: 'var(--green-dark)' }}>{fmtMoney(anterior, project.currency)}</td>
                                <td className="num">{fmtMoney(0, project.currency)}</td>
                                <td></td><td></td><td></td>
                              </tr>
                            )
                          }

                          return (
                            <tr key={c.id} className={`concept-row${isFiniquito ? ' finiquito' : ''}`}
                              style={{ background: tieneParcialPendiente ? 'rgba(251,191,36,.06)' : undefined }}>
                              {/* Checkbox */}
                              <td className="center">
                                <input type="checkbox" checked={!!item.included} disabled={readonly}
                                  onChange={e => scheduleItemSave(c.id, { ...item, included: e.target.checked }, d, c)} />
                                {tieneParcialPendiente && <div style={{ fontSize: 9, color: 'var(--warning)', marginTop: 2, textAlign: 'center' }}>Pendiente</div>}
                              </td>
                              {/* Clave */}
                              <td>
                                <strong>{c.key}</strong>
                                {isFiniquito && <span className="tag-finiquito">FIN</span>}
                                {tieneParcialPendiente && (
                                  <span style={{ display: 'inline-block', fontSize: 10, background: 'var(--warning-soft)', color: 'var(--warning)', padding: '1px 6px', borderRadius: 3, marginLeft: 4, fontWeight: 600 }}>
                                    {pctYaCobrado}% cobrado
                                  </span>
                                )}
                              </td>
                              {/* Descripción */}
                              <td>
                                {c.description}
                                {tieneParcialPendiente && (
                                  <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 3, fontWeight: 600 }}>
                                    Cobrado hasta ahora: {pctYaCobrado}% — Disponible: {pctDisponible}%
                                  </div>
                                )}
                              </td>
                              <td className="num">{fmtMoney(monto, project.currency)}</td>
                              <td className="num muted">{fmtMoney(anterior, project.currency)}</td>
                              {/* Esta estimación */}
                              <td className="num">
                                <strong style={{ color: item.included ? 'var(--green-dark)' : 'var(--text-muted)' }}>
                                  {fmtMoney(thisEst, project.currency)}
                                </strong>
                                {item.parcial_enabled && item.included && (
                                  <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 2 }}>
                                    {Math.round((item.pct_parcial || 0) * 10) / 10}% del concepto
                                  </div>
                                )}
                              </td>
                              <td className="num">{fmtMoney(acum, project.currency)}</td>
                              {/* Por estimar */}
                              <td className="num muted">
                                <div>{fmtMoney(porEst, project.currency)}</div>
                                {monto > 0 && (
                                  <div style={{ marginTop: 4 }}>
                                    <div className="progress" style={{ height: 5, width: 80 }}>
                                      <div className="progress-bar" style={{ width: `${Math.min(100, (acum / monto) * 100)}%` }} />
                                    </div>
                                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
                                      {Math.round((acum / monto) * 1000) / 10}%
                                    </div>
                                  </div>
                                )}
                              </td>
                              {/* Mes */}
                              <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.month || '—'}</td>
                              {/* Parcial */}
                              <td className="center">
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: item.parcial_enabled || tieneParcialPendiente ? 'var(--warning)' : 'var(--text-muted)' }}>
                                    <input type="checkbox"
                                      checked={!!item.parcial_enabled || tieneParcialPendiente}
                                      disabled={readonly || tieneParcialPendiente}
                                      style={{ accentColor: 'var(--warning)' }}
                                      onChange={e => scheduleItemSave(c.id, { ...item, parcial_enabled: e.target.checked, pct_parcial: e.target.checked ? (item.pct_parcial || pctDisponible) : 0 }, d, c)} />
                                    {item.parcial_enabled || tieneParcialPendiente ? '🔶 Parcial' : 'Parcial'}
                                  </label>
                                  {(item.parcial_enabled || tieneParcialPendiente) && item.included && (
                                    <>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <input type="number" step="1" min="0" max={pctDisponible}
                                          value={Math.round((item.pct_parcial || 0) * 10) / 10}
                                          disabled={readonly}
                                          style={{ width: 52, textAlign: 'right', padding: '3px 5px', border: '1px solid var(--warning)', borderRadius: 4, fontWeight: 700, color: 'var(--warning)', fontSize: 13 }}
                                          onChange={e => scheduleItemSave(c.id, { ...item, pct_parcial: parseFloat(e.target.value) || 0 }, d, c)} />
                                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)' }}>%</span>
                                      </div>
                                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Máx: {pctDisponible}%</div>
                                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>= {fmtMoney(thisEst, project.currency)}</div>
                                    </>
                                  )}
                                </div>
                              </td>
                              {/* Atraso */}
                              <td>
                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-soft)', cursor: 'pointer' }}>
                                  <input type="checkbox" checked={!!item.delayed} disabled={readonly}
                                    onChange={e => scheduleItemSave(c.id, { ...item, delayed: e.target.checked }, d, c)} />
                                  ¿Atraso?
                                </label>
                                {item.delayed && (
                                  <input placeholder="Causa" value={item.cause || ''} disabled={readonly}
                                    style={{ marginTop: 3, width: '100%', fontSize: 11, padding: '3px 5px', border: '1px solid var(--border)', borderRadius: 3 }}
                                    onChange={e => scheduleItemSave(c.id, { ...item, cause: e.target.value }, d, c)} />
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Botón continuar */}
          {!readonly && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }} className="no-print">
              <button className="btn btn-primary" style={{ fontSize: 14, padding: '10px 24px' }} onClick={() => { toast('Borrador guardado ✓'); setActiveTab('report') }}>
                Guardar y continuar → Reporte Mensual
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: REPORTE MENSUAL ─────────────────────────────────── */}
      {activeTab === 'report' && (() => {
        const rpt = reportData || {}
        const reportReadonly = estimation.report_sent === true
        const rd = key => rpt[key] || []

        return (
          <div className={reportReadonly ? 'readonly' : ''}>

            {/* Banner enviado */}
            {reportReadonly && (
              <div className="readonly-banner" style={{ background: 'var(--green-soft)', color: 'var(--green-dark)', borderColor: '#86EFAC' }}>
                <span>📋 Reporte marcado como <strong>Enviado</strong> el {fmtDate((estimation.report_sent_at || '').slice(0, 10))}. Solo lectura.</span>
                <button className="btn btn-sm btn-outline" onClick={() => window.print()}>📄 Imprimir / PDF</button>
              </div>
            )}

            {/* Datos del Proyecto */}
            <div className="card mb-md">
              <div className="section-header"><div className="section-title">Datos del Proyecto</div></div>
              <div className="grid grid-3">
                <div className="field"><label>Proyecto</label><input value={project.name} disabled /></div>
                <div className="field"><label>Cliente</label><input value={project.client} disabled /></div>
                <div className="field"><label>Ubicación</label><input value={project.location || '—'} disabled /></div>
                <div className="field"><label>Líder de Proyecto</label><input value={project.team_leader || '—'} disabled /></div>
                <div className="field"><label>Periodo</label><input value={estimation.period_from ? `${fmtDate(estimation.period_from)} — ${fmtDate(estimation.period_to)}` : '—'} disabled /></div>
                <div className="field"><label>Estimación</label><input value={`#${String(estimation.number).padStart(3, '0')}`} disabled /></div>
              </div>
            </div>

            {/* Acciones Realizadas */}
            <div className="card mb-md">
              <div className="section-header">
                <div className="section-title">Acciones Realizadas en el Mes</div>
                <div className="flex" style={{ gap: 8 }}>
                  {!reportReadonly && <>
                    <input ref={togglFileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleTogglFile} />
                    <button className="btn btn-outline btn-sm" onClick={() => togglFileRef.current?.click()}>↑ Importar Toggl CSV</button>
                    <button className="btn btn-outline btn-sm" onClick={() => addReportRow('acciones_realizadas')}>+ Fila</button>
                  </>}
                </div>
              </div>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th className="row-num">N°</th>
                    <th style={{ width: 180 }}>Tarea (Task)</th>
                    <th>Descripción</th>
                    <th style={{ width: 120 }}>Fecha (opcional)</th>
                    {!reportReadonly && <th className="row-actions"></th>}
                  </tr>
                </thead>
                <tbody>
                  {rd('acciones_realizadas').length === 0
                    ? <tr><td colSpan={reportReadonly ? 4 : 5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>Sin acciones registradas</td></tr>
                    : rd('acciones_realizadas').map((row, i) => {
                        const lines = (row.descripcion || '').split('\n').filter(l => l.trim())
                        return (
                          <tr key={row.id}>
                            <td className="row-num">{i + 1}</td>
                            <td><input value={row.task || ''} readOnly={reportReadonly} onChange={e => updateReportRow('acciones_realizadas', row.id, 'task', e.target.value)} /></td>
                            <td>
                              {reportReadonly
                                ? <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12 }}>
                                    {lines.map((l, j) => <li key={j} style={{ display: 'flex', gap: 6, marginBottom: 3 }}><span style={{ color: 'var(--green)', fontWeight: 700 }}>{j + 1}.</span><span>{l}</span></li>)}
                                  </ul>
                                : <textarea value={row.descripcion || ''} rows={Math.max(2, lines.length)}
                                    placeholder="Una descripción por línea"
                                    style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'inherit', fontSize: 12, resize: 'vertical', lineHeight: 1.5 }}
                                    onChange={e => updateReportRow('acciones_realizadas', row.id, 'descripcion', e.target.value)} />}
                            </td>
                            <td><input type="date" value={row.fecha || ''} readOnly={reportReadonly} onChange={e => updateReportRow('acciones_realizadas', row.id, 'fecha', e.target.value)} /></td>
                            {!reportReadonly && <td className="row-actions"><button className="btn btn-ghost btn-xs" onClick={() => removeReportRow('acciones_realizadas', row.id)}>✕</button></td>}
                          </tr>
                        )
                      })}
                </tbody>
              </table>
            </div>

            {/* Acciones Pendientes */}
            <div className="card mb-md">
              <div className="section-header">
                <div className="section-title">Acciones Pendientes</div>
                {!reportReadonly && <button className="btn btn-outline btn-sm" onClick={() => addReportRow('acciones_pendientes')}>+ Fila</button>}
              </div>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th className="row-num">N°</th>
                    <th>Acción</th>
                    <th style={{ width: 120 }}>Fecha</th>
                    <th style={{ width: 130 }}>Responsable</th>
                    {!reportReadonly && <th className="row-actions"></th>}
                  </tr>
                </thead>
                <tbody>
                  {rd('acciones_pendientes').length === 0
                    ? <tr><td colSpan={reportReadonly ? 4 : 5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>Sin acciones pendientes</td></tr>
                    : rd('acciones_pendientes').map((row, i) => {
                        const isBEA = (row.responsable || 'BEA') === 'BEA'
                        return (
                          <tr key={row.id}>
                            <td className="row-num">{i + 1}</td>
                            <td><input value={row.accion || ''} readOnly={reportReadonly} onChange={e => updateReportRow('acciones_pendientes', row.id, 'accion', e.target.value)} /></td>
                            <td><input type="date" value={row.fecha || ''} readOnly={reportReadonly} onChange={e => updateReportRow('acciones_pendientes', row.id, 'fecha', e.target.value)} /></td>
                            <td style={{ textAlign: 'center' }}>
                              {reportReadonly
                                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: isBEA ? 'var(--green-soft)' : '#EFF6FF', color: isBEA ? 'var(--green-dark)' : '#1D4ED8' }}>{isBEA ? '🏢 BEA' : '👤 Cliente'}</span>
                                : <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 99, overflow: 'hidden', fontSize: 11, fontWeight: 700 }}>
                                    <button onClick={() => updateReportRow('acciones_pendientes', row.id, 'responsable', 'BEA')} style={{ padding: '4px 10px', border: 'none', cursor: 'pointer', background: isBEA ? 'var(--green)' : '#fff', color: isBEA ? '#fff' : 'var(--text-muted)' }}>🏢 BEA</button>
                                    <button onClick={() => updateReportRow('acciones_pendientes', row.id, 'responsable', 'Cliente')} style={{ padding: '4px 10px', border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer', background: !isBEA ? '#2563EB' : '#fff', color: !isBEA ? '#fff' : 'var(--text-muted)' }}>👤 Cliente</button>
                                  </div>}
                            </td>
                            {!reportReadonly && <td className="row-actions"><button className="btn btn-ghost btn-xs" onClick={() => removeReportRow('acciones_pendientes', row.id)}>✕</button></td>}
                          </tr>
                        )
                      })}
                </tbody>
              </table>
            </div>

            {/* Información Pendiente */}
            <div className="card mb-md">
              <div className="section-header">
                <div className="section-title">Información Pendiente</div>
                {!reportReadonly && <button className="btn btn-outline btn-sm" onClick={() => addReportRow('informacion_pendiente')}>+ Fila</button>}
              </div>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th className="row-num">N°</th>
                    <th>Información Pendiente</th>
                    <th style={{ width: 130 }}>Responsable</th>
                    {!reportReadonly && <th className="row-actions"></th>}
                  </tr>
                </thead>
                <tbody>
                  {rd('informacion_pendiente').length === 0
                    ? <tr><td colSpan={reportReadonly ? 3 : 4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>Sin información pendiente</td></tr>
                    : rd('informacion_pendiente').map((row, i) => {
                        const isBEA = (row.responsable || 'BEA') === 'BEA'
                        return (
                          <tr key={row.id}>
                            <td className="row-num">{i + 1}</td>
                            <td><input value={row.texto || ''} readOnly={reportReadonly} onChange={e => updateReportRow('informacion_pendiente', row.id, 'texto', e.target.value)} /></td>
                            <td style={{ textAlign: 'center' }}>
                              {reportReadonly
                                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: isBEA ? 'var(--green-soft)' : '#EFF6FF', color: isBEA ? 'var(--green-dark)' : '#1D4ED8' }}>{isBEA ? '🏢 BEA' : '👤 Cliente'}</span>
                                : <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 99, overflow: 'hidden', fontSize: 11, fontWeight: 700 }}>
                                    <button onClick={() => updateReportRow('informacion_pendiente', row.id, 'responsable', 'BEA')} style={{ padding: '4px 10px', border: 'none', cursor: 'pointer', background: isBEA ? 'var(--green)' : '#fff', color: isBEA ? '#fff' : 'var(--text-muted)' }}>🏢 BEA</button>
                                    <button onClick={() => updateReportRow('informacion_pendiente', row.id, 'responsable', 'Cliente')} style={{ padding: '4px 10px', border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer', background: !isBEA ? '#2563EB' : '#fff', color: !isBEA ? '#fff' : 'var(--text-muted)' }}>👤 Cliente</button>
                                  </div>}
                            </td>
                            {!reportReadonly && <td className="row-actions"><button className="btn btn-ghost btn-xs" onClick={() => removeReportRow('informacion_pendiente', row.id)}>✕</button></td>}
                          </tr>
                        )
                      })}
                </tbody>
              </table>
            </div>

            {/* Riesgos */}
            <div className="card mb-md">
              <div className="section-header">
                <div className="section-title">Riesgos</div>
                {!reportReadonly && (
                  <div className="flex" style={{ gap: 8 }}>
                    <button className="btn btn-outline btn-sm"
                      style={rpt.no_riesgos ? { background: 'var(--green-soft)', color: 'var(--green-dark)', borderColor: 'var(--green)' } : {}}
                      onClick={() => scheduleReportSave({ no_riesgos: !rpt.no_riesgos })}>
                      {rpt.no_riesgos ? '✓ Sin riesgos este mes' : 'No hay riesgos actuales'}
                    </button>
                    {!rpt.no_riesgos && <button className="btn btn-outline btn-sm" onClick={() => addReportRow('riesgos')}>+ Riesgo</button>}
                  </div>
                )}
                {reportReadonly && rpt.no_riesgos && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin riesgos este mes</span>}
              </div>
              {rpt.no_riesgos
                ? <div style={{ padding: 14, textAlign: 'center', color: 'var(--green-dark)', fontSize: 13, fontStyle: 'italic', background: 'var(--green-soft)', borderRadius: 'var(--radius)' }}>✓ No hay riesgos actuales en este mes</div>
                : <table className="mini-table">
                    <thead>
                      <tr>
                        <th className="row-num">N°</th>
                        <th>Riesgo</th>
                        <th style={{ width: 180 }}>Créditos en riesgo</th>
                        {!reportReadonly && <th className="row-actions"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rd('riesgos').length === 0
                        ? <tr><td colSpan={reportReadonly ? 3 : 4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>Sin riesgos registrados</td></tr>
                        : rd('riesgos').map((row, i) => (
                            <tr key={row.id}>
                              <td className="row-num">{i + 1}</td>
                              <td><input value={row.riesgo || ''} readOnly={reportReadonly} onChange={e => updateReportRow('riesgos', row.id, 'riesgo', e.target.value)} /></td>
                              <td><input value={row.creditos || ''} readOnly={reportReadonly} onChange={e => updateReportRow('riesgos', row.id, 'creditos', e.target.value)} /></td>
                              {!reportReadonly && <td className="row-actions"><button className="btn btn-ghost btn-xs" onClick={() => removeReportRow('riesgos', row.id)}>✕</button></td>}
                            </tr>
                          ))}
                    </tbody>
                  </table>}
            </div>

            {/* Entregables */}
            <div className="card mb-md">
              <div className="section-header">
                <div className="section-title">Entregables Significativos BEA</div>
                {!reportReadonly && <button className="btn btn-outline btn-sm" onClick={() => addReportRow('entregables')}>+ Item</button>}
              </div>
              <table className="mini-table">
                <tbody>
                  {rd('entregables').length === 0
                    ? <tr><td colSpan={reportReadonly ? 2 : 3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>Sin entregables registrados</td></tr>
                    : rd('entregables').map((row, i) => (
                        <tr key={row.id}>
                          <td className="row-num">{i + 1}</td>
                          <td><input value={row.texto || ''} readOnly={reportReadonly} onChange={e => updateReportRow('entregables', row.id, 'texto', e.target.value)} /></td>
                          {!reportReadonly && <td className="row-actions"><button className="btn btn-ghost btn-xs" onClick={() => removeReportRow('entregables', row.id)}>✕</button></td>}
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>

            {/* Barra de acciones */}
            {!reportReadonly && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 24, paddingTop: 16, borderTop: '2px solid var(--green)' }} className="no-print">
                <span className={`status-pill${reportSaving ? ' dirty' : ''}`}>{reportSaving ? 'Guardando...' : 'Guardado'}</span>
                <div className="flex" style={{ gap: 8 }}>
                  <button className="btn btn-outline" onClick={() => toast('Borrador guardado ✓')}>Guardar borrador</button>
                  <button className="btn btn-dark" onClick={() => window.print()}>📄 Generar PDF</button>
                  <button className="btn btn-primary" style={{ fontSize: 14, padding: '10px 24px' }} onClick={() => setModal({
                    title: '✉ Marcar Reporte como Enviado',
                    body: '<p>Una vez marcado como <strong>Enviado</strong>, el reporte no podrá editarse.</p><p style="margin-top:8px;color:var(--text-muted)">¿Confirmas que deseas marcarlo como Enviado?</p>',
                    onConfirm: markReportSent,
                  })}>✉ Marcar como Enviado</button>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Modal Toggl CSV preview */}
      {togglModal && (
        <div className="modal-overlay show" onClick={e => e.target === e.currentTarget && setTogglModal(null)}>
          <div className="modal" style={{ maxWidth: 660 }}>
            <div className="modal-title">↑ Importar desde Toggl Track</div>
            <div className="modal-body">
              <TogglPreview rows={togglModal.rows} onChange={rows => setTogglModal({ rows })} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setTogglModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={() => confirmTogglImport(togglModal.rows)}>
                Importar seleccionadas ({togglModal.rows.filter(r => r.include).length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <Modal title={modal.title} body={modal.body} confirmText="Confirmar" onConfirm={modal.onConfirm} onClose={() => setModal(null)} />
      )}
    </div>
  )
}

// ── Sub-componentes ───────────────────────────────────────────────────────────
function StatBox({ label, value, green, muted }) {
  return (
    <div className="stat-box">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${green ? ' green' : muted ? ' muted' : ''}`}>{value}</div>
    </div>
  )
}
function KpiBox({ label, pct }) {
  return (
    <div className="kpi-box">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{fmtPct(pct)}</div>
      <div className="progress"><div className="progress-bar" style={{ width: `${Math.min(100, pct)}%` }} /></div>
    </div>
  )
}

function TogglPreview({ rows, onChange }) {
  const clean = rows.filter(r => r.include).length
  const noisy = rows.filter(r => r.noise).length
  function toggle(id) {
    onChange(rows.map(r => r.id === id ? { ...r, include: !r.include } : r))
  }
  return (
    <div>
      <div style={{ fontSize: 13, marginBottom: 10 }}>
        <strong>{rows.length}</strong> entradas encontradas ·{' '}
        <span style={{ color: 'var(--green-dark)' }}>{clean} seleccionadas</span> ·{' '}
        <span style={{ color: 'var(--warning)' }}>{noisy} con ruido</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        Desmarca las entradas que <strong>no</strong> quieras incluir. Las amarillas parecen registros de prueba.
      </div>
      <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
            <tr>
              <th style={{ padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)', width: 40, textAlign: 'center' }}>✓</th>
              <th style={{ padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)' }}>Tarea</th>
              <th style={{ padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)' }}>Descripción</th>
              <th style={{ padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)', textAlign: 'right' }}>%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ background: r.noise ? '#FEF3C7' : undefined }}>
                <td style={{ textAlign: 'center', padding: '5px 8px' }}>
                  <input type="checkbox" checked={r.include} onChange={() => toggle(r.id)} style={{ accentColor: 'var(--green)' }} />
                </td>
                <td style={{ padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.task}>{r.task || '—'}</td>
                <td style={{ padding: '5px 8px', fontSize: 12 }}>
                  {r.desc}
                  {r.noise && <span style={{ fontSize: 10, background: '#B7791F', color: '#fff', padding: '1px 5px', borderRadius: 3, marginLeft: 6 }}>Ruido</span>}
                </td>
                <td style={{ padding: '5px 8px', fontSize: 12, textAlign: 'right', color: 'var(--text-muted)' }}>{r.pct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
