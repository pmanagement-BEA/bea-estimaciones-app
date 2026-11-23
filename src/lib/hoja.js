import { fmtPct, fmtDate } from '../utils/format.js'

/** "50%", "33.33%" (sin ceros de más) */
export const pctTexto = v => `${Math.round(v * 10000) / 100}%`

/**
 * Nota corta para un concepto cobrado en partes (vacía si no aplica):
 * "Cobro parcial: 50% en esta estimación", "… · acumulado 75%" o "Se completa el 50% restante (antes 50%)".
 */
export function notaParcial({ monto, anterior, esta, finiquito }) {
  if (finiquito || !(monto > 0.005) || !(esta > 0.005)) return ''
  const pe = esta / monto, pa = anterior / monto, acum = pa + pe
  const completa = acum >= 0.9999
  if (completa && pa < 0.0001) return ''
  if (completa) return `Se completa el ${pctTexto(pe)} restante (antes ${pctTexto(pa)})`
  return `Cobro parcial: ${pctTexto(pe)} en esta estimación${pa > 0.0001 ? ` · acumulado ${pctTexto(acum)}` : ''}`
}
import { disciplineSubtotal, conceptAmount, itemAmount, AREAS } from '../utils/calculations.js'

/**
 * Datos de la estimación con el formato que se manda al cliente
 * (mismo orden que la hoja "ESTIMACIÓN DE AVANCE" de los libros).
 */
export function armarHoja({ project, estimation, disciplines, items, summary, rates }) {
  const { totals, acumMap } = summary
  const bloques = disciplines
    .filter(d => disciplineSubtotal(d, rates).conDesc > 0 || (d.concepts || []).some(c => c.type === 'Finiquito' && totals.finiquito > 0))
    .map(d => {
      const filas = (d.concepts || []).map(c => {
        const monto = conceptAmount(c, d, rates, disciplines)
        const anterior = acumMap[c.id] || 0
        const esta = itemAmount(items[c.id], c, d, rates, disciplines)
        return {
          clave: c.key, concepto: c.description, entregable: c.deliverable || '', finiquito: c.type === 'Finiquito',
          monto, anterior, esta, acumulado: anterior + esta, porEstimar: Math.max(0, monto - anterior - esta),
          avance: monto > 0.005 ? Math.min(1, (anterior + esta) / monto) : null,
          nota: notaParcial({ monto, anterior, esta, finiquito: c.type === 'Finiquito' }),
        }
      })
      const suma = k => filas.reduce((s, f) => s + f[k], 0)
      return { nombre: d.name, construccion: /construcci/i.test(d.name || ''), finiquito: filas.length > 0 && filas.every(f => f.finiquito), filas, monto: suma('monto'), anterior: suma('anterior'), esta: suma('esta'), acumulado: suma('acumulado'), porEstimar: suma('porEstimar') }
    })
  return {
    numero: estimation.number,
    proyecto: project.name, cliente: project.client, ubicacion: project.location, moneda: project.currency,
    inicio: project.start_date, fin: project.end_date, periodFrom: estimation.period_from, periodTo: estimation.period_to,
    anticipoPct: rates.anticipoPct, finiquitoPct: rates.finiquitoPct,
    totales: { importe: totals.conDescuento, anticipo: totals.anticipo, finiquito: totals.finiquito, estimable: totals.estimable,
      acumAnterior: summary.acumAnterior, actual: summary.actual, acumGlobal: summary.acumGlobal, porEstimar: summary.porEstimar,
      avanceEsta: summary.advanceThis, avanceGlobal: summary.advanceGlobal,
      avanceArea: Object.fromEntries(AREAS.map(a => [a, summary.areaAvance[a] ? summary.areaAvance[a].pct : null])) },
    periodo: `${fmtDate(estimation.period_from)} — ${fmtDate(estimation.period_to)}`,
    resumen: [
      ['Importe total', totals.conDescuento],
      [`Anticipo (${fmtPct(rates.anticipoPct)})`, totals.anticipo],
      [`Finiquito (${fmtPct(rates.finiquitoPct)})`, totals.finiquito],
      [`Importe estimable (${fmtPct(100 - rates.anticipoPct - rates.finiquitoPct)})`, totals.estimable],
      ['Acumulado anterior', summary.acumAnterior],
      ['Estimación actual', summary.actual],
      ['Acumulado global', summary.acumGlobal],
      ['Por estimar', summary.porEstimar],
    ],
    avances: [
      ['% avance esta estimación', summary.advanceThis],
      ['% avance global del proyecto', summary.advanceGlobal],
      ...AREAS.filter(a => summary.areaAvance[a]).map(a => [`% avance ${a}`, summary.areaAvance[a].pct]),
    ],
    bloques,
  }
}
