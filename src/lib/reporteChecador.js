// Reporte del Checador: asistencia, faltas, retardos, salidas tempranas y horas contra lo esperado,
// por día, semana o mes; por empresa, área y persona. Mismo permiso que el reporte diario.
import { supabase } from './supabase'
import { cargarChecadas, resumenPeriodo, motivoAusencia, diaIso, lunesDe, sumarDias, rangoDelMes, HORARIO } from './checador'

export const TOLERANCIA_MIN = 10 // minutos de tolerancia a la entrada
const lower = s => String(s || '').toLowerCase().trim()
const minutos = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m }
const minDelDia = t => { const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Monterrey', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t)).split(':').map(Number); return h * 60 + m }
const LIMITE_ENTRADA = minutos(HORARIO.inicio) + TOLERANCIA_MIN
const HORA_SALIDA = minutos(HORARIO.fin)

/** Rango de un periodo: dia | semana | mes, a partir de una fecha */
export function rangoPeriodo(tipo, fecha) {
  if (tipo === 'semana') { const l = lunesDe(fecha); return { desde: l, hasta: sumarDias(l, 4) } }
  if (tipo === 'mes') return rangoDelMes(fecha.slice(0, 7))
  return { desde: fecha, hasta: fecha }
}

export async function cargarPeriodo(desde, hasta) {
  const [dir, chk] = await Promise.all([
    supabase.from('directorio').select('email, nombre, area, puesto, activo').eq('activo', true),
    cargarChecadas({ desde, hasta }),
  ])
  if (dir.error) throw dir.error
  return { desde, hasta, directorio: dir.data || [], ...chk }
}

export function calcularPeriodo(d, ahora = Date.now()) {
  const hoy = diaIso()
  const personas = d.directorio.map(p => {
    const email = lower(p.email)
    const r = resumenPeriodo(d.desde, d.hasta, d.checadas.filter(c => lower(c.email) === email), d.ediciones.filter(e => lower(e.email) === email), ahora, (d.ausencias || []).filter(a => lower(a.email) === email))
    const habiles = r.dias.filter(x => x.esperadas > 0 && x.fecha < hoy)
    const faltas = habiles.filter(x => x.ms === 0)
    const retardos = r.dias.filter(x => x.esperadas > 0 && x.entrada && minDelDia(x.entrada) > LIMITE_ENTRADA)
    const tempranas = r.dias.filter(x => x.esperadas > 0 && x.fecha < hoy && x.salida && x.salida !== 'ahora' && minDelDia(x.salida) < HORA_SALIDA)
    const ausencias = r.dias.filter(x => x.ausencia)
    return {
      email, nombre: p.nombre, area: p.area || 'Sin área', puesto: p.puesto || '',
      r, dias: r.dias, ms: r.ms, esperadas: r.esperadasFecha, diferencia: r.diferencia,
      habiles: habiles.length, asistio: habiles.length - faltas.length,
      faltas, retardos, tempranas, ausencias, sinSalida: r.sinSalida, editados: r.editados,
      motivosAusencia: [...new Set(ausencias.map(x => motivoAusencia(x.ausencia.motivo_id)?.nombre || 'Ausencia'))],
    }
  })
  const suma = (ps, f) => ps.reduce((s, p) => s + f(p), 0)
  const agrupa = ps => ({
    personas: ps, ms: suma(ps, p => p.ms), esperadas: suma(ps, p => p.esperadas), diferencia: suma(ps, p => p.diferencia),
    habiles: suma(ps, p => p.habiles), asistio: suma(ps, p => p.asistio), faltas: suma(ps, p => p.faltas.length),
    retardos: suma(ps, p => p.retardos.length), tempranas: suma(ps, p => p.tempranas.length),
    sinSalida: suma(ps, p => p.sinSalida), editados: suma(ps, p => p.editados), ausencias: suma(ps, p => p.ausencias.length),
  })
  const areas = ['Consultoría', 'Commissioning', 'Modelación', 'Dirección / PMO', 'Sin área']
    .map(a => ({ area: a, ...agrupa(personas.filter(p => p.area === a)) })).filter(a => a.personas.length)
  return { desde: d.desde, hasta: d.hasta, personas, areas, total: agrupa(personas) }
}

export { minDelDia }
