import { supabase } from './supabase'

/** Coordinador: crea la cuenta (si no existe) o reasigna una contraseña temporal. */
export async function asignarContrasenaTemporal(email, password) {
  const { data, error } = await supabase.rpc('asignar_contrasena_temporal', { p_email: email, p_password: password })
  return { resultado: data, error }
}

/** Coordinador: { email: { tiene_cuenta, debe_cambiar, ultimo_acceso } } */
export async function fetchCuentas() {
  const { data, error } = await supabase.rpc('cuentas_directorio')
  if (error) return {}
  return Object.fromEntries((data || []).map(r => [r.email, r]))
}

/** Contraseña temporal fácil de dictar: BEA-XXXX-XXXX sin letras confusas. */
export function generarTemporal() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const r = crypto.getRandomValues(new Uint32Array(8))
  const s = [...r].map(n => abc[n % abc.length]).join('')
  return `BEA-${s.slice(0, 4)}-${s.slice(4)}`
}
