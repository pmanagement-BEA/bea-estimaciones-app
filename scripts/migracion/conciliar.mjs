// Convierte la lectura de un libro BEA al modelo de la app y concilia mes por mes
// usando el MISMO motor de cálculo de la app (src/utils/calculations.js).
//
// Uso:  node conciliar.mjs lectura.json > conciliacion.json
import fs from 'fs'
import { estimationSummary, conceptAmount } from '../../src/utils/calculations.js'

const TOL = 1 // pesos

function norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '') }

export function aModeloApp(libroOriginal, { porMontos = false } = {}) {
  const libro = structuredClone(libroOriginal)
  const ultimo = libro.meses[libro.meses.length - 1]
  const h = ultimo.encabezado
  const total = h.importe_total || 0
  const rates = {
    anticipoPct: total ? ((h.anticipo || 0) / total) * 100 : 0,
    finiquitoPct: total ? ((h.finiquito || 0) / total) * 100 : 0,
  }
  const factor = Math.max(0, 1 - (rates.anticipoPct + rates.finiquitoPct) / 100)
  const avisos = []

  // Disciplinas y conceptos: estructura del último mes
  // Si el % de los conceptos no reproduce sus montos del Excel (aditivas capturadas en pesos,
  // encabezado de disciplina mal capturado), mandan los montos: estimable = suma de montos y
  // el % de cada concepto = su monto / estimable.
  if (porMontos) ultimo.disciplinas.forEach(d => {
    if (d.finiquito) return
    const montos = d.conceptos.map(c => c.monto_excel || 0)
    const suma = montos.reduce((a, b) => a + b, 0)
    if (suma <= 0 || d.conceptos.some(c => c.monto_excel == null)) return
    const porPct = d.conceptos.reduce((a, c) => a + (c.pct || 0) / 100 * (d.estimable || 0), 0)
    if (Math.abs(porPct - suma) <= TOL) return
    avisos.push(`Disciplina "${d.nombre.slice(0, 40)}": % no cuadra con montos (${Math.round(porPct)} vs ${Math.round(suma)}); se usan los montos del Excel`)
    d.estimable = suma
    d.porMontos = true
    d.conceptos.forEach(c => { c.pct = (c.monto_excel / suma) * 100 })
  })

  let cid = 0
  const disciplines = ultimo.disciplinas.map((d, i) => {
    const m = libro.montos.find(x => norm(x.nombre).slice(0, 25) === norm(d.nombre).slice(0, 25))
    let monto_total, descuento = 0
    if (d.adicional) avisos.push(`Servicio adicional "${d.nombre.slice(0, 40)}": se carga como disciplina con su estimable del Excel`)
    if (d.finiquito) monto_total = 0
    else if (d.adicional || d.porMontos) monto_total = factor ? (d.estimable || 0) / factor : 0
    else if (m && Math.abs(m.precio_final * factor - (d.estimable || 0)) <= TOL) {
      monto_total = m.total
      descuento = m.total ? ((m.total - m.precio_final) / m.total) * 100 : 0
    } else {
      monto_total = factor ? (d.estimable || 0) / factor : 0
      if (m) avisos.push(`Disciplina "${d.nombre.slice(0, 40)}": MONTOS no cuadra con la hoja; se usa el estimable de la hoja`)
    }
    return {
      id: `d${i}`, name: d.nombre, monto_total, descuento, tarifa_hh: 0, sort_order: i,
      concepts: d.conceptos.map((c, j) => ({
        id: `c${cid++}`, key: limpiarClave(c.clave, d.conceptos), description: c.descripcion, deliverable: c.entregable,
        pct: c.pct, month: c.mes, type: c.finiquito ? 'Finiquito' : 'Normal', sort_order: j,
      })),
    }
  })
  const byKey = {}
  disciplines.forEach(d => d.concepts.forEach(c => { byKey[`${d.name}|${c.key}`] = c }))

  // Una estimación Enviada por mes
  const estimations = libro.meses.map((mes, n) => {
    const items = []
    mes.disciplinas.forEach(d => d.conceptos.forEach(c => {
      if (!(c.marca_esta > 0)) return
      const concept = byKey[`${d.nombre}|${c.clave}`]
      if (!concept) { avisos.push(`${mes.hoja}: concepto ${c.clave} no existe en la estructura final`); return }
      const parcial = c.marca_esta < 0.9999
      items.push({ concept_id: concept.id, included: true, parcial_enabled: parcial, pct_parcial: parcial ? c.marca_esta * 100 : 0,
        delayed: /si|sí|x/i.test(c.atraso || ''), cause: c.causa || '' })
    }))
    return { id: `e${n}`, number: n + 1, status: 'Enviada', period: mes.periodo, hoja: mes.hoja,
      created_at: `${mes.periodo}-15T00:00:00Z`, estimation_items: items, excel: mes.encabezado }
  })
  return { rates, disciplines, estimations, avisos }
}

