import { supabase } from './supabase'
import { normEmail } from './directorio'

// Rol del proyecto → área que puede marcar/editar. El líder y el coordinador pueden todo.
export const ROL_AREA = { consultor: 'Consultoría', cx: 'Commissioning', me: 'Modelación' }

/** { area: { listo_por, listo_nombre, listo_at } } de una estimación */
export async function fetchEstadoAreas(estimationId) {
  const { data } = await supabase.from('estimation_area_status').select('*').eq('estimation_id', estimationId)
  return Object.fromEntries((data || []).map(r => [r.area, r]))
}

/** { estimation_id: { area: fila } } para varias estimaciones (tablero) */
export async function fetchEstadoAreasMuchas(ids) {
  if (!ids.length) return {}
  const { data } = await supabase.from('estimation_area_status').select('*').in('estimation_id', ids)
  const out = {}
  ;(data || []).forEach(r => { (out[r.estimation_id] ||= {})[r.area] = r })
  return out
}

export async function marcarAreaLista(estimationId, area, profile) {
  const { data, error } = await supabase.from('estimation_area_status')
    .insert({ estimation_id: estimationId, area, listo_por: normEmail(profile?.email), listo_nombre: profile?.nombre || '' })
    .select().single()
  return { fila: data, error }
}

export async function quitarAreaLista(estimationId, area) {
  const { error } = await supabase.from('estimation_area_status').delete()
    .eq('estimation_id', estimationId).eq('area', area)
  return { error }
}

/**
 * Qué puede hacer el usuario en este proyecto.
 * todo: líder, dueño o coordinador (edita y marca cualquier área).
 * areas: áreas propias por su rol en el proyecto.
 */
export async function permisosProyecto(project, profile) {
  const { data } = await supabase.from('project_members').select('rol')
    .eq('project_id', project.id).eq('email', normEmail(profile?.email))
  const roles = (data || []).map(r => r.rol)
  const todo = profile?.role === 'coordinador' || project.user_id === profile?.id || roles.includes('lider') || roles.includes('coordinador')
  const areas = new Set(roles.map(r => ROL_AREA[r]).filter(Boolean))
  return { todo, areas, roles }
}
