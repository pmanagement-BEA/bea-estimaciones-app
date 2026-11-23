// Proyecciones de cobro: lo que cada proyecto piensa estimar en los meses que vienen, por área.
// mes = mes de ejecución (el periodo de la estimación); se factura al mes siguiente.
import { AREAS, disciplineArea, conceptAmount, itemAmount, projectRates, getAcumuladoAnteriorMap } from '../utils/calculations.js'
import { mesDelPeriodo, esHabil } from '../utils/cierre.js'

export { AREAS }
export const COLOR_AREA = { 'Consultoría': '#2a78d6', 'Commissioning': '#eb6834', 'Modelación': '#1baf7a' }
export const MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export const mesIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
export const sumarMeses = (mes, n) => { const [y, m] = mes.split('-').map(Number); return mesIso(new Date(y, m - 1 + n, 1)) }
export const textoMes = mes => (mes ? `${MESES_LARGOS[+mes.slice(5, 7) - 1]} ${mes.slice(0, 4)}` : '')
export const textoMesCorto = mes => (mes ? `${MESES_CORTOS[+mes.slice(5, 7) - 1]} ${mes.slice(2, 4)}` : '')
/** Se factura al mes siguiente de la ejecución */
export const mesFactura = mes => sumarMeses(mes, 1)
/**
 * Día en que se congelan las proyecciones de un mes: el 15, o el siguiente día hábil si cae en fin de semana
 * o festivo (misma regla que la base: public.fecha_congelamiento). Desde ese día ya no se cambian.
 */
export function fechaCongelamiento(mes) {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(y, m - 1, 15)
  while (!esHabil(d)) d.setDate(d.getDate() + 1)
  return d
}
export const estaCongelada = (mes, hoy = new Date()) => new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) >= fechaCongelamiento(mes)
export const textoCongelamiento = mes => fechaCongelamiento(mes).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })

export function rangoMeses(desde, hasta) {
  const out = []
  for (let m = desde; m <= hasta && out.length < 120; m = sumarMeses(m, 1)) out.push(m)
  return out
}

/** Disciplinas ordenadas con conceptos y estimaciones con items, como las usa la app. */
export function prepararProyecto(p) {
  return {
    disciplines: [...(p.disciplines || [])].sort((a, b) => a.sort_order - b.sort_order)
      .map(d => ({ ...d, concepts: [...(d.concepts || [])].sort((a, b) => a.sort_order - b.sort_order) })),
    estimations: p.estimations || [],
  }
}

/**
 * Lo estimado de verdad por mes y área (estimaciones Enviadas, por el mes de su periodo).
 * Devuelve { 'YYYY-MM': { Consultoría: $, Commissioning: $, Modelación: $ } }
 */
export function estimadoPorMes(project, disciplines, estimations) {
  const rates = projectRates(project)
  const out = {}
  const porConcepto = new Map()
  for (const d of disciplines) for (const c of d.concepts || []) porConcepto.set(c.id, [c, d])
  // La primera estimación de un proyecto migrado (número > 1) trae todo lo cobrado antes, acumulado:
  // no es de un solo mes, así que no se compara mes contra mes.
  const enviadas = estimations.filter(e => e.status === 'Enviada')
  const primera = enviadas.reduce((a, e) => (!a || (e.number || 0) < (a.number || 0) ? e : a), null)
  const acumuladaDeArranque = primera && (primera.number || 0) > 1 ? primera.id : null
  for (const e of enviadas) {
    if (e.id === acumuladaDeArranque) continue
    const mes = mesDelPeriodo(e.period_from, e.period_to)
    if (!mes) continue
    for (const it of e.estimation_items || []) {
      if (!it.included) continue
      const cd = porConcepto.get(it.concept_id); if (!cd) continue
      const area = disciplineArea(cd[1]) || 'Consultoría'
      const monto = itemAmount(it, cd[0], cd[1], rates, disciplines)
      out[mes] ||= {}; out[mes][area] = (out[mes][area] || 0) + monto
    }
  }
  return out
}

