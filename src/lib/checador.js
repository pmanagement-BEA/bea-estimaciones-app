// Checador: franjas de entrada → salida. La fecha de cada franja es el día de la entrada en hora de Monterrey.
import { supabase } from './supabase'
import { festivos } from '../utils/cierre.js'

export const ZONA = 'America/Monterrey'
/** Jornada de referencia (horario Escalón A-NL de Woffu): lunes a viernes hábiles, 8 h con 1 h 15 de comida. */
export const HORARIO = { inicio: '08:00', fin: '17:15', horas: 8, bloques: '08:00–13:45 · 15:00–17:15', descanso: '1 h 15 min de comida' }

// Días propios de BEA (tabla calendario_bea): { 'YYYY-MM-DD': { nombre, tipo: 'festivo' | 'evento' } }
let DIAS_BEA = {}
export const setCalendarioBea = filas => { DIAS_BEA = Object.fromEntries((filas || []).map(f => [f.fecha, f])) }
export const diaBea = f => DIAS_BEA[f] || null

/** Nombres de los festivos de ley (los mismos que calcula utils/cierre.js). */
function nombreFestivoLey(f) {
  const [, m, d] = f.split('-').map(Number)
  const lunes = fechaLocal(f).getDay() === 1
  if (m === 1 && d === 1) return 'Año Nuevo'
  if (m === 2 && lunes && d <= 7) return 'Día de la Constitución'
  if (m === 3 && lunes && d >= 15 && d <= 21) return 'Natalicio de Benito Juárez'
  if (m === 5 && d === 1) return 'Día del Trabajo'
  if (m === 9 && d === 16) return 'Día de la Independencia'
  if (m === 10 && d === 1) return 'Transmisión del Poder Ejecutivo'
  if (m === 11 && lunes && d >= 15 && d <= 21) return 'Aniversario de la Revolución'
  if (m === 12 && d === 25) return 'Navidad'
  return 'Festivo'
}
const H = 3600000

