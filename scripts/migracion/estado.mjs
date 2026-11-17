// Estado de cada proyecto según su libro: activo / en pausa / terminado / sin datos.
import fs from 'fs'
import { conciliar } from './conciliar.mjs'
const HOY = process.env.CORTE || '2026-11'
const mesesEntre = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1) }
const libros = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const out = libros.map(l => {
  const archivo = l.archivo.split('/').pop()
  if (!l.meses.length) return { archivo, estado: 'SIN FORMATO BEA', detalle: 'no se encontraron hojas mensuales del machote' }
  const ult = l.meses.at(-1)
  const conCobro = l.meses.filter(m => (m.encabezado.estimacion_actual || 0) > 1 ||
    m.disciplinas.some(d => d.conceptos.some(c => c.marca_esta > 0)))
  const ultimoCobro = conCobro.at(-1)?.periodo || null
  let c = null
  try { c = conciliar(l) } catch (e) { /* estructura rara */ }
  const estimable = (ult.encabezado.estimable || 0) + (ult.encabezado.estimable_adicional || 0)
  const porEstimar = ult.encabezado.por_estimar ?? null
  const terminado = porEstimar !== null && estimable > 0 && porEstimar <= Math.max(1, estimable * 0.005)
  const sinCobro = ultimoCobro ? mesesEntre(ultimoCobro, HOY) : 99
  const estado = terminado ? 'TERMINADO' : sinCobro <= 2 ? 'ACTIVO' : 'EN PAUSA'
  return { archivo, estado, ultimo_cobro: ultimoCobro, ultima_hoja: ult.periodo, meses: l.meses.length,
    importe: ult.encabezado.importe_total, por_estimar: porEstimar,
    cuadra: c ? `${c.meses_que_cuadran}/${c.meses}` : 'error' }
})
console.log(JSON.stringify(out, null, 1))
