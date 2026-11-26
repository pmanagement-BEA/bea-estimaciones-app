// Desglose de un proyecto en el reporte de desempeño: indicadores RC-OP-43 por área (presupuesto H-H contra
// avance) y, concepto por concepto, cuánto se cobra contra cuántas horas se han gastado.
//
//   Desviación = % de avance ÷ % de horas consumidas  (≥ 1 bien · 0.8–1 atención · < 0.8 se pasan de horas)
//   $/h real   = lo cobrado ÷ horas reales            $/h presupuesto = lo contratado ÷ H-H presupuestadas
//
// Presupuesto H-H y acumulado de arranque (base_hh al cierre de base_mes) vienen del RC-OP-43 (tabla
// horas_presupuesto, por clave de proyecto y área). Las horas posteriores salen de Toggl (histórico) y Track.
// Las horas por concepto solo existen para lo que se registra en Track con concepto del contrato.
import { supabase } from './supabase'
import { duracionMs, mesDe, H } from './track'
import { AREAS, estimationSummary, projectRates, conceptAmount, disciplineArea } from '../utils/calculations.js'
import { prepararProyecto } from './proyecciones.js'

export { AREAS }
const lower = s => String(s || '').toLowerCase().trim()
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Clave de proyecto: los 3 dígitos con que empieza el nombre ("541-24-CL…" → "541", "583_584_585…" → "583"). */
export const claveDe = nombre => (String(nombre || '').trim().match(/^(\d{3})/) || [])[1] || ''

export async function cargarPresupuestoHH() {
  const { data, error } = await supabase.from('horas_presupuesto').select('codigo, area, presupuesto_hh, base_hh, base_mes')
  return error ? [] : data || []
}

export async function cargarActividadesHoras(tpIds) {
  if (!tpIds.length) return []
  const { data, error } = await supabase.from('track_actividades').select('id, proyecto_id, nombre, horas_toggl').in('proyecto_id', tpIds).gt('horas_toggl', 0).order('horas_toggl', { ascending: false }).limit(60)
  return error ? [] : data || []
}

/**
 * datos: lo de cargarDesempeno (projects, tps, historico, registros, directorio, presupuesto, mes)
 * opciones: { tpId, projectId, email }  — email: solo las horas de esa persona en conceptos y personas
 */
