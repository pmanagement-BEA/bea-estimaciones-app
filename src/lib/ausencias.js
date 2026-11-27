// Ausencias (vacaciones, permisos, incapacidades…), saldos por motivo y anuncios.
import { supabase } from './supabase'
import { tipoDia, diasEntre, diaIso } from './checador'

export const ESTADOS = {
  pendiente: { texto: 'Pendiente', clase: 'pend' },
  aprobada: { texto: 'Aprobada', clase: 'ok' },
  rechazada: { texto: 'Rechazada', clase: 'no' },
  cancelada: { texto: 'Cancelada', clase: 'cancel' },
}
/** Aprobada que ya terminó: "Disfrutada" (Woffu le dice "Consumida"). */
export const textoEstado = a => (a.estado === 'aprobada' && a.fin < diaIso() ? 'Disfrutada' : ESTADOS[a.estado]?.texto || a.estado)

/** Días laborables entre dos fechas (misma regla que la base: sin fines de semana ni festivos de ley o de BEA). */
export const diasLaborables = (inicio, fin) => (inicio && fin && fin >= inicio ? diasEntre(inicio, fin).filter(f => tipoDia(f) === 'laborable').length : 0)

export const textoDias = n => `${+n % 1 ? (+n).toFixed(1) : +n} ${Math.abs(+n) === 1 ? 'día' : 'días'}`

/**
 * Saldo de una persona en un motivo: asignados (vigentes), dispuestos (aprobadas), pendientes y disponibles.
 * asignaciones y ausencias: solo de esa persona.
 */
export function saldo(motivoId, asignaciones, ausencias) {
  const hoy = diaIso()
  const asignados = asignaciones.filter(a => a.motivo_id === motivoId && (!a.fin || a.fin >= hoy)).reduce((s, a) => s + +a.dias, 0)
  // Lo que fue sin goce de sueldo no se descuenta del saldo
  const conGoce = a => +a.dias - (+a.dias_sin_goce || 0)
  const dispuestos = ausencias.filter(a => a.motivo_id === motivoId && a.estado === 'aprobada').reduce((s, a) => s + conGoce(a), 0)
  const pendientes = ausencias.filter(a => a.motivo_id === motivoId && a.estado === 'pendiente').reduce((s, a) => s + conGoce(a), 0)
  return { asignados, dispuestos, pendientes, disponibles: asignados - dispuestos - pendientes }
}

export async function cargarMotivos() {
  const { data, error } = await supabase.from('ausencia_motivos').select('*').order('orden').order('nombre')
  if (error) throw error
  return data || []
}

/** Ausencias y asignaciones (de una persona, o de todas si es administrador). */
export async function cargarAusencias(email = null) {
  let qa = supabase.from('ausencias').select('*').order('inicio', { ascending: false })
  let qs = supabase.from('ausencia_asignaciones').select('*').order('created_at', { ascending: false })
  if (email) { qa = qa.eq('email', email); qs = qs.eq('email', email) }
  const [a, s] = await Promise.all([qa, qs])
  if (a.error) throw a.error
  if (s.error) throw s.error
  return { ausencias: a.data || [], asignaciones: s.data || [] }
}

/** Días de vacaciones por año cumplido (LFT art. 76, reforma 2023): 12, 14, 16, 18, 20 y luego +2 cada 5 años. */
export function diasVacacionesLey(anios) {
  if (anios < 1) return 0
  if (anios <= 5) return 10 + 2 * anios
  return 22 + 2 * Math.floor((anios - 6) / 5)
}

/** Años cumplidos desde la fecha de ingreso. */
export function antiguedad(fechaIngreso, hoy = diaIso()) {
  if (!fechaIngreso) return null
  const [y1, m1, d1] = fechaIngreso.split('-').map(Number), [y2, m2, d2] = hoy.split('-').map(Number)
  return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0)
}

/** Fechas de ingreso (la propia, o todas si es administrador): { email: 'YYYY-MM-DD' } */
export async function cargarIngresos() {
  const { data, error } = await supabase.from('rh_ingresos').select('email, fecha_ingreso')
  if (error) return {}
  return Object.fromEntries((data || []).map(r => [r.email, r.fecha_ingreso]))
}