/**
 * Conceptos que todavía se pueden proyectar (lo que les falta por estimar), con su área.
 * [{ concept, discipline, area, monto, porEstimar }]
 */
export function conceptosPorEstimar(project, disciplines, estimations) {
  const rates = projectRates(project)
  const acum = getAcumuladoAnteriorMap(disciplines, estimations, null, rates)
  const out = []
  for (const d of disciplines) {
    const area = disciplineArea(d) || 'Consultoría'
    for (const c of d.concepts || []) {
      const monto = conceptAmount(c, d, rates, disciplines)
      const porEstimar = Math.max(0, monto - (acum[c.id] || 0))
      if (porEstimar > 0.5) out.push({ concept: c, discipline: d, area, monto, porEstimar })
    }
  }
  return out
}

/** Suma de proyecciones: { mes: { area: $ } } y totales por mes, área y total. */
export function sumarProyecciones(filas) {
  const porMes = {}, porArea = Object.fromEntries(AREAS.map(a => [a, 0]))
  let total = 0, tbd = 0
  for (const f of filas) {
    if (f.tbd && !(+f.monto > 0)) { tbd++; continue }
    const v = +f.monto || 0
    porMes[f.mes] ||= {}; porMes[f.mes][f.area] = (porMes[f.mes][f.area] || 0) + v
    porArea[f.area] = (porArea[f.area] || 0) + v
    total += v
  }
  return { porMes, porArea, total, tbd }
}

/**
 * Conceptos proyectados para el mes de una estimación que todavía no se cobran:
 * los que se precargan en el borrador. [{ concept_id, proyeccion }]
 */
export function precargaDelMes(proyecciones, mes, items, porEstimarIds) {
  return proyecciones
    .filter(p => p.mes === mes && p.concept_id && !items[p.concept_id]?.included && porEstimarIds.has(p.concept_id))
    .map(p => ({ concept_id: p.concept_id, proyeccion: p }))
}

/** Nombre corto de una persona del directorio: "Ana María Valencia Maldonado" → "Ana María Valencia" */
export const nombreCorto = n => {
  const w = String(n || '').trim().split(/\s+/).slice(0, 3)
  while (w.length > 1 && /^(de|del|la|las|los|y)$/i.test(w.at(-1))) w.pop() // "Alberto Dávila de" → "Alberto Dávila"
  return w.join(' ')
}
/**
 * Quién proyectó una fila: el correo de quien la capturó en la app (se busca en el directorio)
 * o la hoja del Excel de Proyecciones 2026 ("Hoja ANA (Excel)" → "ANA (Excel)").
 */
export function quienProyecta(creadoPor, nombrePorEmail = {}) {
  const c = String(creadoPor || '').trim()
  if (!c) return ''
  if (c.includes('@')) return nombreCorto(nombrePorEmail[c.toLowerCase()]) || c.split('@')[0]
  return c.replace(/Hoja /g, '')
}
/** Responsables (líderes) de cada proyecto: { project_id: 'Nombre, Nombre' } */
export function responsables(projects, miembros, nombrePorEmail = {}) {
  const out = {}
  for (const p of projects) {
    const lideres = miembros.filter(m => m.project_id === p.id && m.rol === 'lider').map(m => nombreCorto(nombrePorEmail[String(m.email || '').toLowerCase()]) || String(m.email || '').split('@')[0])
    out[p.id] = [...new Set(lideres)].join(', ') || (typeof p.team?.lider === 'string' ? p.team.lider : '')
  }
  return out
}

