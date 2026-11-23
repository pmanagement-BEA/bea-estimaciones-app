// Versión breve de la estimación: resumen financiero, avance por disciplina y SOLO los conceptos
// cobrados en esta estimación. Es una variante de la hoja RC-OP-11; no la reemplaza.
// Sale de la misma hoja (armarHoja), así que los números son los mismos que en el Excel completo.

/** Nombre corto de la disciplina para las tarjetas de avance (igual que el formato original de BEA). */
export function nombreCorto(nombre) {
  const n = String(nombre || '').trim()
  if (/^fase\s*(uno|1)\b/i.test(n)) return 'Fase 1 — LEED Diagnóstico'
  if (/^fase\s*(dos|2)\b/i.test(n) && /leed/i.test(n)) return 'Fase 2 — LEED Diseño'
  if (/^fase\s*(tres|3)\b/i.test(n) && /leed/i.test(n)) return 'Fase 3 — LEED Construcción'
  return n.replace(/&\s*Monitoring-Based Commissioning/i, '').replace(/Certificación\s*\(FINIQUITO\)/i, 'Certificación').replace(/\s+/g, ' ').trim()
}

/**
 * hoja: lo que devuelve armarHoja(). Devuelve:
 * { titulo, numero, proyecto, cliente, moneda, periodFrom, periodTo, tarjetas: [[etiqueta, valor, tipo, verde]],
 *   avances: [{ nombre, pct|null }], bloques: [{ nombre, estimable, filas: [{clave, concepto, monto, anterior, esta, acumulado, porEstimar, finiquito}] }] }
 */
export function armarBreve(hoja) {
  const t = hoja.totales
  const numero = String(hoja.numero ?? '').padStart(3, '0')
  const tarjetas = [
    ['Importe total', t.importe, 'dinero', false],
    ['Importe estimable', t.estimable, 'dinero', true],
    ['Acumulado anterior', t.acumAnterior, 'dinero', false],
    ['Esta estimación', t.actual, 'dinero', true],
    ['Acumulado global', t.acumGlobal, 'dinero', false],
    ['Por estimar', t.porEstimar, 'dinero', false],
    ['% Esta estimación', t.avanceEsta, 'pct', false],
    ['% Avance global', t.avanceGlobal, 'pct', true],
  ]
  const avances = hoja.bloques.map(b => ({ nombre: nombreCorto(b.nombre), pct: b.monto > 0 ? (b.acumulado / b.monto) * 100 : null }))
  const bloques = hoja.bloques
    .map(b => ({ nombre: b.nombre, estimable: b.monto, filas: b.filas.filter(f => f.esta > 0.004) }))
    .filter(b => b.filas.length)
  return {
    titulo: `Estimación #${numero} — ${hoja.proyecto}`,
    numero, proyecto: hoja.proyecto, cliente: hoja.cliente, moneda: hoja.moneda || 'MXN',
    periodFrom: hoja.periodFrom, periodTo: hoja.periodTo, tarjetas, avances, bloques,
    total: bloques.reduce((s, b) => s + b.filas.reduce((x, f) => x + f.esta, 0), 0),
  }
}

/** Nombre de archivo, como el de la hoja completa: "504-Estimación 3 (breve)" */
export const nombreBreve = hoja => `${(hoja.proyecto || '').split(/[-_]/)[0]}-Estimación ${hoja.numero} (breve)`
