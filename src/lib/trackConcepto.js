// Desde Track, cuando el tiempo va a un concepto del contrato: agregarlo a las proyecciones del mes
// o marcarlo completo en el borrador de estimación. Usa las mismas reglas que Proyecciones y la Estimación.
import { supabase } from './supabase'
import { prepararProyecto, conceptosPorEstimar, estaCongelada, mesIso, sumarMeses } from './proyecciones'
import { periodoBorrador, mesDelPeriodo } from '../utils/cierre'
import { nextNumber } from '../utils/aditivas'
import { itemAmount, projectRates, disciplineArea } from '../utils/calculations'
import { quitarAreaLista } from './cierre'

/** Todo lo que hace falta para decidir qué se puede hacer con un concepto. */
export async function estadoConcepto(projectId, conceptId) {
  const { data: p, error } = await supabase.from('projects')
    .select('*, disciplines(*, concepts(*)), estimations(*, estimation_items(*))').eq('id', projectId).single()
  if (error) throw error
  const { disciplines, estimations } = prepararProyecto(p)
  const disc = disciplines.find(d => d.concepts.some(c => c.id === conceptId))
  const concept = disc?.concepts.find(c => c.id === conceptId)
  if (!concept) return null
  const borrador = estimations.find(e => e.status === 'Borrador') || null
  const enviadas = estimations.filter(e => e.status === 'Enviada')
  const pend = conceptosPorEstimar(p, disciplines, enviadas).find(x => x.concept.id === conceptId)
  // Mes de la estimación en turno; si sus proyecciones ya se congelaron, el siguiente mes abierto
  const periodo = borrador || periodoBorrador(estimations)
  let mes = mesDelPeriodo(periodo.period_from, periodo.period_to) || mesIso(new Date())
  const mesEnTurno = mes
  for (let k = 0; k < 3 && estaCongelada(mes); k++) mes = sumarMeses(mes, 1)
  const { data: prs } = await supabase.from('proyecciones').select('id, mes').eq('project_id', projectId).eq('concept_id', conceptId).gte('mes', mesEnTurno)
  const item = borrador?.estimation_items?.find(i => i.concept_id === conceptId)
  return {
    project: p, disciplines, estimations, disc, concept, borrador,
    area: disciplineArea(disc) || 'Consultoría',
    porEstimar: pend?.porEstimar || 0,
    cobrado: !pend, // ya se cobró completo en estimaciones enviadas
    mes, mesEnTurno, proyectado: (prs || []).find(x => x.mes === mes) || null,
    enBorrador: !!item?.included && !item?.parcial_enabled,
  }
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
export async function marcarCompletoEnBorrador(st) {
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
  const payload = { estimation_id: est.id, concept_id: st.concept.id, ...item, amount }
  const { error } = previo?.id
    ? await supabase.from('estimation_items').update(payload).eq('id', previo.id)
    : await supabase.from('estimation_items').insert(payload)
  if (error) throw new Error(/row-level security|permission/i.test(error.message) ? 'No estás en el equipo de este proyecto: pide al líder que te agregue' : error.message)
  // Igual que en la Estimación: si el área ya estaba lista, un cambio la regresa a pendiente
  const area = disciplineArea(st.disc)
  if (area) await quitarAreaLista(est.id, area)
  return { estimacion: est, monto: amount }
}
