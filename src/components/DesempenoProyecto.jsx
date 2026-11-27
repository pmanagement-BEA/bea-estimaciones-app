// Desglose de un proyecto dentro del reporte de desempeño (se abre al picarle a un proyecto).
// Arriba, una tarjeta por área con el semáforo H-H (RC-OP-43); al picarle se abren sus números y se filtran
// los conceptos. Abajo, pestañas: Conceptos · Actividades de Toggl · Equipo.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { fmtMoney } from '../utils/format'
import { detalleProyecto, cargarActividadesHoras, nombresActividades } from '../lib/desempenoDetalle'
import { ETIQUETA_METODO } from '../lib/mapeoActividades'
import { supabase } from '../lib/supabase'
import { toast } from './Toast'
import { COLOR_AREA, textoMes, nombreCorto } from '../lib/proyecciones'
import { num } from '../lib/track'

export const DatosDesempeno = createContext(null)
export const RecargaDesempeno = createContext(() => {})

const ETQ = { 'Consultoría': 'CV', 'Commissioning': 'CX', 'Modelación': 'ME' }
const dinero = (n, moneda = 'MXN') => (n == null || isNaN(n) ? '—' : fmtMoney(Math.round(n), moneda).replace(/\.00$/, ''))
const hrs = (n, dec = 0) => (n == null || isNaN(n) ? '—' : `${num(n, dec)} h`)
const pct = (x, dec = 0) => (x == null || isNaN(x) ? '—' : `${num(x * 100, dec)}%`)
/** Semáforo del RC-OP-43: ≥ 1 bien · 0.8–1 atención · < 0.8 mal */
const tono = x => (x == null || isNaN(x) ? '' : x >= 1 ? 'ok' : x >= 0.8 ? 'medio' : 'mal')

/** Frase corta de cómo va el área */
function veredicto(a) {
  if (a.presupuestoHH == null) return 'Sin presupuesto H-H en el RC-OP-43'
  if (a.restantes < 0) return `Se pasó ${hrs(-a.restantes)} del presupuesto`
  if (a.desviacion == null) return `${hrs(a.restantes)} de margen`
  if (a.desviacion >= 1) return `Va bien · ${hrs(a.restantes)} de margen`
  if (a.desviacion >= 0.8) return `Atención · quedan ${hrs(a.restantes)}`
  return `Gasta horas más rápido que el avance · quedan ${hrs(a.restantes)}`
}

/** Consumo de horas contra avance, en una sola barra */
function DobleBarra({ consumo, avance, color }) {
  const tope = Math.max(1, consumo || 0, avance || 0)
  const w = x => `${Math.min(100, (x || 0) / tope * 100)}%`
  return (
    <div className="dsp-doble" title={`Horas consumidas ${pct(consumo)} · avance cobrado ${pct(avance)}`}>
      <div className="fila"><span>Horas</span><div className="pista"><i className={consumo > 1 ? 'pasado' : ''} style={{ width: w(consumo) }} />{tope > 1 && <b style={{ left: w(1) }} />}</div><em>{pct(consumo)}</em></div>
      <div className="fila"><span>Avance</span><div className="pista"><i style={{ width: w(avance), background: color }} />{tope > 1 && <b style={{ left: w(1) }} />}</div><em>{pct(avance)}</em></div>
    </div>
  )
}

function Dato({ etiqueta, valor, nota, tono: t }) {
  return <div className={`dsp-dato ${t || ''}`}><span>{etiqueta}</span><b>{valor}</b>{nota && <small>{nota}</small>}</div>
}

