// Desglose de un proyecto dentro del reporte de desempeño (se abre al picarle a un proyecto).
// Arriba, una tarjeta por área con el semáforo H-H (RC-OP-43); al picarle se abren sus números y se filtran
// los conceptos. Abajo, pestañas: Conceptos · Actividades de Toggl · Equipo.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { fmtMoney } from '../utils/format'
import { detalleProyecto, cargarActividadesHoras } from '../lib/desempenoDetalle'
import { COLOR_AREA, textoMes, nombreCorto } from '../lib/proyecciones'
import { num } from '../lib/track'

export const DatosDesempeno = createContext(null)

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

export function ProyectoDetalle({ tpId, projectId, email, onAbrir, onCerrar }) {
  const datos = useContext(DatosDesempeno)
  const d = useMemo(() => (datos ? detalleProyecto(datos, { tpId, projectId, email }) : null), [datos, tpId, projectId, email])
  const [areaSel, setAreaSel] = useState(null)
  const [pestana, setPestana] = useState('conceptos')
  const [filtro, setFiltro] = useState('pendientes')
  const [actividades, setActividades] = useState(null)
  const ids = d?.tpIds.join(',')
  useEffect(() => {
    if (pestana !== 'toggl' || actividades) return
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
        {[['conceptos', `Conceptos${areaSel ? ' · ' + ETQ[areaSel] : ''}`], ['toggl', 'Actividades de Toggl'], ['equipo', `Equipo (${d.personas.length})`]].map(([k, t]) => (
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

      {pestana === 'toggl' && (
        actividades === null ? <p className="dsp-vacio">Cargando…</p> : actividades.length ? (
          <ul className="dsp-reparto">
            {actividades.slice(0, 15).map(x => (
              <li key={x.id}><span className="nombre" title={x.nombre}>{x.nombre}</span><span className="dsp-barra"><span style={{ width: `${(+x.horas_toggl) / maxAct * 100}%`, background: 'var(--green)' }} /></span><span className="n">{hrs(+x.horas_toggl, 1)}</span></li>
            ))}
          </ul>
        ) : <p className="dsp-vacio">Sin actividades con horas en Toggl.</p>
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
