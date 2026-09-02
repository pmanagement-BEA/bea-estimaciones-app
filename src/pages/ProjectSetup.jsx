import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toast } from '../components/Toast'
import Modal from '../components/Modal'
import { fmtMoney, fmtPct } from '../utils/format'
import { disciplineSubtotal, projectTotals, conceptAmount } from '../utils/calculations'

// ── Parseo de CSV ─────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const result = []; let cur = '', inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { if (inQuote && line[i + 1] === '"') { cur += '"'; i++ } else inQuote = !inQuote }
    else if (ch === ',' && !inQuote) { result.push(cur); cur = '' }
    else cur += ch
  }
  result.push(cur)
  return result
}

function parseEstimacionCSV(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) throw new Error('El archivo debe tener al menos 2 filas (encabezado + 1 concepto)')
  const header = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase())
  const COL = { disciplina: header.indexOf('disciplina'), clave: header.indexOf('clave'), descripcion: header.indexOf('descripcion'), entregable: header.indexOf('entregable'), monto: header.indexOf('monto'), tipo: header.indexOf('tipo') }
  const missing = ['disciplina', 'clave', 'descripcion', 'tipo'].filter(k => COL[k] === -1)
  if (missing.length > 0) throw new Error('Columnas faltantes: ' + missing.join(', '))
  const disciplines = []; let currentDisc = null
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length < 3) continue
    const discName = (cols[COL.disciplina] || '').trim()
    const clave    = (cols[COL.clave]       || '').trim()
    const desc     = (cols[COL.descripcion] || '').trim()
    const entrega  = COL.entregable !== -1 ? (cols[COL.entregable] || '').trim() : ''
    const montoRaw = COL.monto !== -1 ? (cols[COL.monto] || '0').trim() : '0'
    const tipo     = COL.tipo !== -1 ? (cols[COL.tipo] || 'Normal').trim() : 'Normal'
    if (discName) { currentDisc = { name: discName, concepts: [] }; disciplines.push(currentDisc) }
    if (!currentDisc) { currentDisc = { name: 'Sin disciplina', concepts: [] }; disciplines.push(currentDisc) }
    if (clave || desc) {
      const monto = parseFloat(montoRaw.replace(/[^0-9.\-]/g, '')) || 0
      currentDisc.concepts.push({ key: clave, description: desc, deliverable: entrega, type: tipo.toUpperCase() === 'FINIQUITO' ? 'Finiquito' : 'Normal', _monto: monto })
    }
  }
  return disciplines
}

