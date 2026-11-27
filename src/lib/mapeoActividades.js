// Ligado de actividades de Toggl a conceptos del contrato.
//
// 1. Por CÓDIGO: el prefijo de la actividad dice área y fase
//      CT-01..04 → Consultoría · fase uno / dos (diseño) / tres (construcción) / cierre; CT-00 → general
//      Cx-D → Cx diseño · Cx-C → Cx construcción · Cx-E/EC → Enhanced · Cx-F → cierre · Cx-G/CX-01 → Cx general
//      ME-iN / iN → Modelación, iteración N · ME-ECM → medidas de ahorro · ME-if → iteración final
//    Sin código, se adivina por palabras (comisionamiento, modelo, LEED, diseño, obra…).
// 2. Por PALABRA CLAVE: dentro de esa fase, el concepto que más palabras comparte con la actividad
//    (prefuncionales, issues log, BOD, iteración 2…). Si empatan varios, se reparten entre ellos.
// 3. REPARTO POR MES: las horas de cada mes se reparten entre los conceptos del grupo que se cobraron
//    ese mes (en proporción a lo cobrado). Si ninguno se cobró ese mes, entre los ya cobrados del grupo
//    (en proporción al monto, confianza baja). Si no hay ninguno, se quedan en la fase sin concepto.
// Una corrección manual (tabla track_actividad_concepto) manda sobre todo lo anterior.
import { disciplineArea, projectRates, conceptAmount, getAcumuladoAnteriorMap } from '../utils/calculations.js'
import { prepararProyecto, estimadoPorConcepto } from './proyecciones.js'

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const VACIAS = new Set('de del la las los el en y a para por con sin al un una uno dos tres mes fase cl nc cs gb ed eb leed reporte reunion seguimiento revision informacion documentacion minuta envio'.split(' '))
const palabras = s => norm(s).replace(/([a-z])-([a-z])/g, '$1$2').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !VACIAS.has(w))
// Palabras que pesan más porque distinguen conceptos
const CLAVE = ['prefuncional', 'funcional', 'issues', 'bod', 'opr', 'manual', 'capacitacion', 'entrenamiento', 'lecciones', 'submittal', 'bitacora', 'arranque', 'kick', 'visita', 'sitio', 'diagnostico', 'checklist', 'simulacion', 'baseline', 'ciclo', 'energetic', 'plan', 'final', 'preliminar', 'cierre', 'mensual']

export const FASES = { uno: 'Fase uno', dos: 'Diseño', tres: 'Construcción', cierre: 'Cierre / certificación', general: 'General', enhanced: 'Enhanced Cx', diseno: 'Cx diseño', construccion: 'Cx construcción', me: 'Modelación' }

/** Área y fase de una actividad por su código o, si no tiene, por sus palabras */
export function clasificar(nombre) {
  const n = norm(nombre).trim()
  let m
  if ((m = n.match(/^ct-?0?([0-4])(?![0-9])/))) return { area: 'Consultoría', fase: ['general', 'uno', 'dos', 'tres', 'cierre'][+m[1]], porCodigo: true }
  if (/^cx-?d/.test(n)) return { area: 'Commissioning', fase: 'diseno', porCodigo: true }
  if (/^cx-?c\d/.test(n)) return { area: 'Commissioning', fase: 'construccion', porCodigo: true }
  if (/^cx-?e/.test(n)) return { area: 'Commissioning', fase: 'enhanced', porCodigo: true }
  if (/^cx-?f/.test(n)) return { area: 'Commissioning', fase: 'cierre', porCodigo: true }
  if (/^cx-?(g|\d)/.test(n)) return { area: 'Commissioning', fase: 'general', porCodigo: true }
  if ((m = n.match(/^(?:me-)?i(\d|f)(?![0-9a-z])/)) || (m = n.match(/^me-i(\d|f)/))) return { area: 'Modelación', fase: 'me', iteracion: m[1] === 'f' ? 'final' : +m[1], porCodigo: true }
  if (/^me-/.test(n)) return { area: 'Modelación', fase: 'me', porCodigo: true }
  // Sin código: por palabras
  const area = /comisiona|commission|\bcx\b|prueba|bitacora|issues/.test(n) ? 'Commissioning'
    : /modelo|simulac|\bbem\b|iesve|energet|baseline|ecm/.test(n) ? 'Modelación'
      : /leed|credito|submittal|edge|certific|checklist|diagnostico/.test(n) ? 'Consultoría' : null
  const fase = area === 'Modelación' ? 'me'
    : /diseno|planos|bod|opr/.test(n) ? (area === 'Commissioning' ? 'diseno' : 'dos')
      : /constru|obra|visita|sitio|prueba/.test(n) ? (area === 'Commissioning' ? 'construccion' : 'tres')
        : /cierre|certific|final/.test(n) ? 'cierre' : 'general'
  return { area, fase, porCodigo: false }
}

