import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Si se llega desde el correo de invitación o de "olvidé mi contraseña", hay que pedir una
// contraseña nueva. Se lee ANTES de crear el cliente, porque el cliente limpia el enlace.
const tipoEnlace = /[#&?]type=(invite|recovery|signup)/.exec(window.location.hash + window.location.search)?.[1]
try { if (tipoEnlace) sessionStorage.setItem('bea_crear_contrasena', tipoEnlace) } catch { /* sin storage */ }

export function pideContrasena() {
  try { return sessionStorage.getItem('bea_crear_contrasena') } catch { return tipoEnlace || null }
}
export function contrasenaLista() {
  try { sessionStorage.removeItem('bea_crear_contrasena') } catch { /* sin storage */ }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
