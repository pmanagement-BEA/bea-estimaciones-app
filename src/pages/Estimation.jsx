import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toast } from '../components/Toast'
import Modal from '../components/Modal'
import { fmtMoney, fmtPct, fmtDate } from '../utils/format'
import { disciplineSubtotal, conceptAmount, itemAmount, estimationSummary, projectRates, AREAS, disciplineArea } from '../utils/calculations'
import { fetchEstadoAreas, marcarAreaLista, quitarAreaLista, permisosProyecto } from '../lib/cierre'
import { corteDeEstimacion, fmtCorte, textoCorte, diasParaCorte, periodoBorrador, seEncima, moverPeriodo, inicioDelPeriodo, fechaLocal, mesDelPeriodo } from '../utils/cierre'
import HojaCliente, { armarHoja, descargarExcel } from '../components/HojaCliente'
import EstimacionBreve from '../components/EstimacionBreve'
import { descargarBreve } from '../lib/estimacionBreveExcel'
import { nombreBreve } from '../lib/estimacionBreve'
import { cargarExcelJS } from '../lib/cargarModulo'
import { conceptosPorEstimar } from '../lib/proyecciones'
import FormatosCliente, { avanzarFormatos } from '../components/FormatosCliente'
import { nextNumber, aditivaLabel } from '../utils/aditivas'
import { useAuth } from '../hooks/useAuth'
import { isReadOnlyRole, fetchDirectorio, fetchProjectMembers } from '../lib/directorio'
import { useAjeno, AVISO_AJENO } from '../hooks/useAjeno'
import { descargarReporteExcel, AREAS_REPORTE, ETIQUETA_AREA } from '../lib/reporteExcel'
import LogoCliente, { leerLogoCliente } from '../components/LogoCliente'

// Lo que pasa del reporte anterior al nuevo: lo que sigue vigente (lo realizado en el mes empieza vacío)
const CAMPOS_HEREDADOS = ['acciones_pendientes', 'informacion_pendiente', 'riesgos', 'no_riesgos', 'entregables', 'resumen_proyecto',
  'fase_texto', 'estado_proyecto', 'inicio_fase', 'fin_fase', 'inicio_contrato', 'fin_contrato', 'avance_documental', 'cliente_responsable', 'nota_info_pendiente']

