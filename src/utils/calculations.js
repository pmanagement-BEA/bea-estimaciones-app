export function disciplineSubtotal(d) {
  const monto = parseFloat(d.monto_total) || 0
  const desc = parseFloat(d.descuento) || 0
  const conDesc = monto * (1 - desc / 100)
  const estimable = conDesc * 0.9
  const tarifa = parseFloat(d.tarifa_hh) || 0
  const totalHH = tarifa > 0 ? conDesc / tarifa : 0
  return { monto, conDesc, estimable, totalHH }
}

export function projectTotals(disciplines = []) {
  let importeTotal = 0, conDescuento = 0, estimable = 0
  disciplines.forEach(d => {
    const s = disciplineSubtotal(d)
    importeTotal += s.monto
    conDescuento += s.conDesc
    estimable += s.estimable
  })
  const finiquito = conDescuento * 0.1
  return { importeTotal, conDescuento, estimable, finiquito }
}

export function conceptAmount(concept, discipline) {
  const s = disciplineSubtotal(discipline)
  return ((parseFloat(concept.pct) || 0) / 100) * s.estimable
}

export function projectAdvancePct(disciplines, estimations) {
  const totals = projectTotals(disciplines)
  if (totals.estimable <= 0) return 0
  let acumulado = 0
  estimations.forEach(e => {
    if (e.status !== 'Enviada') return
    ;(e.estimation_items || []).forEach(item => {
      if (!item.included) return
      const concept = findConcept(disciplines, item.concept_id)
      const discipline = findDisciplineForConcept(disciplines, item.concept_id)
      if (!concept || !discipline) return
      const monto = conceptAmount(concept, discipline)
      acumulado += item.parcial_enabled
        ? ((parseFloat(item.pct_parcial) || 0) / 100) * monto
        : monto
    })
  })
  return (acumulado / totals.estimable) * 100
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

export function getAcumuladoAnteriorMap(disciplines, estimations, currentEstimationId) {
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
      const monto = conceptAmount(concept, discipline)
      map[item.concept_id] += item.parcial_enabled
        ? ((parseFloat(item.pct_parcial) || 0) / 100) * monto
        : monto
    })
  })
  return map
}
