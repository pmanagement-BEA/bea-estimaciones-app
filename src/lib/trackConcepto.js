// Desde Track, cuando el tiempo va a un concepto del contrato: agregarlo a las proyecciones del mes
// o marcarlo completo en el borrador de estimación. Usa las mismas reglas que Proyecciones y la Estimación.
import { supabase } from './supabase'
import { prepararProyecto, conceptosPorEstimar, estaCongelada, mesIso, sumarMeses, textoMesCorto } from './proyecciones'
import { periodoBorrador, mesDelPeriodo } from '../utils/cierre'
import { nextNumber } from '../utils/aditivas'
import { itemAmount, projectRates, disciplineArea } from '../utils/calculations'
import { quitarAreaLista } from './cierre'

/** Proyecto con su contrato, estimaciones y proyecciones: lo necesario para saber cómo va cada concepto. */
async function cargarProyecto(projectId) {
  const [{ data: p, error }, { data: prs }] = await Promise.all([
    supabase.from('projects').select('*, disciplines(*, concepts(*)), estimations(*, estimation_items(*))').eq('id', projectId).single(),
    supabase.from('proyecciones').select('id, mes, concept_id').eq('project_id', projectId),
  ])
  if (error) throw error
  const { disciplines, estimations } = prepararProyecto(p)
  const borrador = estimations.find(e => e.status === 'Borrador') || null
  const enviadas = estimations.filter(e => e.status === 'Enviada')
  const pendientes = new Map(conceptosPorEstimar(p, disciplines, enviadas).map(x => [x.concept.id, x]))
  // Mes de la estimación en turno; si sus proyecciones ya se congelaron, el siguiente mes abierto
  const periodo = borrador || periodoBorrador(estimations)
  const mesEnTurno = mesDelPeriodo(periodo.period_from, periodo.period_to) || mesIso(new Date())
  let mes = mesEnTurno
  for (let k = 0; k < 3 && estaCongelada(mes); k++) mes = sumarMeses(mes, 1)
  return { p, disciplines, estimations, borrador, pendientes, mes, mesEnTurno, prs: prs || [] }
}

function estadoEn(base, conceptId) {
  const { p, disciplines, estimations, borrador, pendientes, mes, mesEnTurno, prs } = base
  const disc = disciplines.find(d => d.concepts.some(c => c.id === conceptId))
  const concept = disc?.concepts.find(c => c.id === conceptId)
  if (!concept) return null
  const pend = pendientes.get(conceptId)
  const item = borrador?.estimation_items?.find(i => i.concept_id === conceptId)
  // Proyectado: en el mes en turno o después (el primero que haya)
  const proyectado = prs.filter(x => x.concept_id === conceptId && x.mes >= mesEnTurno).sort((a, b) => a.mes.localeCompare(b.mes))[0] || null
  return {
    project: p, disciplines, estimations, disc, concept, borrador,
    area: disciplineArea(disc) || 'Consultoría',
    porEstimar: pend?.porEstimar || 0,
    cobrado: !pend, // ya se cobró completo en estimaciones enviadas
    mes, mesEnTurno, proyectado,
    enBorrador: !!item?.included,
    borradorParcial: !!item?.included && !!item?.parcial_enabled,
  }
}

/** Todo lo que hace falta para decidir qué se puede hacer con un concepto. */
export async function estadoConcepto(projectId, conceptId) {
  return estadoEn(await cargarProyecto(projectId), conceptId)
}

/** Estado de todos los conceptos de un proyecto (para mostrarlo en la lista de Track): { conceptId: estado } */
export async function estadosConceptos(projectId) {
  const base = await cargarProyecto(projectId)
  return Object.fromEntries(base.disciplines.flatMap(d => d.concepts.map(c => [c.id, estadoEn(base, c.id)])))
}

/** Etiqueta corta: cobrado · en borrador · proyectado dic 26 · sin proyectar */
export function etiquetaEstado(st) {
  if (!st) return ''
  if (st.cobrado) return '✓ cobrado'
  if (st.enBorrador) return st.borradorParcial ? 'parcial en borrador' : 'en borrador'
  if (st.proyectado) return `proyectado ${textoMesCorto(st.proyectado.mes)}`
  return 'sin proyectar'
}

export async function agregarAProyecciones(st) {
  const fila = {
    project_id: st.project.id, mes: st.mes, area: st.area, concept_id: st.concept.id,
    descripcion: `${st.concept.key} ${st.concept.description}`.trim(), monto: Math.round(st.porEstimar * 100) / 100, tbd: false,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('proyecciones').insert(fila)
  if (error) throw new Error(/proyecciones_concepto_mes/.test(error.message) ? 'Ese concepto ya está proyectado en ese mes'
    : /row-level security|permission/i.test(error.message) ? 'No estás en el equipo de este proyecto: pide al líder que te agregue' : error.message)
}

/** Marca el concepto completo (100 %) en el borrador; si no hay borrador del proyecto activo, lo crea. */
export async function marcarCompletoEnBorrador(st, quien = '') {
  let est = st.borrador
  if (!est) {
    if (st.project.status !== 'Activo') throw new Error(`El proyecto está ${(st.project.status || 'sin estado').toLowerCase()} y no tiene borrador de estimación`)
    const { data, error } = await supabase.from('estimations')
      .insert({ project_id: st.project.id, number: nextNumber(st.estimations), status: 'Borrador', ...periodoBorrador(st.estimations) }).select().single()
    if (error) throw new Error(/row-level security|permission/i.test(error.message) ? 'No estás en el equipo de este proyecto: pide al líder que te agregue' : error.message)
    est = { ...data, estimation_items: [] }
  }
  const previo = (est.estimation_items || []).find(i => i.concept_id === st.concept.id)
  const item = { included: true, parcial_enabled: false, pct_parcial: 0, delayed: previo?.delayed || false, cause: previo?.cause || '' }
  const amount = itemAmount(item, st.concept, st.disc, projectRates(st.project), st.disciplines)
  const payload = { estimation_id: est.id, concept_id: st.concept.id, ...item, amount, marcado_desde: 'track', marcado_por: quien, marcado_en: new Date().toISOString() }
  const { error } = previo?.id
    ? await supabase.from('estimation_items').update(payload).eq('id', previo.id)
    : await supabase.from('estimation_items').insert(payload)
  if (error) throw new Error(/row-level security|permission/i.test(error.message) ? 'No estás en el equipo de este proyecto: pide al líder que te agregue' : error.message)
  // Igual que en la Estimación: si el área ya estaba lista, un cambio la regresa a pendiente
  const area = disciplineArea(st.disc)
  if (area) await quitarAreaLista(est.id, area)
  return { estimacion: est, monto: amount }
}
