import { supabase } from './supabase'

export const AREAS_DIRECTORIO = ['Consultoría', 'Commissioning', 'Modelación', 'Dirección / PMO']
export const ROLES_APP = [
  ['colaborador', 'Colaborador (ve sus proyectos asignados)'],
  ['lider', 'Líder de proyecto (crea proyectos, envía estimaciones)'],
  ['coordinador', 'Coordinador (ve todo, administra el directorio)'],
]

// Rol dentro del proyecto → área sugerida para filtrar la lista
export const TEAM_ROLE_AREA = {
  lider: 'Consultoría',
  consultor: 'Consultoría',
  cx: 'Commissioning',
  me: 'Modelación',
  coordinador: null,
}

export const TEAM_ROLE_LABEL = {
  lider: 'Líder de Proyecto',
  cx: 'Commissioning (Cx)',
  me: 'Modelación Energética',
  consultor: 'Consultor LEED',
  coordinador: 'Coordinador',
}

export function normEmail(e) {
  return (e || '').trim().toLowerCase()
}

/** Devuelve { available, data }. available=false si la migración aún no se corre. */
export async function fetchDirectorio() {
  const { data, error } = await supabase.from('directorio').select('*').order('nombre')
  if (error) return { available: false, data: [] }
  return { available: true, data: data || [] }
}

/** Asignaciones de un proyecto: { lider: [email], cx: [email], ... } */
export async function fetchProjectMembers(projectId) {
  const { data, error } = await supabase.from('project_members').select('*').eq('project_id', projectId)
  if (error) return { available: false, byRol: {} }
  const byRol = {}
  ;(data || []).forEach(m => { (byRol[m.rol] ||= []).push(m.email) })
  return { available: true, byRol }
}

/** Reemplaza a la persona asignada a un rol del proyecto (un responsable por rol). */
export async function setProjectRole(projectId, rol, email) {
  const del = await supabase.from('project_members').delete().eq('project_id', projectId).eq('rol', rol)
  if (del.error) return { error: del.error }
  if (!email) return {}
  return supabase.from('project_members').insert({ project_id: projectId, rol, email: normEmail(email) })
}

/** Mis asignaciones: { project_id: [rol, ...] } */
export async function fetchMyAssignments(email) {
  const { data, error } = await supabase.from('project_members').select('project_id, rol').eq('email', normEmail(email))
  if (error) return {}
  const map = {}
  ;(data || []).forEach(m => { (map[m.project_id] ||= []).push(m.rol) })
  return map
}

/**
 * Lee texto pegado desde Excel/Sheets (tab o coma). Columnas esperadas:
 * Nombre, Correo, Área, Puesto, Rol  (el encabezado es opcional; se detecta por el @).
 */
export function parseDirectorioPaste(text) {
  const rows = []
  const errors = []
  const areaMap = a => {
    const s = (a || '').toLowerCase()
    if (/commission|comisiona|\bcx\b/.test(s)) return 'Commissioning'
    if (/model|\bme\b|energ/.test(s)) return 'Modelación'
    if (/direc|pmo|admin|gerencia/.test(s)) return 'Dirección / PMO'
    if (/consult|leed|lider|líder/.test(s)) return 'Consultoría'
    return null
  }
  const rolMap = r => {
    const s = (r || '').toLowerCase()
    if (/coord/.test(s)) return 'coordinador'
    if (/lider|líder/.test(s)) return 'lider'
    return 'colaborador'
  }
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return
    const cols = line.includes('\t') ? line.split('\t') : line.split(',')
    const c = cols.map(x => x.trim())
    const emailIdx = c.findIndex(x => x.includes('@'))
    if (emailIdx === -1) {
      if (i > 0) errors.push(`Línea ${i + 1}: sin correo`)
      return
    }
    const rest = c.filter((_, j) => j !== emailIdx)
    rows.push({
      email: normEmail(c[emailIdx]),
      nombre: rest[0] || '',
      area: areaMap(rest[1]),
      puesto: rest[2] || '',
      rol_app: rolMap(rest[3]),
      activo: true,
    })
  })
  return { rows, errors }
}
