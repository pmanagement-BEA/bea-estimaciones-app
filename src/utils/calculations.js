// ─────────────────────────────────────────────────────────────────────────────
// Reglas de cálculo de BEA (verificadas contra 000000-612-Estimación.xlsx):
//
//   Precio con descuento (IMPORTE TOTAL) = monto × (1 − descuento)
//   Anticipo   = importe total × anticipo %   → se cobra aparte al inicio
//   Finiquito  = importe total × finiquito %  → se retiene hasta la certificación
//   Estimable  = importe total × (1 − anticipo % − finiquito %)  → se reparte en conceptos
//
//   Concepto normal     = % × estimable de su disciplina
//   Concepto finiquito  = % × finiquito total del proyecto
//
//   Avance esta estimación = cobrado este mes (conceptos normales) ÷ estimable
//   Avance global          = acumulado (incluye finiquito cobrado) ÷ importe total
//   Avance por área        = acumulado del área ÷ importe total del área
// ─────────────────────────────────────────────────────────────────────────────

// Proyectos creados antes de estos campos se calculaban con 0% anticipo y 10% finiquito.
export const LEGACY_RATES = { anticipoPct: 0, finiquitoPct: 10 }
export const DEFAULT_RATES = { anticipoPct: 10, finiquitoPct: 5 }

export const AREAS = ['Consultoría', 'Commissioning', 'Modelación']

export function projectRates(project) {
  const num = v => (v === null || v === undefined || v === '' ? null : parseFloat(v))
  const a = num(project?.anticipo_pct)
  const f = num(project?.finiquito_pct)
  return {
    anticipoPct: a ?? LEGACY_RATES.anticipoPct,
    finiquitoPct: f ?? LEGACY_RATES.finiquitoPct,
  }
}

function estimableFactor(rates = LEGACY_RATES) {
  return Math.max(0, 1 - (rates.anticipoPct + rates.finiquitoPct) / 100)
}

export function disciplineArea(d) {
  if (d?.area) return d.area
  const n = (d?.name || '').toLowerCase()
  if (/finiquito|certificaci/.test(n)) return null
  if (/commission|comisiona|\bcx\b/.test(n)) return 'Commissioning'
  if (/model|eficiencia energ/.test(n)) return 'Modelación'
  return 'Consultoría'
}

export function disciplineSubtotal(d, rates = LEGACY_RATES) {
  const monto = parseFloat(d.monto_total) || 0
  const desc = parseFloat(d.descuento) || 0
  const conDesc = monto * (1 - desc / 100)
  const estimable = conDesc * estimableFactor(rates)
  const tarifa = parseFloat(d.tarifa_hh) || 0
  const totalHH = tarifa > 0 ? conDesc / tarifa : 0
  return { monto, conDesc, estimable, totalHH }
}

export function projectTotals(disciplines = [], rates = LEGACY_RATES) {
  let importeTotal = 0, conDescuento = 0, estimable = 0
  disciplines.forEach(d => {
    const s = disciplineSubtotal(d, rates)
    importeTotal += s.monto
    conDescuento += s.conDesc
    estimable += s.estimable
  })
  const anticipo = conDescuento * rates.anticipoPct / 100
  const finiquito = conDescuento * rates.finiquitoPct / 100
  return { importeTotal, conDescuento, estimable, anticipo, finiquito }
}

export function conceptAmount(concept, discipline, rates = LEGACY_RATES, disciplines = null) {
  const pct = (parseFloat(concept.pct) || 0) / 100
  if (concept.type === 'Finiquito') {
    const base = disciplines
      ? projectTotals(disciplines, rates).finiquito
      : disciplineSubtotal(discipline, rates).conDesc * rates.finiquitoPct / 100
    return pct * base
  }
  return pct * disciplineSubtotal(discipline, rates).estimable
}

export function itemAmount(item, concept, discipline, rates = LEGACY_RATES, disciplines = null) {
  if (!item?.included) return 0
  const monto = conceptAmount(concept, discipline, rates, disciplines)
  return item.parcial_enabled ? ((parseFloat(item.pct_parcial) || 0) / 100) * monto : monto
}

