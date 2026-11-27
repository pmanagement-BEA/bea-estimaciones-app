// Reporte de desempeño (general, por área e individual). Solo coordinadores, PMO y CEO (public.ve_desempeno()).
// Todo sale de lo que ya vive en la app: estimaciones (lo cobrado), proyecciones (lo prometido),
// Track (horas: histórico de Toggl + registros nuevos) y el directorio (área de cada persona).
import { supabase } from './supabase'
import { todas, cargarHistorico, cargarRegistros, duracionMs, mesDe, esIndirecto, H } from './track'
import { AREAS, estimationSummary, projectRates, disciplineSubtotal } from '../utils/calculations.js'
import { prepararProyecto, estimadoPorMes, estimadoPorConcepto, conceptosPorEstimar, responsables, nombreCorto, sumarMeses, mesIso } from './proyecciones.js'
import { mesDelPeriodo } from '../utils/cierre.js'
import { cargarPresupuestoHH } from './desempenoDetalle.js'

export { AREAS }
export const MESES_TENDENCIA = 12
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const lower = s => String(s || '').toLowerCase().trim()

/** ¿La persona que entró puede ver el reporte? */
export async function puedeVerDesempeno() {
  const { data, error } = await supabase.rpc('ve_desempeno')
  return !error && data === true
}

/** Días hábiles (lunes a viernes) de un mes, hasta hoy si es el mes en curso. */
export function diasHabiles(mes, hoy = new Date()) {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  const tope = mesIso(hoy) === mes ? hoy.getDate() : ultimo
  let n = 0
  for (let d = 1; d <= tope; d++) { const w = new Date(y, m - 1, d).getDay(); if (w && w < 6) n++ }
  return n
}

/** Trae todo lo necesario para el reporte (una sola vez; los cálculos son en memoria). */
export async function cargarDesempeno(mes) {
  const desde = sumarMeses(mes, -(MESES_TENDENCIA - 1))
  const finMes = sumarMeses(mes, 1) + '-01'
  const ultimoDia = new Date(new Date(finMes + 'T12:00:00').getTime() - 86400000).toISOString().slice(0, 10)
  const [proj, proy, miembros, dir, tps, hist, regs, presupuesto, historicoAct, overrides] = await Promise.all([
    supabase.from('projects').select('*, disciplines (*, concepts(*)), estimations (*, estimation_items(*))'),
    todas(() => supabase.from('proyecciones').select('id, project_id, mes, area, monto, tbd, concept_id')),
    supabase.from('project_members').select('project_id, rol, email'),
    supabase.from('directorio').select('*'),
    todas(() => supabase.from('track_proyectos').select('*')),
    cargarHistorico({ mesDesde: desde, mesHasta: mes }).catch(() => []),
    cargarRegistros({ desde: desde + '-01', hasta: ultimoDia }).catch(() => []),
    cargarPresupuestoHH(),
    // Histórico de Toggl por actividad (persona · actividad · mes); si la tabla no existe, vacío
    todas(() => supabase.from('track_historico_act').select('mes, actividad_id, email, segundos, track_actividades(proyecto_id, nombre)')
      .gte('mes', desde).lte('mes', mes)).catch(() => []),
    // Correcciones manuales del ligado actividad → concepto
    todas(() => supabase.from('track_actividad_concepto').select('*')).catch(() => []),
  ])
  for (const r of [proj, miembros, dir]) if (r.error) throw r.error
  return { mes, projects: proj.data || [], proyecciones: proy, miembros: miembros.data || [], directorio: dir.data || [], tps, historico: hist, registros: regs, presupuesto, historicoAct, overrides }
}

// Suma de dinero por moneda: { MXN: n, USD: n }
const sumar = (acc, moneda, v) => { if (v) acc[moneda || 'MXN'] = (acc[moneda || 'MXN'] || 0) + v; return acc }

/**
 * Calcula todo el reporte para un mes. Devuelve:
 * { proyectos, personas, areas, tendencia, atrasos, alertas, totales }
 */
