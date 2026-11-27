// Reporte mensual de Cx: uno por proyecto y mes (tabla reportes_cx). Reemplaza el Google Sheet
// "REPORTES MENSUALES": matriz de equipos, issues log de diseño y construcción, reuniones y acuerdos,
// y el correo al líder con los conceptos de Cx que se pueden cobrar en el mes.
import { supabase } from './supabase'
import { disciplineArea } from '../utils/calculations.js'
import { prepararProyecto, conceptosPorEstimar, nombreCorto, sumarMeses, MESES_LARGOS } from './proyecciones.js'

export const SISTEMAS = [
  ['hvac', 'Sistema HVAC'],
  ['electrico', 'Sistema Eléctrico'],
  ['iluminacion', 'Sistema de iluminación'],
  ['hidrosanitario', 'Sistema Hidrosanitario'],
  ['renovable', 'Sistema de energía renovable'],
]
export const ESTADOS_ISSUE = [['ingresos', 'No. de ingresos'], ['abierto', 'Abierto'], ['proceso', 'En proceso'], ['cerrado', 'Cerrado']]

export const mesMayus = mes => MESES_LARGOS[+mes.slice(5, 7) - 1].toUpperCase()
export const ultimoDiaMes = mes => { const [y, m] = mes.split('-').map(Number); return `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }

/** Reporte vacío (todo NA) o copiado del mes anterior, para un proyecto y mes */
export function reporteNuevo(projectId, mes, anterior) {
  const base = anterior ? {
    matriz: anterior.matriz, nota_matriz: anterior.nota_matriz,
    issues_diseno: anterior.issues_diseno, nota_diseno: anterior.nota_diseno,
    issues_construccion: anterior.issues_construccion, nota_construccion: anterior.nota_construccion,
    comentarios: anterior.comentarios,
  } : {
    matriz: Object.fromEntries(SISTEMAS.map(([k]) => [k, null])), nota_matriz: '',
    issues_diseno: Object.fromEntries(SISTEMAS.map(([k]) => [k, null])), nota_diseno: '',
    issues_construccion: Object.fromEntries(SISTEMAS.map(([k]) => [k, null])), nota_construccion: '',
    comentarios: '',
  }
  return { project_id: projectId, mes, fecha_corte: ultimoDiaMes(mes), conceptos_cobrar: [], estado: 'borrador', ...JSON.parse(JSON.stringify(base)) }
}

/** Proyectos con Cx: los de la persona (rol cx o líder) o todos si es coordinador; con su reporte del mes y del anterior */
export async function cargarProyectosCx(mes) {
  const [proj, miembros, dir, reps, proy] = await Promise.all([
    supabase.from('projects').select('*, disciplines (*, concepts(*)), estimations (*, estimation_items(*))').in('status', ['Activo', 'Pausado', 'Terminado']),
    supabase.from('project_members').select('project_id, rol, email'),
    supabase.from('directorio').select('nombre, email'),
    supabase.from('reportes_cx').select('*').in('mes', [mes, sumarMeses(mes, -1)]),
    supabase.from('proyecciones').select('project_id, mes, concept_id, monto').eq('mes', mes),
  ])
  for (const r of [proj, miembros, dir]) if (r.error) throw r.error
  const nombre = Object.fromEntries((dir.data || []).map(d => [String(d.email).toLowerCase(), d.nombre]))
  const conReporte = new Set((reps.data || []).map(r => r.project_id))
  // Activos y pausados con Cx; los terminados solo si traen reporte del mes o del anterior
  const conCx = (proj.data || []).filter(p => (p.disciplines || []).some(d => disciplineArea(d) === 'Commissioning') && (p.status !== 'Terminado' || conReporte.has(p.id)))
  return conCx.map(p => {
    const ms = (miembros.data || []).filter(m => m.project_id === p.id)
    const lider = ms.find(m => m.rol === 'lider')
    const cx = ms.filter(m => m.rol === 'cx')
    return {
      p, miembros: ms,
      lider: lider ? { email: lider.email, nombre: nombre[String(lider.email).toLowerCase()] || lider.email } : null,
      cx: cx.map(m => ({ email: m.email, nombre: nombre[String(m.email).toLowerCase()] || m.email })),
      reporte: (reps.data || []).find(r => r.project_id === p.id && r.mes === mes) || null,
      anterior: (reps.data || []).find(r => r.project_id === p.id && r.mes === sumarMeses(mes, -1)) || null,
      proyectados: new Set((proy.data || []).filter(x => x.project_id === p.id && x.concept_id).map(x => x.concept_id)),
    }
  }).sort((a, b) => a.p.name.localeCompare(b.p.name))
}

/** Conceptos de Cx que faltan por cobrar (para elegir los del correo) */
export function conceptosCxPendientes(p) {
  const { disciplines, estimations } = prepararProyecto(p)
  return conceptosPorEstimar(p, disciplines, estimations).filter(x => x.area === 'Commissioning')
}

export async function guardarReporte(rep) {
  const fila = { ...rep, actualizado_at: new Date().toISOString() }
  delete fila.actualizado_por
  const { data, error } = await supabase.from('reportes_cx').upsert(fila, { onConflict: 'project_id,mes' }).select().single()
  if (error) throw error
  return data
}

/** "614-26-CL.CS-TREBOTTI_NAVE IV PIC" → "614 Trebotti Nave IV PIC" */
export function nombreCorto614(nombre) {
  const t = String(nombre || '')
  const clave = (t.match(/^\d{3}/) || [''])[0]
  const resto = t.includes('_') ? t.split('_').slice(-1)[0] : t
  const cliente = (t.split('_')[0].split('-').slice(-1)[0] || '')
  const titulo = s => s.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Iv|Iii|Ii|Pic|Emcs|Itesm|Cx|Hvac)\b/g, w => w.toUpperCase())
  const sinAcento = x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const repetido = sinAcento(resto).startsWith(sinAcento(cliente))
  return `${clave} ${repetido ? '' : titulo(cliente)} ${titulo(resto)}`.replace(/\s+/g, ' ').trim()
}

/** Correo al líder, en el formato de siempre */
export function correo({ p, lider }, rep, conceptos) {
  const mes = mesMayus(rep.mes)
  const saludo = lider ? nombreCorto(lider.nombre).split(' ')[0] : ''
  const lista = conceptos.map(c => `-${c.key} ${c.description}`).join('\n')
  const cuerpo = [
    `Buenos días${saludo ? ', ' + saludo : ''}. Te adjunto el reporte mensual para ${nombreCorto614(p.name)}`,
    '',
    conceptos.length ? `Se pueden cobrar los conceptos relacionados con los siguientes entregables en el mes de ${mes}.\n${lista}` : `En el mes de ${mes} no hay conceptos por cobrar.`,
    '',
    'Muchas gracias, quedo a tus órdenes.',
  ].join('\n')
  return { para: lider?.email || '', asunto: `${p.name}-RC-OP-24 - ${mes}`, cuerpo }
}

/** Nombre para el PDF: nombre y apellido paterno, en mayúsculas y sin acentos ("HECTOR GONZALEZ") */
export function autorPdf(nombre) {
  const w = String(nombre || '').trim().split(/\s+/).filter(Boolean)
  const elegido = w.length >= 4 ? [w[0], w[2]] : w.slice(0, 2)
  return elegido.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
}
