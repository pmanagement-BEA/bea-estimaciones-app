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

/**
 * Corte de una estimación: el último día de su periodo o, si es inhábil, el día hábil anterior.
 * (Para periodos de mes de calendario es el último día hábil del mes.) Sin period_to, el del mes de period_from.
 */
export function corteDeEstimacion(periodFrom, periodTo) {
  if (periodTo) {
    const d = fecha(periodTo)
    while (!esHabil(d)) d.setDate(d.getDate() - 1)
    return d
  }
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

const fecha = t => { const [y, m, d] = t.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }
const finDeMes = (y, m) => new Date(y, m + 1, 0).getDate()
// Suma meses conservando el día (si el mes no tiene ese día, el último del mes)
function masMeses(d, n) {
  const y = d.getFullYear(), m = d.getMonth() + n
  return new Date(y, m, Math.min(d.getDate(), finDeMes(y, m)))
}
const menosUnDia = d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)

/**
 * Siguiente periodo según el patrón del proyecto (el de su última estimación enviada):
 * - si estima por mes de calendario (empieza el día 1): el mes completo siguiente;
 * - si no (p. ej. del 11 al 10): empieza el día después de donde terminó y dura un mes.
 * `saltar` = cuántos periodos más adelante (meses sin estimar).
 */
export function periodoSiguiente(ultima, saltar = 0) {
  const desde0 = fecha(ultima.period_from), hasta0 = fecha(ultima.period_to)
  if (desde0.getDate() === 1) {
    const y = hasta0.getFullYear(), m = hasta0.getMonth() + 1 + saltar
    const ini = new Date(y, m, 1)
    return { period_from: iso(ini), period_to: iso(new Date(ini.getFullYear(), ini.getMonth(), finDeMes(ini.getFullYear(), ini.getMonth()))) }
  }
  const base = new Date(hasta0.getFullYear(), hasta0.getMonth(), hasta0.getDate() + 1)
  const ini = masMeses(base, saltar)
  return { period_from: iso(ini), period_to: iso(menosUnDia(masMeses(base, saltar + 1))) }
}

/** ¿Se enciman dos periodos? */
export const seEncima = (a, b) => !!(a?.period_from && a?.period_to && b?.period_from && b?.period_to) &&
  a.period_from <= b.period_to && a.period_to >= b.period_from

/**
 * Periodo del borrador: el periodo en turno según el patrón del proyecto (puede haber meses sin
 * estimar: se salta hasta el periodo que incluye hoy); nunca uno que ya tenga una estimación enviada.
 * Sin estimaciones enviadas: el mes de calendario en curso. Devuelve { period_from, period_to }.
 */
export function periodoBorrador(estimaciones = [], hoy = new Date()) {
  const enviadas = estimaciones.filter(e => e.status === 'Enviada' && e.period_from && e.period_to)
  const hoyIso = iso(hoy)
  if (!enviadas.length) {
    const y = hoy.getFullYear(), m = hoy.getMonth()
    return { period_from: `${y}-${pad(m + 1)}-01`, period_to: `${y}-${pad(m + 1)}-${pad(finDeMes(y, m))}` }
  }
  const ultima = [...enviadas].sort((a, b) => (b.number || 0) - (a.number || 0) || (b.period_to > a.period_to ? 1 : -1))[0]
  for (let k = 0; k < 240; k++) {
    const p = periodoSiguiente(ultima, k)
    if (p.period_to >= hoyIso && !enviadas.some(e => seEncima(e, p))) return p
  }
  return periodoSiguiente(ultima, 0)
}