/** 'YYYY-MM-DD' de una fecha en hora de Monterrey. */
export const diaIso = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
/** 'HH:MM' (24 h) de un instante en hora de Monterrey. */
export const hhmm = t => (t ? new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t)) : '')
export const hhmmss = t => (t ? new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(t)) : '')
export const hora = t => (t ? new Date(t).toLocaleTimeString('es-MX', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' }) : '')
export const mayuscula = t => (t ? t[0].toUpperCase() + t.slice(1) : t)
const fechaLocal = f => new Date(f + 'T12:00:00')
export const textoDia = f => mayuscula(fechaLocal(f).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, ''))
export const textoDiaLargo = f => mayuscula(fechaLocal(f).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
export const fechaHora = t => new Date(t).toLocaleString('es-MX', { timeZone: ZONA, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Instante (ISO) de 'YYYY-MM-DD' + 'HH:MM' en hora de Monterrey. */
export function aInstante(fecha, hm) {
  const supuesto = new Date(`${fecha}T${hm}:00Z`)
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ZONA, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(supuesto).map(x => [x.type, x.value]))
  const comoLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
  return new Date(supuesto.getTime() - (comoLocal - supuesto.getTime())).toISOString()
}

export const sumarDias = (f, n) => { const d = fechaLocal(f); d.setDate(d.getDate() + n); return diaIsoLocal(d) }
const diaIsoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function lunesDe(f) { const d = fechaLocal(f); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return diaIsoLocal(d) }
export function diasEntre(desde, hasta) { const out = []; for (let f = desde; f <= hasta; f = sumarDias(f, 1)) out.push(f); return out }

/** 'laborable' | 'descanso' (fin de semana) | 'festivo' */
export function tipoDia(f) {
  const d = fechaLocal(f)
  if (d.getDay() === 0 || d.getDay() === 6) return 'descanso'
  if (DIAS_BEA[f]?.tipo === 'festivo') return 'festivo'
  return festivos(d.getFullYear()).has(f) ? 'festivo' : 'laborable'
}
/** Nombre del festivo o evento del día ('' si no hay). */
export function nombreDia(f) {
  if (DIAS_BEA[f]) return DIAS_BEA[f].nombre
  return festivos(fechaLocal(f).getFullYear()).has(f) ? nombreFestivoLey(f) : ''
}
export const esEvento = f => DIAS_BEA[f]?.tipo === 'evento'

// Motivos de ausencia { id: { nombre, color } } para pintar los días con ausencia aprobada
let MOTIVOS = {}
export const setMotivosAusencia = lista => { MOTIVOS = Object.fromEntries((lista || []).map(m => [m.id, m])) }
export const motivoAusencia = id => MOTIVOS[id] || null
const ausenciaDelDia = (f, ausencias) => ausencias.find(a => a.inicio <= f && a.fin >= f) || null
export const esperadasDia = f => (tipoDia(f) === 'laborable' ? HORARIO.horas * H : 0)

/** Milisegundos de una franja; abierta de hoy cuenta hasta ahora, abierta de otro día no cuenta. */
export function duracion(c, ahora = Date.now()) {
  if (c.salida) return new Date(c.salida) - new Date(c.entrada)
  return c.fecha === diaIso() ? Math.max(0, ahora - new Date(c.entrada)) : 0
}
export const sinSalida = c => !c.salida && c.fecha !== diaIso()
export const abierta = c => !c.salida && c.fecha === diaIso()

/** 7 h 05 min · con signo: +0 h 21 min / −1 h 10 min */
export function textoHoras(ms, signo = false) {
  const neg = ms < 0
  const min = Math.round(Math.abs(ms) / 60000)
  const h = Math.floor(min / 60), m = min % 60
  const t = h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
  return signo ? `${neg ? '−' : min ? '+' : ''}${t}` : (neg ? '−' : '') + t
}

/** Resumen de un día: franjas ordenadas, primera entrada, última salida, descansos, horas, esperadas y diferencia. */
export function resumenDia(fecha, franjas = [], ediciones = [], ahora = Date.now(), ausencias = []) {
  const fs = [...franjas].sort((a, b) => String(a.entrada).localeCompare(String(b.entrada)))
  const ms = fs.reduce((s, c) => s + duracion(c, ahora), 0)
  let descansos = 0
  for (let i = 1; i < fs.length; i++) if (fs[i - 1].salida) descansos += Math.max(0, new Date(fs[i].entrada) - new Date(fs[i - 1].salida))
  const ultima = fs.at(-1)
  const ausencia = esperadasDia(fecha) ? ausenciaDelDia(fecha, ausencias) : null
  const esperadas = ausencia ? 0 : esperadasDia(fecha)
  const hoy = diaIso()
  return {
    fecha, franjas: fs, ms, descansos, esperadas, tipo: tipoDia(fecha), ausencia,
    entrada: fs[0]?.entrada || null,
    salida: ultima ? (ultima.salida || (abierta(ultima) ? 'ahora' : null)) : null,
    // Hoy no se cuenta como faltante hasta que termine el día
    diferencia: fecha === hoy ? (ms > esperadas ? ms - esperadas : 0) : ms - esperadas,
    sinSalida: fs.filter(sinSalida).length,
    ediciones: ediciones.filter(e => e.fecha === fecha).sort((a, b) => String(b.hecho_en).localeCompare(String(a.hecho_en))),
  }
}

/** Días de un rango (hasta hoy como máximo), del más reciente al más viejo, con su resumen. */
export function diasDelRango(desde, hasta, checadas, ediciones = [], ahora = Date.now(), ausencias = []) {
  const tope = hasta < diaIso() ? hasta : diaIso()
  if (tope < desde) return []
  const porFecha = new Map()
  for (const c of checadas) { if (!porFecha.has(c.fecha)) porFecha.set(c.fecha, []); porFecha.get(c.fecha).push(c) }
  return diasEntre(desde, tope).reverse().map(f => resumenDia(f, porFecha.get(f) || [], ediciones, ahora, ausencias))
}

/** Total de un periodo: horas hechas, esperadas a la fecha y en todo el periodo, días trabajados, sin salida, editados. */
export function resumenPeriodo(desde, hasta, checadas, ediciones = [], ahora = Date.now(), ausencias = []) {
  const dentro = checadas.filter(c => c.fecha >= desde && c.fecha <= hasta)
  const dias = diasDelRango(desde, hasta, dentro, ediciones.filter(e => e.fecha >= desde && e.fecha <= hasta), ahora, ausencias)
  const hoy = diaIso()
  const esperadasFecha = dias.reduce((s, d) => s + (d.fecha < hoy ? d.esperadas : 0), 0)
  const esperadasTotal = diasEntre(desde, hasta).reduce((s, f) => s + (ausenciaDelDia(f, ausencias) ? 0 : esperadasDia(f)), 0)
  const ms = dias.reduce((s, d) => s + d.ms, 0)
  const msAntesDeHoy = dias.reduce((s, d) => s + (d.fecha < hoy ? d.ms : 0), 0)
  const trabajados = dias.filter(d => d.ms > 0).length
  return {
    ms, esperadasFecha, esperadasTotal, trabajados,
    diferencia: msAntesDeHoy - esperadasFecha,
    promedio: trabajados ? ms / trabajados : 0,
    sinSalida: dias.reduce((s, d) => s + d.sinSalida, 0),
    editados: dias.filter(d => d.ediciones.length).length,
    diasAusencia: dias.filter(d => d.ausencia).length,
    dias,
  }
}

/** Primer y último día de un mes 'YYYY-MM'. */
export function rangoDelMes(mes) {
  const [y, m] = mes.split('-').map(Number)
  return { desde: `${mes}-01`, hasta: `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }
}

async function todas(tabla, armar) {
  const out = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await armar(supabase.from(tabla).select('*')).range(i, i + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}

/** Franjas vigentes (sin las borradas) y ediciones de un rango; de una persona o de todas (solo admin). */
export async function cargarChecadas({ desde, hasta, email = null }) {
  const [checadas, ediciones, ausencias] = await Promise.all([
    todas('checadas', q => { q = q.gte('fecha', desde).lte('fecha', hasta).eq('borrada', false); return (email ? q.eq('email', email) : q).order('entrada', { ascending: true }) }),
    todas('checadas_ediciones', q => { q = q.gte('fecha', desde).lte('fecha', hasta); return (email ? q.eq('email', email) : q).order('hecho_en', { ascending: false }) }),
    // Ausencias aprobadas que tocan el rango (si la tabla todavía no existe, sin ausencias)
    todas('ausencias', q => { q = q.eq('estado', 'aprobada').lte('inicio', hasta).gte('fin', desde); return (email ? q.eq('email', email) : q).order('inicio') }).catch(() => []),
  ])
  return { checadas, ediciones, ausencias }
}