/** Fase de una disciplina del contrato */
function faseDisciplina(d) {
  const n = norm(d.name)
  if (/finiquito|^certificaci/.test(n)) return 'cierre'
  if (/fase uno|diagnost/.test(n)) return 'uno'
  if (/fase dos|disen/.test(n) && !/commission|cx/.test(n)) return 'dos'
  if (/fase tres|constru/.test(n) && !/commission|cx/.test(n)) return 'tres'
  if (/enhanced|\becx\b/.test(n)) return 'enhanced'
  if (/model|eficiencia energ|simulac/.test(n)) return 'me'
  if (/commission|comisiona|\bcx\b/.test(n)) return 'cx'
  return 'otra'
}

/** Disciplinas candidatas y filtro de conceptos para una clasificación */
function candidatos(cls, disciplines) {
  const ds = disciplines.map(d => ({ d, area: disciplineArea(d), fase: faseDisciplina(d) }))
  let elegidas = []
  if (cls.area === 'Consultoría') {
    elegidas = cls.fase === 'general' ? ds.filter(x => x.area === 'Consultoría')
      : cls.fase === 'cierre' ? ds.filter(x => x.fase === 'cierre')
        : ds.filter(x => x.area === 'Consultoría' && x.fase === cls.fase)
    if (!elegidas.length && cls.fase !== 'general') elegidas = ds.filter(x => x.area === 'Consultoría')
  } else if (cls.area === 'Commissioning') {
    elegidas = cls.fase === 'enhanced' ? ds.filter(x => x.fase === 'enhanced') : ds.filter(x => x.area === 'Commissioning' && x.fase !== 'enhanced')
    if (!elegidas.length) elegidas = ds.filter(x => x.area === 'Commissioning')
  } else if (cls.area === 'Modelación') {
    elegidas = ds.filter(x => x.area === 'Modelación')
  }
  let conceptos = elegidas.flatMap(x => (x.d.concepts || []).map(c => ({ c, d: x.d })))
  // Cx: separar diseño y construcción por el texto del concepto
  if (cls.area === 'Commissioning' && (cls.fase === 'diseno' || cls.fase === 'construccion')) {
    const re = cls.fase === 'diseno' ? /disen|bod|opr|plan(\s|$)|plan de|planos|especifica|cuestionario/ : /constru|prueba|bitacora|visita|sitio|issues|manual|lecciones|final|capacita|entrena|o&m|om\b/
    const f = conceptos.filter(x => re.test(norm(x.c.description)))
    if (f.length) conceptos = f
  }
  // ME: iteración N
  if (cls.area === 'Modelación' && cls.iteracion != null) {
    const ord = ['preliminar', 'primera', 'segunda', 'tercera', 'cuarta']
    const it = cls.iteracion
    const re = it === 'final' ? /final|as design|as built/ : new RegExp(`iteracion ${it}\\b|${ord[it] || '#'} (iteracion|simulacion)|\\b${it}(a|ª)? iteracion`)
    const f = conceptos.filter(x => re.test(norm(x.c.description)))
    if (f.length) conceptos = f
  }
  return { disciplinas: elegidas.map(x => x.d), conceptos }
}

/** Mejor coincidencia por palabras dentro de los candidatos: [{c,d}] empatados o [] */
function porPalabras(nombre, conceptos) {
  const sinCodigo = norm(nombre).replace(/^[a-z]{1,3}-?[a-z0-9]{0,4}-?[0-9.]*\s*/, '')
  const ws = new Set(palabras(sinCodigo))
  if (!ws.size) return { grupo: [], score: 0 }
  let mejor = 0, grupo = []
  for (const x of conceptos) {
    const cw = palabras(x.c.description)
    let s = 0
    for (const w of cw) if (ws.has(w)) s += CLAVE.some(k => w.startsWith(k)) ? 2 : 1
    if (s > mejor) { mejor = s; grupo = [x] } else if (s === mejor && s > 0) grupo.push(x)
  }
  return mejor >= 2 ? { grupo, score: mejor } : { grupo: [], score: mejor }
}