// ── Listas de opciones ──────────────────────────────────────────────────────
const SERVICE_TYPES = ['LEED BD+C','LEED ID+C','LEED O+M','EDGE','Comisionamiento','Modelación Energética','Mixto']
const PHASE_OPTIONS = ['Diseño','Construcción','Ocupación']
const TEAM_ROLES = [
  ['lider','Líder de Proyecto'],
  ['cx','Agente de Comisionamiento (CX)'],
  ['me','Consultor de Modelación Energética'],
  ['consultor','Consultor de Consultoría LEED'],
  ['coordinador','Coordinador de Proyecto'],
]
// Genera las disciplinas + conceptos por defecto del machote BEA.
// mesesF2 = meses de diseño (Fase 2), mesesF3 = meses de construcción (Fase 3 y CX)
function buildTemplateDisciplines(mesesF2 = 8, mesesF3 = 18) {
  const LEED_F2_EST = 387432
  const LEED_F3_EST = 183569.472
  const EH_EST = 17280
  const ME_EST = 172914.759

  const n2 = Math.max(1, Math.min(60, mesesF2))
  const n3 = Math.max(1, Math.min(60, mesesF3))

  const fase2Concepts = []
  for (let i = 1; i <= n2; i++) {
    fase2Concepts.push({ key: `2.b.${String(i).padStart(2, '0')}`, description: `Seguimiento LEED diseño mes ${i}: reunión mensual, revisión de entregables de diseño, asesoría técnica LEED y desarrollo de cálculos`, deliverable: '1. Reporte.', pct: (47520 / LEED_F2_EST) * 100, month: '', type: 'Normal' })
  }
  fase2Concepts.push({ key: '2.09', description: 'Reporte de Revisión de Diseño Final', deliverable: '1. Reporte.', pct: (7272 / LEED_F2_EST) * 100, month: '', type: 'Normal' })

  const fase3Concepts = []
  for (let i = 1; i <= n3; i++) {
    fase3Concepts.push({ key: `3.seg.${String(i).padStart(2, '0')}`, description: `Seguimiento LEED Construcción y Reporte Mensual de Avance - Mes ${i}`, deliverable: '1. Reporte mensual.', pct: (4267.35 / LEED_F3_EST) * 100, month: '', type: 'Normal' })
  }
  for (let mes = 2, b = 1; mes <= n3; mes += 2, b++) {
    fase3Concepts.push({ key: `3.bim.${String(b).padStart(2, '0')}`, description: `Reunión bimensual en sitio — Mes ${mes} de construcción`, deliverable: '1. Reporte de Inspección.', pct: (5637.6 / LEED_F3_EST) * 100, month: '', type: 'Normal' })
  }
  fase3Concepts.push({ key: '3.31', description: 'Plan de Calidad del Ambiente Interior', deliverable: '1. Plan.', pct: (2466.45 / LEED_F3_EST) * 100, month: '', type: 'Normal' })

  const cxConcepts = []
  for (let i = 1; i <= n3; i++) {
    cxConcepts.push({ key: `cx.seg.${String(i).padStart(2, '0')}`, description: `Seguimiento de proyecto mes ${i}`, deliverable: '1. Reporte.', pct: Math.round((100 / (n3 + 3)) * 10) / 10, month: '', type: 'Normal' })
  }
  cxConcepts.push(
    { key: 'cx.fin.01', description: 'Revisión de pruebas pre-funcionales de los sistemas', deliverable: '1. Reporte.', pct: 0, month: '', type: 'Finiquito' },
    { key: 'cx.fin.02', description: 'Revisión de Pruebas funcionales de los sistemas', deliverable: '1. Reporte.', pct: 0, month: '', type: 'Finiquito' },
    { key: 'cx.fin.03', description: 'Integración del manual de O&M general y reporte final', deliverable: '1. Documento.', pct: 0, month: '', type: 'Finiquito' },
  )

  return [
    {
      name: 'Fase Uno: Diagnóstico, Factibilidad y Plan de Acción para Certificación LEED',
      concepts: [
        { key: '1.01', description: 'Diagnóstico de sustentabilidad del proyecto: revisión de condiciones del sitio, programa arquitectónico y estrategias de diseño pasivo', deliverable: '1. Reporte de diagnóstico.', pct: 0, month: '', type: 'Normal' },
        { key: '1.02', description: 'Análisis de factibilidad LEED: evaluación de créditos alcanzables, nivel de certificación objetivo y brechas principales', deliverable: '1. Matriz de factibilidad.', pct: 0, month: '', type: 'Normal' },
        { key: '1.03', description: 'Plan Estratégico de Acción LEED: hoja de ruta de créditos, responsables, entregables y cronograma de certificación', deliverable: '1. Plan Estratégico.', pct: 0, month: '', type: 'Normal' },
        { key: '1.04', description: 'Taller de alineación con equipo de diseño: sesión de trabajo para socializar el plan LEED y definir compromisos por disciplina', deliverable: '1. Minuta de taller.', pct: 0, month: '', type: 'Normal' },
      ],
    },
    { name: 'Fase Dos: Asesoría y Gestión LEED Diseño e Ingenierías', concepts: fase2Concepts },
    { name: 'Fase Tres: Asesoría y Gestión LEED Construcción', concepts: fase3Concepts },
    { name: 'Fundamental Commissioning', concepts: cxConcepts },
    {
      name: 'Enhanced Commissioning & Monitoring-Based Commissioning',
      concepts: [
        { key: '5.02', description: 'Revision de submittals de los sistemas', deliverable: '1. Reporte.', pct: (14400 / EH_EST) * 100, month: '', type: 'Normal' },
        { key: '5.03', description: 'Revision de los entrenamientos de los sistemas', deliverable: '1. Reporte.', pct: (1728 / EH_EST) * 100, month: 'TBD', type: 'Normal' },
        { key: '5.04', description: 'Plan de comisionamiento continuo', deliverable: '1. Plan Cx.', pct: (1152 / EH_EST) * 100, month: 'TBD', type: 'Normal' },
      ],
    },
    {
      name: 'Modelación Energética',
      concepts: [
        { key: '6.02a', description: 'Iteracion 2', deliverable: '1. Reporte.', pct: (43809.984 / ME_EST) * 100, month: '', type: 'Normal' },
        { key: '6.04a', description: 'Reunion via remota de revision de reportes - iteracion 2', deliverable: '1. Minuta.', pct: (1422.9 / ME_EST) * 100, month: '', type: 'Normal' },
        { key: '6.05b', description: 'Version 1 de cambios en Modelo Energetico derivados de ajustes en el proyecto arquitectonico', deliverable: '1. Reporte.', pct: (11700 / ME_EST) * 100, month: '', type: 'Normal' },
        { key: '6.06b', description: 'Version 2 de cambios en Modelo Energetico derivados de ajustes en el proyecto arquitectonico', deliverable: '1. Reporte.', pct: (115981.875 / ME_EST) * 100, month: '', type: 'Normal' },
      ],
    },
    {
      name: 'Certificación (FINIQUITO)',
      concepts: [
        { key: '7.01', description: 'Envio a revision preliminar', deliverable: '1. Submittals.', pct: 0, month: '', type: 'Finiquito' },
        { key: '7.02', description: 'Envio a revision final', deliverable: '1. Submittals.', pct: 0, month: '', type: 'Finiquito' },
        { key: '7.03', description: 'Certificacion', deliverable: '1. Certificado.', pct: 0, month: '', type: 'Finiquito' },
      ],
    },
  ]
}

