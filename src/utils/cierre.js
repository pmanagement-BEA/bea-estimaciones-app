// Corte mensual de estimaciones: último día del mes o, si es inhábil, el día hábil anterior.
// Días inhábiles: sábado, domingo y días de descanso obligatorio (Ley Federal del Trabajo, art. 74).

const pad = n => String(n).padStart(2, '0')
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// n-ésimo lunes del mes (n = 1, 3…)
function nLunes(year, month, n) {
  const d = new Date(year, month, 1)
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1)
  d.setDate(d.getDate() + 7 * (n - 1))
  return d
}

export function festivos(year) {
  const s = new Set([
    `${year}-01-01`, `${year}-05-01`, `${year}-09-16`, `${year}-12-25`,
    iso(nLunes(year, 1, 1)),  // Constitución: primer lunes de febrero
    iso(nLunes(year, 2, 3)),  // Natalicio de Benito Juárez: tercer lunes de marzo
    iso(nLunes(year, 10, 3)), // Revolución: tercer lunes de noviembre
  ])
  if ((year - 2024) % 6 === 0) s.add(`${year}-10-01`) // Transmisión del Poder Ejecutivo
  return s
}

export function esHabil(d) {
  const dow = d.getDay()
  return dow !== 0 && dow !== 6 && !festivos(d.getFullYear()).has(iso(d))
}

/** Fecha de corte del mes (month 0-11). */
export function fechaCorte(year, month) {
  const d = new Date(year, month + 1, 0)
  while (!esHabil(d)) d.setDate(d.getDate() - 1)
  return d
}

/** Corte del mes al que pertenece una estimación (por su period_from 'YYYY-MM-DD'). */
export function corteDeEstimacion(periodFrom) {
  const [y, m] = (periodFrom || iso(new Date())).split('-').map(Number)
  return fechaCorte(y, m - 1)
}

/** Días naturales que faltan para el corte (negativo si ya pasó). */
export function diasParaCorte(corte, hoy = new Date()) {
  const a = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  return Math.round((corte - a) / 86400000)
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const fmtCorte = d => `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`

/** Texto corto para el tablero: "faltan 3 días", "hoy es el corte", "venció hace 2 días". */
export function textoCorte(corte, hoy = new Date()) {
  const n = diasParaCorte(corte, hoy)
  if (n > 1) return `faltan ${n} días`
  if (n === 1) return 'mañana es el corte'
  if (n === 0) return 'hoy es el corte'
  return `venció hace ${-n} día${n === -1 ? '' : 's'}`
}

/**
 * Mes del borrador: el mes en turno (puede haber meses sin estimar), salvo que ese
 * mes ya tenga una estimación enviada; entonces el siguiente. Devuelve { period_from, period_to }.
 */
export function periodoBorrador(estimaciones = [], hoy = new Date()) {
  let y = hoy.getFullYear(), m = hoy.getMonth()
  const enviados = new Set(estimaciones.filter(e => e.status === 'Enviada' && e.period_from).map(e => e.period_from.slice(0, 7)))
  while (enviados.has(`${y}-${pad(m + 1)}`)) { m++; if (m > 11) { m = 0; y++ } }
  const ultimo = new Date(y, m + 1, 0).getDate()
  return { period_from: `${y}-${pad(m + 1)}-01`, period_to: `${y}-${pad(m + 1)}-${pad(ultimo)}` }
}
