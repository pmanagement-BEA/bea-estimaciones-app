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

/**
 * Coordinador: crea de un jalón la cuenta de cada persona activa del directorio que aún no tiene.
 * Las contraseñas temporales se generan aquí, en el navegador, y solo se muestran al coordinador.
 * Nunca toca cuentas que ya existen (no les cambia la contraseña).
 * onAvance(hechos, total) para mostrar el progreso.
 */
export async function crearCuentasMasivo(personas, onAvance) {
  const resultados = []
  for (const [i, p] of personas.entries()) {
    const clave = generarTemporal()
    const { resultado, error } = await asignarContrasenaTemporal(p.email, clave)
    resultados.push({ ...p, clave: error ? '' : clave, ok: !error && resultado === 'creada', error: error?.message || (resultado !== 'creada' ? 'Ya tenía cuenta' : '') })
    onAvance?.(i + 1, personas.length)
  }
  return resultados
}

/** Texto listo para mandar por WhatsApp o Chat a cada persona. */
export function mensajeBienvenida({ nombre, email, clave }) {
  const url = window.location.origin + import.meta.env.BASE_URL
  return `Hola ${(nombre || '').split(' ')[0]}, ya tienes cuenta en la app de Estimaciones BEA.\n` +
    `Entra a ${url}\nCorreo: ${email}\nContraseña temporal: ${clave}\n` +
    `Al entrar te pedirá crear tu propia contraseña.`
}

/** CSV (con BOM para que Excel respete acentos). */
export function csvCuentas(resultados) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const filas = [['Nombre', 'Correo', 'Área', 'Contraseña temporal', 'Resultado']]
    .concat(resultados.map(r => [r.nombre, r.email, r.area || '', r.clave, r.ok ? 'Creada' : r.error]))
  return '﻿' + filas.map(f => f.map(esc).join(',')).join('\r\n')
}

/** Contraseña temporal fácil de dictar: BEA-XXXX-XXXX sin letras confusas. */
export function generarTemporal() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const r = crypto.getRandomValues(new Uint32Array(8))
  const s = [...r].map(n => abc[n % abc.length]).join('')
  return `BEA-${s.slice(0, 4)}-${s.slice(4)}`
}
