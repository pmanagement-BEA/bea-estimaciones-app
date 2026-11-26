// Track: registro de tiempo propio de BEA. El catálogo (proyectos y actividades) viene de Toggl
// y se conservan sus ids; el histórico mensual de Toggl (2024 →) vive en track_historico.
import { supabase } from './supabase'
import { diaIso, aInstante, ZONA } from './checador'

export const H = 3600000

/** Trae todas las filas de una consulta paginando de 1000 en 1000 (límite de Supabase). */
export async function todas(armar) {
  const out = []
  for (let desde = 0; desde < 200000; desde += 1000) {
    const { data, error } = await armar().range(desde, desde + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

export const cargarProyectos = () =>
  todas(() => supabase.from('track_proyectos').select('*').order('nombre'))

export async function cargarActividades(proyectoId) {
  const { data, error } = await supabase.from('track_actividades').select('*').eq('proyecto_id', proyectoId).order('nombre')
  if (error) throw error
  return data || []
}

/** Conceptos de la estimación de un proyecto de la app (para ligar el tiempo al concepto del contrato). */
export async function cargarConceptos(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase.from('disciplines').select('name, sort_order, concepts(id, key, description, sort_order)').eq('project_id', projectId).order('sort_order')
  if (error) return []
  return (data || []).flatMap(d => [...(d.concepts || [])].sort((a, b) => a.sort_order - b.sort_order).map(c => ({ ...c, disciplina: d.name })))
}

/** Registros con inicio entre dos días (inclusive), de una persona o de todos (si se puede). */
export function cargarRegistros({ desde, hasta, email }) {
  return todas(() => {
    let q = supabase.from('track_registros').select('*')
      .gte('inicio', aInstante(desde, '00:00'))
      .lt('inicio', aInstante(sumarDia(hasta), '00:00'))
      .order('inicio', { ascending: false })
    if (email) q = q.eq('email', email)
    return q
  })
}

export const cargarHistorico = ({ mesDesde, mesHasta }) =>
  todas(() => supabase.from('track_historico').select('*').gte('mes', mesDesde).lte('mes', mesHasta))

export async function cronometroActivo(email) {
  const { data } = await supabase.from('track_registros').select('*').eq('email', email).is('fin', null).maybeSingle()
  return data || null
}

const sumarDia = f => { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export const duracionMs = (r, ahora = Date.now()) => Math.max(0, (r.fin ? new Date(r.fin).getTime() : ahora) - new Date(r.inicio).getTime())
export const diaDe = r => diaIso(new Date(r.inicio))
export const mesDe = r => diaDe(r).slice(0, 7)

/** 3 h 05 min */
export function textoH(ms) {
  const min = Math.round(ms / 60000)
  const h = Math.floor(min / 60), m = min % 60
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}
/** 1,234.5 h */
export const horas = (ms, dec = 1) => `${(ms / H).toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec })} h`
export const num = (n, dec = 0) => (n ?? 0).toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec })

const dos = n => String(n).padStart(2, '0')
/** 01:23:45 */
export const reloj = ms => { const t = Math.floor(ms / 1000); return `${dos(Math.floor(t / 3600))}:${dos(Math.floor(t / 60) % 60)}:${dos(t % 60)}` }

/** Proyectos internos de BEA (000-BEA, 003-PMO, …): cuentan como horas indirectas. */
export const esIndirecto = p => !p || /^00\d/.test(p.nombre || '') || /^0\d\d[\s-]/.test(p.nombre || '')

/** Interpreta "1:30", "1.5", "90m", "2h" → milisegundos. */
export function leerDuracion(txt) {
  const t = String(txt || '').trim().toLowerCase().replace(',', '.')
  let m
  if ((m = t.match(/^(\d+):(\d{1,2})$/))) return (+m[1] * 60 + +m[2]) * 60000
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*m(in)?$/))) return +m[1] * 60000
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*h?$/))) return +m[1] * H
  return null
}

export { ZONA }
