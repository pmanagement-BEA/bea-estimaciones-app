// Reporte diario de Track: en qué se fueron las horas de un día (empresa, área y persona) y quién registró
// menos de lo que le tocaba. Lo ven solo PMO, Dirección y Héctor (public.ve_reporte_diario()).
// Le tocaba = 8 h en día hábil; 0 en fin de semana, festivo (de ley o del calendario BEA) o con ausencia aprobada.
import { supabase } from './supabase'
import { cargarRegistros, duracionMs, esIndirecto, H } from './track'
import { cargarChecadas, setCalendarioBea, setMotivosAusencia, motivoAusencia, resumenDia, tipoDia, sumarDias, diaIso } from './checador'
import { cargarMotivos } from './ausencias'

export const AREAS_RD = ['Consultoría', 'Commissioning', 'Modelación', 'Dirección / PMO']
const lower = s => String(s || '').toLowerCase().trim()

export async function puedeVerReporteDiario() {
  const { data, error } = await supabase.rpc('ve_reporte_diario')
  return !error && data === true
}

/** Calendario BEA y motivos de ausencia (para saber qué días son hábiles) */
export async function prepararCalendario() {
  const [cal, mot] = await Promise.all([
    supabase.from('calendario_bea').select('*'),
    cargarMotivos().catch(() => []),
  ])
  setCalendarioBea(cal.data || [])
  setMotivosAusencia(mot)
}

/** El último día hábil antes de hoy */
export function diaHabilAnterior(hoy = diaIso()) {
  let f = sumarDias(hoy, -1)
  for (let i = 0; i < 14 && tipoDia(f) !== 'laborable'; i++) f = sumarDias(f, -1)
  return f
}

export async function cargarDia(fecha) {
  const [dir, tps, regs, chk] = await Promise.all([
    supabase.from('directorio').select('email, nombre, area, activo').eq('activo', true),
    supabase.from('track_proyectos').select('id, nombre, project_id, facturable'),
    cargarRegistros({ desde: fecha, hasta: fecha }),
    cargarChecadas({ desde: fecha, hasta: fecha }).catch(() => ({ checadas: [], ediciones: [], ausencias: [] })),
  ])
  if (dir.error) throw dir.error
  // Nombres de actividades y conceptos de los registros del día
  const actIds = [...new Set(regs.map(r => r.actividad_id).filter(Boolean))]
  const conIds = [...new Set(regs.map(r => r.concepto_id).filter(Boolean))]
  const [acts, cons] = await Promise.all([
    actIds.length ? supabase.from('track_actividades').select('id, nombre').in('id', actIds) : { data: [] },
    conIds.length ? supabase.from('concepts').select('id, key, description').in('id', conIds) : { data: [] },
  ])
  return {
    fecha, directorio: dir.data || [], tps: tps.data || [], registros: regs,
    checadas: chk.checadas || [], ausencias: chk.ausencias || [],
    actividades: Object.fromEntries((acts.data || []).map(a => [String(a.id), a.nombre])),
    conceptos: Object.fromEntries((cons.data || []).map(c => [c.id, `${c.key} ${c.description}`])),
  }
}

/** Todo el cálculo del día */
export function calcularDia(d, ahora = Date.now()) {
  const tpPorId = new Map(d.tps.map(t => [String(t.id), t]))
  const personas = d.directorio.map(p => {
    const email = lower(p.email)
    const regs = d.registros.filter(r => lower(r.email) === email).sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
    const franjas = d.checadas.filter(c => lower(c.email) === email)
    const aus = d.ausencias.filter(a => lower(a.email) === email)
    const dia = resumenDia(d.fecha, franjas, [], ahora, aus)
    const track = regs.reduce((s, r) => s + duracionMs(r, ahora), 0)
    const indirectas = regs.reduce((s, r) => s + (esIndirecto(tpPorId.get(String(r.proyecto_id))) ? duracionMs(r, ahora) : 0), 0)
    const esperadas = dia.esperadas
    const falta = Math.max(0, esperadas - track)
    const estado = dia.ausencia ? 'ausencia' : esperadas === 0 ? 'no-laboral' : track === 0 ? 'nada' : falta > 0.5 * H ? 'falta' : 'completo'
    return {
      email, nombre: p.nombre, area: p.area || 'Sin área', esperadas, track, checado: dia.ms, falta, indirectas, estado,
      ausencia: dia.ausencia ? (motivoAusencia(dia.ausencia.motivo_id)?.nombre || 'Ausencia') : null,
      registros: regs.map(r => {
        const tp = tpPorId.get(String(r.proyecto_id))
        return {
          id: r.id, inicio: r.inicio, fin: r.fin, ms: duracionMs(r, ahora), proyecto: tp?.nombre || 'Proyecto',
          que: r.concepto_id ? d.conceptos[r.concepto_id] : r.actividad_id ? d.actividades[String(r.actividad_id)] : '',
          descripcion: r.descripcion || '', conConcepto: !!r.concepto_id, indirecto: esIndirecto(tp),
        }
      }),
    }
  })

  // En qué se fueron las horas: por proyecto (empresa y por área)
  const porProyecto = (lista) => {
    const m = new Map()
    for (const p of lista) for (const r of p.registros) {
      const x = m.get(r.proyecto) || { proyecto: r.proyecto, ms: 0, personas: new Set(), indirecto: r.indirecto }
      x.ms += r.ms; x.personas.add(p.nombre); m.set(r.proyecto, x)
    }
    return [...m.values()].map(x => ({ ...x, personas: [...x.personas] })).sort((a, b) => b.ms - a.ms)
  }
  const suma = (lista, k) => lista.reduce((s, p) => s + p[k], 0)
  const areas = AREAS_RD.concat(['Sin área']).map(area => {
    const ps = personas.filter(p => p.area === area)
    if (!ps.length) return null
    return { area, personas: ps, track: suma(ps, 'track'), esperadas: suma(ps, 'esperadas'), checado: suma(ps, 'checado'), proyectos: porProyecto(ps), conFalta: ps.filter(p => p.estado === 'falta' || p.estado === 'nada').length }
  }).filter(Boolean)
  const conFalta = personas.filter(p => p.estado === 'falta' || p.estado === 'nada').sort((a, b) => b.falta - a.falta)
  return {
    fecha: d.fecha, laborable: tipoDia(d.fecha) === 'laborable', personas, areas, conFalta,
    proyectos: porProyecto(personas),
    totales: {
      track: suma(personas, 'track'), esperadas: suma(personas, 'esperadas'), checado: suma(personas, 'checado'), indirectas: suma(personas, 'indirectas'),
      registraron: personas.filter(p => p.track > 0).length, esperaban: personas.filter(p => p.esperadas > 0).length,
      ausentes: personas.filter(p => p.estado === 'ausencia').length,
    },
  }
}

export { H }