function getTeamMembers() {
  try { return JSON.parse(localStorage.getItem('bea_team_members') || '[]') } catch { return [] }
}
function saveTeamMemberLocally(name) {
  const arr = getTeamMembers()
  if (!arr.includes(name)) { arr.push(name); localStorage.setItem('bea_team_members', JSON.stringify(arr)) }
}

// ── Cálculo de avance por disciplina ────────────────────────────────────────
function disciplineAdvancePct(discipline, estimations) {
  const s = disciplineSubtotal(discipline)
  if (s.conDesc <= 0) return 0
  let acum = 0
  ;(estimations || []).forEach(e => {
    if (e.status !== 'Enviada') return
    ;(e.estimation_items || []).forEach(item => {
      const c = (discipline.concepts || []).find(c => c.id === item.concept_id)
      if (c && item.included) acum += parseFloat(item.amount) || 0
    })
  })
  return (acum / s.conDesc) * 100
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function ProjectSetup() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [project, setProject] = useState(null)
  const [disciplines, setDisciplines] = useState([])
  const [estimations, setEstimations] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modal, setModal] = useState(null) // { title, body, onConfirm }
  const [csvModal, setCsvModal] = useState(false)
  const saveTimer = useRef(null)
  const csvInputRef = useRef(null)

  // ── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    const [projRes, discRes, estRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('disciplines').select('*, concepts(*)').eq('project_id', id).order('sort_order'),
      supabase.from('estimations').select('*, estimation_items(*)').eq('project_id', id).order('created_at'),
    ])
    if (projRes.error) { toast('Error al cargar proyecto', true); setLoading(false); return }

    // Ordenar conceptos dentro de cada disciplina
    const discs = (discRes.data || []).map(d => ({
      ...d,
      concepts: [...(d.concepts || [])].sort((a, b) => a.sort_order - b.sort_order),
    }))

    setProject(projRes.data)
    setDisciplines(discs)
    setEstimations(estRes.data || [])
    setLoading(false)
  }

  // ── Auto-save con debounce (600ms) ─────────────────────────────────────────
  const scheduleProjectSave = useCallback((updatedProject) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveProject(updatedProject), 600)
  }, [])

  async function saveProject(p) {
    setSaving(true)
    const { error } = await supabase.from('projects').update({
      name: p.name, client: p.client, location: p.location,
      service_type: p.service_type, phase: p.phase, status: p.status,
      start_date: p.start_date || null, end_date: p.end_date || null,
      currency: p.currency, client_contact_name: p.client_contact_name,
      client_contact_email: p.client_contact_email,
      meses_fase2: p.meses_fase2, meses_fase3: p.meses_fase3, team: p.team,
    }).eq('id', p.id)
    setSaving(false)
    if (error) toast('Error al guardar', true)
  }

  function setProjectField(field, value) {
    setProject(prev => {
      const updated = { ...prev, [field]: value }
      scheduleProjectSave(updated)
      return updated
    })
  }
  function setTeamField(role, value) {
    setProject(prev => {
      const updated = { ...prev, team: { ...prev.team, [role]: value } }
      scheduleProjectSave(updated)
      return updated
    })
  }

  // ── Disciplinas ────────────────────────────────────────────────────────────
  async function addDiscipline() {
    const sortOrder = disciplines.length
    const { data, error } = await supabase.from('disciplines')
      .insert({ project_id: id, name: 'Nueva disciplina', sort_order: sortOrder })
      .select('*, concepts(*)')
      .single()
    if (error) { toast('Error al agregar disciplina', true); return }
    setDisciplines(prev => [...prev, { ...data, concepts: [] }])
  }

  async function addDefaultDisciplines() {
    setSaving(true)
    const template = buildTemplateDisciplines(project.meses_fase2 || 8, project.meses_fase3 || 18)
    const newDiscs = []
    for (let i = 0; i < template.length; i++) {
      const t = template[i]
      const { data: disc, error: dErr } = await supabase
        .from('disciplines').insert({ project_id: id, name: t.name, sort_order: i }).select().single()
      if (dErr) { toast('Error al crear disciplinas', true); setSaving(false); return }
      let concepts = []
      if (t.concepts.length > 0) {
        const rows = t.concepts.map((c, j) => ({
          discipline_id: disc.id,
          key: c.key, description: c.description, deliverable: c.deliverable,
          pct: c.pct, month: c.month || '', type: c.type || 'Normal', sort_order: j,
        }))
        const { data: cData, error: cErr } = await supabase.from('concepts').insert(rows).select()
        if (cErr) { toast('Error al crear conceptos', true); setSaving(false); return }
        concepts = [...(cData || [])].sort((a, b) => a.sort_order - b.sort_order)
      }
      newDiscs.push({ ...disc, concepts })
    }
    setDisciplines(newDiscs)
    setSaving(false)
    toast('Disciplinas y conceptos cargados ✓')
  }

  async function removeDiscipline(discId) {
    const { error } = await supabase.from('disciplines').delete().eq('id', discId)
    if (error) { toast('Error al eliminar', true); return }
    setDisciplines(prev => prev.filter(d => d.id !== discId))
    toast('Disciplina eliminada')
  }

  async function saveDisciplineField(discId, field, value) {
    setDisciplines(prev => prev.map(d => d.id === discId ? { ...d, [field]: value } : d))
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      await supabase.from('disciplines').update({ [field]: value }).eq('id', discId)
      setSaving(false)
    }, 600)
  }

  // ── Conceptos ──────────────────────────────────────────────────────────────
  async function addConcept(discId) {
    const disc = disciplines.find(d => d.id === discId)
    const sortOrder = (disc?.concepts || []).length
    const { data, error } = await supabase.from('concepts')
      .insert({ discipline_id: discId, description: 'Nuevo concepto', sort_order: sortOrder })
      .select().single()
    if (error) { toast('Error al agregar concepto', true); return }
    setDisciplines(prev => prev.map(d =>
      d.id === discId ? { ...d, concepts: [...d.concepts, data] } : d
    ))
  }

  async function removeConcept(discId, conceptId) {
    const { error } = await supabase.from('concepts').delete().eq('id', conceptId)
    if (error) { toast('Error al eliminar', true); return }
    setDisciplines(prev => prev.map(d =>
      d.id === discId ? { ...d, concepts: d.concepts.filter(c => c.id !== conceptId) } : d
    ))
  }

  async function saveConceptField(discId, conceptId, field, value) {
    setDisciplines(prev => prev.map(d =>
      d.id === discId
        ? { ...d, concepts: d.concepts.map(c => c.id === conceptId ? { ...c, [field]: value } : c) }
        : d
    ))
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      await supabase.from('concepts').update({ [field]: value }).eq('id', conceptId)
      setSaving(false)
    }, 600)
  }

  // ── Importar desde CSV ────────────────────────────────────────────────────
  async function handleCSVFile(event) {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    const text = await file.text()
    let parsed
    try { parsed = parseEstimacionCSV(text) } catch (err) { toast('Error en CSV: ' + err.message, true); return }
    if (!parsed.length) { toast('El CSV no contiene datos válidos', true); return }

    // Borrar disciplinas actuales
    if (disciplines.length > 0) {
      await supabase.from('disciplines').delete().eq('project_id', id)
    }

    // Insertar disciplinas y calcular % por monto
    const newDiscs = []
    for (let i = 0; i < parsed.length; i++) {
      const d = parsed[i]
      const totalMonto = d.concepts.reduce((s, c) => s + (c._monto || 0), 0)
      const { data: discData, error: dErr } = await supabase
        .from('disciplines')
        .insert({ project_id: id, name: d.name, monto_total: totalMonto, sort_order: i })
        .select().single()
      if (dErr) { toast('Error al crear disciplina: ' + d.name, true); continue }

      const conceptRows = d.concepts.map((c, j) => ({
        discipline_id: discData.id,
        key: c.key,
        description: c.description,
        deliverable: c.deliverable,
        pct: totalMonto > 0 ? Math.round((c._monto / totalMonto) * 1000) / 10 : 0,
        type: c.type,
        sort_order: j,
      }))
      const { data: concData } = await supabase.from('concepts').insert(conceptRows).select()
      newDiscs.push({ ...discData, concepts: concData || [] })
    }
    setDisciplines(newDiscs)
    toast(`CSV cargado: ${newDiscs.length} disciplinas, ${newDiscs.reduce((s, d) => s + d.concepts.length, 0)} conceptos`)
  }

  async function equalizePercentages(discId) {
    const disc = disciplines.find(d => d.id === discId)
    if (!disc || disc.concepts.length === 0) return
    const pct = parseFloat((100 / disc.concepts.length).toFixed(4))
    const updated = disc.concepts.map(c => ({ ...c, pct }))
    setDisciplines(prev => prev.map(d =>
      d.id === discId ? { ...d, concepts: updated } : d
    ))
    for (const c of updated) {
      await supabase.from('concepts').update({ pct }).eq('id', c.id)
    }
    toast('Porcentajes igualados')
  }

  // ── Eliminar proyecto ──────────────────────────────────────────────────────
  async function deleteProject() {
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) { toast('Error al eliminar', true); return }
    toast('Proyecto eliminado')
    navigate('/')
  }

  // ── Ir a estimación del mes ────────────────────────────────────────────────
  async function goToEstimation() {
    clearTimeout(saveTimer.current)
    await saveProject(project)

    // Buscar o crear borrador
    let draft = estimations.find(e => e.status === 'Borrador')
    if (!draft) {
      const now = new Date()
      const y = now.getFullYear()
      const m = now.getMonth()
      const pad = n => String(n).padStart(2, '0')
      const lastDay = new Date(y, m + 1, 0).getDate()
      const period_from = `${y}-${pad(m + 1)}-01`
      const period_to   = `${y}-${pad(m + 1)}-${pad(lastDay)}`
      const number = estimations.length + 1

      const { data, error } = await supabase.from('estimations')
        .insert({ project_id: id, number, status: 'Borrador', period_from, period_to })
        .select().single()
      if (error) { toast('Error al crear estimación', true); return }
      draft = data
    }
    navigate(`/projects/${id}/estimations/${draft.id}`)
  }

  // ── UI helpers ─────────────────────────────────────────────────────────────
  if (loading) return <div className="main"><div className="spinner" /></div>
  if (!project) return <div className="main"><div className="empty-state"><h3>Proyecto no encontrado</h3></div></div>

  const totals = projectTotals(disciplines)
  const sentCount = estimations.filter(e => e.status === 'Enviada').length
  const teamMembers = getTeamMembers()

  return (
    <div className="main">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <a onClick={() => navigate('/')}>Mis Proyectos</a>
        <span className="sep">›</span>
        <span className="current">{project.name}</span>
      </div>

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{project.name}</h1>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--green-dark)', marginTop: 4 }}>
            ⚙ Configuración del Proyecto
          </div>
          <div className="page-subtitle">{project.client || 'Sin cliente'}</div>
        </div>
        <div className="flex" style={{ flexWrap: 'wrap', gap: 8 }}>
          {project.status === 'Activo' && (
            <button className="btn btn-primary" onClick={goToEstimation}>Estimación del mes →</button>
          )}
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/aditivas`)}>📋 Aditivas</button>
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/history`)}>Historial</button>
          <button className="btn btn-danger" onClick={() => setModal({
            title: 'Eliminar proyecto',
            body: `¿Eliminar el proyecto <strong>${project.name}</strong> y todas sus estimaciones? Esta acción no se puede deshacer.`,
            onConfirm: deleteProject,
          })}>Eliminar</button>
        </div>
      </div>

      {/* Status pill */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className={`status-pill${saving ? ' dirty' : ''}`}>{saving ? 'Guardando...' : 'Guardado'}</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-4 mb-md">
        <div className="stat-box">
          <div className="stat-label">Importe Total</div>
          <div className="stat-value">{fmtMoney(totals.importeTotal, project.currency)}</div>
          <div className="stat-sub">{project.currency}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Estimable (100%)</div>
          <div className="stat-value green">{fmtMoney(totals.conDescuento, project.currency)}</div>
          <div className="stat-sub">Finiquito: {fmtMoney(totals.finiquito, project.currency)}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Estimaciones</div>
          <div className="stat-value">{estimations.length}</div>
          <div className="stat-sub">{sentCount} enviadas</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Estado</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            <span className={`state-badge state-${project.status}`} style={{ position: 'static', padding: '4px 10px' }}>
              {project.status}
            </span>
          </div>
        </div>
      </div>

      {/* ── Datos Generales ────────────────────────────────────── */}
      <div className="card mb-md">
        <div className="section-header"><div className="section-title">Datos Generales</div></div>
        <div className="grid grid-3 mb-md">
          <Field label="Nombre del proyecto">
            <input value={project.name} onChange={e => setProjectField('name', e.target.value)} />
          </Field>
          <Field label="Cliente">
            <input value={project.client} onChange={e => setProjectField('client', e.target.value)} />
          </Field>
          <Field label="Ubicación">
            <input value={project.location} onChange={e => setProjectField('location', e.target.value)} />
          </Field>
          <Field label="Tipo de servicio">
            <select value={project.service_type} onChange={e => setProjectField('service_type', e.target.value)}>
              {SERVICE_TYPES.map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Fase actual del Proyecto">
            <select value={project.phase} onChange={e => setProjectField('phase', e.target.value)}>
              {PHASE_OPTIONS.map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Estado">
            <select value={project.status} onChange={e => setProjectField('status', e.target.value)}>
              {['Activo','Pausado','Cancelado'].map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Fecha de inicio de Proyecto">
            <input type="date" value={project.start_date || ''} onChange={e => setProjectField('start_date', e.target.value)} />
          </Field>
          <Field label="Fecha estimada de fin de Proyecto">
            <input type="date" value={project.end_date || ''} onChange={e => setProjectField('end_date', e.target.value)} />
          </Field>
          <Field label="Moneda">
            <select value={project.currency} onChange={e => setProjectField('currency', e.target.value)}>
              {['MXN','USD'].map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Meses de diseño (Fase 2)">
            <input type="number" min="1" max="60" value={project.meses_fase2}
              onChange={e => setProjectField('meses_fase2', parseInt(e.target.value) || 8)} />
          </Field>
          <Field label="Meses de construcción (Fase 3)">
            <input type="number" min="1" max="60" value={project.meses_fase3}
              onChange={e => setProjectField('meses_fase3', parseInt(e.target.value) || 18)} />
          </Field>
          <Field label="Cliente responsable (nombre)">
            <input value={project.client_contact_name} onChange={e => setProjectField('client_contact_name', e.target.value)} />
          </Field>
          <Field label="Cliente responsable (email)">
            <input type="email" value={project.client_contact_email} onChange={e => setProjectField('client_contact_email', e.target.value)} />
          </Field>
        </div>
      </div>

      {/* ── Equipo ────────────────────────────────────────────── */}
      <div className="card mb-md">
        <div className="section-header">
          <div className="section-title">Equipo del Proyecto</div>
          <button className="btn btn-outline btn-sm" onClick={() => {
            const name = prompt('Nombre del nuevo miembro del equipo:')
            if (name?.trim()) saveTeamMemberLocally(name.trim())
          }}>+ Agregar miembro</button>
        </div>
        <div className="grid grid-3">
          {TEAM_ROLES.map(([role, label]) => (
            <Field key={role} label={label}>
              <select value={(project.team || {})[role] || ''} onChange={e => {
                const val = e.target.value
                if (val) saveTeamMemberLocally(val)
                setTeamField(role, val)
              }}>
                <option value="">— Seleccionar —</option>
                {teamMembers.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          ))}
        </div>
      </div>

      {/* ── Disciplinas ───────────────────────────────────────── */}
      <div className="card mb-md">
        <div className="section-header">
          <div className="section-title">Montos por Disciplina</div>
          <div className="flex gap-sm">
            {disciplines.length === 0 && (
              <button className="btn btn-dark btn-sm" onClick={addDefaultDisciplines}>
                ⚡ Cargar disciplinas BEA
              </button>
            )}
            <button className="btn btn-outline btn-sm" onClick={addDiscipline}>+ Disciplina</button>
          </div>
        </div>
        {disciplines.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
            Sin disciplinas. Haz clic en "Cargar disciplinas BEA" para agregar las 4 estándar, o en "+ Disciplina" para agregar manualmente.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>Disciplina</th>
                  <th className="num">Monto Total</th>
                  <th className="num">Desc. %</th>
                  <th className="num">Con Descuento</th>
                  <th className="num">Estimable</th>
                  <th className="num">Tarifa HH</th>
                  <th className="num">Total HH</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {disciplines.map(d => {
                  const s = disciplineSubtotal(d)
                  return (
                    <tr key={d.id}>
                      <td>
                        <textarea rows={2}
                          style={{ width: '100%', minWidth: 200, resize: 'vertical', fontSize: 13, padding: '5px 7px', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'inherit', lineHeight: 1.4, background: 'transparent' }}
                          value={d.name}
                          onChange={e => saveDisciplineField(d.id, 'name', e.target.value)} />
                      </td>
                      <td className="num">
                        <input type="number" step="0.01" style={{ textAlign: 'right' }}
                          value={d.monto_total}
                          onChange={e => saveDisciplineField(d.id, 'monto_total', parseFloat(e.target.value) || 0)} />
                      </td>
                      <td className="num">
                        <input type="number" step="0.01"
                          value={d.descuento}
                          onChange={e => saveDisciplineField(d.id, 'descuento', parseFloat(e.target.value) || 0)} />
                      </td>
                      <td className="num">{fmtMoney(s.conDesc, project.currency)}</td>
                      <td className="num"><strong>{fmtMoney(s.estimable, project.currency)}</strong></td>
                      <td className="num">
                        <input type="number" step="0.01"
                          value={d.tarifa_hh}
                          onChange={e => saveDisciplineField(d.id, 'tarifa_hh', parseFloat(e.target.value) || 0)} />
                      </td>
                      <td className="num">{s.totalHH.toFixed(1)}</td>
                      <td>
                        <button className="btn btn-ghost btn-xs" title="Eliminar disciplina"
                          onClick={() => setModal({
                            title: 'Eliminar disciplina',
                            body: `¿Eliminar <strong>${d.name}</strong> y todos sus conceptos? Esta acción no se puede deshacer.`,
                            onConfirm: () => removeDiscipline(d.id),
                          })}>✕</button>
                      </td>
                    </tr>
                  )
                })}
                {/* Fila de totales */}
                <tr style={{ background: 'var(--surface)', fontWeight: 700 }}>
                  <td>TOTALES</td>
                  <td className="num">{fmtMoney(totals.importeTotal, project.currency)}</td>
                  <td></td>
                  <td className="num">{fmtMoney(totals.conDescuento, project.currency)}</td>
                  <td className="num" style={{ color: 'var(--green-dark)' }}>{fmtMoney(totals.estimable, project.currency)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Conceptos por Disciplina ───────────────────────────── */}
      {disciplines.length > 0 && (
        <div className="mb-md">
          <div className="section-header">
            <div className="section-title">Conceptos por Disciplina</div>
            <div>
              <input ref={csvInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSVFile} />
              <button className="btn btn-outline btn-sm" style={{ color: 'var(--navy)', borderColor: 'var(--navy)' }}
                onClick={() => setCsvModal(true)}>
                📥 Cargar plantilla CSV
              </button>
            </div>
          </div>

          {disciplines.map(d => {
            const s = disciplineSubtotal(d)
            const totalPct = d.concepts.reduce((sum, c) => sum + (parseFloat(c.pct) || 0), 0)
            const roundedPct = Math.round(totalPct * 10) / 10
            const advPct = disciplineAdvancePct(d, estimations)

            return (
              <div key={d.id} className="discipline-block">
                <div className="discipline-header">
                  <div style={{ flex: 1 }}>
                    <div className="discipline-name">{d.name}</div>
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                      <span>Estimado: <strong style={{ color: 'var(--green-dark)' }}>{fmtPct(advPct)}</strong></span>
                      <div className="progress" style={{ flex: 1, maxWidth: 180 }}>
                        <div className="progress-bar" style={{ width: `${Math.min(100, advPct)}%` }} />
                      </div>
                      <span>({fmtPct(roundedPct)} % asignado)</span>
                    </div>
                  </div>
                  <div className="discipline-stats">
                    <span>Estimable: <strong>{fmtMoney(s.conDesc, project.currency)}</strong></span>
                    <span>Conceptos: <strong>{d.concepts.length}</strong></span>
                    <button className="btn btn-outline btn-sm" onClick={() => equalizePercentages(d.id)}>⟳ % iguales</button>
                    <button className="btn btn-outline btn-sm" onClick={() => addConcept(d.id)}>+ Concepto</button>
                  </div>
                </div>

                <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 80 }}>Clave</th>
                        <th>Descripción</th>
                        <th>Entregable</th>
                        <th className="num" style={{ width: 110 }}>% del monto</th>
                        <th className="num" style={{ width: 130 }}>Monto</th>
                        <th style={{ width: 120 }}>Tipo</th>
                        <th style={{ width: 30 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.concepts.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 18 }}>
                            Sin conceptos · agrega el primero con el botón "+ Concepto"
                          </td>
                        </tr>
                      ) : d.concepts.map(c => (
                        <tr key={c.id} className={`concept-row${c.type === 'Finiquito' ? ' finiquito' : ''}`}>
                          <td>
                            <input value={c.key || ''}
                              onChange={e => saveConceptField(d.id, c.id, 'key', e.target.value)} />
                          </td>
                          <td>
                            <textarea rows={2}
                              style={{ width: '100%', minWidth: 200, resize: 'vertical', fontSize: 12, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'inherit', lineHeight: 1.4 }}
                              value={c.description || ''}
                              onChange={e => saveConceptField(d.id, c.id, 'description', e.target.value)} />
                          </td>
                          <td>
                            <input value={c.deliverable || ''}
                              onChange={e => saveConceptField(d.id, c.id, 'deliverable', e.target.value)} />
                          </td>
                          <td className="num">
                            <input type="number" step="0.1" min="0" max="100"
                              value={Math.round((c.pct || 0) * 10) / 10}
                              onChange={e => saveConceptField(d.id, c.id, 'pct', parseFloat(e.target.value) || 0)} />
                          </td>
                          <td className="num">
                            <strong>{fmtMoney(conceptAmount(c, d), project.currency)}</strong>
                          </td>
                          <td>
                            <select value={c.type || 'Normal'}
                              onChange={e => saveConceptField(d.id, c.id, 'type', e.target.value)}>
                              <option>Normal</option>
                              <option>Finiquito</option>
                            </select>
                          </td>
                          <td>
                            <button className="btn btn-ghost btn-xs"
                              onClick={() => setModal({
                                title: 'Eliminar concepto',
                                body: `¿Eliminar el concepto <strong>${c.description || c.key}</strong>?`,
                                onConfirm: () => removeConcept(d.id, c.id),
                              })}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Resumen de % */}
                <div style={{ margin: '6px 12px 10px', padding: '6px 12px', background: 'var(--surface-2)', borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--text-muted)' }}>
                  {roundedPct > 100
                    ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>⚠ Suma de % supera el 100% ({roundedPct}%)</span>
                    : roundedPct > 0
                      ? <span>Suma asignada: <strong style={{ color: 'var(--navy)' }}>{roundedPct}%</strong> &nbsp;·&nbsp; Disponible: <strong style={{ color: 'var(--green-dark)' }}>{Math.round((100 - roundedPct) * 10) / 10}%</strong></span>
                      : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Botón final ────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24, paddingTop: 16, borderTop: '2px solid var(--green)' }}>
        <button className="btn btn-primary" style={{ fontSize: 15, padding: '12px 28px' }} onClick={goToEstimation}>
          ✓ Configuración completada → Ir a Estimación del mes
        </button>
      </div>

      {/* Modal de confirmación */}
      {modal && (
        <Modal
          title={modal.title}
          body={modal.body}
          confirmText="Eliminar"
          onConfirm={modal.onConfirm}
          onClose={() => setModal(null)}
        />
      )}

      {/* Modal instrucciones CSV */}
      {csvModal && (
        <CsvInstructionsModal
          onClose={() => setCsvModal(false)}
          onConfirm={() => { setCsvModal(false); csvInputRef.current?.click() }}
        />
      )}
    </div>
  )
}

// ── Sub-componente Field ──────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  )
}

// ── Modal instrucciones CSV ───────────────────────────────────────────────────
function CsvInstructionsModal({ onClose, onConfirm }) {
  const example = [
    'disciplina,clave,descripcion,entregable,monto,tipo',
    '"Fase Dos: Asesoría LEED Diseño",2.b.01,"Seguimiento LEED diseño mes 1: reunión mensual","1. Reporte.",47520,Normal',
    ',2.b.02,"Seguimiento LEED diseño mes 2: reunión mensual","1. Reporte.",47520,Normal',
    ',2.09,"Reporte de Revisión de Diseño Final","1. Reporte.",7272,Normal',
    '"Fundamental Commissioning",4.18,"Seguimiento de proyecto mes 14","1. Reporte.",5486.4,Normal',
    ',4.23,"Revisión de pruebas pre-funcionales","1. Reporte.",9144,FINIQUITO',
  ].join('\n')

  const cols = [
    ['A', 'disciplina', 'Nombre de la disciplina. Déjala vacía en los conceptos que pertenecen a la misma disciplina (como celdas combinadas en Excel).', 'Sí (primera de cada grupo)'],
    ['B', 'clave', 'Clave única del concepto (ej: 2.b.01, 4.18)', 'Sí'],
    ['C', 'descripcion', 'Descripción completa del concepto', 'Sí'],
    ['D', 'entregable', 'Entregable asociado (ej: 1. Reporte.)', 'No (puede quedar vacío)'],
    ['E', 'monto', 'Monto del concepto en pesos, sin comas ni $ (ej: 47520)', 'No (puede ser 0)'],
    ['F', 'tipo', 'Normal o FINIQUITO', 'Sí'],
  ]

  return (
    <div className="modal-overlay show" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 700 }}>
        <div className="modal-title">📥 Cargar plantilla CSV — Requisitos</div>
        <div className="modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          <div className="warning-banner" style={{ marginBottom: 14 }}>
            ⚠ La carga del CSV reemplazará todas las disciplinas y conceptos actuales del proyecto.
          </div>
          <p style={{ fontWeight: 700, marginBottom: 8 }}>Columnas requeridas (en este orden):</p>
          <div style={{ overflowX: 'auto', marginBottom: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  {['Col.', 'Nombre', 'Descripción', 'Requerida'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', border: '1px solid var(--border)', fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cols.map(([col, name, desc, req]) => (
                  <tr key={col}>
                    <td style={{ padding: '5px 10px', border: '1px solid var(--border)', fontWeight: 700, color: 'var(--navy)' }}>{col}</td>
                    <td style={{ padding: '5px 10px', border: '1px solid var(--border)', fontFamily: 'monospace', color: 'var(--green-dark)' }}>{name}</td>
                    <td style={{ padding: '5px 10px', border: '1px solid var(--border)', color: 'var(--text-soft)' }}>{desc}</td>
                    <td style={{ padding: '5px 10px', border: '1px solid var(--border)', color: req.startsWith('Sí') ? 'var(--green-dark)' : 'var(--text-muted)', fontWeight: req.startsWith('Sí') ? 700 : 400 }}>{req}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontWeight: 700, marginBottom: 8 }}>Ejemplo del archivo:</p>
          <pre style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 'var(--radius)', fontSize: 11, overflowX: 'auto', whiteSpace: 'pre', border: '1px solid var(--border)' }}>
            {example}
          </pre>
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            💡 <strong>Tip:</strong> En Excel, cuando una disciplina abarca varios conceptos, deja la columna A vacía en las filas siguientes. Guarda el archivo con "CSV UTF-8" para evitar problemas con acentos.
          </p>
        </div>
        <div className="modal-actions">
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={onConfirm}>Entendido — seleccionar archivo CSV</button>
        </div>
      </div>
    </div>
  )
}
