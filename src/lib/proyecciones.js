// Proyecciones de cobro: lo que cada proyecto piensa estimar en los meses que vienen, por área.
// mes = mes de ejecución (el periodo de la estimación); se factura al mes siguiente.
import { AREAS, disciplineArea, conceptAmount, itemAmount, projectRates, getAcumuladoAnteriorMap } from '../utils/calculations.js'
import { mesDelPeriodo } from '../utils/cierre.js'

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