// Áreas que llevan reporte mensual: las que tienen disciplinas en el contrato (si no se distingue ninguna, las 3)
function areasDelReporte(discs) {
  const hay = AREAS_REPORTE.map(([a]) => a).filter(a => (discs || []).some(d => disciplineArea(d) === a))
  return hay.length ? hay : AREAS_REPORTE.map(([a]) => a)
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

// ── Helpers ──────────────────────────────────────────────────────────────────
function monthOptions(mes, startDate, endDate) {
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
    opts.push({ value, label, selected: mes === value })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return opts
}



// ── Componente principal ─────────────────────────────────────────────────────
export default function Estimation() {
  const { id, estId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [project, setProject]         = useState(null)
  const [disciplines, setDisciplines] = useState([])
  const [estimation, setEstimation]   = useState(null)
  const [allEstimations, setAllEstimations] = useState([])
  const [items, setItems]             = useState({}) // { concept_id: item }
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [activeTab, setActiveTab]     = useState('estimation')
  const [vistaCliente, setVistaCliente] = useState('completa') // hoja completa RC-OP-11 o versión breve
  // Al abrir la hoja para cliente se precarga ExcelJS: la descarga sale al instante
  useEffect(() => { if (activeTab === 'cliente') cargarExcelJS().catch(() => {}) }, [activeTab])
  const [modal, setModal]             = useState(null)
  const [reportes, setReportes]       = useState({}) // reporte mensual de cada área: { Consultoría: {...}, Commissioning: {...}, Modelación: {...} }
  const [areaRpt, setAreaRpt]         = useState(null) // área cuyo reporte se está viendo
  const [reportSaving, setReportSaving] = useState(false)
  const [equipo, setEquipo]           = useState({})
  const [togglModal, setTogglModal]   = useState(null) // { rows: [] }
  const [areaStatus, setAreaStatus]   = useState({}) // { area: { listo_por, listo_nombre, listo_at } }
  const [perms, setPerms]             = useState({ todo: false, areas: new Set() })
  const ajeno = useAjeno(project, profile)
  const soloLectura = isReadOnlyRole(profile) || ajeno
  const areaStatusRef   = useRef({})
  const conceptosClienteRef = useRef([])
  const saveTimer       = useRef(null)
  // Guardado de conceptos: un temporizador por concepto (antes era uno solo y se perdían cambios)
  const saveTimers      = useRef({})
  const pendientes      = useRef({}) // { concept_id: item } aún sin guardar
  const [proyectados, setProyectados] = useState({ ids: new Set(), lista: [], libres: new Set(), pendientes: new Set() })
  const reportSaveTimer = useRef(null)
  const reportInsert    = useRef({}) // por área: el primer guardado (insert) en curso
  const reportesRef     = useRef({})
  const areaRef         = useRef(null)
  const areaElegida     = useRef(false) // la persona ya escogió área a mano
  const reportRef       = useRef(null)
  const togglFileRef    = useRef(null)

  useEffect(() => { fetchAll() }, [id, estId])
  // Permisos por área: se calculan cuando ya cargaron el proyecto y el perfil (el perfil llega después del primer render)
  useEffect(() => {
    if (project?.id && profile?.id) permisosProyecto(project, profile).then(setPerms)
  }, [project?.id, profile?.id, profile?.role])

  // Reporte mensual: arranca en el área de la persona (mientras no escoja otra a mano)
  useEffect(() => {
    if (!disciplines.length || areaElegida.current) return
    const aplican = areasDelReporte(disciplines)
    cambiarAreaRpt(aplican.find(a => perms.areas?.has(a)) || aplican[0])
  }, [disciplines, perms]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const periodo = periodoBorrador(allEsts)
      const mesYaEnviado = est && allEsts.some(e => e.status === 'Enviada' && seEncima(e, est))
      if (mesYaEnviado) {
        // El borrador quedó encimado con un periodo ya enviado: pasa al periodo en turno (si el líder eligió otro a mano, se respeta)
        await supabase.from('estimations').update(periodo).eq('id', est.id)
        est = { ...est, ...periodo }
      }
      if (!est && projRes.data.status !== 'Activo' && searchParams.get('crear') !== '1') {
        // Abrir un proyecto inactivo o pausado no debe dejar borradores vacíos: se crea solo a propósito desde el Historial
        toast(`El proyecto está ${(projRes.data.status || 'sin estado').toLowerCase()} y no tiene borrador. Si sí toca estimar, créalo con "+ Nueva / Borrador actual".`)
        setLoading(false)
        navigate(`/projects/${id}/history`, { replace: true })
        return
      }
      if (!est) {
        // Crear borrador del mes en turno
        const { data, error } = await supabase.from('estimations')
          .insert({ project_id: id, number: nextNumber(allEsts), status: 'Borrador', ...periodo })
          .select().single()
        if (error) { toast('Error al crear estimación', true); setLoading(false); return }
        est = { ...data, estimation_items: [] }
        allEsts.push(est)
      }
    } else {
      est = allEsts.find(e => e.id === estId)
      if (est?.status === 'Borrador' && allEsts.some(e => e.status === 'Enviada' && seEncima(e, est))) {
        // Borrador encimado con un periodo ya enviado: pasa al periodo en turno
        const periodo = periodoBorrador(allEsts)
        await supabase.from('estimations').update(periodo).eq('id', est.id)
        est = { ...est, ...periodo }
      }
    }

    if (!est) { toast('Estimación no encontrada', true); setLoading(false); return }

    // El inicio del periodo es fijo: el día en que se envió la estimación anterior
    if (est.status === 'Borrador') {
      const inicio = inicioDelPeriodo(allEsts, est.number)
      if (inicio && inicio !== est.period_from) {
        const cambio = { period_from: inicio, ...(est.period_to && est.period_to >= inicio ? {} : { period_to: inicio }) }
        await supabase.from('estimations').update(cambio).eq('id', est.id)
        est = { ...est, ...cambio }
      }
    }

    // Construir mapa de items por concept_id
    const itemMap = {}
    ;(est.estimation_items || []).forEach(item => { itemMap[item.concept_id] = item })
    // Asegurar que todos los conceptos tengan un item (puede que no existan en DB todavía)
    for (const d of discs) {
      for (const c of d.concepts) {
        if (!itemMap[c.id]) itemMap[c.id] = { concept_id: c.id, included: false, amount: 0, parcial_enabled: false, pct_parcial: 0, delayed: false, cause: '' }
      }
    }

    // Proyecciones del mes: se sugieren (etiqueta "Proyectado" y botón para marcarlas); nada se marca solo
    let infoProyectados = { ids: new Set(), lista: [], libres: new Set(), pendientes: new Set() }
    if (est.status === 'Borrador') {
      const mesEst = mesDelPeriodo(est.period_from, est.period_to)
      const { data: prs } = await supabase.from('proyecciones').select('id, concept_id, area, descripcion, monto, tbd').eq('project_id', id).eq('mes', mesEst)
      if (prs?.length) {
        // "Libres": conceptos que no se han cobrado nada (se pueden marcar completos)
        const porEstimar = conceptosPorEstimar(projRes.data, discs, allEsts.filter(e => e.id !== est.id))
        const libres = new Set(porEstimar.filter(x => x.porEstimar >= x.monto - 0.5).map(x => x.concept.id))
        // "Pendientes": conceptos a los que aún les falta algo por cobrar (los demás ya se cobraron completos)
        const pendientes = new Set(porEstimar.map(x => x.concept.id))
        const orden = new Map(discs.flatMap(d => d.concepts.map(c => c.id)).map((cid, i) => [cid, i]))
        const lista = [...prs].sort((a, b) => (orden.get(a.concept_id) ?? 1e6) - (orden.get(b.concept_id) ?? 1e6))
        infoProyectados = { ids: new Set(prs.map(x => x.concept_id).filter(Boolean)), lista, libres, pendientes }
      }
    }
    setProyectados(infoProyectados)

    // Reporte mensual: uno por área. Si el área aún no tiene el suyo, arranca con lo que sigue vigente:
    // del reporte general de esta misma estimación (de antes de separar por área) o del último reporte anterior.
    const { data: rdRows } = await supabase.from('report_data').select('*').eq('estimation_id', est.id)
    const general = (rdRows || []).find(r => !r.area) || null
    const previa = allEsts.filter(e => e.number < est.number).sort((a, b) => b.number - a.number).slice(0, 3)
    let prevRows = []
    if (previa.length) {
      const { data: prev } = await supabase.from('report_data').select('*').in('estimation_id', previa.map(e => e.id))
      prevRows = prev || []
    }
    const tomar = base => Object.fromEntries(CAMPOS_HEREDADOS.map(k => [k, base[k]]).filter(([, v]) => v != null))
    const porArea = {}
    for (const [a] of AREAS_REPORTE) {
      const propio = (rdRows || []).find(r => r.area === a)
      if (propio) { porArea[a] = propio; continue }
      if (general) {
        porArea[a] = { area: a, ...tomar(general), acciones_realizadas: (general.acciones_realizadas || []).filter(x => (x.area || 'Consultoría') === a), _heredado: 'general' }
        continue
      }
      const base = previa.map(e => prevRows.find(r => r.estimation_id === e.id && r.area === a) || prevRows.find(r => r.estimation_id === e.id && !r.area)).find(Boolean)
      porArea[a] = base ? { area: a, ...tomar(base), _heredado: previa.find(e => e.id === base.estimation_id).number } : { area: a }
    }
    reportesRef.current = porArea
    setReportes(porArea)
    if (areaRef.current) reportRef.current = porArea[areaRef.current]

    const [dir, mem] = await Promise.all([fetchDirectorio(), fetchProjectMembers(id)])
    const nombre = rol => {
      const email = (mem.byRol[rol] || [])[0]
      return (email && (dir.data.find(p => p.email === email)?.nombre || email)) || (projRes.data?.team || {})[rol] || ''
    }
    setEquipo({ lider: nombre('lider'), cx: nombre('cx'), me: nombre('me') })

    const estado = await fetchEstadoAreas(est.id)
    areaStatusRef.current = estado
    setAreaStatus(estado)

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
    // Conserva el patrón de días del proyecto (p. ej. del 11 al 10)
    const { period_from, period_to } = moverPeriodo(estimation, value)
    setEstimation(prev => ({ ...prev, period_from, period_to }))
    await supabase.from('estimations').update({ period_from, period_to }).eq('id', estimation.id)
  }

  // ── Guardar item en Supabase (debounce 500ms) ──────────────────────────────
  const scheduleItemSave = useCallback((conceptId, updatedItem, disc, concept) => {
    // Calcular amount con las reglas del proyecto (anticipo / finiquito)
    const amount = itemAmount(updatedItem, concept, disc, projectRates(project), disciplines)

    const itemWithAmount = { ...updatedItem, amount }
    setItems(prev => ({ ...prev, [conceptId]: itemWithAmount }))

    // Si el área ya estaba marcada como lista, un cambio la regresa a pendiente
    const area = disciplineArea(disc)
    if (area && areaStatusRef.current[area]) {
      const { [area]: _, ...resto } = areaStatusRef.current
      areaStatusRef.current = resto
      setAreaStatus(resto)
      quitarAreaLista(estimation.id, area)
      toast(`${area} vuelve a pendiente porque cambiaste su avance`)
    }

    pendientes.current[conceptId] = itemWithAmount
    clearTimeout(saveTimers.current[conceptId])
    saveTimers.current[conceptId] = setTimeout(() => {
      delete pendientes.current[conceptId]; delete saveTimers.current[conceptId]
      upsertItem(estimation.id, conceptId, itemWithAmount)
    }, 500)
  }, [estimation?.id, project, disciplines])

  // Viene de aceptar una aditiva (?aditiva=NNN): marca sus conceptos en este borrador, una sola vez
  const aditivaPedida = searchParams.get('aditiva')
  const aditivaHecha = useRef(null)
  useEffect(() => {
    if (loading || !aditivaPedida || !estimation || aditivaHecha.current === aditivaPedida) return
    aditivaHecha.current = aditivaPedida
    setSearchParams({}, { replace: true })
    if (estimation.status !== 'Borrador') { toast('Esta estimación ya se envió: la aditiva queda para la siguiente', true); return }
    const label = aditivaLabel(aditivaPedida)
    const disc = disciplines.find(d => (d.name || '').startsWith(label))
    if (!disc) { toast(`No encontré ${label} en el contrato`, true); return }
    const nuevos = disc.concepts.filter(c => !items[c.id]?.included)
    for (const c of nuevos) scheduleItemSave(c.id, { ...items[c.id], included: true }, disc, c)
    toast(nuevos.length ? `${label} agregada a la estimación: ${nuevos.length} ${nuevos.length === 1 ? 'concepto' : 'conceptos'} ✓` : `${label} ya estaba en la estimación`)
  }, [loading, aditivaPedida, estimation, disciplines, items, scheduleItemSave, setSearchParams])

  // Guarda ya lo que esté esperando su turno (antes de enviar, marcar área o salir)
  async function guardarPendientes() {
    const lista = Object.entries(pendientes.current)
    pendientes.current = {}
    for (const [cid] of lista) { clearTimeout(saveTimers.current[cid]); delete saveTimers.current[cid] }
    for (const [cid, item] of lista) await upsertItem(estimation.id, cid, item)
  }
  useEffect(() => () => { if (estimation?.id) guardarPendientes() }, [estimation?.id])

  // Marca los conceptos proyectados para este mes que faltan (botón, cuando el borrador ya tenía conceptos)
  // Proyectados del mes que todavía se pueden marcar (sin cobrar nada antes y sin marcar)
  const porMarcar = () => proyectados.lista.filter(p => p.concept_id && proyectados.libres.has(p.concept_id) && !items[p.concept_id]?.included)
  function marcarConcepto(cid) {
    const found = disciplines.flatMap(d => d.concepts.map(c => [c, d])).find(([c]) => c.id === cid)
    if (found) scheduleItemSave(cid, { ...items[cid], included: true }, found[1], found[0])
  }
  function marcarProyectados() {
    const lista = porMarcar()
    for (const p of lista) marcarConcepto(p.concept_id)
    toast(`${lista.length} ${lista.length === 1 ? 'concepto proyectado marcado' : 'conceptos proyectados marcados'} ✓`)
  }

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

  // El anticipo ahora es un % del proyecto (Configuración), no un dato por estimación.

  // ── Marcar como Enviada ────────────────────────────────────────────────────
  async function markSent() {
    setSaving(true)
    // Guardar items pendientes primero
    await guardarPendientes()
    for (const [cid, item] of Object.entries(items)) {
      if (item.included) await upsertItem(estimation.id, cid, item)
    }
    // El periodo termina el día en que se envía (y queda fijo)
    const ahora = new Date()
    const envio = { status: 'Enviada', enviada_at: ahora.toISOString(), period_to: fechaLocal(ahora) }
    if (envio.period_to < estimation.period_from) envio.period_to = estimation.period_from
    const { error } = await supabase.from('estimations').update(envio).eq('id', estimation.id)
    setSaving(false)
    if (error) { toast('Error al marcar como enviada', true); return }
    setEstimation(prev => ({ ...prev, ...envio }))
    toast('Estimación marcada como Enviada ✓')
    // La estimación en formato del cliente queda como plantilla del mes siguiente
    const errores = await avanzarFormatos(project, conceptosClienteRef.current, { from: estimation.period_from, to: envio.period_to })
    if (errores.length) toast('No se actualizó el formato del cliente: ' + errores.join(' · '), true)
  }

  // ── Report helpers ─────────────────────────────────────────────────────────
  // Guarda el reporte de un área en memoria (y el que se ve, si es esa área)
  function ponerReporte(next) {
    reportesRef.current = { ...reportesRef.current, [next.area]: next }
    setReportes(reportesRef.current)
    if (next.area === areaRef.current) reportRef.current = next
  }

  function scheduleReportSave(updates) {
    const actual = reportRef.current || { area: areaRef.current }
    const tocaListo = 'listo' in updates
    const next = { ...actual, ...updates, ...(!tocaListo && actual.listo ? { listo: false, listo_por: '', listo_en: null } : {}) }
    if (!tocaListo && actual.listo) toast(`El reporte de ${ETIQUETA_AREA[next.area]} vuelve a captura porque lo cambiaste`)
    ponerReporte(next)
    clearTimeout(reportSaveTimer.current)
    reportSaveTimer.current = setTimeout(() => { reportSaveTimer.current = null; flushReportSave(next) }, 600)
  }

  // Cambiar de área: lo que estaba esperando su turno se guarda ya
  function cambiarAreaRpt(a, aMano = false) {
    if (aMano) areaElegida.current = true
    if (a === areaRef.current) return
    if (reportSaveTimer.current) { clearTimeout(reportSaveTimer.current); reportSaveTimer.current = null; if (reportRef.current) flushReportSave(reportRef.current) }
    areaRef.current = a
    reportRef.current = reportesRef.current[a] || { area: a }
    setAreaRpt(a)
  }

  async function flushReportSave(data) {
    const a = data.area
    setReportSaving(true)
    // Si el primer guardado (insert) de esa área sigue en curso, espera a que termine para no crear dos reportes
    if (!data.id && reportInsert.current[a]) { await reportInsert.current[a]; data = { ...data, id: reportesRef.current[a]?.id } }
    const limpio = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('_')))
    if (data.id) {
      const { error } = await supabase.from('report_data').update(limpio).eq('id', data.id)
      if (error) toast('No se guardó el reporte: ' + error.message, true)
    } else {
      reportInsert.current[a] = supabase.from('report_data')
        .insert({ estimation_id: estimation.id, ...limpio }).select('id').single()
      const { data: created, error } = await reportInsert.current[a]
      reportInsert.current[a] = null
      if (error) toast('No se guardó el reporte: ' + error.message, true)
      if (created) {
        // Conserva lo que se haya escrito mientras se guardaba
        const { _heredado, ...resto } = reportesRef.current[a] || { area: a }
        ponerReporte({ ...resto, id: created.id })
      }
    }
    setReportSaving(false)
  }

  function marcarReporteListo(listo) {
    scheduleReportSave(listo
      ? { listo: true, listo_por: profile?.nombre || profile?.email || '', listo_en: new Date().toISOString() }
      : { listo: false, listo_por: '', listo_en: null })
    toast(listo ? `Reporte de ${ETIQUETA_AREA[areaRef.current]} listo ✓` : 'Reporte de vuelta en captura')
  }

  function addReportRow(key) {
    const defaults = {
      acciones_realizadas:   { task: '', descripcion: '', fecha: '', area: areaRef.current || areaPropia() },
      acciones_pendientes:   { accion: '', fecha: '', responsable: 'BEA' },
      informacion_pendiente: { texto: '', responsable: 'BEA' },
      riesgos:               { riesgo: '', creditos: '' },
      entregables:           { texto: '' },
      resumen_proyecto:      { hito: '', fecha: '' },
    }
    const newRow = { id: crypto.randomUUID(), ...(defaults[key] || {}) }
    const arr = [...(reportRef.current?.[key] || []), newRow]
    scheduleReportSave({ [key]: arr })
  }

  // Área con la que arrancan las acciones nuevas: la de la persona (si solo tiene una), si no Consultoría
  function areaPropia() {
    const mias = [...(perms.areas || [])]
    return mias.length === 1 ? mias[0] : 'Consultoría'
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
      newRows.push({ id: crypto.randomUUID(), task, descripcion: descs.join('\n'), fecha: '', area: areaRef.current || areaPropia() })
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

  const readonly = estimation.status === 'Enviada' || soloLectura
  const rates = projectRates(project)
  const summary = estimationSummary(disciplines, allEstimations, estimation.id, items, rates)
  const { totals, acumMap, acumAnterior, acumGlobal, porEstimar, advanceThis, advanceGlobal } = summary
  const currentTotal = summary.actual
  const thisEstAmount = (item, c, d) => itemAmount(item, c, d, rates, disciplines)
  const amountOf = (c, d) => conceptAmount(c, d, rates, disciplines)
  const hasFiniquitoConcepts = d => (d.concepts || []).some(c => c.type === 'Finiquito')

  // Avance por disciplina (sobre su importe con descuento, como el Excel)
  const discAdv = {}
  disciplines.forEach(d => {
    const bd = summary.byDiscipline[d.id]
    discAdv[d.id] = bd?.conDesc === 0 && hasFiniquitoConcepts(d)
      ? (totals.finiquito > 0 ? (bd.acumulado / totals.finiquito) * 100 : 0)
      : (bd?.avance || 0)
  })

  // ── Cierre del mes por área ────────────────────────────────────────────────
  const areasAplican = AREAS.filter(a => summary.areaAvance[a])
  const areasPendientes = areasAplican.filter(a => !areaStatus[a])
  const todasListas = areasAplican.length > 0 && areasPendientes.length === 0
  const corte = corteDeEstimacion(estimation.period_from, estimation.period_to)
  const puedeMarcar = a => !readonly && (perms.todo || perms.areas.has(a))
  const puedeEditar = d => !readonly && (perms.todo || perms.areas.has(disciplineArea(d)))
  // Para los documentos (hoja BEA, formato del cliente): mientras sea borrador, el periodo termina hoy,
  // que es cuando se imprime y se envía; ya enviada, su fecha de envío.
  const hoyIso = fechaLocal(new Date())
  const estDocs = estimation.status === 'Enviada' ? estimation
    : { ...estimation, period_to: estimation.period_from && hoyIso < estimation.period_from ? estimation.period_from : hoyIso }
  const hoja = armarHoja({ project, estimation: estDocs, disciplines, items, summary, rates })
  // Conceptos para llenar el formato propio del cliente (Tec, STIVA…)
  const conceptosCliente = disciplines.flatMap(d => (d.concepts || []).map(c => {
    const monto = amountOf(c, d)
    return { clave: c.key, disciplina: d.sort_order, monto,
      anterior: monto > 0 ? (acumMap[c.id] || 0) / monto : 0,
      esta: monto > 0 ? thisEstAmount(items[c.id], c, d) / monto : 0 }
  }))
  const periodo = { from: estDocs.period_from, to: estDocs.period_to }
  conceptosClienteRef.current = conceptosCliente

  async function toggleArea(a) {
    if (areaStatus[a]) {
      const { error } = await quitarAreaLista(estimation.id, a)
      if (error) { toast('No se pudo: ' + error.message, true); return }
      const { [a]: _, ...resto } = areaStatus
      areaStatusRef.current = resto; setAreaStatus(resto)
    } else {
      await guardarPendientes()
      const { fila, error } = await marcarAreaLista(estimation.id, a, profile)
      if (error) { toast('No se pudo: ' + error.message, true); return }
      const nuevo = { ...areaStatus, [a]: fila }
      areaStatusRef.current = nuevo; setAreaStatus(nuevo)
      toast(`${a} marcada como lista ✓`)
    }
  }

  const estNumLabel = `#${String(estimation.number).padStart(3, '0')}`
  // Candados: una estimación en $0 no debe enviarse por descuido, y el borrador no debe ir adelantado al mes actual
  const nombreMes = ym => { const [y, m] = (ym || '').split('-').map(Number); return y ? new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }) : '' }
  const mesBorrador = estimation.status === 'Borrador' ? mesDelPeriodo(estimation.period_from, estimation.period_to) : ''
  const mesHoy = fechaLocal(new Date()).slice(0, 7)
  const borradorAdelantado = !!mesBorrador && mesBorrador > mesHoy
  const avisoEnvioVacio = currentTotal > 0.005 ? '' :
    `<p style="color:var(--danger);margin-bottom:8px"><strong>Esta estimación no tiene ningún concepto cobrado ($0).</strong> Si la envías, el mes queda cerrado en ceros y el siguiente borrador pasa al mes que sigue. Envíala vacía solo si de verdad no se cobra nada este mes.</p>`
  const monthOpts = monthOptions(mesDelPeriodo(estimation.period_from, estimation.period_to), project.start_date, project.end_date)

  return (
    <div className="main">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <a onClick={() => navigate('/proyectos')}>Mis Proyectos</a>
        <span className="sep">›</span>
        <a onClick={() => navigate(`/projects/${id}/setup`)}>{project.name}</a>
        <span className="sep">›</span>
        <span className="current">Estimación {estNumLabel}</span>
      </div>

      {/* Banner readonly */}
      {readonly && (
        <div className="readonly-banner no-print">
          <span>{soloLectura && estimation.status !== 'Enviada'
            ? (ajeno ? <>👁 {AVISO_AJENO}</> : <>👁 Tienes acceso de <strong>solo lectura</strong> a esta estimación.</>)
            : <>📋 Esta estimación está marcada como <strong>{estimation.status}</strong> y no puede editarse.</>}</span>
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
            <button className="btn btn-outline" onClick={async () => { await guardarPendientes(); toast('Borrador guardado ✓') }}>Guardar borrador</button>
            {perms.todo && <button className="btn btn-primary" onClick={() => setModal({
              title: '✉ Marcar Estimación como Enviada',
              body: avisoEnvioVacio + (areasPendientes.length ? `<p style="color:var(--danger)"><strong>Ojo:</strong> faltan por marcar como listas: ${areasPendientes.join(', ')}.</p>` : '') +
                '<p>Una vez marcada como <strong>Enviada</strong>, la estimación no podrá editarse.</p><p style="margin-top:8px;color:var(--text-muted)">¿Confirmas que deseas marcarla como Enviada?</p>',
              onConfirm: markSent,
            })}>Marcar como Enviada</button>}
          </>}
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/setup`)}>⚙ Configuración</button>
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/history`)}>📋 Historial</button>
        </div>
      </div>

      {/* Pill estado */}
      <div style={{ marginBottom: 16 }} className="no-print">
        <span className={`status-pill${saving ? ' dirty' : ''}`}>{saving ? 'Guardando...' : 'Guardado'}</span>
      </div>

      {/* Tabs */}
      <div className="tabs no-print">
        <div className={`tab${activeTab === 'estimation' ? ' active' : ''}`} onClick={() => setActiveTab('estimation')}>Estimación</div>
        <div className={`tab${activeTab === 'report' ? ' active' : ''}`} onClick={() => setActiveTab('report')}>Reporte Mensual</div>
        <div className={`tab${activeTab === 'cliente' ? ' active' : ''}`} onClick={() => setActiveTab('cliente')}>Hoja para cliente</div>
      </div>

      {/* Cierre del mes: cada área marca su avance como listo */}
      {estimation.status === 'Borrador' && activeTab !== 'cliente' && areasAplican.length > 0 && (
        <div className="card mb-md no-print" style={{ borderLeft: `4px solid ${todasListas ? 'var(--green)' : diasParaCorte(corte) < 0 ? 'var(--danger)' : 'var(--warning)'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--navy)' }}>Cierre del mes</div>
              <div style={{ fontSize: 12, color: diasParaCorte(corte) < 0 && !todasListas ? 'var(--danger)' : 'var(--text-muted)' }}>
                Corte: {fmtCorte(corte)} · {textoCorte(corte)}
              </div>
            </div>
            {perms.todo && (
              <button className="btn btn-primary" disabled={!todasListas} onClick={() => setActiveTab('cliente')}
                title={todasListas ? '' : `Falta: ${areasPendientes.join(', ')}`}>
                {todasListas ? '📄 Generar estimación para cliente' : `Faltan ${areasPendientes.length} área${areasPendientes.length > 1 ? 's' : ''}`}
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${areasAplican.length}, 1fr)`, gap: 8 }}>
            {areasAplican.map(a => {
              const st = areaStatus[a]
              return (
                <div key={a} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 10px', background: st ? 'var(--green-soft)' : 'var(--surface)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: st ? 'var(--green-dark)' : 'var(--text-soft)' }}>{st ? '✓' : '⏳'} {a}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 6px' }}>
                    {st ? `Lista · ${(st.listo_nombre || st.listo_por).split(' ')[0]} · ${new Date(st.listo_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}` : 'Pendiente'}
                  </div>
                  {puedeMarcar(a) && (
                    <button className={`btn btn-sm ${st ? 'btn-outline' : 'btn-primary'}`} onClick={() => toggleArea(a)}>
                      {st ? 'Quitar "lista"' : 'Mi área está lista'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── TAB: ESTIMACIÓN ─────────────────────────────────────── */}
      {activeTab === 'estimation' && (
        <div className={readonly ? 'readonly' : ''}>
          {/* Periodo */}
          <div className="card mb-md">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
              <div className="field">
                <label>Número de estimación</label>
                <input value={estimation.number} disabled />
              </div>
              <div className="field">
                <label>Mes de estimación</label>
                <select disabled value={monthOpts.find(o => o.selected)?.value || ''} onChange={e => changeMonth(e.target.value)} style={{ fontSize: 13 }} title="Sale del inicio del periodo">
                  <option value="">— Seleccionar mes —</option>
                  {monthOpts.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Inicio del periodo 🔒</label>
                <input value={estimation.period_from ? fmtDate(estimation.period_from) : '—'} disabled
                  title="Fecha en que se envió la estimación anterior" />
              </div>
              <div className="field">
                <label>Fin del periodo{estimation.status === 'Enviada' ? ' 🔒' : ''}</label>
                <input value={estimation.status === 'Enviada'
                  ? (estimation.period_to ? fmtDate(estimation.period_to) : '—')
                  : 'Se fija al enviar'} disabled
                  title={estimation.status === 'Enviada' ? 'Fecha en que se envió esta estimación' : 'Se pone sola con la fecha del día en que se marque como Enviada'} />
              </div>
              <div className="field">
                <label>Estado</label>
                <input value={estimation.status} disabled />
              </div>
            </div>
          </div>

          {borradorAdelantado && (
            <div className="card mb-md no-print" style={{ borderLeft: '4px solid var(--danger)', padding: '10px 16px', fontSize: 13 }}>
              <strong>Este borrador es de {nombreMes(mesBorrador)}, pero el mes en curso es {nombreMes(mesHoy)}.</strong>{' '}
              Lo proyectado que ves abajo es de ese mes posterior. Revisa en el{' '}
              <button className="btn-link-mini" onClick={() => navigate(`/projects/${id}/history`)}>Historial</button>{' '}
              si una estimación anterior quedó enviada vacía.
            </div>
          )}

          {/* Lo proyectado para este mes: lista compacta con su estado y botón para marcar */}
          {estimation.status === 'Borrador' && proyectados.lista.length > 0 && (() => {
            const faltan = porMarcar()
            const total = proyectados.lista.reduce((x, p) => x + (+p.monto || 0), 0)
            const conceptoDe = cid => { for (const d of disciplines) { const c = d.concepts.find(c => c.id === cid); if (c) return c } return null }
            const estado = p => {
              if (!p.concept_id) return ['Sin concepto ligado', 'var(--text-soft)']
              if (items[p.concept_id]?.included) return ['✓ Marcado', 'var(--green-dark)']
              if (!proyectados.pendientes.has(p.concept_id)) return ['Ya cobrado', 'var(--text-soft)']
              if (!proyectados.libres.has(p.concept_id)) return ['Ya se cobró una parte', 'var(--warning)']
              return ['Por marcar', 'var(--text-muted)']
            }
            const colorArea = { 'Consultoría': '#2a78d6', 'Commissioning': '#eb6834', 'Modelación': '#1baf7a' }
            return (
              <div className="card mb-md no-print proyectados-mes" style={{ borderLeft: '4px solid var(--green)', padding: '10px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>
                    <strong>Proyectado para este mes:</strong> {proyectados.lista.length} {proyectados.lista.length === 1 ? 'concepto' : 'conceptos'} · {fmtMoney(total, project.currency)}
                    {faltan.length > 0 ? <span style={{ color: 'var(--text-muted)' }}> · {faltan.length} sin marcar</span> : <span style={{ color: 'var(--green-dark)' }}> · todo marcado ✓</span>}
                  </span>
                  <span className="flex gap-sm">
                    {faltan.length > 0 && !readonly && <button className="btn btn-sm btn-primary" onClick={marcarProyectados}>Marcar los proyectados</button>}
                    <button className="btn btn-sm btn-outline" onClick={() => navigate(`/projects/${id}/proyecciones`)}>Ver proyecciones</button>
                  </span>
                </div>
                <table className="tabla-proyectados">
                  <tbody>
                    {proyectados.lista.map(p => {
                      const c = p.concept_id && conceptoDe(p.concept_id)
                      const [txt, color] = estado(p)
                      const texto = c ? c.description : p.descripcion
                      return (
                        <tr key={p.id}>
                          <td className="clave">{c ? c.key : ''}</td>
                          <td className="desc" title={texto}>{texto || '—'}</td>
                          <td className="area"><span style={{ background: colorArea[p.area] }} />{p.area}</td>
                          <td className="num">{p.tbd && !(+p.monto > 0) ? 'Por definir' : fmtMoney(p.monto, project.currency)}</td>
                          <td className="estado" style={{ color }}>{txt}</td>
                          <td className="accion">{!readonly && txt === 'Por marcar' && <button className="btn-link-mini" onClick={() => marcarConcepto(p.concept_id)}>Marcar</button>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })()}

          {/* Resumen Financiero */}
          <div className="section">
            <div className="section-header">
              <div className="section-title">Resumen Financiero</div>
              <span className="muted" style={{ fontSize: 11 }}>Moneda: {project.currency}</span>
            </div>
            <div className="summary-grid">
              <StatBox label="Importe Total" value={fmtMoney(totals.conDescuento, project.currency)} />
              <StatBox label={`Anticipo (${fmtPct(rates.anticipoPct)})`} value={fmtMoney(totals.anticipo, project.currency)} muted />
              <StatBox label={`Finiquito (${fmtPct(rates.finiquitoPct)})`} value={fmtMoney(totals.finiquito, project.currency)} muted />
              <StatBox label={`Importe Estimable (${fmtPct(100 - rates.anticipoPct - rates.finiquitoPct)})`} value={fmtMoney(totals.estimable, project.currency)} green />
              <StatBox label="Acumulado Anterior" value={fmtMoney(acumAnterior, project.currency)} muted />
              <StatBox label="Esta Estimación" value={fmtMoney(currentTotal, project.currency)} green />
              <StatBox label="Acumulado Global" value={fmtMoney(acumGlobal, project.currency)} />
              <StatBox label="Por Estimar" value={fmtMoney(porEstimar, project.currency)} muted />
              {totals.finiquito > 0 && (
                <StatBox label="Finiquito por Cobrar" value={fmtMoney(summary.finiquitoPorCobrar, project.currency)} muted />
              )}
            </div>
          </div>

          {/* KPIs de avance */}
          <div className="section">
            <div className="section-header"><div className="section-title">Avance del Proyecto</div></div>
            <div className="kpi-row" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 10 }}>
              <KpiBox label="Esta Estimación" pct={advanceThis} />
              <KpiBox label="Avance Global del Proyecto" pct={advanceGlobal} />
            </div>
            <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 10 }}>
              {AREAS.map(a => {
                const av = summary.areaAvance[a]
                return (
                  <div key={a} className={`kpi-box${av ? '' : ' inactive'}`}>
                    <div className="kpi-label">% Avance {a}</div>
                    <div className="kpi-value">{av ? fmtPct(av.pct) : '—'}</div>
                    <div className="progress"><div className="progress-bar" style={{ width: `${av ? Math.min(100, av.pct) : 0}%` }} /></div>
                    {!av && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>No aplica</div>}
                  </div>
                )
              })}
            </div>
            <div className="kpi-row">
              {disciplines.map(d => {
                const s = disciplineSubtotal(d, rates)
                const active = s.conDesc > 0 || (hasFiniquitoConcepts(d) && totals.finiquito > 0)
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
              const s = disciplineSubtotal(d, rates)
              if (s.conDesc === 0 && !(hasFiniquitoConcepts(d) && totals.finiquito > 0)) {
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
              const ro = !puedeEditar(d)
              return (
                <div key={d.id} className="discipline-block">
                  <div className="discipline-header">
                    <div className="discipline-name">
                      {d.name}
                      {ro && !readonly && <span style={{ fontSize: 10, fontWeight: 600, background: 'var(--surface-2)', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 99, marginLeft: 8 }}>🔒 Lo captura {disciplineArea(d) || 'el líder'}</span>}
                    </div>
                    <div className="discipline-stats">
                      <span>{s.conDesc === 0 && hasFiniquitoConcepts(d)
                        ? <>Finiquito: <strong>{fmtMoney(totals.finiquito, project.currency)}</strong></>
                        : <>Estimable: <strong>{fmtMoney(s.estimable, project.currency)}</strong></>}</span>
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
                          const monto = amountOf(c, d)
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
                                <input type="checkbox" checked={!!item.included} disabled={ro}
                                  onChange={e => scheduleItemSave(c.id, { ...item, included: e.target.checked }, d, c)} />
                                {tieneParcialPendiente && <div style={{ fontSize: 9, color: 'var(--warning)', marginTop: 2, textAlign: 'center' }}>Pendiente</div>}
                              </td>
                              {/* Clave */}
                              <td>
                                <strong>{c.key}</strong>
                                {isFiniquito && <span className="tag-finiquito">FIN</span>}
                                {proyectados.ids.has(c.id) && <span title="Proyectado para este mes" style={{ display: 'inline-block', fontSize: 10, background: 'var(--green-soft)', color: 'var(--green-dark)', padding: '1px 6px', borderRadius: 3, marginLeft: 4, fontWeight: 600 }}>Proyectado</span>}
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
                                      disabled={ro || tieneParcialPendiente}
                                      style={{ accentColor: 'var(--warning)' }}
                                      onChange={e => scheduleItemSave(c.id, { ...item, parcial_enabled: e.target.checked, pct_parcial: e.target.checked ? (item.pct_parcial || pctDisponible) : 0 }, d, c)} />
                                    {item.parcial_enabled || tieneParcialPendiente ? '🔶 Parcial' : 'Parcial'}
                                  </label>
                                  {(item.parcial_enabled || tieneParcialPendiente) && item.included && (
                                    <>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <input type="number" step="1" min="0" max={pctDisponible}
                                          value={Math.round((item.pct_parcial || 0) * 10) / 10}
                                          disabled={ro}
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
                                  <input type="checkbox" checked={!!item.delayed} disabled={ro}
                                    onChange={e => scheduleItemSave(c.id, { ...item, delayed: e.target.checked }, d, c)} />
                                  ¿Atraso?
                                </label>
                                {item.delayed && (
                                  <input placeholder="Causa" value={item.cause || ''} disabled={ro}
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

          {/* Botón continuar (el reporte mensual lo capturan todos) */}
          {(
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }} className="no-print">
              <button className="btn btn-primary" style={{ fontSize: 14, padding: '10px 24px' }} onClick={() => { if (!readonly) toast('Borrador guardado ✓'); setActiveTab('report') }}>
                {readonly ? 'Ir al Reporte Mensual →' : 'Guardar y continuar → Reporte Mensual'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: REPORTE MENSUAL ─────────────────────────────────── */}
      {activeTab === 'cliente' && (
        <div>
          <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: areasPendientes.length && estimation.status === 'Borrador' ? 'var(--danger)' : 'var(--text-muted)' }}>
              {estimation.status === 'Enviada' ? 'Estimación enviada.'
                : areasPendientes.length ? `Vista previa: falta que marquen como lista ${areasPendientes.join(', ')}.`
                : 'Todas las áreas están listas. Revisa y descarga.'}
            </div>
            <div className="flex" style={{ gap: 8 }}>
              <button className="btn btn-outline" onClick={() => descargarExcel(hoja).catch(e => toast('No se pudo generar el Excel: ' + e.message, true))}>⬇ Descargar Excel</button>
              <button className="btn btn-outline" onClick={() => imprimirHoja(hoja)}>📄 Imprimir / PDF</button>
              <button className="btn btn-outline" title="Solo los conceptos cobrados en esta estimación" onClick={() => descargarBreve(hoja, equipo.lider).catch(e => toast('No se pudo generar el Excel breve: ' + e.message, true))}>⬇ Excel breve</button>
              <button className="btn btn-outline" title="Solo los conceptos cobrados en esta estimación" onClick={() => imprimirBreve(hoja)}>📄 PDF breve</button>
              {estimation.status === 'Borrador' && perms.todo && (
                <button className="btn btn-primary" onClick={() => setModal({
                  title: '✉ Marcar Estimación como Enviada',
                  body: avisoEnvioVacio + (areasPendientes.length ? `<p style="color:var(--danger)"><strong>Ojo:</strong> faltan por marcar como listas: ${areasPendientes.join(', ')}.</p>` : '') +
                    '<p>Una vez marcada como <strong>Enviada</strong>, la estimación no podrá editarse.</p>',
                  onConfirm: markSent,
                })}>Marcar como Enviada</button>
              )}
            </div>
          </div>
          <FormatosCliente project={project} conceptos={conceptosCliente} periodo={periodo} puedeAdministrar={perms.todo && !soloLectura} />
          <div className="no-print" style={{ display: 'flex', gap: 6, margin: '4px 0 10px' }}>
            <button className={`btn btn-sm ${vistaCliente === 'completa' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setVistaCliente('completa')}>Hoja completa (RC-OP-11)</button>
            <button className={`btn btn-sm ${vistaCliente === 'breve' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setVistaCliente('breve')}>Versión breve</button>
          </div>
          {vistaCliente === 'completa' && <HojaCliente hoja={hoja} />}
          <div className={vistaCliente === 'breve' ? '' : 'eb-oculta'}>
            <EstimacionBreve hoja={hoja} elaboradoPor={equipo.lider} />
          </div>
        </div>
      )}

      {activeTab === 'report' && (() => {
        const rpt = (areaRpt && reportes[areaRpt]) || { area: areaRpt }
        // Todos capturan el reporte mensual (no solo los asignados al proyecto); solo el rol de lectura lo ve sin editar
        const reportReadonly = estimation.report_sent === true || isReadOnlyRole(profile)
        const reportHeredado = rpt._heredado
        const areasRpt = areasDelReporte(disciplines)
        const estadoRpt = a => (reportes[a]?.listo ? 'listo' : reportes[a]?.id ? 'captura' : 'vacio')
        const listos = areasRpt.filter(a => estadoRpt(a) === 'listo')
        const todosListos = listos.length === areasRpt.length
        const rd = key => rpt[key] || []
        const mesRpt = mesDelPeriodo(estimation.period_from, estimation.period_to)
        const mesReporteTxt = mesRpt ? `${MESES[Number(mesRpt.slice(5, 7)) - 1]} ${mesRpt.slice(0, 4)}` : '—'
        // Acciones agrupadas por área (Consultoría, Comisionamiento, Modelado energético), como en el formato
        const ordenArea = Object.fromEntries(AREAS_REPORTE.map(([a], i) => [a, i]))
        const accionesOrdenadas = rd('acciones_realizadas').map((r, i) => [r, i])
          .sort((x, y) => (ordenArea[x[0].area || 'Consultoría'] - ordenArea[y[0].area || 'Consultoría']) || x[1] - y[1]).map(x => x[0])
        const excelDeArea = async (a, logoCliente) => {
          const r = reportes[a] || { area: a }
          await descargarReporteExcel({
            proyecto: project.name, cliente: project.client, numero: estimation.number, periodFrom: estimation.period_from, periodTo: estimation.period_to, equipo,
            area: a, logoCliente,
            rpt: { ...r, inicio_contrato: r.inicio_contrato || project.start_date, fin_contrato: r.fin_contrato || project.end_date },
          })
        }
        const bajarReporteExcel = async () => {
          try { await excelDeArea(areaRpt, await leerLogoCliente(project)) } catch (err) { toast('No se pudo generar el Excel: ' + err.message, true) }
        }
        const bajarLosReportes = async () => {
          try {
            const logo = await leerLogoCliente(project)
            for (const a of areasRpt) { await excelDeArea(a, logo); await new Promise(r => setTimeout(r, 400)) }
            toast(`${areasRpt.length} reportes descargados ✓`)
          } catch (err) { toast('No se pudo generar el Excel: ' + err.message, true) }
        }

        return (
          <div className={reportReadonly ? 'readonly' : ''}>

            {/* Un reporte por área; el líder descarga todos cuando están listos */}
            <div className="card mb-md no-print rpt-areas">
              <div className="rpt-areas-cab">
                <div>
                  <div className="section-title">Reporte mensual por área</div>
                  <div className="rpt-areas-sub">Cada área llena el suyo y lo marca como listo. {areasRpt.length > 1 ? `El líder descarga los ${areasRpt.length} cuando estén listos.` : ''}</div>
                </div>
                {perms.todo && areasRpt.length > 1 && (
                  <div className="rpt-lider">
                    <span>{listos.length} de {areasRpt.length} listos</span>
                    <button className="btn btn-primary btn-sm" disabled={!todosListos} onClick={bajarLosReportes}
                      title={todosListos ? 'Descarga el Excel RC-OP-01 de cada área' : `Falta: ${areasRpt.filter(a => estadoRpt(a) !== 'listo').map(a => ETIQUETA_AREA[a]).join(', ')}`}>
                      ⬇ Descargar los {areasRpt.length}
                    </button>
                  </div>
                )}
              </div>
              <div className="rpt-areas-fila" role="tablist">
                {areasRpt.map(a => {
                  const e = estadoRpt(a)
                  return (
                    <button key={a} role="tab" aria-selected={areaRpt === a} className={`rpt-area ${e}${areaRpt === a ? ' sel' : ''}`} onClick={() => cambiarAreaRpt(a, true)}>
                      <span className="nom">{ETIQUETA_AREA[a]}</span>
                      <span className="est">{e === 'listo' ? `✓ Listo${reportes[a]?.listo_por ? ` · ${reportes[a].listo_por}` : ''}` : e === 'captura' ? 'En captura' : 'Sin empezar'}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Banner enviado */}
            {reportReadonly && (
              <div className="readonly-banner" style={{ background: 'var(--green-soft)', color: 'var(--green-dark)', borderColor: '#86EFAC' }}>
                <span>📋 Reporte marcado como <strong>Enviado</strong> el {fmtDate((estimation.report_sent_at || '').slice(0, 10))}. Solo lectura.</span>
                <span className="flex" style={{ gap: 6 }}>
                  <button className="btn btn-sm btn-outline" onClick={bajarReporteExcel}>⬇ Excel RC-OP-01</button>
                  <button className="btn btn-sm btn-outline" onClick={() => window.print()}>📄 Imprimir / PDF</button>
                </span>
              </div>
            )}

            {reportHeredado && !reportReadonly && (
              <div className="readonly-banner no-print" style={{ background: '#EFF6FF', color: '#1D4ED8', borderColor: '#BFDBFE' }}>
                <span>{reportHeredado === 'general'
                  ? `Este reporte arrancó con lo que ya se había capturado en el reporte general de esta estimación (encabezado, pendientes, riesgos, entregables y las acciones de ${ETIQUETA_AREA[areaRpt]}). Deja solo lo de tu área.`
                  : `Se copió del reporte de la estimación #${String(reportHeredado).padStart(3, '0')} lo que sigue vigente: encabezado, pendientes, información pendiente, riesgos, entregables y resumen. Revísalo, deja solo lo de ${ETIQUETA_AREA[areaRpt]} y actualízalo; las acciones del mes empiezan vacías.`}</span>
              </div>
            )}

            {/* Datos del Proyecto */}
            <div className="card mb-md">
              <div className="section-header"><div className="section-title">Datos del Proyecto</div></div>
              <div className="grid grid-3">
                <div className="field"><label>Proyecto</label><input value={project.name} disabled /></div>
                <div className="field"><label>Cliente</label><input value={project.client} disabled /></div>
                <div className="field"><label>Ubicación</label><input value={project.location || '—'} disabled /></div>
                <div className="field"><label>Mes</label><input value={mesReporteTxt} disabled /></div>
                <div className="field"><label>Área del reporte</label><input value={ETIQUETA_AREA[areaRpt] || '—'} disabled /></div>
                <div className="field"><label>Estimación</label><input value={`#${String(estimation.number).padStart(3, '0')}`} disabled /></div>
                <div className="field"><label>% global de avance documental</label>
                  <input type="number" min="0" max="100" step="0.1" value={rpt.avance_documental ?? ''} readOnly={reportReadonly} placeholder="0 – 100"
                    onChange={e => scheduleReportSave({ avance_documental: e.target.value === '' ? null : Math.min(100, Math.max(0, Number(e.target.value))) })} /></div>
                <div className="field"><label>Fase</label>
                  <input value={rpt.fase_texto ?? ''} readOnly={reportReadonly} placeholder={project.phase ? `p. ej. ${project.phase}` : 'p. ej. Diseño / Construcción'}
                    onChange={e => scheduleReportSave({ fase_texto: e.target.value })} /></div>
                <div className="field"><label>Estado de proyecto</label>
                  <input value={rpt.estado_proyecto ?? ''} readOnly={reportReadonly} placeholder="p. ej. En tiempo / Con atraso"
                    onChange={e => scheduleReportSave({ estado_proyecto: e.target.value })} /></div>
                <div className="field"><label>Cliente responsable</label>
                  <input value={rpt.cliente_responsable ?? ''} readOnly={reportReadonly} placeholder={project.client_contact_name || 'Nombre del contacto'}
                    onChange={e => scheduleReportSave({ cliente_responsable: e.target.value })} /></div>
                <div className="field"><label>Inicio de fase</label>
                  <input type="date" value={rpt.inicio_fase || ''} readOnly={reportReadonly} onChange={e => scheduleReportSave({ inicio_fase: e.target.value || null })} /></div>
                <div className="field"><label>Finalización de fase</label>
                  <input type="date" value={rpt.fin_fase || ''} readOnly={reportReadonly} onChange={e => scheduleReportSave({ fin_fase: e.target.value || null })} /></div>
                <div className="field"><label>Inicio de contrato</label>
                  <input type="date" value={rpt.inicio_contrato || project.start_date || ''} readOnly={reportReadonly} onChange={e => scheduleReportSave({ inicio_contrato: e.target.value || null })} /></div>
                <div className="field"><label>Finalización de contrato</label>
                  <input type="date" value={rpt.fin_contrato || project.end_date || ''} readOnly={reportReadonly} onChange={e => scheduleReportSave({ fin_contrato: e.target.value || null })} /></div>
              </div>
              <div className="section-title" style={{ fontSize: 13, margin: '14px 0 6px' }}>Distribución</div>
              <div className="grid grid-3">
                <div className="field"><label>Líder de proyecto</label><input value={equipo.lider || '—'} disabled /></div>
                <div className="field"><label>Autoridad Cx</label><input value={equipo.cx || '—'} disabled /></div>
                <div className="field"><label>Modelación energética</label><input value={equipo.me || '—'} disabled /></div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }} className="no-print">El equipo sale de la tarjeta del proyecto (Configuración → Equipo).</div>
              <LogoCliente project={project} puedeCambiar={perms.todo && !soloLectura} onCambio={logo_cliente => setProject(p => ({ ...p, logo_cliente }))} />
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
                    <th style={{ width: 150 }}>Área</th>
                    <th style={{ width: 180 }}>Tarea (Task)</th>
                    <th>Descripción</th>
                    <th style={{ width: 120 }}>Fecha (opcional)</th>
                    {!reportReadonly && <th className="row-actions"></th>}
                  </tr>
                </thead>
                <tbody>
                  {rd('acciones_realizadas').length === 0
                    ? <tr><td colSpan={reportReadonly ? 5 : 6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>Sin acciones registradas</td></tr>
                    : accionesOrdenadas.map((row, i) => {
                        const lines = (row.descripcion || '').split('\n').filter(l => l.trim())
                        return (
                          <tr key={row.id}>
                            <td className="row-num">{i + 1}</td>
                            <td>
                              <span style={{ fontSize: 12 }}>{ETIQUETA_AREA[row.area || areaRpt || 'Consultoría']}</span>
                            </td>
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
              {(!reportReadonly || (rpt.nota_info_pendiente || '').trim()) && (
                <div className="field" style={{ marginTop: 10 }}>
                  <label>Nota general</label>
                  <textarea value={rpt.nota_info_pendiente || ''} readOnly={reportReadonly} rows={2} placeholder="Comentario general sobre la información pendiente (opcional)"
                    style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'inherit', fontSize: 12, resize: 'vertical' }}
                    onChange={e => scheduleReportSave({ nota_info_pendiente: e.target.value })} />
                </div>
              )}
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
                        <th style={{ width: 220 }}>Prerrequisitos / créditos en incumplimiento</th>
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

            {/* Resumen del proyecto */}
            <div className="card mb-md">
              <div className="section-header">
                <div>
                  <div className="section-title">Resumen del Proyecto</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Hitos del proyecto con su fecha. Se acumulan mes con mes.</div>
                </div>
                {!reportReadonly && <button className="btn btn-outline btn-sm" onClick={() => addReportRow('resumen_proyecto')}>+ Hito</button>}
              </div>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th className="row-num">N°</th>
                    <th>Hito</th>
                    <th style={{ width: 140 }}>Fecha</th>
                    {!reportReadonly && <th className="row-actions"></th>}
                  </tr>
                </thead>
                <tbody>
                  {rd('resumen_proyecto').length === 0
                    ? <tr><td colSpan={reportReadonly ? 3 : 4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>Sin hitos registrados</td></tr>
                    : rd('resumen_proyecto').map((row, i) => (
                        <tr key={row.id}>
                          <td className="row-num">{i + 1}</td>
                          <td><input value={row.hito || ''} readOnly={reportReadonly} onChange={e => updateReportRow('resumen_proyecto', row.id, 'hito', e.target.value)} /></td>
                          <td><input type="date" value={row.fecha || ''} readOnly={reportReadonly} onChange={e => updateReportRow('resumen_proyecto', row.id, 'fecha', e.target.value)} /></td>
                          {!reportReadonly && <td className="row-actions"><button className="btn btn-ghost btn-xs" onClick={() => removeReportRow('resumen_proyecto', row.id)}>✕</button></td>}
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
                  <button className="btn btn-outline" onClick={bajarReporteExcel}>⬇ Excel RC-OP-01</button>
                  <button className="btn btn-dark" onClick={() => window.print()}>📄 Generar PDF</button>
                  {rpt.listo
                    ? <button className="btn btn-outline" onClick={() => marcarReporteListo(false)}>↩ Regresar a captura</button>
                    : <button className="btn btn-primary" onClick={() => marcarReporteListo(true)}>✓ Marcar {ETIQUETA_AREA[areaRpt]} como listo</button>}
                  {perms.todo && <button className="btn btn-primary" style={{ fontSize: 14, padding: '10px 24px' }} onClick={() => setModal({
                    title: '✉ Marcar Reporte como Enviado',
                    body: '<p>Una vez marcado como <strong>Enviado</strong>, el reporte no podrá editarse.</p><p style="margin-top:8px;color:var(--text-muted)">¿Confirmas que deseas marcarlo como Enviado?</p>',
                    onConfirm: markReportSent,
                  })}>✉ Marcar como Enviado</button>}
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

// Imprime la versión breve (carta vertical, solo los conceptos cobrados en esta estimación).
function imprimirBreve(hoja) {
  const body = document.body
  const titulo = document.title
  const fin = () => { body.classList.remove('imprimiendo-breve'); document.title = titulo; window.removeEventListener('afterprint', fin) }
  body.classList.add('imprimiendo-breve')
  document.title = nombreBreve(hoja)
  window.addEventListener('afterprint', fin)
  window.print()
  setTimeout(fin, 1000)
}

// Imprime solo la hoja RC-OP-11 (doble carta horizontal, como el Excel) y no la pantalla completa.
// El nombre del PDF sale como el del Excel: "521-Estimación 17".
function imprimirHoja(hoja) {
  const body = document.body
  const titulo = document.title
  const fin = () => { body.classList.remove('imprimiendo-hoja'); document.title = titulo; window.removeEventListener('afterprint', fin) }
  body.classList.add('imprimiendo-hoja')
  document.title = `${(hoja.proyecto || '').split(/[-_]/)[0]}-Estimación ${hoja.numero}`
  window.addEventListener('afterprint', fin)
  window.print()
  setTimeout(fin, 1000)
}