export function conciliar(libro) {
  const m = aModeloApp(libro)
  const meses = m.estimations.map((e, n) => {
    const items = Object.fromEntries(e.estimation_items.map(i => [i.concept_id, i]))
    // Solo cuentan los meses anteriores a este (como cuando se capturó en su momento)
    const s = estimationSummary(m.disciplines, m.estimations.slice(0, n + 1), e.id, items, m.rates)
    const x = e.excel
    const dif = (a, b) => (b === undefined ? null : Math.round((a - b) * 100) / 100)
    const d1 = dif(s.actual, x.estimacion_actual), d2 = dif(s.acumGlobal, x.acumulado_global)
    return { hoja: e.hoja, periodo: e.period, app_actual: Math.round(s.actual * 100) / 100, excel_actual: x.estimacion_actual,
      dif_actual: d1, dif_acumulado: d2, cuadra: (d1 === null || Math.abs(d1) <= TOL) && (d2 === null || Math.abs(d2) <= TOL) }
  })
  // Montos por concepto: app vs Excel (último mes)
  const ult = libro.meses[libro.meses.length - 1]
  let difConceptos = 0
  ult.disciplinas.forEach((d, i) => d.conceptos.forEach((c, j) => {
    if (c.finiquito || c.monto_excel == null) return
    const app = conceptAmount(m.disciplines[i].concepts[j], m.disciplines[i], m.rates, m.disciplines)
    if (Math.abs(app - c.monto_excel) > TOL) difConceptos++
  }))
  return {
    archivo: libro.archivo.split('/').pop(), rates: m.rates, disciplinas: m.disciplines.length,
    conceptos: m.disciplines.reduce((n, d) => n + d.concepts.length, 0), meses: meses.length,
    ultimo_periodo: meses.at(-1)?.periodo, meses_que_cuadran: meses.filter(x => x.cuadra).length,
    conceptos_con_monto_distinto: difConceptos, avisos: [...new Set(m.avisos)].slice(0, 8), detalle: meses,
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && process.argv[2]) {
  const libros = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  console.log(JSON.stringify(libros.map(conciliar), null, 1))
}

/**
 * Clave que Excel guardó como número con basura de punto flotante (6.029999999999999 → 6.03, 2.1000000000000005 → 2.10).
 * Mismo resultado que carga_partes/claves_dos_decimales.sql + claves_revertir_sin_cero.sql (lo que hay en producción):
 * la basura se redondea a 2 decimales; "4.1" escrito así se vuelve "4.10" solo si la disciplina numera con cero (4.01, 4.02…).
 */
export function limpiarClave(clave, hermanos = []) {
  const k = String(clave ?? '').trim()
  if (/^\d+\.\d{5,}$/.test(k)) return (Math.round(Number(k) * 100) / 100).toFixed(2)
  if (/^\d+\.\d$/.test(k)) {
    const claves = hermanos.map(h => String(h.clave ?? '').trim()).filter(x => x !== k)
    const dosDecimales = claves.some(x => /^\d+\.\d\d$/.test(x) || /^\d+\.\d{5,}$/.test(x))
    const conCero = claves.some(x => /^\d+\.0\d/.test(x))
    if (dosDecimales && conCero) return k + '0'
  }
  return k
}