export function findConcept(disciplines, conceptId) {
  for (const d of disciplines) {
    const c = (d.concepts || []).find(c => c.id === conceptId)
    if (c) return c
  }
  return null
}

export function findDisciplineForConcept(disciplines, conceptId) {
  return disciplines.find(d => (d.concepts || []).some(c => c.id === conceptId)) || null
}

// Monto acumulado por concepto en estimaciones Enviadas (excluye la actual).
export function getAcumuladoAnteriorMap(disciplines, estimations, currentEstimationId, rates = LEGACY_RATES) {
  const map = {}
  disciplines.forEach(d => (d.concepts || []).forEach(c => (map[c.id] = 0)))

  const sorted = [...estimations]
    .filter(e => e.id !== currentEstimationId && e.status === 'Enviada')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  sorted.forEach(est => {
    ;(est.estimation_items || []).forEach(item => {
      if (!item.included || map[item.concept_id] === undefined) return
      const concept = findConcept(disciplines, item.concept_id)
      const discipline = findDisciplineForConcept(disciplines, item.concept_id)
      if (!concept || !discipline) return
      map[item.concept_id] += itemAmount(item, concept, discipline, rates, disciplines)
    })
  })
  return map
}

/**
 * Resumen completo de una estimación con las reglas del Excel de BEA.
 * items: { concept_id: item } de la estimación actual (o null para solo lo enviado).
 */
export function estimationSummary(disciplines, estimations, currentEstimationId, items, rates = LEGACY_RATES) {
  const totals = projectTotals(disciplines, rates)
  const acumMap = getAcumuladoAnteriorMap(disciplines, estimations, currentEstimationId, rates)

  let anteriorNormal = 0, anteriorFin = 0, actualNormal = 0, actualFin = 0
  const areas = {}
  AREAS.forEach(a => (areas[a] = { conDesc: 0, acumulado: 0 }))
  const byDiscipline = {}

  disciplines.forEach(d => {
    const s = disciplineSubtotal(d, rates)
    const area = disciplineArea(d)
    if (area && areas[area]) areas[area].conDesc += s.conDesc
    let dAcum = 0
    ;(d.concepts || []).forEach(c => {
      const prev = acumMap[c.id] || 0
      const now = items ? itemAmount(items[c.id], c, d, rates, disciplines) : 0
      if (c.type === 'Finiquito') { anteriorFin += prev; actualFin += now }
      else { anteriorNormal += prev; actualNormal += now }
      dAcum += prev + now
    })
    if (area && areas[area]) areas[area].acumulado += dAcum
    byDiscipline[d.id] = { ...s, acumulado: dAcum, avance: s.conDesc > 0 ? (dAcum / s.conDesc) * 100 : 0 }
  })

  const acumAnterior = anteriorNormal + anteriorFin
  const actual = actualNormal + actualFin
  const acumGlobal = acumAnterior + actual
  const areaAvance = {}
  AREAS.forEach(a => {
    const { conDesc, acumulado } = areas[a]
    areaAvance[a] = conDesc > 0 ? { pct: (acumulado / conDesc) * 100, conDesc, acumulado } : null
  })

  return {
    totals, acumMap,
    acumAnterior, actual, acumGlobal,
    actualNormal, actualFin,
    porEstimar: Math.max(0, totals.estimable - anteriorNormal - actualNormal),
    finiquitoPorCobrar: Math.max(0, totals.finiquito - anteriorFin - actualFin),
    advanceThis: totals.estimable > 0 ? (actualNormal / totals.estimable) * 100 : 0,
    advanceGlobal: totals.conDescuento > 0 ? (acumGlobal / totals.conDescuento) * 100 : 0,
    areaAvance, byDiscipline,
  }
}

// Avance global del proyecto (solo estimaciones Enviadas) — mismo criterio que el Excel.
export function projectAdvancePct(disciplines, estimations, rates = LEGACY_RATES) {
  return estimationSummary(disciplines, estimations, null, null, rates).advanceGlobal
}