export function calcularDesempeno(datos, hoy = new Date()) {
  const { mes, projects, proyecciones, miembros, directorio, tps, historico, registros } = datos
  const mesHoy = mesIso(hoy)
  const meses = Array.from({ length: MESES_TENDENCIA }, (_, i) => sumarMeses(mes, i - MESES_TENDENCIA + 1))
  const habiles = diasHabiles(mes, hoy)

  // ── Directorio: persona por correo y por nombre (el histórico de Toggl a veces no trae correo)
  const porEmail = {}, porNombre = {}
  for (const d of directorio) { porEmail[lower(d.email)] = d; porNombre[norm(d.nombre)] = d }
  const nombrePorEmail = Object.fromEntries(directorio.map(d => [lower(d.email), d.nombre]))
  const persona = (email, nombre) => porEmail[lower(email)] || porNombre[norm(nombre)] || null
  const tpPorId = new Map(tps.map(t => [String(t.id), t]))

  // ── Horas: { clave persona: { nombre, email, area, meses: { mes: { total, indirectas, porProyecto: { tpId: h } } } } }
  const gente = {}
  const horasProyMes = {} // tpId → { mes: h }
  const sinConcepto = [] // registros del mes en proyectos facturables sin concepto del contrato
  function sumarHoras(email, nombre, tpId, m, h) {
    if (!(h > 0)) return
    const d = persona(email, nombre)
    const clave = lower(d?.email || email) || 'n:' + (norm(nombre) || 'sin-identificar')
    const g = (gente[clave] ||= { clave, email: d?.email || email || '', nombre: d?.nombre || nombre || email || 'Usuario de Toggl sin identificar', area: d?.area || null, activo: d ? d.activo !== false : true, meses: {} })
    const mm = (g.meses[m] ||= { total: 0, indirectas: 0, porProyecto: {} })
    const tp = tpPorId.get(String(tpId))
    mm.total += h
    if (esIndirecto(tp)) mm.indirectas += h
    mm.porProyecto[tpId] = (mm.porProyecto[tpId] || 0) + h
    ;((horasProyMes[tpId] ||= {})[m] = (horasProyMes[tpId][m] || 0) + h)
  }
  for (const r of historico) sumarHoras(r.email, r.nombre, r.proyecto_id, r.mes, (+r.segundos || 0) / 3600)
  const horasAppPorTp = {}
  for (const r of registros) {
    const h = duracionMs(r) / H
    sumarHoras(r.email, '', r.proyecto_id, mesDe(r), h)
    horasAppPorTp[r.proyecto_id] = (horasAppPorTp[r.proyecto_id] || 0) + h
    const tp = tpPorId.get(String(r.proyecto_id))
    // Sin concepto: ni concepto del contrato ni actividad (las generales como reuniones o traslados sí cuentan como capturadas)
    if (mesDe(r) === mes && tp?.project_id && !r.concepto_id && !r.actividad_id && !esIndirecto(tp)) sinConcepto.push(r)
  }

  // ── Proyectos de la app
  const lideres = responsables(projects, miembros, nombrePorEmail)
  // Responsable de cada área en el proyecto (consultor/líder → Consultoría, cx → Commissioning, me → Modelación)
  const ROL_AREA = { consultor: 'Consultoría', lider: 'Consultoría', cx: 'Commissioning', me: 'Modelación' }
  const responsablesDe = pid => {
    const out = {}
    for (const m of miembros) {
      if (m.project_id !== pid || !ROL_AREA[m.rol]) continue
      const area = ROL_AREA[m.rol]
      // En Consultoría manda el consultor; el líder solo si no hay consultor
      if (m.rol === 'lider' && miembros.some(x => x.project_id === pid && x.rol === 'consultor')) continue
      const e = lower(m.email)
      ;(out[area] ||= []).includes(e) || out[area].push(e)
    }
    return Object.fromEntries(Object.entries(out).map(([a, es]) => [a, es.map(e => ({ email: e, nombre: nombreCorto(nombrePorEmail[e]) || e.split('@')[0] }))]))
  }
  const proyPorProyecto = {}
  for (const f of proyecciones) (proyPorProyecto[f.project_id] ||= []).push(f)
  const atrasos = [], alertas = []
  const alerta = (tipo, texto, extra = {}) => alertas.push({ tipo, texto, ...extra })

  const proyectos = projects.map(p => {
    const { disciplines, estimations } = prepararProyecto(p)
    const rates = projectRates(p)
    const s = estimationSummary(disciplines, estimations, null, null, rates)
    const cobradoMeses = estimadoPorMes(p, disciplines, estimations)
    const cobradoConcepto = estimadoPorConcepto(p, disciplines, estimations)
    const pendientes = conceptosPorEstimar(p, disciplines, estimations)
    const pendienteId = new Map(pendientes.map(x => [x.concept.id, x]))
    const conceptoId = new Map(disciplines.flatMap(d => (d.concepts || []).map(c => [c.id, c])))
    const filas = proyPorProyecto[p.id] || []
    const moneda = p.currency || 'MXN'

    const proyectadoMeses = {}
    for (const f of filas) if (!(f.tbd && !(+f.monto > 0))) ((proyectadoMeses[f.mes] ||= {})[f.area] = (proyectadoMeses[f.mes][f.area] || 0) + (+f.monto || 0))
    const sumaArea = o => Object.values(o || {}).reduce((a, b) => a + b, 0)

    // Horas reales: lo acumulado en Toggl al importar + lo registrado en la app
    const misTps = tps.filter(t => t.project_id === p.id)
    const horasReales = misTps.reduce((a, t) => a + (+t.horas_toggl || 0) + (horasAppPorTp[t.id] || 0), 0)
    const horasMes = misTps.reduce((a, t) => a + (horasProyMes[t.id]?.[mes] || 0), 0)
    const hhContrato = disciplines.reduce((a, d) => a + disciplineSubtotal(d, rates).totalHH, 0)
    const horasEstimadas = hhContrato > 0 ? hhContrato : misTps.reduce((a, t) => a + (+t.horas_estimadas || 0), 0)
    const avance = s.advanceGlobal
    const eficiencia = horasReales > 0 && horasEstimadas > 0 ? (avance / 100) * horasEstimadas / horasReales : null
    const porHora = horasReales > 0 ? s.acumGlobal / horasReales : null
    const futuras = filas.filter(f => f.mes >= mesHoy && (+f.monto > 0 || f.tbd)).map(f => f.mes).sort()
    const porEstimar = pendientes.reduce((a, x) => a + x.porEstimar, 0)

    const activo = p.status === 'Activo'
    if (activo) {
      // Atrasos: conceptos cuya última proyección quedó en un mes que ya pasó y siguen sin cobrarse
      // (si se reprogramaron a un mes futuro ya no cuentan como atraso)
      const ultima = new Map()
      for (const f of filas) if (f.concept_id && (!ultima.has(f.concept_id) || f.mes > ultima.get(f.concept_id).mes)) ultima.set(f.concept_id, f)
      for (const f of ultima.values()) {
        if (f.mes >= mesHoy) continue
        const pend = pendienteId.get(f.concept_id)
        if (!pend) continue
        atrasos.push({ proyecto: p, moneda, mes: f.mes, area: f.area, concepto: conceptoId.get(f.concept_id), monto: +f.monto || 0, sinMonto: !(+f.monto > 0), porEstimar: pend.porEstimar, meses: (+mesHoy.slice(0, 4) - +f.mes.slice(0, 4)) * 12 + (+mesHoy.slice(5) - +f.mes.slice(5)) })
      }
      // Calidad de captura
      for (const e of estimations) {
        if (e.status === 'Enviada' && !(e.estimation_items || []).some(i => i.included)) alerta('Estimación vacía', `${p.name}: la estimación #${String(e.number || '').padStart(3, '0')} está Enviada sin conceptos`, { proyecto: p })
        const me = mesDelPeriodo(e.period_from, e.period_to)
        if (e.status === 'Borrador' && me && me > mesHoy) alerta('Borrador adelantado', `${p.name}: borrador #${String(e.number || '').padStart(3, '0')} de ${me}, un mes que no ha llegado`, { proyecto: p })
      }
      for (const f of filas) {
        if (f.mes >= mesHoy && f.concept_id && conceptoId.has(f.concept_id) && !pendienteId.has(f.concept_id) && +f.monto > 0)
          alerta('Proyección de algo ya cobrado', `${p.name}: ${conceptoId.get(f.concept_id).key} está proyectado en ${f.mes} pero ya se cobró completo`, { proyecto: p })
      }
      if (porEstimar > 0.5 && !futuras.length) alerta('Sin proyección', `${p.name}: le falta por estimar y no tiene nada proyectado de aquí en adelante`, { proyecto: p })
      if (!lideres[p.id]) alerta('Sin líder', `${p.name}: no tiene líder asignado`, { proyecto: p })
      if (!disciplines.length) alerta('Sin alcance', `${p.name}: no tiene disciplinas ni conceptos cargados`, { proyecto: p })
    }

    const cobradoMes = cobradoMeses[mes] || {}
    const proyectadoMes = proyectadoMeses[mes] || {}
    return {
      p, activo, moneda, lider: lideres[p.id] || '', avance, areaAvance: s.areaAvance,
      responsablesArea: responsablesDe(p.id), cierre: p.end_date ? String(p.end_date).slice(0, 7) : null,
      conDescuento: s.totals.conDescuento, acumulado: s.acumGlobal, porEstimar,
      cobradoMeses, proyectadoMeses, cobradoMes, proyectadoMes,
      cobradoMesTotal: sumaArea(cobradoMes), proyectadoMesTotal: sumaArea(proyectadoMes),
      horasReales, horasMes, horasEstimadas, eficiencia, porHora,
      // Para comparar horas contra dinero en un periodo: horas del equipo y cobrado por mes
      horasPorMes: Object.fromEntries(meses.map(m => [m, misTps.reduce((a2, t) => a2 + (horasProyMes[t.id]?.[m] || 0), 0)])),
      cobradoPorMes: Object.fromEntries(meses.map(m => [m, sumaArea(cobradoMeses[m])])),
      termino: futuras.at(-1) || null, ligado: misTps.length > 0,
    }
  })

  // Horas sin dueño
  for (const g of Object.values(gente)) if (!g.area && (g.meses[mes]?.total || 0) > 0) alerta('Horas sin área', `${g.nombre}: ${g.meses[mes].total.toFixed(1)} h en ${mes} sin área en el Directorio`)
  if (sinConcepto.length) {
    const quien = {}
    for (const r of sinConcepto) quien[r.email] = (quien[r.email] || 0) + 1
    for (const [email, n] of Object.entries(quien)) alerta('Horas sin concepto', `${nombreCorto(nombrePorEmail[email]) || email}: ${n} registro${n === 1 ? '' : 's'} del mes en proyectos sin concepto del contrato`)
  }
  const tpsConHoras = tps.filter(t => !t.project_id && !esIndirecto(t) && t.facturable && (horasProyMes[t.id]?.[mes] || 0) > 0)
  for (const t of tpsConHoras) alerta('Proyecto de Track sin ligar', `${t.nombre}: tiene horas en ${mes} pero no está ligado a un proyecto de la app`)

  // ── Personas (con horas en los 12 meses o activas en el directorio)
  for (const d of directorio) if (d.activo !== false && !gente[lower(d.email)]) gente[lower(d.email)] = { clave: lower(d.email), email: d.email, nombre: d.nombre, area: d.area, activo: true, meses: {} }
  const capacidad = habiles * 8
  const personas = Object.values(gente).filter(g => g.activo || meses.some(m => g.meses[m]?.total)).map(g => {
    const mm = g.meses[mes] || { total: 0, indirectas: 0, porProyecto: {} }
    const proyectosLider = proyectos.filter(x => x.activo && miembros.some(m => m.project_id === x.p.id && lower(m.email) === lower(g.email) && m.rol === 'lider'))
    const proyectosMiembro = proyectos.filter(x => x.activo && miembros.some(m => m.project_id === x.p.id && lower(m.email) === lower(g.email)))
    return {
      ...g, horas: mm.total, indirectas: mm.indirectas, directas: mm.total - mm.indirectas,
      pctIndirectas: mm.total > 0 ? mm.indirectas / mm.total * 100 : 0,
      utilizacion: capacidad > 0 ? mm.total / capacidad * 100 : 0,
      porProyecto: Object.entries(mm.porProyecto).map(([id, h]) => ({ tp: tpPorId.get(String(id)), h })).sort((a, b) => b.h - a.h),
      tendencia: meses.map(m => ({ mes: m, horas: g.meses[m]?.total || 0, indirectas: g.meses[m]?.indirectas || 0 })),
      proyectosLider, proyectosMiembro,
      sinConcepto: sinConcepto.filter(r => lower(r.email) === lower(g.email)).length,
    }
  }).sort((a, b) => b.horas - a.horas || String(a.nombre).localeCompare(String(b.nombre)))

  // ── Áreas
  const activos = proyectos.filter(x => x.activo)
  const areas = AREAS.map(area => {
    const cobrado = {}, proyectado = {}, acumulado = {}, contratado = {}
    for (const x of activos) {
      sumar(cobrado, x.moneda, x.cobradoMes[area] || 0)
      sumar(proyectado, x.moneda, x.proyectadoMes[area] || 0)
      const aa = x.areaAvance?.[area]
      if (aa) { sumar(acumulado, x.moneda, aa.acumulado); sumar(contratado, x.moneda, aa.conDesc) }
    }
    const gentes = personas.filter(g => g.area === area)
    const horas = gentes.reduce((a, g) => a + g.horas, 0)
    const indirectas = gentes.reduce((a, g) => a + g.indirectas, 0)
    return {
      area, cobrado, proyectado, acumulado, contratado, personas: gentes, horas, indirectas,
      cumplimiento: (proyectado.MXN || 0) > 0 ? (cobrado.MXN || 0) / proyectado.MXN * 100 : null,
      avance: (contratado.MXN || 0) > 0 ? (acumulado.MXN || 0) / contratado.MXN * 100 : null,
      utilizacion: capacidad > 0 && gentes.some(g => g.activo || g.horas > 0) ? horas / (gentes.filter(g => g.activo || g.horas > 0).length * capacidad) * 100 : 0,
      porHora: horas > 0 ? (cobrado.MXN || 0) / horas : null,
      proyectos: activos.filter(x => x.areaAvance?.[area] || x.cobradoMes[area] || x.proyectadoMes[area]),
      atrasos: atrasos.filter(a => a.area === area),
    }
  })

  // ── Tendencia de 12 meses (proyectado vs cobrado, MXN y USD por separado; horas del equipo)
  const tendencia = meses.map(m => {
    const cobrado = {}, proyectado = {}
    for (const x of activos) {
      sumar(cobrado, x.moneda, Object.values(x.cobradoMeses[m] || {}).reduce((a, b) => a + b, 0))
      sumar(proyectado, x.moneda, Object.values(x.proyectadoMeses[m] || {}).reduce((a, b) => a + b, 0))
    }
    const horas = personas.reduce((a, g) => a + (g.meses[m]?.total || 0), 0)
    const indirectas = personas.reduce((a, g) => a + (g.meses[m]?.indirectas || 0), 0)
    return { mes: m, cobrado, proyectado, horas, indirectas }
  })

  // ── Totales generales
  const cobrado = {}, proyectado = {}, porEstimar = {}, contratado = {}, acumulado = {}
  for (const x of activos) {
    sumar(cobrado, x.moneda, x.cobradoMesTotal); sumar(proyectado, x.moneda, x.proyectadoMesTotal)
    sumar(porEstimar, x.moneda, x.porEstimar); sumar(contratado, x.moneda, x.conDescuento); sumar(acumulado, x.moneda, x.acumulado)
  }
  const horas = personas.reduce((a, g) => a + g.horas, 0)
  const indirectas = personas.reduce((a, g) => a + g.indirectas, 0)
  // Capacidad: gente de las áreas operativas o que registró horas en el mes (Dirección sin horas no cuenta)
  const conHoras = personas.filter(g => (g.activo && AREAS.includes(g.area)) || g.horas > 0)
  const totales = {
    cobrado, proyectado, porEstimar, contratado, acumulado, horas, indirectas, habiles, capacidad,
    cumplimiento: (proyectado.MXN || 0) > 0 ? (cobrado.MXN || 0) / proyectado.MXN * 100 : null,
    pctIndirectas: horas > 0 ? indirectas / horas * 100 : 0,
    utilizacion: conHoras.length && capacidad > 0 ? horas / (conHoras.length * capacidad) * 100 : 0,
    porHora: horas > 0 ? (cobrado.MXN || 0) / horas : null,
    proyectosActivos: activos.length,
    atrasados: new Set(atrasos.map(a => a.proyecto.id)).size,
  }
  atrasos.sort((a, b) => a.mes.localeCompare(b.mes) || b.monto - a.monto)
  return { mes, meses, proyectos: activos, todos: proyectos, personas, areas, tendencia, atrasos, alertas, totales }
}