export function detalleProyecto(datos, { tpId, projectId, email } = {}) {
  const { projects, tps, historico, registros, directorio, presupuesto = [], mes } = datos
  const tp = tpId != null ? tps.find(t => String(t.id) === String(tpId)) : null
  const proyecto = projectId ? projects.find(p => p.id === projectId) : tp?.project_id ? projects.find(p => p.id === tp.project_id) : null
  const clave = claveDe(proyecto?.name || tp?.nombre)
  const titulo = proyecto?.name || tp?.nombre || 'Proyecto'

  // Proyectos de la app con la misma clave (un portafolio como 564 tiene varios) y proyectos de Track/Toggl
  const deLaClave = clave ? projects.filter(p => claveDe(p.name) === clave && p.status !== 'Cancelado') : proyecto ? [proyecto] : []
  const tpsClave = clave ? tps.filter(t => claveDe(t.nombre) === clave || deLaClave.some(p => p.id === t.project_id)) : tp ? [tp] : []
  const tpIds = new Set(tpsClave.map(t => String(t.id)))

  // Persona → área (Directorio)
  const porEmail = {}, porNombre = {}
  for (const d of directorio) { porEmail[lower(d.email)] = d; porNombre[norm(d.nombre)] = d }
  const quien = (e, n) => porEmail[lower(e)] || porNombre[norm(n)] || null

  // ── Presupuesto H-H por área (RC-OP-43)
  const pres = Object.fromEntries(presupuesto.filter(x => x.codigo === clave).map(x => [x.area, x]))
  const baseMes = Object.values(pres)[0]?.base_mes || null

  // ── Horas: por área después del arranque, por persona (mes y 12 meses) y por concepto
  const horasArea = Object.fromEntries(AREAS.map(a => [a, 0])); let horasSinArea = 0
  const personas = {}
  const sumarPersona = (e, n, m, h) => {
    const d = quien(e, n)
    const k = lower(d?.email || e) || 'n:' + (norm(n) || 'sin-identificar')
    const x = (personas[k] ||= { nombre: d?.nombre || n || e || 'Usuario de Toggl sin identificar', area: d?.area || null, email: d?.email || e || '', mes: 0, total: 0 })
    x.total += h; if (m === mes) x.mes += h
    if (baseMes && m > baseMes) { if (AREAS.includes(d?.area)) horasArea[d.area] += h; else horasSinArea += h }
  }
  for (const r of historico) if (tpIds.has(String(r.proyecto_id))) sumarPersona(r.email, r.nombre, r.mes, (+r.segundos || 0) / 3600)
  const porConcepto = {}; let generales = 0, sinConcepto = 0
  for (const r of registros) {
    if (!tpIds.has(String(r.proyecto_id))) continue
    const h = duracionMs(r) / H
    sumarPersona(r.email, '', mesDe(r), h)
    if (email && lower(r.email) !== lower(email)) continue
    if (r.concepto_id) porConcepto[r.concepto_id] = (porConcepto[r.concepto_id] || 0) + h
    else if (r.actividad_id) generales += h
    else sinConcepto += h
  }

  // ── Dinero por área (todos los proyectos de la clave, como el RC-OP-43)
  const dinero = Object.fromEntries(AREAS.map(a => [a, { contratado: 0, cobrado: 0 }]))
  let moneda = 'MXN'
  for (const p of deLaClave) {
    const { disciplines, estimations } = prepararProyecto(p)
    if (!disciplines.length) continue
    moneda = p.currency || moneda
    const s = estimationSummary(disciplines, estimations, null, null, projectRates(p))
    for (const a of AREAS) { const v = s.areaAvance[a]; if (v) { dinero[a].contratado += v.conDesc; dinero[a].cobrado += v.acumulado } }
  }

  const areas = AREAS.map(a => {
    const pr = pres[a]
    const presupuestoHH = pr?.presupuesto_hh != null ? +pr.presupuesto_hh : null
    const hh = pr ? (+pr.base_hh || 0) + horasArea[a] : null
    const { contratado, cobrado } = dinero[a]
    if (!presupuestoHH && !contratado) return null
    const avance = contratado > 0 ? cobrado / contratado : null
    const consumo = presupuestoHH && hh != null ? hh / presupuestoHH : null
    const restantes = presupuestoHH && hh != null ? presupuestoHH - hh : null
    const porCobrar = Math.max(0, contratado - cobrado)
    return {
      area: a, presupuestoHH, hh, contratado, cobrado, avance, consumo, porCobrar, restantes,
      desviacion: avance != null && consumo > 0 ? avance / consumo : null,
      hhReal: hh > 0 ? cobrado / hh : null,
      hhPresupuesto: presupuestoHH > 0 && contratado > 0 ? contratado / presupuestoHH : null,
      hhNecesario: restantes > 0 && porCobrar > 0 ? porCobrar / restantes : null,
      alTerminar: avance > 0 && hh != null ? hh / avance : null,
    }
  }).filter(Boolean)

  // ── Concepto por concepto (del proyecto elegido; si es una fila de Track sin proyecto, de toda la clave)
  const fuente = proyecto ? [proyecto] : deLaClave
  const conceptos = []
  for (const p of fuente) {
    const { disciplines, estimations } = prepararProyecto(p)
    const rates = projectRates(p)
    const { acumMap } = estimationSummary(disciplines, estimations, null, null, rates)
    for (const d of disciplines) {
      const area = disciplineArea(d) || 'Consultoría'
      const ar = areas.find(x => x.area === area)
      for (const c of d.concepts || []) {
        const monto = conceptAmount(c, d, rates, disciplines)
        if (!(monto > 0.5)) continue
        const cobrado = Math.min(monto, acumMap[c.id] || 0)
        const horas = porConcepto[c.id] || 0
        const hhPres = ar?.presupuestoHH && ar.contratado > 0 ? monto / ar.contratado * ar.presupuestoHH : null
        const avance = cobrado / monto
        conceptos.push({
          id: c.id, key: c.key, descripcion: c.description, disciplina: d.name, area, proyecto: p.name, moneda: p.currency || 'MXN',
          monto, cobrado, avance, horas, hhPres,
          porHora: horas > 0 && cobrado > 0.5 ? cobrado / horas : null,
          porHoraPotencial: horas > 0 && !(cobrado > 0.5) ? monto / horas : null,
          porHoraPres: hhPres > 0 ? monto / hhPres : null,
          desviacion: horas > 0 && hhPres > 0 ? (avance || 0) / (horas / hhPres) : null,
          estado: avance >= 0.999 ? 'Cobrado' : avance > 0.001 ? 'Parcial' : 'Por cobrar',
        })
      }
    }
  }

  return {
    clave, titulo, proyecto, tp, moneda, areas, conceptos, baseMes, tieneRcOp43: Object.keys(pres).length > 0,
    horasSinArea, generales, sinConcepto, horasConcepto: Object.values(porConcepto).reduce((a, b) => a + b, 0),
    personas: Object.values(personas).filter(x => x.total > 0.05).sort((a, b) => b.mes - a.mes || b.total - a.total),
    tpIds: [...tpIds], varios: deLaClave.length > 1,
  }
}