/** Lo estimado de verdad por mes y concepto: { 'YYYY-MM': { concept_id: $ } } (misma regla que estimadoPorMes). */
export function estimadoPorConcepto(project, disciplines, estimations) {
  const rates = projectRates(project)
  const out = {}
  const porConcepto = new Map()
  for (const d of disciplines) for (const c of d.concepts || []) porConcepto.set(c.id, [c, d])
  const enviadas = estimations.filter(e => e.status === 'Enviada')
  const primera = enviadas.reduce((a, e) => (!a || (e.number || 0) < (a.number || 0) ? e : a), null)
  const acumuladaDeArranque = primera && (primera.number || 0) > 1 ? primera.id : null
  for (const e of enviadas) {
    if (e.id === acumuladaDeArranque) continue
    const mes = mesDelPeriodo(e.period_from, e.period_to)
    if (!mes) continue
    for (const it of e.estimation_items || []) {
      if (!it.included) continue
      const cd = porConcepto.get(it.concept_id); if (!cd) continue
      out[mes] ||= {}; out[mes][it.concept_id] = (out[mes][it.concept_id] || 0) + itemAmount(it, cd[0], cd[1], rates, disciplines)
    }
  }
  return out
}

/**
 * Versiones de la proyección de un mes según el historial: después de cada día con cambios, cuánto había proyectado.
 * historial: filas de proyecciones_historial (de cualquier mes). Devuelve [{ dia, total, sinMonto, cambios: [fila] }]
 */
export function versionesDelMes(historial, mes) {
  const toca = historial.filter(h => h.mes === mes || h.mes_antes === mes).sort((a, b) => String(a.hecho_en).localeCompare(String(b.hecho_en)) || a.id - b.id)
  const vivo = new Map() // proyeccion_id → fila vigente en este mes
  const porDia = new Map()
  for (const h of toca) {
    if (h.accion !== 'baja' && h.mes === mes) vivo.set(h.proyeccion_id, h); else vivo.delete(h.proyeccion_id)
    const dia = String(h.hecho_en).slice(0, 10)
    const filas = [...vivo.values()]
    porDia.set(dia, { dia, total: filas.reduce((s, f) => s + (f.tbd && !(+f.monto > 0) ? 0 : +f.monto || 0), 0), sinMonto: filas.filter(f => f.tbd && !(+f.monto > 0)).length, cambios: [...(porDia.get(dia)?.cambios || []), h] })
  }
  return [...porDia.values()]
}

const ROL_CORTO = { cx: 'Cx', me: 'ME', consultor: 'Consultor', coordinador: 'Coordinador' }
/** El resto del equipo de cada proyecto (sin el líder): { project_id: ['Cx: Nombre', 'ME: Nombre', …] } */
export function equipos(projects, miembros, nombrePorEmail = {}) {
  const orden = ['consultor', 'cx', 'me', 'coordinador']
  const out = {}
  for (const p of projects) {
    const ms = miembros.filter(m => m.project_id === p.id && m.rol !== 'lider').sort((a, b) => orden.indexOf(a.rol) - orden.indexOf(b.rol))
    out[p.id] = [...new Set(ms.map(m => `${ROL_CORTO[m.rol] || m.rol}: ${nombreCorto(nombrePorEmail[String(m.email || '').toLowerCase()]) || String(m.email || '').split('@')[0]}`))]
  }
  return out
}

/**
 * Lo que trae una estimación, concepto por concepto (para la vista previa al proyectar).
 * Devuelve { mes, total, items: [{ concept, discipline, area, monto }] } con los conceptos incluidos y con monto.
 */
export function detalleEstimacion(project, disciplines, estimation) {
  const rates = projectRates(project)
  const porConcepto = new Map()
  for (const d of disciplines) for (const c of d.concepts || []) porConcepto.set(c.id, [c, d])
  const items = []
  for (const it of estimation.estimation_items || []) {
    if (!it.included) continue
    const cd = porConcepto.get(it.concept_id); if (!cd) continue
    const monto = itemAmount(it, cd[0], cd[1], rates, disciplines)
    if (monto > 0.5) items.push({ concept: cd[0], discipline: cd[1], area: disciplineArea(cd[1]) || 'Consultoría', monto })
  }
  const orden = new Map(disciplines.flatMap((d, i) => (d.concepts || []).map((c, j) => [c.id, i * 1000 + j])))
  items.sort((a, b) => orden.get(a.concept.id) - orden.get(b.concept.id))
  return { mes: mesDelPeriodo(estimation.period_from, estimation.period_to), total: items.reduce((s, x) => s + x.monto, 0), items }
}
