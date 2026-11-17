// Prueba "saldo al corte": una sola estimación con el acumulado de cada concepto al último mes.
import fs from 'fs'
import { estimationSummary } from '../../src/utils/calculations.js'
import { aModeloApp } from './conciliar.mjs'

export function saldoAlCorte(libro, opts = {}) {
  const m = aModeloApp(libro, opts)
  const ult = m.ultimo || libro.meses.at(-1)
  const items = []
  const sinMatch = []
  ult.disciplinas.forEach((d, i) => d.conceptos.forEach((c, j) => {
    const frac = Math.min(1, (c.marca_anterior || 0) + (c.marca_esta || 0))
    if (!(frac > 0.00001)) return
    const concept = m.disciplines[i].concepts[j]
    const parcial = frac < 0.9999
    items.push({ concept_id: concept.id, included: true, parcial_enabled: parcial, pct_parcial: parcial ? frac * 100 : 0 })
  }))
  const est = { id: 'corte', number: 1, status: 'Enviada', period: ult.periodo, created_at: `${ult.periodo}-15T00:00:00Z`, estimation_items: items }
  const s = estimationSummary(m.disciplines, [est], 'corte', Object.fromEntries(items.map(x => [x.concept_id, x])), m.rates)
  const x = ult.encabezado
  const dif = x.acumulado_global == null ? null : Math.round((s.acumGlobal - x.acumulado_global) * 100) / 100
  if (!opts.porMontos && (dif === null || Math.abs(dif) > 1)) {
    const alt = saldoAlCorte(libro, { porMontos: true })
    if (alt.dif !== null && Math.abs(alt.dif) <= 1) return alt
  }
  return { modo: opts.porMontos ? 'montos' : 'pct', avisos: m.avisos, model: m, items, archivo: libro.archivo.split('/').pop(), periodo: ult.periodo, app: Math.round(s.acumGlobal * 100) / 100,
    excel: x.acumulado_global, dif: x.acumulado_global == null ? null : Math.round((s.acumGlobal - x.acumulado_global) * 100) / 100,
    importe_app: Math.round(s.totals.conDescuento), importe_excel: x.importe_total, por_estimar_excel: x.por_estimar }
}

if (process.argv[2]) {
  const L = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).filter(l => l.meses.length)
  const r = L.map(saldoAlCorte)
  r.forEach(z => console.log(z.archivo.padEnd(28), z.modo, z.periodo, 'dif', String(z.dif).padStart(12), ' importe app', z.importe_app, 'excel', Math.round(z.importe_excel || 0)))
  console.log('cuadran', r.filter(z => z.dif !== null && Math.abs(z.dif) <= 1).length, 'de', r.length)
}