export function ProyectoDetalle({ tpId, projectId, email, onAbrir, onCerrar, pestanaInicial = 'conceptos' }) {
  const datos = useContext(DatosDesempeno)
  const d = useMemo(() => (datos ? detalleProyecto(datos, { tpId, projectId, email }) : null), [datos, tpId, projectId, email])
  const [areaSel, setAreaSel] = useState(null)
  const [pestana, setPestana] = useState(pestanaInicial)
  const [nombres, setNombres] = useState({})
  const [filtro, setFiltro] = useState('pendientes')
  const [actividades, setActividades] = useState(null)
  const ids = d?.tpIds.join(',')
  const idsAct = (d?.enTrack || []).filter(x => x.actividadId).map(x => String(x.actividadId)).join(',')
  useEffect(() => {
    if (!idsAct) return
    let vivo = true
    nombresActividades(idsAct.split(',')).then(n => { if (vivo) setNombres(n) })
    return () => { vivo = false }
  }, [idsAct])
  useEffect(() => {
    if (pestana !== 'actividades' || actividades) return
    let vivo = true
    cargarActividadesHoras(ids ? ids.split(',') : []).then(a => { if (vivo) setActividades(a) })
    return () => { vivo = false }
  }, [pestana, ids, actividades])
  if (!d) return null

  const a = d.areas.find(x => x.area === areaSel)
  const conHoras = d.horasConcepto > 0.01
  const deArea = d.conceptos.filter(c => !areaSel || c.area === areaSel)
  const cuenta = { pendientes: deArea.filter(c => c.estado !== 'Cobrado').length, cobrados: deArea.filter(c => c.estado === 'Cobrado').length, todos: deArea.length }
  const lista = deArea.filter(c => filtro === 'todos' || (filtro === 'cobrados' ? c.estado === 'Cobrado' : c.estado !== 'Cobrado'))
  const maxMonto = Math.max(1, ...lista.map(c => c.monto))
  const persona = email ? d.personas.find(p => p.email?.toLowerCase() === email.toLowerCase()) : null
  const maxAct = actividades?.[0]?.horas_toggl || 1

  return (
    <div className="dsp-detalle">
      <div className="dsp-detalle-tit">
        <div>
          <b>{d.titulo}</b>
          {persona && <span className="dsp-pill">{nombreCorto(persona.nombre)}: {hrs(persona.mes, 1)} este mes</span>}
          {d.varios && <span className="dsp-pill suave" title="El RC-OP-43 mide por clave: se suman todos los proyectos de la clave">clave {d.clave} · portafolio</span>}
        </div>
        <div className="no-print dsp-acciones">
          {d.proyecto && onAbrir && <button className="btn btn-outline btn-sm" onClick={() => onAbrir(d.proyecto)}>Estimaciones →</button>}
          {onCerrar && <button className="btn btn-outline btn-sm" onClick={onCerrar} aria-label="Cerrar desglose">✕</button>}
        </div>
      </div>

      {/* Tarjetas por área */}
      {d.areas.length ? (
        <div className="dsp-areas">
          {d.areas.map(x => (
            <button key={x.area} className={`dsp-area ${tono(x.desviacion)}${areaSel === x.area ? ' sel' : ''}`} onClick={() => setAreaSel(areaSel === x.area ? null : x.area)} aria-pressed={areaSel === x.area}>
              <div className="cab">
                <span><i className="dsp-punto" style={{ background: COLOR_AREA[x.area] }} />{ETQ[x.area]} · {x.area}</span>
                <span className={`desv ${tono(x.desviacion)}`} title="Desviación = avance ÷ horas consumidas">{x.desviacion == null ? '—' : num(x.desviacion, 2)}</span>
              </div>
              {x.presupuestoHH != null ? <DobleBarra consumo={x.consumo} avance={x.avance} color={COLOR_AREA[x.area]} /> : <div className="sub">Avance cobrado {pct(x.avance)}</div>}
              <div className="ver">{veredicto(x)}</div>
            </button>
          ))}
        </div>
      ) : <p className="dsp-vacio">Este proyecto no tiene alcance cargado en la app.</p>}

      {a && (
        <div className="dsp-datos">
          <Dato etiqueta="H-H" valor={`${hrs(a.hh)} / ${hrs(a.presupuestoHH)}`} nota="acumuladas / presupuesto" />
          <Dato etiqueta="$/h plan" valor={dinero(a.hhPresupuesto, d.moneda)} nota="contratado ÷ H-H" />
          <Dato etiqueta="$/h real" valor={dinero(a.hhReal, d.moneda)} nota="cobrado ÷ H-H" tono={a.hhReal != null && a.hhPresupuesto ? tono(a.hhReal / a.hhPresupuesto) : ''} />
          <Dato etiqueta="Por cobrar" valor={dinero(a.porCobrar, d.moneda)} nota={`de ${dinero(a.contratado, d.moneda)}`} />
          {a.hhNecesario != null && <Dato etiqueta="$/h para cerrar" valor={dinero(a.hhNecesario, d.moneda)} nota="lo que falta ÷ H-H restantes" />}
          {a.alTerminar != null && <Dato etiqueta="Al terminar" valor={hrs(a.alTerminar)} nota="H-H a este ritmo" tono={a.presupuestoHH ? tono(a.presupuestoHH / a.alTerminar) : ''} />}
        </div>
      )}

      {/* Pestañas */}
      <div className="dsp-pestanas no-print" role="tablist">
        {[['conceptos', `Conceptos${areaSel ? ' · ' + ETQ[areaSel] : ''}`], ['actividades', 'Actividad por actividad'], ['equipo', `Equipo (${d.personas.length})`]].map(([k, t]) => (
          <button key={k} role="tab" aria-selected={pestana === k} className={pestana === k ? 'activa' : ''} onClick={() => setPestana(k)}>{t}</button>
        ))}
      </div>

      {pestana === 'conceptos' && (
        <>
          <div className="dsp-chips">
            {[['pendientes', 'Por cobrar'], ['cobrados', 'Cobrados'], ['todos', 'Todos']].map(([k, t]) => (
              <button key={k} className={filtro === k ? 'activa' : ''} onClick={() => setFiltro(k)}>{t} <span>{cuenta[k]}</span></button>
            ))}
            {areaSel && <button className="quitar" onClick={() => setAreaSel(null)}>{ETQ[areaSel]} ✕</button>}
            {!conHoras && <span className="dsp-hint" title="Se llenan cuando el equipo registra en Track eligiendo el concepto del contrato">ⓘ Aún sin horas por concepto</span>}
          </div>
          {lista.length ? (
            <ul className="dsp-lista-c">
              {lista.map(c => {
                const rel = c.porHora != null && c.porHoraPres ? c.porHora / c.porHoraPres : null
                return (
                  <li key={c.id} className={c.estado === 'Cobrado' ? 'cobrado' : ''}>
                    <span className="clave" style={{ borderColor: COLOR_AREA[c.area] }}>{c.key}</span>
                    <span className="texto" title={`${c.descripcion} · ${c.disciplina}`}>{c.descripcion}</span>
                    <span className="monto">
                      <span className="mini"><i style={{ width: `${c.monto / maxMonto * 100}%` }}><i style={{ width: `${(c.avance || 0) * 100}%` }} /></i></span>
                      {dinero(c.monto, c.moneda)}
                    </span>
                    <span className="hh" title="H-H que le tocan según el presupuesto">{c.hhPres != null ? hrs(c.hhPres, 0) : ''}</span>
                    {conHoras && (
                      <span className={`real ${tono(rel)}`}>
                        {c.horas > 0.01 ? <>{hrs(c.horas, 1)} · {c.porHora != null ? dinero(c.porHora, c.moneda) + '/h' : <i title="Aún no se cobra">{dinero(c.porHoraPotencial, c.moneda)}/h</i>}</> : ''}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : <p className="dsp-vacio">Nada en este filtro.</p>}
        </>
      )}

      {pestana === 'actividades' && (
        <div className="dsp-act">
          <h5>{email ? 'Lo que registró en Track' : 'Registrado en Track'} <span className="sub">desde que arrancó Track</span></h5>
          {d.enTrack.length ? (
            <ul className="dsp-reparto">
              {d.enTrack.map(x => {
                const c = x.conceptoId ? d.conceptos.find(k => k.id === x.conceptoId) : null
                const nombre = c ? `${c.key} ${c.descripcion}` : x.actividadId ? nombres[String(x.actividadId)] || 'Actividad' : x.descripcion || 'Sin descripción'
                return (
                  <li key={x.k}>
                    <span className="nombre" title={nombre}>{c && <span className="dsp-tag-c">concepto</span>}{nombre}</span>
                    <span className="dsp-barra"><span style={{ width: `${x.horas / d.enTrack[0].horas * 100}%`, background: c ? 'var(--green)' : '#8a97a8' }} /></span>
                    <span className="n">{hrs(x.horas, 1)}</span>
                  </li>
                )
              })}
            </ul>
          ) : <p className="dsp-vacio">Aún no hay registros en Track para este proyecto{email ? ' de esta persona' : ''}.</p>}
          <h5>Histórico de Toggl <span className="sub">todo el equipo, hasta el 26 nov 2026</span></h5>
          {actividades === null ? <p className="dsp-vacio">Cargando…</p> : actividades.length ? (
            <ul className="dsp-reparto">
              {actividades.slice(0, 15).map(x => (
                <li key={x.id}><span className="nombre" title={x.nombre}>{x.nombre}</span><span className="dsp-barra"><span style={{ width: `${(+x.horas_toggl) / maxAct * 100}%`, background: 'var(--green)' }} /></span><span className="n">{hrs(+x.horas_toggl, 1)}</span></li>
              ))}
            </ul>
          ) : <p className="dsp-vacio">Sin actividades con horas en Toggl.</p>}
        </div>
      )}

      {pestana === 'equipo' && (
        d.personas.length ? (
          <ul className="dsp-equipo">
            {d.personas.slice(0, 15).map(p => (
              <li key={p.nombre + p.email} className={email && p.email?.toLowerCase() === email.toLowerCase() ? 'yo' : ''}>
                <span className="nombre">{nombreCorto(p.nombre)}</span>
                <span className="sub">{ETQ[p.area] || 'Sin área'}</span>
                <span className="n">{hrs(p.mes, 1)} <small>{textoMes(datos.mes).split(' ')[0].slice(0, 3).toLowerCase()}</small></span>
                <span className="n sub">{hrs(p.total, 0)} <small>12 m</small></span>
              </li>
            ))}
          </ul>
        ) : <p className="dsp-vacio">Sin horas en los últimos 12 meses.</p>
      )}
    </div>
  )
}

/**
 * Versión sencilla para la vista Individual: horas por concepto, cuánto se cobró y sus indicadores,
 * en una sola lista (conceptos del contrato + otras actividades + horas de Toggl sin concepto).
 */
/** Texto del cuadro flotante: de dónde salen las horas de un concepto */
function origenTexto(c) {
  const l = []
  if (c.horasTrack > 0.01) l.push(`Track: ${hrs(c.horasTrack, 1)}`)
  for (const o of c.origenes.slice(0, 8)) l.push(`${o.nombre}: ${hrs(o.h, 1)} (${ETIQUETA_METODO[o.metodo] || o.metodo})`)
  if (c.origenes.length > 8) l.push(`…y ${c.origenes.length - 8} actividades más`)
  return l.join('\n')
}

const CONF = { alta: 'Alta', media: 'Media', baja: 'Baja', manual: 'Manual', ninguna: '—' }

/** Cómo se ligó cada actividad de Toggl del proyecto (todo el equipo, últimos 12 meses), con corrección manual */
export function MapeoActividades({ tpId }) {
  const datos = useContext(DatosDesempeno)
  const recargar = useContext(RecargaDesempeno)
  const d = useMemo(() => (datos ? detalleProyecto(datos, { tpId }) : null), [datos, tpId])
  const [guardando, setGuardando] = useState(null)
  if (!d?.ligado || !d.proyLigado) return null
  const p = d.proyLigado
  const discs = [...(p.disciplines || [])].sort((a, b) => a.sort_order - b.sort_order)
  const conceptoKey = new Map(discs.flatMap(x => (x.concepts || []).map(c => [c.id, c])))
  const ov = new Map((datos.overrides || []).filter(o => o.project_id === p.id).map(o => [Number(o.actividad_id), o]))
  const filas = [...d.ligado.actividades.values()].filter(a => a.horas > 0.01).sort((a, b) => b.horas - a.horas)

  async function cambiar(act, valor) {
    setGuardando(act.id)
    let res
    if (!valor) res = await supabase.from('track_actividad_concepto').delete().eq('actividad_id', act.id)
    else {
      const fila = { actividad_id: act.id, project_id: p.id, concepto_id: null, disciplina_id: null, ignorar: false }
      if (valor === 'ignorar') fila.ignorar = true
      else if (valor.startsWith('c:')) fila.concepto_id = valor.slice(2)
      else if (valor.startsWith('d:')) fila.disciplina_id = valor.slice(2)
      res = await supabase.from('track_actividad_concepto').upsert(fila)
    }
    setGuardando(null)
    if (res.error) { toast('No se pudo guardar: solo el líder del proyecto o un coordinador puede corregir el ligado', true); return }
    toast('Ligado actualizado')
    recargar()
  }
  const valorDe = id => { const o = ov.get(id); return !o ? '' : o.ignorar ? 'ignorar' : o.concepto_id ? 'c:' + o.concepto_id : o.disciplina_id ? 'd:' + o.disciplina_id : '' }

  return (
    <div className="dsp-mapeo">
      <p className="dsp-nota">Todo el equipo, últimos 12 meses. <b>Palabra clave</b> = el nombre coincide con un concepto · <b>Reparto por mes</b> = se reparte entre los conceptos de la fase cobrados ese mes (est.) · <b>Solo fase</b> = no hubo concepto cobrado al cual atribuirla. Una corrección manual manda sobre lo automático.</p>
      <div className="dsp-tabla-wrap">
        <table className="dsp-tabla">
          <thead><tr><th>Actividad de Toggl</th><th className="n">Horas</th><th>Se ligó a</th><th>Cómo</th><th>Confianza</th><th className="no-print">Corregir</th></tr></thead>
          <tbody>
            {filas.map(a => {
              const cs = Object.entries(a.horasConcepto).sort((x, y) => y[1] - x[1])
              const destino = cs.length
                ? cs.slice(0, 3).map(([cid, h]) => `${conceptoKey.get(cid)?.key || '?'} (${num(h, 1)} h)`).join(', ') + (cs.length > 3 ? ` +${cs.length - 3}` : '')
                : a.metodo === 'ignorada' ? 'Ignorada' : a.disciplinas.length ? `Fase: ${a.disciplinas.slice(0, 2).join(' · ')}` : 'Sin ligar'
              const detalle = cs.map(([cid, h]) => `${conceptoKey.get(cid)?.key} ${conceptoKey.get(cid)?.description}: ${hrs(h, 1)}`).join('\n')
              return (
                <tr key={a.id}>
                  <td className="desc" title={a.nombre}>{a.nombre}</td>
                  <td className="n">{hrs(a.horas, 1)}</td>
                  <td title={detalle}>{destino}{a.horasFase > 0.05 && cs.length ? <span className="sub"> · {hrs(a.horasFase, 1)} en la fase</span> : null}</td>
                  <td className="sub">{ETIQUETA_METODO[a.metodo]}</td>
                  <td><span className={`dsp-conf ${a.confianza}`}>{CONF[a.confianza]}</span></td>
                  <td className="no-print">
                    <select className="input dsp-sel" value={valorDe(a.id)} disabled={guardando === a.id} onChange={e => cambiar(a, e.target.value)} aria-label={`Corregir ligado de ${a.nombre}`}>
                      <option value="">Automático</option>
                      <option value="ignorar">No ligar (ignorar)</option>
                      <optgroup label="Repartir en una fase">{discs.map(x => <option key={x.id} value={'d:' + x.id}>{x.name}</option>)}</optgroup>
                      {discs.map(x => (x.concepts || []).length ? <optgroup key={x.id} label={x.name}>{[...x.concepts].sort((a2, b2) => a2.sort_order - b2.sort_order).map(c => <option key={c.id} value={'c:' + c.id}>{c.key} {String(c.description).slice(0, 60)}</option>)}</optgroup> : null)}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function DesgloseConceptos({ tpId, email, meses = [], onAbrir, onCerrar }) {
  const datos = useContext(DatosDesempeno)
  const clavMeses = meses.join(',')
  const d = useMemo(() => (datos ? detalleProyecto(datos, { tpId, email, meses: clavMeses ? clavMeses.split(',') : undefined }) : null), [datos, tpId, email, clavMeses])
  const [todos, setTodos] = useState(false)
  const [verMapeo, setVerMapeo] = useState(false)
  const [nombres, setNombres] = useState({})
  const idsAct = (d?.enTrack || []).filter(x => x.actividadId && !x.conceptoId).map(x => String(x.actividadId)).join(',')
  useEffect(() => {
    if (!idsAct) return
    let vivo = true
    nombresActividades(idsAct.split(',')).then(n => { if (vivo) setNombres(n) })
    return () => { vivo = false }
  }, [idsAct])
  if (!d) return null

  const yo = d.personas.find(p => p.email?.toLowerCase() === String(email || '').toLowerCase())
  const horasPeriodo = yo ? (meses.length > 1 ? yo.total : yo.mes) : 0
  const planDe = area => d.areas.find(a => a.area === area)?.hhPresupuesto ?? null
  const conHoras = d.conceptos.filter(c => c.horas > 0.01).sort((a, b) => b.horas - a.horas)
  const sinHoras = d.conceptos.filter(c => !(c.horas > 0.01))
  const otras = d.enTrack.filter(x => !x.conceptoId)
  const hConcepto = conHoras.reduce((a, c) => a + c.horas, 0)
  const cobConcepto = conHoras.reduce((a, c) => a + c.cobrado, 0)
  const hOtras = otras.reduce((a, x) => a + x.horas, 0)
  // Toggl: cada actividad con sus horas; lo que no trae actividad queda en un renglón aparte
  const hToggl = Math.max(0, d.horasTogglPeriodo - d.horasTogglAct)
  const hLigadas = conHoras.reduce((a, c) => a + c.horasToggl, 0)
  const phReal = hConcepto > 0 && cobConcepto > 0 ? cobConcepto / hConcepto : null
  const planes = [...new Set(conHoras.map(c => planDe(c.area)).filter(Boolean))]
  const phPlan = planes.length === 1 ? planes[0] : null
  const maxH = Math.max(1, ...conHoras.map(c => c.horas), ...otras.map(x => x.horas), ...d.togglAct.map(x => x.horas), hToggl)

  return (
    <div className="dsp-detalle">
      <div className="dsp-detalle-tit">
        <b>{d.titulo}</b>
        <div className="no-print dsp-acciones">
          {d.proyecto && onAbrir && <button className="btn btn-outline btn-sm" onClick={() => onAbrir(d.proyecto)}>Estimaciones →</button>}
          {onCerrar && <button className="btn btn-outline btn-sm" onClick={onCerrar} aria-label="Cerrar desglose">✕</button>}
        </div>
      </div>

      <div className="dsp-datos">
        <Dato etiqueta="Sus horas" valor={hrs(horasPeriodo, 1)} nota={meses.length > 1 ? 'últimos 12 meses' : textoMes(datos.mes)} />
        <Dato etiqueta="Con concepto" valor={hrs(hConcepto, 1)} nota={hLigadas > 0.05 ? `${hrs(hLigadas, 1)} ligadas desde Toggl` : horasPeriodo > 0 ? `${pct(hConcepto / horasPeriodo)} de sus horas` : 'registradas en Track'} />
        <Dato etiqueta="Cobrado de esos conceptos" valor={dinero(cobConcepto, d.moneda)} />
        <Dato etiqueta="$/h real" valor={dinero(phReal, d.moneda)} nota="cobrado ÷ horas" tono={phReal != null && phPlan ? tono(phReal / phPlan) : ''} />
        {phPlan != null && <Dato etiqueta="$/h plan" valor={dinero(phPlan, d.moneda)} nota="contratado ÷ H-H (RC-OP-43)" />}
      </div>

      <ul className="dsp-lista-h">
        <li className="cab"><span>En qué</span><span>Horas</span><span>Cobrado</span><span>$/h</span></li>
        {conHoras.map(c => {
          const plan = planDe(c.area)
          const ph = c.porHora ?? c.porHoraPotencial
          const rel = c.porHora != null && plan ? c.porHora / plan : null
          return (
            <li key={c.id}>
              <span className="que" title={`${c.descripcion} · ${c.disciplina}`}><b style={{ borderColor: COLOR_AREA[c.area] }}>{c.key}</b>{c.descripcion}</span>
              <span className="h" title={origenTexto(c)}><i style={{ width: `${c.horas / maxH * 90}px` }} />{hrs(c.horas, 1)}{c.horasEstimadas > c.horas / 2 && <small className="dsp-est">est.</small>}</span>
              <span className="n">{c.cobrado > 0.5 ? dinero(c.cobrado, c.moneda) : <span className="sub">por cobrar</span>}</span>
              <span className={`n ${tono(rel)}`} title={plan ? `Plan ${dinero(plan, c.moneda)}/h` : ''}>{ph != null ? <>{dinero(ph, c.moneda)}{c.porHora == null && <small> pot.</small>}{rel != null && (rel >= 1 ? ' ▲' : ' ▼')}</> : '—'}</span>
            </li>
          )
        })}
        {otras.map(x => (
          <li key={x.k} className="otra">
            <span className="que">{x.actividadId ? nombres[String(x.actividadId)] || 'Actividad' : x.descripcion || 'Sin descripción'}</span>
            <span className="h"><i style={{ width: `${x.horas / maxH * 90}px` }} />{hrs(x.horas, 1)}</span>
            <span className="n sub">sin concepto</span><span className="n">—</span>
          </li>
        ))}
        {d.togglAct.map(x => (
          <li key={'t' + x.actividadId} className="toggl">
            <span className="que" title={x.nombre}><span className="dsp-tag-t">Toggl</span>{x.nombre}</span>
            <span className="h"><i style={{ width: `${x.horas / maxH * 90}px` }} />{hrs(x.horas, 1)}</span>
            <span className="n sub">sin concepto</span><span className="n">—</span>
          </li>
        ))}
        {hToggl > 0.05 && (
          <li className="otra">
            <span className="que" title="Horas de Toggl registradas sin actividad">Toggl sin actividad</span>
            <span className="h"><i style={{ width: `${hToggl / maxH * 90}px` }} />{hrs(hToggl, 1)}</span>
            <span className="n sub">—</span><span className="n">—</span>
          </li>
        )}
        {!conHoras.length && !otras.length && !d.togglAct.length && hToggl <= 0.05 && <li className="otra"><span className="que sub">Sin horas en el periodo.</span></li>}
      </ul>
      {!conHoras.length && <p className="dsp-nota">No hay horas ligadas a conceptos: este proyecto no tiene actividades de Toggl que se puedan ligar ni registros de Track con concepto.</p>}
      {d.ligado && (
        <>
          <button className="btn btn-outline btn-sm no-print" style={{ marginTop: 8, marginRight: 6 }} onClick={() => setVerMapeo(!verMapeo)}>{verMapeo ? 'Ocultar' : 'Ver'} cómo se ligaron las actividades</button>
          {verMapeo && <MapeoActividades tpId={tpId} />}
        </>
      )}

      {sinHoras.length > 0 && (
        <>
          <button className="btn btn-outline btn-sm no-print" style={{ marginTop: 8 }} onClick={() => setTodos(!todos)}>{todos ? 'Ocultar' : 'Ver'} los {sinHoras.length} conceptos del contrato sin horas</button>
          {todos && (
            <ul className="dsp-lista-h compacta">
              {sinHoras.map(c => (
                <li key={c.id} className={c.estado === 'Cobrado' ? 'otra' : ''}>
                  <span className="que" title={c.descripcion}><b style={{ borderColor: COLOR_AREA[c.area] }}>{c.key}</b>{c.descripcion}</span>
                  <span className="n sub">{c.hhPres != null ? `${hrs(c.hhPres)} plan` : ''}</span>
                  <span className="n">{dinero(c.monto, c.moneda)}</span>
                  <span className="n sub">{c.estado}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