/**
 * Liga las actividades de un proyecto de la app.
 * actividades: [{ id, nombre }] · filas: [{ actividadId, mes, horas }] (ya filtradas por persona/periodo)
 * overrides: [{ actividad_id, concepto_id, disciplina_id, ignorar }]
 * Devuelve { actividades: Map(id → info), conceptos: { cid: { horas, estimadas, origenes: { actId: h } } } }
 */
export function ligar(proyecto, actividades, filas, overrides = []) {
  const { disciplines, estimations } = prepararProyecto(proyecto)
  const rates = projectRates(proyecto)
  const cobradoMes = estimadoPorConcepto(proyecto, disciplines, estimations)
  const acum = getAcumuladoAnteriorMap(disciplines, estimations, null, rates)
  const monto = {}
  for (const d of disciplines) for (const c of d.concepts || []) monto[c.id] = conceptAmount(c, d, rates, disciplines)
  const conceptoPorId = new Map(disciplines.flatMap(d => (d.concepts || []).map(c => [c.id, { c, d }])))
  const ov = new Map(overrides.map(o => [Number(o.actividad_id), o]))

  const info = new Map()
  for (const a of actividades) {
    const cls = clasificar(a.nombre)
    const o = ov.get(Number(a.id))
    let grupo = [], metodo, confianza, disciplinas = []
    if (o?.ignorar) { metodo = 'ignorada'; confianza = 'manual' }
    else if (o?.concepto_id && conceptoPorId.has(o.concepto_id)) { grupo = [conceptoPorId.get(o.concepto_id)]; metodo = 'manual'; confianza = 'manual' }
    else if (o?.disciplina_id) {
      const d = disciplines.find(x => x.id === o.disciplina_id)
      disciplinas = d ? [d] : []
      grupo = d ? (d.concepts || []).map(c => ({ c, d })) : []
      metodo = 'manual-reparto'; confianza = 'manual'
    } else if (!cls.area) { metodo = 'sin'; confianza = 'ninguna' }
    else {
      const cand = candidatos(cls, disciplines)
      disciplinas = cand.disciplinas
      const pp = porPalabras(a.nombre, cand.conceptos)
      if (pp.grupo.length) { grupo = pp.grupo; metodo = 'palabra'; confianza = pp.grupo.length === 1 ? 'alta' : 'media' }
      else { grupo = cand.conceptos; metodo = cand.conceptos.length ? 'reparto' : 'fase'; confianza = cls.porCodigo ? 'media' : 'baja' }
    }
    info.set(Number(a.id), { id: Number(a.id), nombre: a.nombre, cls, metodo, confianza, grupo: grupo.map(x => x.c.id), disciplinas: disciplinas.map(d => d.name), horas: 0, horasConcepto: {}, horasFase: 0, horasSin: 0, estimadas: 0 })
  }

  const conceptos = {}
  const sumar = (cid, act, h, estimada) => {
    const x = (conceptos[cid] ||= { horas: 0, estimadas: 0, origenes: {} })
    x.horas += h; if (estimada) x.estimadas += h
    x.origenes[act.id] = (x.origenes[act.id] || 0) + h
    act.horasConcepto[cid] = (act.horasConcepto[cid] || 0) + h
  }
  for (const f of filas) {
    const act = info.get(Number(f.actividadId))
    if (!act || !(f.horas > 0)) continue
    act.horas += f.horas
    if (act.metodo === 'ignorada' || act.metodo === 'sin') { act.horasSin += f.horas; continue }
    const g = act.grupo
    if (!g.length) { act.horasFase += f.horas; continue }
    if (g.length === 1) { sumar(g[0], act, f.horas, act.metodo === 'reparto'); continue }
    // Reparto: primero lo cobrado ese mes, luego lo ya cobrado (por monto)
    const delMes = g.map(cid => [cid, cobradoMes[f.mes]?.[cid] || 0]).filter(x => x[1] > 0.5)
    const base = delMes.length ? delMes : g.map(cid => [cid, (acum[cid] || 0) > 0.5 ? monto[cid] || 0 : 0]).filter(x => x[1] > 0.5)
    if (!base.length) { act.horasFase += f.horas; continue }
    const tot = base.reduce((s, x) => s + x[1], 0)
    for (const [cid, w] of base) sumar(cid, act, f.horas * w / tot, true)
    if (!delMes.length) act.estimadas += f.horas
  }
  return { actividades: info, conceptos }
}

export const ETIQUETA_METODO = {
  manual: 'Manual', 'manual-reparto': 'Manual (fase)', ignorada: 'Ignorada',
  palabra: 'Palabra clave', reparto: 'Reparto por mes', fase: 'Solo fase', sin: 'Sin ligar',
}
